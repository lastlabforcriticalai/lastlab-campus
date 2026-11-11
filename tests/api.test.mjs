import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.mjs';

const host='https://curso.lastlab.example';
function makeEnv(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8')+readFileSync(new URL('../migrations/0002_student_access.sql',import.meta.url),'utf8')+readFileSync(new URL('../migrations/0003_hybrid_recovery.sql',import.meta.url),'utf8'));
 const adapt=(sql)=>({bind(...args){let stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args)}}});
 return {DB:{prepare:adapt,async batch(items){sqlite.exec('BEGIN');try{const rows=[];for(const item of items)rows.push(await item.run());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}},RATE_LIMIT_SALT:'test-only-salt-NEVER-PRODUCTION',REGISTRATION_ENABLED:'true',ASSETS:{fetch:async()=>new Response('ok')}};
}
async function call(env,path,{method='GET',body,sessionCookie='',origin=host}={}){
 const headers={};if(origin)headers.origin=origin;if(sessionCookie)headers.cookie=sessionCookie;
 if(body!==undefined)headers['content-type']='application/json';
 const req=new Request(host+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const response=await worker.fetch(req,env);let data=null;try{data=await response.json()}catch{}
 return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
test('registro, inicio de sesión, progreso y autorización docente',async()=>{
 const env=makeEnv();
 let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'alumno_01',displayName:'Alumno Test',password:'pruebaLargaPorSeguridad2026!'}});
 assert.equal(r.status,201);assert.equal(r.data.user.role,'student');assert.match(r.cookie,/__Host-lastlab_session=/);
 const savedCookie=r.cookie;
 r=await call(env,'/api/auth/me',{sessionCookie:savedCookie});assert.equal(r.data.user.username,'alumno_01');
 r=await call(env,'/api/progress',{method:'PUT',sessionCookie:savedCookie,body:{state:{done:[1,4],notes:'lectura personal',task:'preguntas'}}});assert.equal(r.status,200);
 r=await call(env,'/api/progress',{sessionCookie:savedCookie});assert.deepEqual(r.data.state.done,[1,4]);
 r=await call(env,'/api/admin/students',{sessionCookie:savedCookie});assert.equal(r.status,403);
 r=await call(env,'/api/auth/logout',{method:'POST',sessionCookie:savedCookie,body:{}});assert.equal(r.status,200);
 r=await call(env,'/api/progress',{sessionCookie:savedCookie});assert.equal(r.status,401);
 r=await call(env,'/api/auth/login',{method:'POST',body:{username:'alumno_01',password:'pruebaLargaPorSeguridad2026!'}});assert.equal(r.status,200);
 r=await call(env,'/api/progress',{sessionCookie:r.cookie});assert.deepEqual(r.data.state.done,[1,4]);
});
test('el servidor califica y el cliente no fija la nota',async()=>{
 const env=makeEnv();let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'alumno_02',password:'contrasenaBastanteLarga2026'}});
 const key=r.cookie;
 r=await call(env,'/api/quiz/submit',{method:'POST',sessionCookie:key,body:{unit:0,answers:{0:0,1:0,2:0},score:99}});
 assert.equal(r.status,200);assert.equal(r.data.total,3);assert.equal(r.data.verified,true);assert.ok(r.data.score<=3);
 r=await call(env,'/api/quiz/submit',{method:'POST',sessionCookie:key,body:{unit:0,answers:{0:99,1:0,2:0}}});assert.equal(r.status,400);
 r=await call(env,'/api/quiz/submit',{method:'POST',sessionCookie:key,body:{unit:11,answers:{0:0,1:0,2:0}}});assert.equal(r.status,400);
});
test('protección contra peticiones externas y claves débiles',async()=>{
 const env=makeEnv();let r=await call(env,'/api/auth/register',{method:'POST',origin:'https://attacker.example',body:{username:'malicious',password:'123456789012'}});assert.equal(r.status,403);
 r=await call(env,'/api/auth/register',{method:'POST',body:{username:'sampleuser',password:'123'}});assert.equal(r.status,400);
});

