// Recuperación híbrida. Solo hashes SHA-256 de tokens aleatorios; nunca tokens en D1.
const encoder=new TextEncoder();
const now=()=>Math.floor(Date.now()/1000);
const hex=buf=>Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
const rand=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
const sha=async str=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(str)));
const changed=r=>Number(r?.meta?.changes??r?.changes??0);
const tokenOK=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
export const validEmail=s=>typeof s==='string'&&s.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(s);
export const emailEnabled=env=>env.EMAIL_RECOVERY_ENABLED==='true'&&typeof env.RESEND_API_KEY==='string'&&env.RESEND_API_KEY.length>=12&&typeof env.EMAIL_FROM==='string'&&env.EMAIL_FROM.includes('@');
export const backupEnabled=env=>env.BACKUP_RECOVERY_ENABLED==='true';
const normalizeEmail=s=>s.trim().toLowerCase();

export async function emailProfile(env,userId){
  const row=await env.DB.prepare('SELECT email,verified_at FROM account_emails WHERE user_id=?').bind(userId).first();
  return {email:row?.email||null,verified:Boolean(row?.verified_at)};
}
export async function setPendingEmail(env,userId,value){
  if(!validEmail(value))throw Object.assign(new Error('Correo electrónico inválido.'),{status:400});
  const email=normalizeEmail(value),timestamp=now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_action_tokens WHERE user_id=? AND purpose=?').bind(userId,'verify'),
    env.DB.prepare(`INSERT INTO account_emails(user_id,email,verified_at,updated_at) VALUES(?,?,NULL,?)
      ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,
      verified_at=CASE WHEN account_emails.email=excluded.email THEN account_emails.verified_at ELSE NULL END,
      updated_at=excluded.updated_at`).bind(userId,email,timestamp)
  ]);
  return email;
}
async function resend(env,to,subject,url,purpose){
  const body=purpose==='verify'
    ? 'Verificá tu correo de LAST Lab Campus usando este enlace:'
    : 'Solicitaste restablecer tu contraseña de LAST Lab Campus. Si no fuiste vos, ignorá este mensaje.';
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,text:body+'\n\n'+url+'\n\nEste enlace es individual y vence pronto. No lo reenvíes.'})
  });
  if(!response.ok)throw new Error('El proveedor de correo no aceptó el envío ('+response.status+').');
}
async function sendAction(env,userId,email,purpose,origin){
  if(!emailEnabled(env))throw Object.assign(new Error('El correo de recuperación todavía no está configurado.'),{status:503});
  const code=rand(32),hash=await sha(code),created=now();
  const ttl=purpose==='verify'?24*3600:30*60;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_action_tokens WHERE user_id=? AND purpose=?').bind(userId,purpose),
    env.DB.prepare('INSERT INTO email_action_tokens(token_hash,user_id,email,purpose,created_at,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(hash,userId,email,purpose,created,created+ttl)
  ]);
  const url=origin+'/#'+(purpose==='verify'?'verificar-correo=':'restablecer-correo=')+code;
  try{await resend(env,email,purpose==='verify'?'Verificá tu correo · LAST Lab Campus':'Restablecé tu contraseña · LAST Lab Campus',url,purpose);}
  catch(e){
    await env.DB.prepare('DELETE FROM email_action_tokens WHERE token_hash=? AND used_at IS NULL').bind(hash).run();
    throw e;
  }
}
export async function startVerification(env,userId,origin){
  const profile=await emailProfile(env,userId);
  if(!profile.email)return {error:'Primero registrá un correo electrónico.'};
  if(profile.verified)return {ok:true,alreadyVerified:true};
  await sendAction(env,userId,profile.email,'verify',origin);
  return {ok:true};
}
export async function verifyEmail(env,code){
  if(!tokenOK(code))return false;
  const hash=await sha(code),timestamp=now(),claim=crypto.randomUUID();
  const rows=await env.DB.batch([
    env.DB.prepare(`UPDATE email_action_tokens SET used_at=?,claim_id=?
      WHERE token_hash=? AND purpose='verify' AND used_at IS NULL AND expires_at>?
      AND email=(SELECT email FROM account_emails WHERE user_id=email_action_tokens.user_id)`)
      .bind(timestamp,claim,hash,timestamp),
    env.DB.prepare(`UPDATE account_emails SET verified_at=?,updated_at=?
      WHERE user_id=(SELECT user_id FROM email_action_tokens WHERE token_hash=? AND claim_id=?)
      AND email=(SELECT email FROM email_action_tokens WHERE token_hash=? AND claim_id=?)`)
      .bind(timestamp,timestamp,hash,claim,hash,claim)
  ]);
  return changed(rows[0])===1&&changed(rows[1])===1;
}
export async function startEmailReset(env,identity,origin){
  const lookup=String(identity||'').trim().toLowerCase();
  if(!lookup||lookup.length>254)return;
  const row=await env.DB.prepare(`SELECT a.user_id,a.email FROM account_emails a
    JOIN users u ON u.id=a.user_id WHERE a.verified_at IS NOT NULL AND (a.email=? OR u.username=?)`)
    .bind(lookup,lookup).first();
  if(row)await sendAction(env,row.user_id,row.email,'reset',origin);
}
export async function completeEmailReset(env,code,pwd){
  if(!tokenOK(code))return false;
  const hash=await sha(code),timestamp=now(),claim=crypto.randomUUID();
  const rows=await env.DB.batch([
    env.DB.prepare(`UPDATE email_action_tokens SET used_at=?,claim_id=?
      WHERE token_hash=? AND purpose='reset' AND used_at IS NULL AND expires_at>?
      AND EXISTS (SELECT 1 FROM account_emails a WHERE a.user_id=email_action_tokens.user_id
        AND a.email=email_action_tokens.email AND a.verified_at IS NOT NULL)`)
      .bind(timestamp,claim,hash,timestamp),
    env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,password_iterations=?
      WHERE id=(SELECT user_id FROM email_action_tokens WHERE token_hash=? AND claim_id=?)`)
      .bind(pwd.hash,pwd.salt,pwd.iterations,hash,claim),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id=
      (SELECT user_id FROM email_action_tokens WHERE token_hash=? AND claim_id=?)`)
      .bind(hash,claim)
  ]);
  return changed(rows[0])===1&&changed(rows[1])===1;
}
export async function generateBackupCodes(env,userId){
  const created=now(),codes=[],statements=[
    env.DB.prepare('DELETE FROM account_backup_codes WHERE user_id=?').bind(userId)
  ];
  for(let i=0;i<8;i++){
    const code=rand(24);codes.push(code);
    statements.push(env.DB.prepare('INSERT INTO account_backup_codes(code_hash,user_id,created_at) VALUES(?,?,?)')
      .bind(await sha(code),userId,created));
  }
  await env.DB.batch(statements);
  return codes;
}
export async function backupStatus(env,userId){
  const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM account_backup_codes WHERE user_id=? AND used_at IS NULL')
    .bind(userId).first();
  return Number(row?.n||0);
}
export async function completeBackupReset(env,userId,code,pwd){
  if(typeof code!=='string'||!/^[0-9a-f]{48}$/.test(code))return false;
  const hash=await sha(code),timestamp=now(),claim=crypto.randomUUID();
  const rows=await env.DB.batch([
    env.DB.prepare('UPDATE account_backup_codes SET used_at=?,claim_id=? WHERE code_hash=? AND user_id=? AND used_at IS NULL')
      .bind(timestamp,claim,hash,userId),
    env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,password_iterations=?
      WHERE id=? AND EXISTS (SELECT 1 FROM account_backup_codes WHERE code_hash=? AND claim_id=?)`)
      .bind(pwd.hash,pwd.salt,pwd.iterations,userId,hash,claim),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND EXISTS
      (SELECT 1 FROM account_backup_codes WHERE code_hash=? AND claim_id=?)`)
      .bind(userId,hash,claim)
  ]);
  return changed(rows[0])===1&&changed(rows[1])===1;
}
