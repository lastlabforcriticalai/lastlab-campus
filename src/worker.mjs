import { ANSWER_KEYS } from './quiz-keys.mjs';
import {issueInvites,listInvites,revokeInvite,isValidInvite,redeemInvite,issueRecovery,isValidRecovery,redeemRecovery} from './student-access.mjs';
import {validEmail,emailEnabled,backupEnabled,emailProfile,setPendingEmail,startVerification,verifyEmail,startEmailReset,completeEmailReset,generateBackupCodes,backupStatus,completeBackupReset} from './hybrid-recovery.mjs';

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
async function teacherGranted(env,userId){
  // Compatible with existing D1: no teacher table is required until a grant is created.
  try{
    const grant=await env.DB.prepare('SELECT user_id FROM teacher_grants WHERE user_id=?').bind(userId).first();
    return !!grant;
  }catch(error){
    if(/no such table: teacher_grants/i.test(String(error)))return false;
    throw error;
  }
}
const canTeach=u=>!!u&&(u.role==='admin'||u.role==='teacher');
async function session(env,req) {
  const token=fromCookie(req); if(!/^[0-9a-f]{64}$/.test(token))return null;
  const digest=await sha256(token);
  const user=await env.DB.prepare(`SELECT u.id, u.username, u.display_name, u.role, s.token_hash, s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(digest,now()).first();
  if(user&&user.role==='student'&&await teacherGranted(env,user.id))user.role='teacher';
  return user;
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
  const password=b.password,code=typeof b.inviteCode==='string'?b.inviteCode.trim():'';
  if(!usernameOK(username))return fail('Usuario: 3–30 caracteres, letras minúsculas, números, punto, guion o guion bajo.');
  if(typeof password!=='string'||password.length<12||password.length>128)return fail('La contraseña debe tener entre 12 y 128 caracteres.');
  if(display.length>80)return fail('El nombre visible no puede superar los 80 caracteres.');
  const needsEmail=emailEnabled(env);
  if(needsEmail){
    if(!validEmail(b.email))return fail('Para registrarte, ingresá un correo electrónico válido.');
    const used=await env.DB.prepare('SELECT user_id FROM account_emails WHERE email=?').bind(b.email.trim().toLowerCase()).first();
    if(used)return fail('Ese correo electrónico ya está asociado a otra cuenta.',409);
  }
  const registrationClosed=env.REGISTRATION_ENABLED!=='true';
  if(!await limit(env,req,registrationClosed?'bootstrap-register':'register',username,5,3600))
    return fail('Demasiados intentos de registro. Probá más tarde.',429);
  let role='student', invite=null;
  if(registrationClosed){
    const master=env.BOOTSTRAP_INVITE_CODE;
    const bootstrap=typeof master==='string'&&master.length>=32&&constantTimeEqual(code,master);
    if(bootstrap){
      const existing=await env.DB.prepare('SELECT COUNT(*) AS n FROM users').bind().first();
      if(Number(existing?.n||0)!==0)return fail('La activación inicial de administrador ya fue utilizada.',403);
      role='admin';
    }else if(env.INVITES_ENABLED==='true'&&await isValidInvite(env,code)){
      invite=code;
    }else{
      return fail('Inscripciones cerradas. Solicitá un código de invitación válido al docente.',403);
    }
  }
  const salt=randomHex(16),passHash=await derivePassword(password,salt),id=crypto.randomUUID();
  try{
    if(role==='admin'){
      const inserted=await env.DB.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,password_iterations,role,created_at) SELECT ?,?,?,?,?,?,'admin',? WHERE NOT EXISTS (SELECT 1 FROM users)")
        .bind(id,username,display||username,passHash,salt,ITERATIONS,now()).run();
      if(Number(inserted?.meta?.changes??inserted?.changes??0)!==1)return fail('La activación inicial ya fue utilizada.',403);
    }else if(invite){
      const ok=await redeemInvite(env,invite,{id,username,displayName:display||username,passwordHash:passHash,salt,iterations:ITERATIONS});
      if(!ok)return fail('La invitación ya fue usada, revocada o venció.',403);
    }else{
      await env.DB.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,password_iterations,role,created_at) VALUES(?,?,?,?,?,?,'student',?)")
        .bind(id,username,display||username,passHash,salt,ITERATIONS,now()).run();
    }
  }catch(e){if(String(e).includes('UNIQUE'))return fail('Ese nombre de usuario ya existe.',409);throw e;}
  let emailVerificationSent=null;
  if(needsEmail){
    try{
      await setPendingEmail(env,id,b.email);
      await startVerification(env,id,new URL(req.url).origin);
      emailVerificationSent=true;
    }catch(e){
      console.warn('LASTLab signup email delivery unavailable',String(e?.message||e));
      emailVerificationSent=false;
    }
  }
  return reply({ok:true,user:{id,username,displayName:display||username,role},
    ...(needsEmail?{emailVerificationSent}:{} )},201,{'Set-Cookie':await createSession(env,id)});
}
async function login(env,req) {
  const b=await body(req),identity=String(b.username||'').trim().toLowerCase();
  const byUsername=usernameOK(identity),byEmail=validEmail(identity);
  if((!byUsername&&!byEmail)||typeof b.password!=='string')return fail('Credenciales incorrectas.',401);
  if(!await limit(env,req,'login',identity,12,900))return fail('Demasiados intentos. Esperá 15 minutos.',429);
  // El correo solamente es un identificador de acceso después de verificarlo.
  // Conservamos siempre el ingreso con username para cuentas anteriores.
  const u=byUsername
    ?await env.DB.prepare(`SELECT id,username,display_name,password_hash,password_salt,password_iterations,role FROM users WHERE username=?`)
      .bind(identity).first()
    :await env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.password_hash,u.password_salt,u.password_iterations,u.role
        FROM users u JOIN account_emails e ON e.user_id=u.id
        WHERE e.email=? AND e.verified_at IS NOT NULL`)
      .bind(identity).first();
  // No revelar si el nombre o correo existe a través del mensaje o el tiempo de PBKDF2.
  const salt=u?.password_salt||'0'.repeat(32), hash=await derivePassword(b.password,salt,u?.password_iterations||ITERATIONS);
  if(!u||!constantTimeEqual(u.password_hash,hash))return fail('Credenciales incorrectas.',401);
  if(u.role==='student'&&await teacherGranted(env,u.id))u.role='teacher';
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
async function getProgress(env,u){
  const r=await env.DB.prepare('SELECT state_json,updated_at FROM progress WHERE user_id=? AND course_id=?').bind(u.id,COURSE_ID).first();
  let teacherFeedback=null;
  try{
    const review=await env.DB.prepare('SELECT feedback,updated_at FROM academic_reviews WHERE student_id=? AND course_id=?')
      .bind(u.id,COURSE_ID).first();
    if(review)teacherFeedback={text:review.feedback,updatedAt:review.updated_at};
  }catch(error){if(!/no such table: academic_reviews/i.test(String(error)))throw error;}
  return reply({ok:true,state:r?JSON.parse(r.state_json):null,updatedAt:r?.updated_at||null,teacherFeedback});
}
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
async function adminStudents(env,u){if(!canTeach(u))return fail('Acceso denegado.',403);
  const rows=await env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.created_at,
    COALESCE(json_array_length(json_extract(p.state_json,'$.done')),0) AS completed,
    (SELECT COUNT(*) FROM quiz_attempts a WHERE a.user_id=u.id AND a.course_id=?) AS quiz_attempts,
    (SELECT ROUND(AVG(CAST(a.score AS REAL)/a.total)*100,1) FROM quiz_attempts a
      WHERE a.user_id=u.id AND a.course_id=?) AS avg_quiz_percent,
    p.updated_at AS last_progress_at
    FROM users u LEFT JOIN progress p ON p.user_id=u.id AND p.course_id=?
    WHERE u.role='student'
    ORDER BY u.created_at DESC LIMIT 500`).bind(COURSE_ID,COURSE_ID,COURSE_ID).all();
  let teacherIds=new Set();
  try{
    const grants=await env.DB.prepare('SELECT user_id FROM teacher_grants').bind().all();
    teacherIds=new Set((grants.results||[]).map(g=>g.user_id));
  }catch(error){if(!/no such table: teacher_grants/i.test(String(error)))throw error;}
  return reply({ok:true,students:(rows.results||[]).filter(row=>!teacherIds.has(row.id))});
}
// Teaching access is a *grant* on an existing student account. The original
// users.role CHECK remains intact, avoiding a risky SQLite table rebuild.
async function manageTeachers(env,req,u,method){
  if(u.role!=='admin')return fail('Solo el administrador puede designar o revocar docentes.',403);
  if(method==='GET'){
    try{
      const result=await env.DB.prepare(`SELECT u.username,u.display_name,t.created_at
        FROM teacher_grants t JOIN users u ON u.id=t.user_id ORDER BY u.username`).bind().all();
      return reply({ok:true,teachers:result.results||[]});
    }catch(error){
      if(/no such table: teacher_grants/i.test(String(error)))return reply({ok:true,teachers:[]});
      throw error;
    }
  }
  if(method!=='POST'&&method!=='DELETE')return fail('Método no permitido.',405);
  const payload=await body(req),username=String(payload.username||'').trim().toLowerCase();
  if(!usernameOK(username))return fail('Ingresá un nombre de usuario válido.');
  const candidate=await env.DB.prepare('SELECT id,role FROM users WHERE username=?').bind(username).first();
  if(!candidate||candidate.role!=='student')return fail('La cuenta debe existir y no ser administradora.',404);
  if(method==='POST'){
    // Authorized admin operation; additive, idempotent, no data loss or migration of users.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS teacher_grants(
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      granted_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    )`).bind().run();
    await env.DB.prepare('INSERT OR IGNORE INTO teacher_grants(user_id,granted_by,created_at) VALUES(?,?,?)')
      .bind(candidate.id,u.id,now()).run();
    return reply({ok:true,username,role:'teacher'});
  }
  try{await env.DB.prepare('DELETE FROM teacher_grants WHERE user_id=?').bind(candidate.id).run();}
  catch(error){if(!/no such table: teacher_grants/i.test(String(error)))throw error;}
  return reply({ok:true,username,role:'student'});
}
async function teacherStudentWork(env,req,u,method){
  if(!canTeach(u))return fail('Acceso docente requerido.',403);
  if(method!=='GET'&&method!=='POST')return fail('Método no permitido.',405);
  const payload=method==='POST'?await body(req):{};
  const username=String(method==='POST'?payload.username:new URL(req.url).searchParams.get('username')||'').trim().toLowerCase();
  if(!usernameOK(username))return fail('Indicá el usuario del estudiante.');
  const student=await env.DB.prepare(`SELECT u.id,u.username,u.display_name,p.state_json,p.updated_at
    FROM users u LEFT JOIN progress p ON p.user_id=u.id AND p.course_id=?
    WHERE u.username=? AND u.role='student'`).bind(COURSE_ID,username).first();
  if(!student||await teacherGranted(env,student.id))return fail('No se encontró un estudiante.',404);
  if(method==='POST'){
    const feedback=payload.feedback;
    if(typeof feedback!=='string'||feedback.trim().length<1||feedback.length>3000)
      return fail('La devolución debe tener entre 1 y 3000 caracteres.');
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS academic_reviews(
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL,
      feedback TEXT NOT NULL,
      reviewed_by TEXT NOT NULL REFERENCES users(id),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(student_id,course_id)
    )`).bind().run();
    await env.DB.prepare(`INSERT INTO academic_reviews(student_id,course_id,feedback,reviewed_by,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(student_id,course_id) DO UPDATE SET
      feedback=excluded.feedback,reviewed_by=excluded.reviewed_by,updated_at=excluded.updated_at`)
      .bind(student.id,COURSE_ID,feedback.trim(),u.id,now()).run();
    return reply({ok:true,message:'Devolución guardada para el estudiante.'});
  }
  const state=student.state_json?JSON.parse(student.state_json):{};
  const attempts=await env.DB.prepare(`SELECT unit_number,score,total,created_at
    FROM quiz_attempts WHERE user_id=? AND course_id=? ORDER BY created_at DESC LIMIT 100`)
    .bind(student.id,COURSE_ID).all();
  let feedback=null;
  try{
    const review=await env.DB.prepare('SELECT feedback,updated_at FROM academic_reviews WHERE student_id=? AND course_id=?')
      .bind(student.id,COURSE_ID).first();
    feedback=review?{text:review.feedback,updatedAt:review.updated_at}:null;
  }catch(error){if(!/no such table: academic_reviews/i.test(String(error)))throw error;}
  // Never expose personal notes, credentials, email tokens or raw security information.
  return reply({ok:true,student:{username:student.username,displayName:student.display_name},
    task:typeof state.task==='string'?state.task:'',
    completed:Array.isArray(state.done)?state.done:[],
    updatedAt:student.updated_at||null,attempts:attempts.results||[],feedback});
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

async function resetPasswordWithTeacherCode(env,req){
  if(env.INVITES_ENABLED!=='true')return fail('Recuperación asistida no habilitada todavía.',503);
  const b=await body(req),username=String(b.username||'').trim().toLowerCase();
  const code=typeof b.recoveryCode==='string'?b.recoveryCode.trim():'';
  if(!usernameOK(username)||typeof b.newPassword!=='string'||b.newPassword.length<12||b.newPassword.length>128)
    return fail('Datos de recuperación inválidos.');
  if(!await limit(env,req,'recover',username,5,900))return fail('Demasiados intentos de recuperación.',429);
  const u=await env.DB.prepare("SELECT id FROM users WHERE username=? AND role='student'").bind(username).first();
  if(!u||!await isValidRecovery(env,u.id,code))return fail('Código inválido, usado o vencido.',403);
  const salt=randomHex(16),hash=await derivePassword(b.newPassword,salt);
  const redeemed=await redeemRecovery(env,u.id,code,{salt,hash,iterations:ITERATIONS});
  if(!redeemed)return fail('Código inválido, usado o vencido.',403);
  return reply({ok:true,message:'Contraseña actualizada. Iniciá sesión nuevamente.'});
}
async function studentInvitesAdmin(env,req,u,path,method){
  if(env.INVITES_ENABLED!=='true')return fail('El módulo de invitaciones aún no está habilitado. Falta aplicar su migración.',503);
  if(!canTeach(u))return fail('Acceso denegado.',403);
  if(path==='/api/admin/invites'&&method==='GET')return reply({ok:true,invites:await listInvites(env)});
  if(path==='/api/admin/invites'&&method==='POST'){
    if(!await limit(env,req,'admin-create-invites',u.id,12,3600))return fail('Límite de generación de invitaciones alcanzado.',429);
    const result=await issueInvites(env,u.id,await body(req));
    return result.error?fail(result.error):reply({ok:true,...result},201);
  }
  if(path==='/api/admin/invites/revoke'&&method==='POST'){
    const b=await body(req),ok=await revokeInvite(env,b.tokenHash);
    return ok?reply({ok:true}):fail('Invitación inexistente o ya utilizada.',404);
  }
  if(path==='/api/admin/recovery-code'&&method==='POST'){
    if(!await limit(env,req,'admin-recovery',u.id,10,3600))return fail('Límite de códigos de recuperación alcanzado.',429);
    const b=await body(req);
    if(u.role==='teacher'){
      const target=await env.DB.prepare('SELECT id FROM users WHERE username=? AND role=\'student\'')
        .bind(String(b.username||'').trim().toLowerCase()).first();
      if(!target||await teacherGranted(env,target.id))return fail('Sólo se pueden recuperar cuentas de estudiantes.',403);
    }
    const result=await issueRecovery(env,u.id,b.username);
    return result.error?fail(result.error,404):reply({ok:true,...result},201);
  }
  return fail('Ruta inexistente.',404);
}


const validNewPassword=p=>typeof p==='string'&&p.length>=12&&p.length<=128;
async function passwordMaterial(p){
  const salt=randomHex(16);
  return {hash:await derivePassword(p,salt),salt,iterations:ITERATIONS};
}
async function verifyCurrentPassword(env,u,password){
  if(typeof password!=='string')return false;
  const record=await env.DB.prepare('SELECT password_hash,password_salt,password_iterations FROM users WHERE id=?').bind(u.id).first();
  if(!record)return false;
  return constantTimeEqual(await derivePassword(password,record.password_salt,record.password_iterations),record.password_hash);
}
async function hybridPublic(env,req,path){
  const b=await body(req),origin=new URL(req.url).origin;
  if(path==='/api/auth/verify-email'){
    if(!emailEnabled(env))return fail('Verificación por correo no habilitada.',503);
    if(!await limit(env,req,'verify-email','',15,900))return fail('Demasiados intentos.',429);
    const ok=await verifyEmail(env,b.token);
    return ok?reply({ok:true,message:'Correo verificado. Tu cuenta ya admite recuperación por email.'}):fail('Enlace inválido, vencido o ya utilizado.',403);
  }
  if(path==='/api/auth/email-reset/request'){
    if(!emailEnabled(env))return fail('Recuperación por correo no habilitada todavía.',503);
    const identifier=String(b.identifier||'').trim().toLowerCase();
    if(identifier.length<3||identifier.length>254)return fail('Ingresá tu usuario o correo electrónico.');
    if(!await limit(env,req,'email-reset-ip','',10,3600)
        ||!await limit(env,req,'email-reset-request',identifier,3,3600))
      return fail('Demasiadas solicitudes. Intentá más tarde.',429);
    try{await startEmailReset(env,identifier,origin);}
    catch(e){console.error('Email reset provider issue',String(e?.message||e));}
    return reply({ok:true,message:'Si la cuenta tiene un correo verificado, recibirá un enlace para cambiar la contraseña.'});
  }
  if(path==='/api/auth/email-reset/complete'){
    if(!emailEnabled(env))return fail('Recuperación por correo no habilitada.',503);
    if(!validNewPassword(b.newPassword))return fail('La contraseña debe tener entre 12 y 128 caracteres.');
    if(!await limit(env,req,'email-reset-confirm','',8,900))return fail('Demasiados intentos.',429);
    const ok=await completeEmailReset(env,b.token,await passwordMaterial(b.newPassword));
    return ok?reply({ok:true,message:'Contraseña actualizada. Iniciá sesión nuevamente.'}):fail('Enlace inválido, usado o vencido.',403);
  }
  if(path==='/api/auth/backup-reset'){
    if(!backupEnabled(env))return fail('Códigos de respaldo no habilitados todavía.',503);
    const username=String(b.username||'').trim().toLowerCase();
    if(!usernameOK(username)||!validNewPassword(b.newPassword)||typeof b.code!=='string')
      return fail('Datos de recuperación inválidos.');
    if(!await limit(env,req,'backup-reset',username,5,900))return fail('Demasiados intentos de recuperación.',429);
    const u=await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first();
    if(!u)return fail('Código inválido o ya utilizado.',403);
    const ok=await completeBackupReset(env,u.id,b.code.trim().toLowerCase(),await passwordMaterial(b.newPassword));
    return ok?reply({ok:true,message:'Contraseña actualizada. Iniciá sesión nuevamente.'}):fail('Código inválido o ya utilizado.',403);
  }
  return fail('Ruta inexistente.',404);
}
async function hybridAccount(env,req,u,path,method){
  if(path==='/api/account/email'){
    if(!emailEnabled(env))return fail('Correo electrónico no configurado todavía.',503);
    if(method==='GET')return reply({ok:true,...await emailProfile(env,u.id)});
    if(method==='POST'){
      if(!await limit(env,req,'set-email',u.username,5,3600))return fail('Demasiados cambios de correo.',429);
      const b=await body(req);
      if(!validEmail(b.email))return fail('Correo electrónico inválido.');
      if(!await verifyCurrentPassword(env,u,b.password))return fail('Contraseña actual incorrecta.',403);
      try{
        const mail=await setPendingEmail(env,u.id,b.email);
        const result=await startVerification(env,u.id,new URL(req.url).origin);
        return reply({ok:true,email:mail,verified:!!result.alreadyVerified,
          message:result.alreadyVerified?'Correo previamente verificado.':'Revisá tu correo y utilizá el enlace de verificación.'});
      }catch(e){
        if(String(e).includes('UNIQUE'))return fail('Ese correo ya está asociado a otra cuenta.',409);
        console.error('LASTLab account email issue',String(e?.message||e));
        return fail('No se pudo enviar el correo de verificación. Revisá el servicio y volvé a intentarlo.',502);
      }
    }
  }
  if(path==='/api/account/email/resend'&&method==='POST'){
    if(!emailEnabled(env))return fail('Correo no configurado todavía.',503);
    if(!await limit(env,req,'resend-verify',u.username,3,3600))return fail('Esperá antes de solicitar otro correo.',429);
    try{
      const result=await startVerification(env,u.id,new URL(req.url).origin);
      return result.error?fail(result.error):reply({ok:true,message:result.alreadyVerified?'El correo ya estaba verificado.':'Enviamos otro enlace de verificación.'});
    }catch(e){
      console.error('LASTLab email resend issue',String(e?.message||e));
      return fail('No se pudo enviar el correo. Intentá más tarde.',502);
    }
  }
  if(path==='/api/account/backup-codes'){
    if(!backupEnabled(env))return fail('Códigos personales no habilitados todavía.',503);
    if(method==='GET')return reply({ok:true,remaining:await backupStatus(env,u.id)});
    if(method==='POST'){
      if(!await limit(env,req,'create-backup-codes',u.username,3,3600))return fail('Demasiadas regeneraciones de códigos.',429);
      const b=await body(req);
      if(!await verifyCurrentPassword(env,u,b.password))return fail('Contraseña actual incorrecta.',403);
      const codes=await generateBackupCodes(env,u.id);
      return reply({ok:true,codes,remaining:codes.length,message:'Guardá los códigos en un lugar seguro. Los anteriores dejaron de funcionar.'},201);
    }
  }
  return fail('Ruta inexistente.',404);
}

async function api(req,env){
  const url=new URL(req.url), path=url.pathname,method=req.method;
  if(path==='/api/health'&&method==='GET')return reply({ok:true,course:COURSE_ID});
  if(!env.DB || !env.RATE_LIMIT_SALT)return fail('Aplicación no configurada: faltan D1 o secretos.',503);
  if(!['GET','HEAD'].includes(method)&&!originOK(req))return fail('Origen no autorizado.',403);
  if(path==='/api/auth/register'&&method==='POST')return register(env,req);
  if(path==='/api/auth/login'&&method==='POST')return login(env,req);
  if(path==='/api/auth/features'&&method==='GET')return reply({ok:true,emailRecovery:emailEnabled(env),backupRecovery:backupEnabled(env)});
  if(method==='POST'&&(path==='/api/auth/verify-email'||path==='/api/auth/email-reset/request'||path==='/api/auth/email-reset/complete'||path==='/api/auth/backup-reset'))
    return hybridPublic(env,req,path);
  if(path==='/api/auth/reset-password'&&method==='POST')return resetPasswordWithTeacherCode(env,req);
  const u=await session(env,req);
  if(path==='/api/auth/me'&&method==='GET')return reply({ok:true,user:u?{id:u.id,username:u.username,displayName:u.display_name,role:u.role}:null});
  if(path==='/api/auth/logout'&&method==='POST'){
    if(u)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(u.token_hash).run();
    return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(!u)return fail('Iniciá sesión para usar esta función.',401);
  if(path==='/api/account/email'||path==='/api/account/email/resend'||path==='/api/account/backup-codes')
    return hybridAccount(env,req,u,path,method);
  if(path.startsWith('/api/admin/invites')||path==='/api/admin/recovery-code')return studentInvitesAdmin(env,req,u,path,method);
  if(path==='/api/admin/teachers')return manageTeachers(env,req,u,method);
  if(path==='/api/teacher/student-work')return teacherStudentWork(env,req,u,method);
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