test('inscripción desactivada por defecto en despliegues de prueba',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';
 const r=await call(env,'/api/auth/register',{method:'POST',body:{username:'prueba123',password:'contraseñaLargaDePrueba123'}});
 assert.equal(r.status,403);
});


test('bootstrap: primera cuenta docente con código privado y registro público cerrado',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'primero',password:'contrasenaDePrueba2026!',inviteCode:'codigo-invalido'}});
 assert.equal(r.status,403);
 r=await call(env,'/api/auth/register',{method:'POST',body:{username:'primero',displayName:'Docente Inicial',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,201);assert.equal(r.data.user.role,'admin');
 r=await call(env,'/api/admin/students',{sessionCookie:r.cookie});assert.equal(r.status,200);assert.deepEqual(r.data.students,[],'No mostrar la cuenta administradora en seguimiento de estudiantes');
 r=await call(env,'/api/auth/register',{method:'POST',body:{username:'segundo',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,403);
});

test('código bootstrap no da rol docente cuando inscripciones públicas están abiertas',async()=>{
 const env=makeEnv();env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 const r=await call(env,'/api/auth/register',{method:'POST',body:{username:'alumno_03',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,201);assert.equal(r.data.user.role,'student');
});


test('activar la cuenta inicial no hereda el bloqueo previo de registro general',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 const encoded=new TextEncoder().encode(env.RATE_LIMIT_SALT+'|register|local|primero');
 const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))).map(n=>n.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT INTO rate_limits(rate_key,bucket,hits) VALUES(?,?,?)').bind(key,Math.floor(Date.now()/1000/3600),99).run();
 const r=await call(env,'/api/auth/register',{method:'POST',body:{username:'primero',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,201);assert.equal(r.data.user.role,'admin');
});

test('activar la cuenta inicial sigue limitando intentos de códigos incorrectos',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 for(let i=0;i<5;i++){
   const r=await call(env,'/api/auth/register',{method:'POST',body:{username:'primero',password:'contrasenaDePrueba2026!',inviteCode:'equivocado'}});
   assert.equal(r.status,403);
 }
 const r=await call(env,'/api/auth/register',{method:'POST',body:{username:'primero',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,429);
});


test('PBKDF2 cumple con el máximo de Cloudflare Workers',()=>{
 const source=readFileSync(new URL('../src/worker.mjs',import.meta.url),'utf8');
 const configured=Number(source.match(/const ITERATIONS = (\d+);/)?.[1]);
 assert.ok(configured>0&&configured<=100000,'Workers rechaza PBKDF2 por encima de 100000');
});


test('docente genera invitaciones privadas, alumno se registra y el código se consume',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';env.INVITES_ENABLED='true';
 env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'profesor1',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,201);assert.equal(r.data.user.role,'admin');
 const teacherCookie=r.cookie;
 r=await call(env,'/api/admin/invites',{method:'POST',sessionCookie:teacherCookie,body:{count:2,label:'Piloto de noviembre'}});
 assert.equal(r.status,201);assert.equal(r.data.codes.length,2);
 const invite=r.data.codes[0];assert.match(invite,/^[0-9a-f]{64}$/);
 const dbRow=await env.DB.prepare('SELECT token_hash FROM course_invites LIMIT 1').bind().first();
 assert.notEqual(dbRow.token_hash,invite);
 r=await call(env,'/api/auth/register',{method:'POST',body:{username:'student1',password:'PasswordSeguroDePrueba2026!',inviteCode:invite}});
 assert.equal(r.status,201);assert.equal(r.data.user.role,'student');
 const studentCookie=r.cookie;
 const roster=await call(env,'/api/admin/students',{sessionCookie:teacherCookie});
 assert.equal(roster.status,200);
 assert.deepEqual(roster.data.students.map(student=>student.username),['student1'],'La lista muestra solo estudiantes');
 r=await call(env,'/api/admin/invites',{method:'POST',sessionCookie:studentCookie,body:{count:1}});
 assert.equal(r.status,403);
 r=await call(env,'/api/auth/register',{method:'POST',body:{username:'student2',password:'PasswordSeguroDePrueba2026!',inviteCode:invite}});
 assert.equal(r.status,403);
 r=await call(env,'/api/admin/invites',{sessionCookie:teacherCookie});
 assert.equal(r.status,200);assert.equal(r.data.invites.length,2);
 const unused=r.data.invites.find(row=>!row.redeemed_at);
 r=await call(env,'/api/admin/invites/revoke',{method:'POST',sessionCookie:teacherCookie,body:{tokenHash:unused.token_hash}});
 assert.equal(r.status,200);
 const secondCode=(await env.DB.prepare('SELECT token_hash FROM course_invites WHERE redeemed_at IS NOT NULL').bind().first()).token_hash;
 assert.equal(typeof secondCode,'string');
});

test('recuperación docente invalida el código y las sesiones antiguas',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';env.INVITES_ENABLED='true';
 env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'profesor2',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 const admin=r.cookie;
 r=await call(env,'/api/admin/invites',{method:'POST',sessionCookie:admin,body:{count:1}});
 const invite=r.data.codes[0];
 r=await call(env,'/api/auth/register',{method:'POST',body:{username:'student3',password:'PasswordOriginalSeguro2026!',inviteCode:invite}});
 const oldSession=r.cookie;
 r=await call(env,'/api/admin/recovery-code',{method:'POST',sessionCookie:admin,body:{username:'student3'}});
 assert.equal(r.status,201);assert.match(r.data.code,/^[0-9a-f]{64}$/);
 const resetCode=r.data.code;
 r=await call(env,'/api/auth/reset-password',{method:'POST',body:{username:'student3',recoveryCode:resetCode,newPassword:'OtraContrasenaSegura2026!'}});
 assert.equal(r.status,200);
 r=await call(env,'/api/auth/me',{sessionCookie:oldSession});assert.equal(r.data.user,null);
 r=await call(env,'/api/auth/reset-password',{method:'POST',body:{username:'student3',recoveryCode:resetCode,newPassword:'OtraContrasenaSegura2026!'}});
 assert.equal(r.status,403);
 r=await call(env,'/api/auth/login',{method:'POST',body:{username:'student3',password:'PasswordOriginalSeguro2026!'}});
 assert.equal(r.status,401);
 r=await call(env,'/api/auth/login',{method:'POST',body:{username:'student3',password:'OtraContrasenaSegura2026!'}});
 assert.equal(r.status,200);
});

test('módulo inactivo conserva el registro cerrado y rechaza administración nueva',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';env.INVITES_ENABLED='false';
 env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'profesor3',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,201);
 r=await call(env,'/api/admin/invites',{sessionCookie:r.cookie});
 assert.equal(r.status,503);
 r=await call(env,'/api/auth/register',{method:'POST',body:{username:'student4',password:'PasswordOriginalSeguro2026!',inviteCode:'a'.repeat(64)}});
 assert.equal(r.status,403);
});


