// Invitaciones y recuperación asistida para LAST Lab Campus.
// Nunca almacena en D1 los códigos en claro; se devuelven una sola vez.
const enc = new TextEncoder();
const epoch = () => Math.floor(Date.now() / 1000);
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const randomCode = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))));
const tokenOK = code => typeof code === 'string' && /^[0-9a-f]{64}$/.test(code.trim());
const changes = row => Number(row?.meta?.changes ?? row?.changes ?? 0);

export async function issueInvites(env, adminId, payload) {
  const count=Number(payload?.count ?? 1);
  if(!Number.isInteger(count) || count<1 || count>50) return {error:'Se pueden generar entre 1 y 50 códigos por operación.'};
  const label=typeof payload?.label==='string'?payload.label.trim():'';
  if(label.length>80) return {error:'La referencia debe tener 80 caracteres como máximo.'};
  const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM course_invites WHERE redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>?')
    .bind(epoch()).first();
  if(Number(n?.n || 0)+count>250) return {error:'Límite de invitaciones activas alcanzado. Revocá o esperá el vencimiento de las existentes.'};
  const now=epoch(),expiresAt=now+7*86400;
  const codes=[],statements=[];
  // D1 Workers Free permite 50 consultas por ejecución y 100 parámetros
  // por consulta. Agrupamos 20 invitaciones por INSERT (20 x 5 = 100).
  // Emitir 50 códigos consume solo 3 INSERT, no 50 consultas separadas.
  const rows=[];
  for(let i=0;i<count;i++){
    const code=randomCode();
    codes.push(code);
    rows.push([await sha256(code),label,adminId,now,expiresAt]);
  }
  for(let i=0;i<rows.length;i+=20){
    const part=rows.slice(i,i+20);
    const placeholders=part.map(()=>'(?,?,?,?,?)').join(',');
    const values=part.flat();
    statements.push(env.DB.prepare('INSERT INTO course_invites(token_hash,label,created_by,created_at,expires_at) VALUES '+placeholders).bind(...values));
  }
  await env.DB.batch(statements);
  return {codes,label,expiresAt};
}
export async function listInvites(env){
  const result=await env.DB.prepare('SELECT token_hash,label,created_at,expires_at,redeemed_at,revoked_at FROM course_invites ORDER BY created_at DESC LIMIT 120').bind().all();
  return result.results||[];
}
export async function revokeInvite(env,hash){
  if(typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))return false;
  const r=await env.DB.prepare('UPDATE course_invites SET revoked_at=? WHERE token_hash=? AND redeemed_at IS NULL AND revoked_at IS NULL')
    .bind(epoch(),hash).run();
  return changes(r)===1;
}
export async function isValidInvite(env,code){
  if(!tokenOK(code)) return false;
  const found=await env.DB.prepare('SELECT token_hash FROM course_invites WHERE token_hash=? AND expires_at>? AND redeemed_at IS NULL AND revoked_at IS NULL')
    .bind(await sha256(code.trim()),epoch()).first();
  return Boolean(found);
}
export async function redeemInvite(env,code,person){
  if(!tokenOK(code))return false;
  const tokenHash=await sha256(code.trim()),now=epoch();
  // D1 batch es transaccional. Las dos escrituras usan el mismo claim_id
  // para impedir el doble uso de un código aun bajo concurrencia.
  const results=await env.DB.batch([
    env.DB.prepare('UPDATE course_invites SET redeemed_at=?,redeemed_by=? WHERE token_hash=? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>?')
      .bind(now,person.id,tokenHash,now),
    env.DB.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,password_iterations,role,created_at) SELECT ?,?,?,?,?,?,'student',? FROM course_invites WHERE token_hash=? AND redeemed_by=? AND redeemed_at=?")
      .bind(person.id,person.username,person.displayName,person.passwordHash,person.salt,person.iterations,now,tokenHash,person.id,now)
  ]);
  return changes(results[0])===1 && changes(results[1])===1;
}
export async function issueRecovery(env,adminId,username){
  if(typeof username!=='string'||username.length>30)return {error:'Ingresá un nombre de usuario válido.'};
  const user=await env.DB.prepare("SELECT id,username,role FROM users WHERE username=?").bind(username.trim().toLowerCase()).first();
  if(!user || user.role!=='student')return {error:'No se encontró una cuenta de estudiante válida.'};
  const code=randomCode(), now=epoch(), expiresAt=now+30*60;
  await env.DB.batch([
    env.DB.prepare('UPDATE password_recovery_codes SET revoked_at=? WHERE user_id=? AND redeemed_at IS NULL AND revoked_at IS NULL').bind(now,user.id),
    env.DB.prepare('INSERT INTO password_recovery_codes(token_hash,user_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?)')
      .bind(await sha256(code),user.id,adminId,now,expiresAt)
  ]);
  return {username:user.username,code,expiresAt};
}
export async function isValidRecovery(env,userId,code){
  if(!tokenOK(code)) return false;
  const row=await env.DB.prepare('SELECT token_hash FROM password_recovery_codes WHERE token_hash=? AND user_id=? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>?')
    .bind(await sha256(code.trim()),userId,epoch()).first();
  return Boolean(row);
}
export async function redeemRecovery(env,userId,code,passwordInfo){
  if(!tokenOK(code))return false;
  const hash=await sha256(code.trim()),now=epoch(),claimId=crypto.randomUUID();
  const rows=await env.DB.batch([
    env.DB.prepare('UPDATE password_recovery_codes SET redeemed_at=?,claim_id=? WHERE token_hash=? AND user_id=? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>?')
      .bind(now,claimId,hash,userId,now),
    env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,password_iterations=? WHERE id=? AND EXISTS (SELECT 1 FROM password_recovery_codes WHERE token_hash=? AND claim_id=?)')
      .bind(passwordInfo.hash,passwordInfo.salt,passwordInfo.iterations,userId,hash,claimId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM password_recovery_codes WHERE token_hash=? AND claim_id=?)')
      .bind(userId,hash,claimId)
  ]);
  return changes(rows[0])===1 && changes(rows[1])===1;
}
