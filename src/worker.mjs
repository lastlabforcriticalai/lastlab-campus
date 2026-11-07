import { ANSWER_KEYS } from './quiz-keys.mjs';

const COOKIE = '__Host-lastlab_session';
const COURSE_ID = 'fintech-blockchain-ia-2026';
const SESSION_DAYS = 14;
// Cloudflare Workers limits one PBKDF2 deriveBits operation to at most 100,000 iterations.
// Closed pilot only: reconsider authentication architecture before enrolling students.
const ITERATIONS = 100000;
const MAX_BODY_BYTES = 26000;
const MAX_STATE_BYTES = 22000;
const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const randomHex = bytes => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const usernameOK = s => typeof s === 'string' && /^[a-z0-9_][a-z0-9_.-]{2,29}$/.test(s);

function reply(data, status=200, headers={}) {
  return Response.json(data, { status, headers: { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers } });
}
function fail(message, status=400) { return reply({ok:false,error:message},status); }
function cookie(token, maxAge) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function fromCookie(req) { return (req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1) || ''; }
async function body(req) {
  const raw=await req.text();
  if (new Blob([raw]).size>MAX_BODY_BYTES) throw Object.assign(new Error('Solicitud demasiado grande'),{status:413});
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('El cuerpo debe ser JSON válido'),{status:400}); }
}
function originOK(req) {
  const origin=req.headers.get('origin');
  return Boolean(origin) && origin===new URL(req.url).origin;
}
async function derivePassword(password, saltHex, iterations=ITERATIONS) {
  const salt=new Uint8Array(saltHex.match(/../g).map(h=>parseInt(h,16)));
  const k=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const out=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},k,256);
  return hex(out);
}
function constantTimeEqual(a,b) {
  if (typeof a!=='string'||typeof b!=='string'||a.length!==b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function checkLimit(env,key,max,period) {
  const bucket=Math.floor(now()/period);
  await env.DB.prepare(`INSERT INTO rate_limits (rate_key, bucket, hits) VALUES (?, ?, 1)
    ON CONFLICT(rate_key) DO UPDATE SET hits=CASE WHEN bucket=excluded.bucket THEN hits+1 ELSE 1 END, bucket=excluded.bucket`)
    .bind(key,bucket).run();
  const r=await env.DB.prepare('SELECT hits FROM rate_limits WHERE rate_key=?').bind(key).first();
  return (r?.hits||0)<=max;
}
async function limit(env,req,action,username='',max=12,period=900) {
  const ip=req.headers.get('CF-Connecting-IP')||'local';
  // Store only a salted digest, never the raw visitor IP.
  const digest=await sha256(`${env.RATE_LIMIT_SALT}|${action}|${ip}|${username}`);
  return checkLimit(env,digest,max,period);
}
async function session(env,req) {
  const token=fromCookie(req); if(!/^[0-9a-f]{64}$/.test(token))return null;
  const digest=await sha256(token);
  return env.DB.prepare(`SELECT u.id, u.username, u.display_name, u.role, s.token_hash, s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(digest,now()).first();
}
async function createSession(env,userId) {
  const token=randomHex(32);
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .bind(await sha256(token),userId,now()+SESSION_DAYS*86400,now()).run();
  return cookie(token,SESSION_DAYS*86400);
}
async function register(env,req) {
  const b=await body(req), username=String(b.username||'').trim().toLowerCase();
  const display=String(b.displayName||'').trim();
  const password=b.password;
  if(!usernameOK(username))return fail('Usuario: 3–30 caracteres, letras minúsculas, números, punto, guion o guion bajo.');
  if(typeof password!=='string'||password.length<12||password.length>128)return fail('La contraseña debe tener entre 12 y 128 caracteres.');
  if(display.length>80)return fail('El nombre visible no puede superar los 80 caracteres.');
  const bootstrapMode=env.REGISTRATION_ENABLED!=='true';
  // Rate limits for closed pilot activation are independent of public registration.
  // Failed invitation attempts remain limited; legacy registration attempts cannot block bootstrap.
  if(!await limit(env,req,bootstrapMode?'bootstrap-register':'register',username,5,3600))
    return fail(bootstrapMode?'Demasiados intentos de activación. Probá más tarde.':'Demasiados registros. Probá más tarde.',429);
  // Registro público cerrado: la cuenta docente inicial requiere un código
  // guardado exclusivamente como secreto de Cloudflare.
  let role='student';
  if(env.REGISTRATION_ENABLED!=='true'){
    const provided=typeof b.inviteCode==='string'?b.inviteCode:'';
    const expected=env.BOOTSTRAP_INVITE_CODE;
    if(typeof expected!=='string'||expected.length<32||!constantTimeEqual(provided,expected))
      return fail('Inscripciones cerradas. Se necesita un código de activación para la cuenta inicial.',403);
    const existing=await env.DB.prepare('SELECT COUNT(*) AS n FROM users').bind().first();
    if(Number(existing?.n||0)!==0)return fail('La cuenta inicial ya fue creada. El código no puede reutilizarse.',403);
    role='admin';
  }
  // No pedimos email sin tener un mecanismo de verificación y recuperación.
  const salt=randomHex(16), passHash=await derivePassword(password,salt), id=crypto.randomUUID();
  try {
    const initial=role==='admin';
    const sql=initial
      ? `INSERT INTO users(id,username,display_name,password_hash,password_salt,password_iterations,role,created_at)
         SELECT ?,?,?,?,?,?,'admin',? WHERE NOT EXISTS (SELECT 1 FROM users)`
      : `INSERT INTO users(id,username,display_name,password_hash,password_salt,password_iterations,role,created_at)
         VALUES(?,?,?,?,?,?,'student',?)`;
    const inserted=await env.DB.prepare(sql).bind(id,username,display||username,passHash,salt,ITERATIONS,now()).run();
    if(initial && Number(inserted?.meta?.changes??inserted?.changes??0)!==1)
      return fail('La cuenta inicial ya fue creada. El código no puede reutilizarse.',403);
  }catch(e){if(String(e).includes('UNIQUE'))return fail('Ese usuario ya existe.',409);throw e;}
  return reply({ok:true,user:{id,username,displayName:display||username,role}},201,{'Set-Cookie':await createSession(env,id)});
}
async function login(env,req) {
  const b=await body(req),username=String(b.username||'').trim().toLowerCase();
  if(!usernameOK(username)||typeof b.password!=='string')return fail('Credenciales incorrectas.',401);
  if(!await limit(env,req,'login',username,12,900))return fail('Demasiados intentos. Esperá 15 minutos.',429);
  const u=await env.DB.prepare(`SELECT id,username,display_name,password_hash,password_salt,password_iterations,role FROM users WHERE username=?`)
    .bind(username).first();
  // A PBKDF2 calculation on absent accounts makes user-existence timing less distinctive.
  const salt=u?.password_salt||'0'.repeat(32), hash=await derivePassword(b.password,salt,u?.password_iterations||ITERATIONS);
  if(!u||!constantTimeEqual(u.password_hash,hash))return fail('Credenciales incorrectas.',401);
  return reply({ok:true,user:{id:u.id,username:u.username,displayName:u.display_name,role:u.role}},200,
    {'Set-Cookie':await createSession(env,u.id)});
}
function cleanProgress(input) {
  const obj=input && typeof input==='object' && !Array.isArray(input) ? input : {};
  const done=Array.isArray(obj.done)?[...new Set(obj.done.filter(x=>Number.isInteger(x)&&x>=0&&x<10))].sort((a,b)=>a-b):[];
  const text=(s,n)=>typeof s==='string'?s.slice(0,n):'';
  // No credentials, identity data or arbitrary JS payload are ever stored as progress.
  const quiz=obj.quiz&&typeof obj.quiz==='object'?obj.quiz:{};
  const moduleQuiz=obj.moduleQuiz&&typeof obj.moduleQuiz==='object'?obj.moduleQuiz:{};
  const co=obj.co&&typeof obj.co==='object'?obj.co:{};
  const safe={done,notes:text(obj.notes,7000),task:text(obj.task,7000),quiz:{},moduleQuiz:{},
    co:{income:Number(co.income)||1200,debt:Number(co.debt)||300,history:Number(co.history)||2,rate:Number(co.rate)||18,threshold:Number(co.threshold)||25},
    block:text(obj.block,1000),nonce:Number(obj.nonce)||0};
  for(const [k,v] of Object.entries(quiz))if(/^(?:[0-9]|1[0-9])$/.test(k)&&Number.isInteger(Number(v)))safe.quiz[k]=Number(v);
  for(const [k,v] of Object.entries(moduleQuiz))if(/^[0-9]$/.test(k)&&v&&typeof v==='object'){
    const answers={};for(const [q,a] of Object.entries(v.answers||{}))if(/^[0-2]$/.test(q)&&Number.isInteger(Number(a))&&Number(a)>=0&&Number(a)<=2)answers[q]=Number(a);
    safe.moduleQuiz[k]={answers,graded:!!v.graded,score:Number.isInteger(v.score)?Math.min(3,Math.max(0,v.score)):null};
  }
  const json=JSON.stringify(safe);if(new Blob([json]).size>MAX_STATE_BYTES)throw Object.assign(new Error('Progreso demasiado grande'),{status:413});
  return safe;
}
async function getProgress(env,u){const r=await env.DB.prepare('SELECT state_json,updated_at FROM progress WHERE user_id=? AND course_id=?').bind(u.id,COURSE_ID).first();return reply({ok:true,state:r?JSON.parse(r.state_json):null,updatedAt:r?.updated_at||null});}
async function putProgress(env,req,u) {
  const b=await body(req),state=cleanProgress(b.state);
  await env.DB.prepare(`INSERT INTO progress(user_id,course_id,state_json,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id,course_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
    .bind(u.id,COURSE_ID,JSON.stringify(state),now()).run();
  return reply({ok:true,savedAt:now()});
}
async function submitQuiz(env,req,u) {
  const b=await body(req),unit=b.unit,ans=b.answers;
  if(!Number.isInteger(unit)||unit<0||unit>=ANSWER_KEYS.length)return fail('Unidad inválida.');
  const keys=ANSWER_KEYS[unit];
  if(!ans||typeof ans!=='object')return fail('Respuestas faltantes.');
  const responses=keys.map((_,i)=>{
    const a=Array.isArray(ans)?ans[i]:ans[String(i)];
    return Number.isInteger(a)&&a>=0&&a<=2?a:null;
  });
  if(responses.some(a=>a===null))return fail('Respondé todas las preguntas antes de enviar.');
  const score=responses.reduce((v,a,i)=>v+Number(a===keys[i]),0);
  await env.DB.prepare('INSERT INTO quiz_attempts(user_id,course_id,unit_number,score,total,answers_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(u.id,COURSE_ID,unit,score,keys.length,JSON.stringify(responses),now()).run();
  return reply({ok:true,score,total:keys.length,unit,verified:true});
}
async function adminStudents(env,u){if(u.role!=='admin')return fail('Acceso denegado.',403);
  const rows=await env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.created_at,
    COALESCE(json_array_length(json_extract(p.state_json,'$.done')),0) AS completed,
    (SELECT COUNT(*) FROM quiz_attempts a WHERE a.user_id=u.id AND a.course_id=?) AS quiz_attempts,
    (SELECT ROUND(AVG(CAST(a.score AS REAL)/a.total)*100,1) FROM quiz_attempts a
      WHERE a.user_id=u.id AND a.course_id=?) AS avg_quiz_percent,
    p.updated_at AS last_progress_at
    FROM users u LEFT JOIN progress p ON p.user_id=u.id AND p.course_id=?
    ORDER BY u.created_at DESC LIMIT 500`).bind(COURSE_ID,COURSE_ID,COURSE_ID).all();
  return reply({ok:true,students:rows.results||[]});
}
async function changePassword(env,req,u){
  if(!await limit(env,req,'change-password',u.username,6,900))return fail('Demasiados intentos.',429);
  const b=await body(req),old=b.oldPassword,next=b.newPassword;
  if(typeof old!=='string'||typeof next!=='string'||next.length<12||next.length>128)return fail('Contraseña nueva: 12–128 caracteres.');
  const oldRecord=await env.DB.prepare('SELECT password_hash,password_salt,password_iterations FROM users WHERE id=?').bind(u.id).first();
  const oldHash=await derivePassword(old,oldRecord.password_salt,oldRecord.password_iterations);
  if(!constantTimeEqual(oldHash,oldRecord.password_hash))return fail('La contraseña actual no coincide.',401);
  const salt=randomHex(16),hash=await derivePassword(next,salt);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,password_iterations=? WHERE id=?').bind(hash,salt,ITERATIONS,u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)
  ]);
  return reply({ok:true,message:'Contraseña actualizada. Volvé a iniciar sesión.'},200,{'Set-Cookie':cookie('',0)});
}
async function deleteAccount(env,req,u){const b=await body(req);
  if(typeof b.password!=='string')return fail('Confirmá tu contraseña.');
  const rec=await env.DB.prepare('SELECT password_hash,password_salt,password_iterations FROM users WHERE id=?').bind(u.id).first();
  if(!constantTimeEqual(await derivePassword(b.password,rec.password_salt,rec.password_iterations),rec.password_hash))return fail('Contraseña incorrecta.',401);
  if(u.role==='admin')return fail('Una cuenta administradora debe ser degradada antes de eliminarse.',403);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM quiz_attempts WHERE user_id=?').bind(u.id),
    env.DB.prepare('DELETE FROM progress WHERE user_id=?').bind(u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id),
    env.DB.prepare('DELETE FROM users WHERE id=?').bind(u.id)
  ]);
  return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
}
async function api(req,env){
  const url=new URL(req.url), path=url.pathname,method=req.method;
  if(path==='/api/health'&&method==='GET')return reply({ok:true,course:COURSE_ID});
  if(!env.DB || !env.RATE_LIMIT_SALT)return fail('Aplicación no configurada: faltan D1 o secretos.',503);
  if(!['GET','HEAD'].includes(method)&&!originOK(req))return fail('Origen no autorizado.',403);
  if(path==='/api/auth/register'&&method==='POST')return register(env,req);
  if(path==='/api/auth/login'&&method==='POST')return login(env,req);
  const u=await session(env,req);
  if(path==='/api/auth/me'&&method==='GET')return reply({ok:true,user:u?{id:u.id,username:u.username,displayName:u.display_name,role:u.role}:null});
  if(path==='/api/auth/logout'&&method==='POST'){
    if(u)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(u.token_hash).run();
    return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(!u)return fail('Iniciá sesión para usar esta función.',401);
  if(path==='/api/progress'&&method==='GET')return getProgress(env,u);
  if(path==='/api/progress'&&method==='PUT')return putProgress(env,req,u);
  if(path==='/api/quiz/submit'&&method==='POST')return submitQuiz(env,req,u);
  if(path==='/api/admin/students'&&method==='GET')return adminStudents(env,u);
  if(path==='/api/auth/change-password'&&method==='POST')return changePassword(env,req,u);
  if(path==='/api/account'&&method==='DELETE')return deleteAccount(env,req,u);
  return fail('Ruta inexistente.',404);
}
const SECURE_HEADERS={
  'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
};
export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      const response=url.pathname.startsWith('/api/')?await api(request,env):await env.ASSETS.fetch(request);
      const out=new Response(response.body,response);
      for(const [k,v] of Object.entries(SECURE_HEADERS))out.headers.set(k,v);
      return out;
    }catch(e){
      console.error('LASTLab worker error',String(e.message||e));
      return fail(e.status && Number.isInteger(e.status)?e.message:'Error interno. Intentá nuevamente.',e.status||500);
    }
  }
};