test('lote de 50 invitaciones D1: tres consultas de escritura, máximo cien parámetros por SQL',async()=>{
 const env=makeEnv();env.REGISTRATION_ENABLED='false';env.INVITES_ENABLED='true';
 env.BOOTSTRAP_INVITE_CODE='CodigoDePruebaLocalNoUsarEnLaNube-1234567890';
 let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'profesor50',password:'contrasenaDePrueba2026!',inviteCode:env.BOOTSTRAP_INVITE_CODE}});
 assert.equal(r.status,201);const admin=r.cookie;
 let inserts=0;
 const prepare=env.DB.prepare;
 env.DB.prepare=sql=>{
   if(sql.startsWith('INSERT INTO course_invites(')){
     inserts++;
     assert.ok((sql.match(/\?/g)||[]).length<=100,'No superar 100 variables enlazadas por consulta D1');
   }
   return prepare(sql);
 };
 r=await call(env,'/api/admin/invites',{method:'POST',sessionCookie:admin,body:{count:50,label:'Cohorte de prueba'}});
 assert.equal(r.status,201);assert.equal(r.data.codes.length,50);
 assert.equal(new Set(r.data.codes).size,50);
 assert.equal(inserts,3);
 const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM course_invites').bind().first();
 assert.equal(row.n,50);
 r=await call(env,'/api/admin/invites',{method:'POST',sessionCookie:admin,body:{count:51,label:'No admitido'}});
 assert.equal(r.status,400);
});


