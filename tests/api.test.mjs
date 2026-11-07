import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.mjs';

const host='https://curso.lastlab.example';
function makeEnv(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));
 const adapt=(sql)=>({bind(...args){let stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args)}}});
 return {DB:{prepare:adapt,async batch(items){return Promise.all(items);}},RATE_LIMIT_SALT:'test-only-salt-NEVER-PRODUCTION',REGISTRATION_ENABLED:'true',ASSETS:{fetch:async()=>new Response('ok')}};
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