test('recuperación autónoma: registro, email verificado y restablecimiento sin perder progreso',async()=>{
 const env=makeEnv();
 env.EMAIL_RECOVERY_ENABLED='true';env.RESEND_API_KEY='re_PRUEBA_SOLO_TESTS_1234567890';env.EMAIL_FROM='Acceso LAST Lab <acceso@pruebas.lastlab.lat>';
 const sent=[],originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
   assert.equal(url,'https://api.resend.com/emails');
   sent.push(JSON.parse(opts.body));
   assert.equal(opts.headers.Authorization,'Bearer '+env.RESEND_API_KEY);
   return new Response(JSON.stringify({id:'email-test-id'}),{status:200});
 };
 try{
   let r=await call(env,'/api/auth/features');
   assert.equal(r.data.emailRecovery,true);assert.equal(r.data.backupRecovery,false);
   r=await call(env,'/api/auth/register',{method:'POST',body:{username:'alumnoemail',displayName:'Alumno Email',email:'alumno@example.com',password:'Original_Contrasena_Segura_2026'}});
   assert.equal(r.status,201);assert.equal(r.data.emailVerificationSent,true);
   const oldCookie=r.cookie;
   assert.equal(sent.length,1);
   let token=sent[0].text.match(/#verificar-correo=([0-9a-f]{64})/)[1];
   let db=await env.DB.prepare("SELECT token_hash FROM email_action_tokens WHERE purpose='verify'").bind().first();
   assert.notEqual(db.token_hash,token);
   // Un correo registrado pero todavía no verificado no permite iniciar sesión.
   let byEmail=await call(env,'/api/auth/login',{method:'POST',body:{username:'alumno@example.com',password:'Original_Contrasena_Segura_2026'}});
   assert.equal(byEmail.status,401);
   // El nombre de usuario sigue funcionando durante la verificación.
   let byUsername=await call(env,'/api/auth/login',{method:'POST',body:{username:'alumnoemail',password:'Original_Contrasena_Segura_2026'}});
   assert.equal(byUsername.status,200);
   r=await call(env,'/api/auth/verify-email',{method:'POST',body:{token}});
   assert.equal(r.status,200);
   // Una vez verificado, se permiten email y nombre de usuario, pero nunca otra contraseña.
   byEmail=await call(env,'/api/auth/login',{method:'POST',body:{username:'ALUMNO@EXAMPLE.COM',password:'Original_Contrasena_Segura_2026'}});
   assert.equal(byEmail.status,200);assert.equal(byEmail.data.user.username,'alumnoemail');
   byEmail=await call(env,'/api/auth/login',{method:'POST',body:{username:'alumno@example.com',password:'Clave_Incorrecta_2026'}});
   assert.equal(byEmail.status,401);
   r=await call(env,'/api/auth/verify-email',{method:'POST',body:{token}});
   assert.equal(r.status,403);
   r=await call(env,'/api/account/email',{sessionCookie:oldCookie});
   assert.deepEqual({email:r.data.email,verified:r.data.verified},{email:'alumno@example.com',verified:true});
   r=await call(env,'/api/progress',{method:'PUT',sessionCookie:oldCookie,body:{state:{done:[0,2]}}});
   assert.equal(r.status,200);
   r=await call(env,'/api/auth/email-reset/request',{method:'POST',body:{identifier:'alumno@example.com'}});
   assert.equal(r.status,200);assert.equal(sent.length,2);
   token=sent[1].text.match(/#restablecer-correo=([0-9a-f]{64})/)[1];
   r=await call(env,'/api/auth/email-reset/complete',{method:'POST',body:{token,newPassword:'Nueva_Contrasena_Email_2026'}});
   assert.equal(r.status,200);
   r=await call(env,'/api/auth/me',{sessionCookie:oldCookie});assert.equal(r.data.user,null);
   r=await call(env,'/api/auth/email-reset/complete',{method:'POST',body:{token,newPassword:'Nueva_Contrasena_Email_2026'}});
   assert.equal(r.status,403);
   r=await call(env,'/api/auth/login',{method:'POST',body:{username:'alumnoemail',password:'Original_Contrasena_Segura_2026'}});
   assert.equal(r.status,401);
   r=await call(env,'/api/auth/login',{method:'POST',body:{username:'alumnoemail',password:'Nueva_Contrasena_Email_2026'}});
   assert.equal(r.status,200);
   r=await call(env,'/api/progress',{sessionCookie:r.cookie});
   assert.deepEqual(r.data.state.done,[0,2]);
 }finally{globalThis.fetch=originalFetch;}
});

test('autogestión de ocho códigos personales, cambio de clave y revocación de sesiones',async()=>{
 const env=makeEnv();env.BACKUP_RECOVERY_ENABLED='true';
 let r=await call(env,'/api/auth/register',{method:'POST',body:{username:'alumnobackup',password:'Clave_Prueba_Original_2026'}});
 assert.equal(r.status,201);const cookie=r.cookie;
 r=await call(env,'/api/auth/features');assert.equal(r.data.backupRecovery,true);
 r=await call(env,'/api/account/backup-codes',{method:'POST',sessionCookie:cookie,body:{password:'Clave_Prueba_Incorrecta_2026'}});
 assert.equal(r.status,403);
 r=await call(env,'/api/account/backup-codes',{method:'POST',sessionCookie:cookie,body:{password:'Clave_Prueba_Original_2026'}});
 assert.equal(r.status,201);assert.equal(r.data.codes.length,8);
 const code=r.data.codes[0];
 assert.match(code,/^[0-9a-f]{48}$/);assert.equal(new Set(r.data.codes).size,8);
 let row=await env.DB.prepare('SELECT code_hash FROM account_backup_codes LIMIT 1').bind().first();
 assert.notEqual(row.code_hash,code);
 r=await call(env,'/api/account/backup-codes',{sessionCookie:cookie});assert.equal(r.data.remaining,8);
 r=await call(env,'/api/auth/backup-reset',{method:'POST',body:{username:'alumnobackup',code,newPassword:'Clave_Nueva_Backup_2026'}});
 assert.equal(r.status,200);
 r=await call(env,'/api/auth/me',{sessionCookie:cookie});assert.equal(r.data.user,null);
 r=await call(env,'/api/auth/backup-reset',{method:'POST',body:{username:'alumnobackup',code,newPassword:'Clave_Nueva_Backup_2026'}});
 assert.equal(r.status,403);
 r=await call(env,'/api/auth/login',{method:'POST',body:{username:'alumnobackup',password:'Clave_Nueva_Backup_2026'}});
 assert.equal(r.status,200);
 r=await call(env,'/api/account/backup-codes',{sessionCookie:r.cookie});assert.equal(r.data.remaining,7);
});

test('recuperación autónoma cerrada por defecto y correo no configurable sin Resend',async()=>{
 const env=makeEnv();
 let r=await call(env,'/api/auth/features');
 assert.equal(r.data.emailRecovery,false);assert.equal(r.data.backupRecovery,false);
 r=await call(env,'/api/auth/email-reset/request',{method:'POST',body:{identifier:'alguien@example.com'}});
 assert.equal(r.status,503);
 r=await call(env,'/api/auth/backup-reset',{method:'POST',body:{username:'nobody',code:'a'.repeat(48),newPassword:'claveSeguraLaQueSea2026'}});
 assert.equal(r.status,503);
});
