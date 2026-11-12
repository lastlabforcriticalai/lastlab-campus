(() => {
  'use strict';
  const COURSE_KEY='fibia-v1';
  let user=null, bridge=null, timer=null, pending=null, saving=false, available=true, loginTab='login';
  let recoveryMode='teacher',resetEmailToken=null;
  const recoveryFeatures={emailRecovery:false,backupRecovery:false};
  const existing=document.querySelector('.topRight');
  const button=document.createElement('button'); button.id='accountButton';button.className='topButton';button.textContent='Ingresar / Registrarse';existing.appendChild(button);
  const indicator=document.createElement('span');indicator.className='account-status';button.before(indicator);
  const dialog=document.createElement('dialog');dialog.className='account-dialog';dialog.setAttribute('aria-label','Cuenta del campus');
  dialog.innerHTML='<header><h2>Mi cuenta · LAST Lab</h2><button type="button" id="accountClose" aria-label="Cerrar">×</button></header><div class="account-body" id="accountContent"></div>';
  document.body.append(dialog);
  const slot=document.getElementById('accountContent');
  const $=sel=>slot.querySelector(sel);
  const esc=x=>String(x??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  async function request(path,opts={}) {
    let res;
    try {res=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}})}
    catch {throw Error('No se pudo conectar con el servidor del campus.');}
    let data;try{data=await res.json()}catch{throw Error('Respuesta inesperada del servidor.');}
    if(!res.ok||!data.ok)throw Error(data.error||`Error de conexión (${res.status})`);
    return data;
  }
  function notice(text,error=false){const el=$('#accountNotice');if(el){el.textContent=text||'';el.className='notice'+(error?' error':'');el.hidden=!text;}}
  function refreshUI(){
    button.textContent=user?`👤 ${user.username}`:'Ingresar / Registrarse';
    indicator.textContent=user?'Progreso sincronizado':available?'Modo invitado':'Solo modo invitado';
    indicator.classList.toggle('offline',!available);
    const side=document.querySelector('.sideFooter p');
    if(side)side.textContent=user?'El progreso se guarda en tu cuenta de LAST Lab. No ingreses datos personales o financieros reales en los ejercicios.':'Como invitado, el avance se guarda solo en este navegador. Registrate para conservarlo entre dispositivos.';
  }
  function open(){render();if(!dialog.open)dialog.showModal();}
  function close(){if(dialog.open)dialog.close();}
  button.addEventListener('click',open);dialog.querySelector('#accountClose').addEventListener('click',close);
  dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
  function formMarkup(){
    const login=loginTab==='login',register=loginTab==='register',recover=loginTab==='recover',link=loginTab==='emailLink';
    const tabs='<div class="tabset"><button type="button" data-tab="login" class="'+(login?'active':'')+'">Ingresar</button><button type="button" data-tab="register" class="'+(register?'active':'')+'">Crear usuario</button><button type="button" data-tab="recover" class="'+(recover||link?'active':'')+'">Recuperar</button></div>';
    const noticeHtml='<div class="notice" id="accountNotice" hidden></div>';
    if(link)return tabs+'<p>Elegí una contraseña nueva para completar la recuperación por correo.</p><form id="accountForm"><div class="row"><label for="newPass">Nueva contraseña (12 caracteres como mínimo)</label><input id="newPass" name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></div><button class="primary" type="submit">Guardar nueva contraseña</button></form>'+noticeHtml;
    if(recover){
      const chosen=recoveryMode==='email'&&!recoveryFeatures.emailRecovery?'teacher':recoveryMode==='backup'&&!recoveryFeatures.backupRecovery?'teacher':recoveryMode;
      const choices='<div class="recovery-choices">'
        +(recoveryFeatures.emailRecovery?'<button type="button" data-recovery="email" class="'+(chosen==='email'?'active':'')+'">Por correo</button>':'')
        +(recoveryFeatures.backupRecovery?'<button type="button" data-recovery="backup" class="'+(chosen==='backup'?'active':'')+'">Código personal</button>':'')
        +'<button type="button" data-recovery="teacher" class="'+(chosen==='teacher'?'active':'')+'">Ayuda docente</button></div>';
      const fields=chosen==='email'
        ?'<div class="row"><label for="identityInput">Usuario o correo verificado</label><input id="identityInput" name="identifier" required autocomplete="username"></div>'
        :'<div class="row"><label for="userInput">Nombre de usuario</label><input id="userInput" name="username" required maxlength="30" autocomplete="username"></div>'
          +'<div class="row"><label for="recoveryInput">'+(chosen==='backup'?'Uno de tus códigos personales':'Código entregado por el docente')+'</label><input id="recoveryInput" name="'+(chosen==='backup'?'code':'recoveryCode')+'" type="password" required autocomplete="off" maxlength="64"></div>'
          +'<div class="row"><label for="passInput">Nueva contraseña (mínimo 12 caracteres)</label><input type="password" id="passInput" name="newPassword" autocomplete="new-password" required minlength="12" maxlength="128"></div>';
      return tabs+'<p>'+(chosen==='email'?'Te enviaremos un enlace temporal, siempre que el correo de la cuenta esté verificado.':chosen==='backup'?'Usá un código personal que hayas guardado previamente.':'Solicitá al docente un código temporal de recuperación.')+'</p>'+choices
        +'<form id="accountForm">'+fields+'<button class="primary" type="submit">'+(chosen==='email'?'Solicitar enlace de recuperación':'Restablecer contraseña')+'</button></form>'+noticeHtml;
    }
    return tabs+'<p>'+(register?'Para conservar tu avance necesitás una invitación individual del docente.':'Ingresá con tu nombre de usuario o correo electrónico verificado y tu contraseña.')+'</p>'
      +'<form id="accountForm"><div class="row"><label for="userInput">'+(register?'Nombre de usuario':'Usuario o correo verificado')+'</label><input id="userInput" name="username" '+(register?'maxlength="30" minlength="3" pattern="[a-zA-Z0-9_.-]{3,30}"':'maxlength="254" minlength="3"')+' autocomplete="username" required></div>'
      +(register?'<div class="row"><label for="nameInput">Nombre visible (opcional)</label><input id="nameInput" name="displayName" maxlength="80" autocomplete="nickname"></div>'
        +(recoveryFeatures.emailRecovery?'<div class="row"><label for="registerEmail">Correo para recuperar tu cuenta (se verificará)</label><input id="registerEmail" name="email" type="email" autocomplete="email" maxlength="254" required></div>':'')
        +'<div class="row"><label for="inviteInput">Código individual de invitación</label><input id="inviteInput" name="inviteCode" type="password" autocomplete="off" required><small id="inviteLength">Longitud del código: 0 caracteres</small></div>':'')
      +'<div class="row"><label for="passInput">Contraseña (mínimo 12 caracteres)</label><input type="password" id="passInput" name="password" autocomplete="'+(login?'current-password':'new-password')+'" required minlength="'+(login?'1':'12')+'" maxlength="128"></div>'
      +'<button class="primary" type="submit">'+(register?'Crear mi cuenta':'Iniciar sesión')+'</button></form>'+noticeHtml
      +'<p class="hint">'+(recoveryFeatures.emailRecovery?'El correo se usa para verificar la identidad y recuperar el acceso.':'El envío autónomo por correo se habilitará al configurar Resend.')+'</p>';
  }
  function adminMarkup(){return '<div class="admin-tools"><section class="admin-section">'
    +'<h3>Seguimiento de estudiantes</h3><div class="controls"><button type="button" class="secondary" id="adminLoad">Consultar progreso de estudiantes</button><button type="button" class="secondary" id="adminCSV" disabled>Exportar CSV</button></div><div id="adminResult" class="table-wrap"></div>'
    +'</section><section class="admin-section"><h3>Invitar estudiantes</h3><p class="hint">Generá códigos de un solo uso, válidos por 7 días. Cada estudiante recibe uno distinto. El código solo se muestra al generarlo.</p>'
    +'<form id="invitesForm"><div class="admin-grid"><div class="row"><label for="inviteCount">Cantidad (1–50)</label><input id="inviteCount" name="count" type="number" min="1" max="50" value="1" required></div><div class="row"><label for="inviteLabel">Referencia del grupo</label><input id="inviteLabel" name="label" maxlength="80" placeholder="Curso de noviembre"></div></div><button class="primary" type="submit">Generar invitaciones</button></form>'
    +'<div id="invitesCreated" hidden><label for="inviteCodes">Códigos recién generados · copiá y guardá ahora</label><textarea id="inviteCodes" readonly rows="4"></textarea><button type="button" class="secondary" id="copyInvites">Copiar códigos</button></div>'
    +'<div class="controls"><button type="button" class="secondary" id="adminListInvites">Ver invitaciones y revocar</button></div><div id="adminInvitesResult" class="table-wrap"></div>'
    +'</section><section class="admin-section"><h3>Recuperación asistida</h3><p class="hint">Confirmá la identidad del alumno por fuera de esta web antes de entregarle el código. El código vence en 30 minutos y no sirve para cambiar cuentas docentes.</p>'
    +'<form id="resetIssueForm"><div class="row"><label for="resetStudent">Usuario del estudiante</label><input id="resetStudent" name="username" maxlength="30" required></div><button class="secondary" type="submit">Generar código de recuperación</button></form>'
    +'<div id="recoveryCreated" hidden><label for="resetCodeOutput">Código recién generado · copialo ahora</label><input id="resetCodeOutput" readonly><button type="button" class="secondary" id="copyReset">Copiar código</button></div>'
    +'</section><section class="admin-section"><h3>Revisar tareas de alumnos</h3>'
    +'<p class="hint">Consultá las propuestas escritas y los resultados de cuestionarios. Las notas personales del estudiante no se muestran.</p>'
    +'<div class="row"><label for="reviewUsername">Usuario del alumno</label><input id="reviewUsername" maxlength="30" autocomplete="off"></div>'
    +'<button class="secondary" id="reviewStudent">Consultar tarea y resultados</button><div id="studentWorkResult" class="table-wrap"></div>'
    +'</section>'
    +(user?.role==='admin'?'<section class="admin-section"><h3>Acceso de otros docentes</h3>'
      +'<p class="hint">Otorgá acceso académico a una cuenta existente. No recibe permisos de Cloudflare ni puede gestionar a otros docentes.</p>'
      +'<form id="teacherGrantForm"><div class="row"><label for="teacherUsername">Usuario registrado de la profesora</label><input id="teacherUsername" name="username" maxlength="30" required></div>'
      +'<button class="primary" type="submit">Habilitar docente</button></form><button class="secondary" id="teacherList">Ver docentes y revocar</button>'
      +'<div id="teacherGrantResults" class="table-wrap"></div></section>':'')
    +'</div>';}
  function render(){
    dialog.classList.toggle('admin-view',Boolean(user&&(user.role==='admin'||user.role==='teacher')));
    if(!user){slot.innerHTML=formMarkup();slot.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{loginTab=el.dataset.tab;render()}));slot.querySelectorAll('[data-recovery]').forEach(el=>el.addEventListener('click',()=>{recoveryMode=el.dataset.recovery;render()}));$('#accountForm').addEventListener('submit',onSubmit);$('#accountForm').addEventListener('input',()=>notice(''));const invite=$('#inviteInput');if(invite)invite.addEventListener('input',()=>{$('#inviteLength').textContent='Longitud del código: '+invite.value.length+' caracteres';});return;}
    slot.innerHTML=`<p>Sesión iniciada como <b>${esc(user.displayName||user.username)}</b>. Tu avance se guarda en Cloudflare D1 y puede recuperarse desde otros dispositivos.</p>
    <div class="controls"><button class="primary" id="logout">Cerrar sesión</button><button class="secondary" id="passwordChange">Cambiar contraseña</button></div>
    <div class="notice" id="accountNotice" hidden></div><section id="hybridAccount"></section><section id="academicFeedback"></section>${user.role==='admin'||user.role==='teacher'?adminMarkup():''}
    <p class="hint">Privacidad: conservamos el usuario, el avance y los resultados. Si registrás un correo, se usa para verificar la cuenta y recuperar el acceso. No solicitamos datos financieros reales.</p>`;
    $('#logout').onclick=logout;
    $('#passwordChange').onclick=changePasswordForm;
    loadHybridAccount();
    loadAcademicFeedback();
    if(user.role==='admin'||user.role==='teacher'){
      $('#adminLoad').onclick=loadAdmin;
      $('#invitesForm').onsubmit=issueInvitesFromPanel;
      $('#adminListInvites').onclick=loadInvitesFromPanel;
      $('#resetIssueForm').onsubmit=issueRecoveryFromPanel;
      $('#copyInvites').onclick=()=>copySecret($('#inviteCodes').value);
      $('#copyReset').onclick=()=>copySecret($('#resetCodeOutput').value);
      $('#reviewStudent').onclick=()=>loadStudentWork($('#reviewUsername').value);
      if(user.role==='admin'){
        $('#teacherGrantForm').onsubmit=grantTeacher;
        $('#teacherList').onclick=listTeachers;
      }
    }
  }
  async function onSubmit(e){
    e.preventDefault();const form=e.currentTarget,values=Object.fromEntries(new FormData(form));
    if(loginTab==='register'&&String(values.inviteCode||'').length<32){notice('El código de invitación tiene que tener al menos 32 caracteres.',true);return;}
    const btn=form.querySelector('[type=submit]');btn.disabled=true;notice('Conectando con el campus…');
    try{
      if(loginTab==='emailLink'){
        const data=await request('/api/auth/email-reset/complete',{method:'POST',body:JSON.stringify({token:resetEmailToken,newPassword:values.newPassword})});
        resetEmailToken=null;history.replaceState(null,'',location.pathname+location.search);
        loginTab='login';render();notice(data.message);
      }else if(loginTab==='recover'){
        let path,bodyData;
        if(recoveryMode==='email'&&recoveryFeatures.emailRecovery){
          path='/api/auth/email-reset/request';bodyData={identifier:values.identifier};
        }else if(recoveryMode==='backup'&&recoveryFeatures.backupRecovery){
          path='/api/auth/backup-reset';bodyData=values;
        }else{path='/api/auth/reset-password';bodyData=values;}
        const data=await request(path,{method:'POST',body:JSON.stringify(bodyData)});
        if(path!=='/api/auth/email-reset/request'){loginTab='login';render();}
        notice(data.message||'Revisá las instrucciones de recuperación.');
      }else{
        const data=await request('/api/auth/'+(loginTab==='login'?'login':'register'),{method:'POST',body:JSON.stringify(values)});
        user=data.user;await restoreProgress();refreshUI();render();
        const msg=data.emailVerificationSent===true?'Cuenta creada. Revisá tu correo para verificarlo.'
          :data.emailVerificationSent===false?'Cuenta creada, pero no se pudo enviar el enlace. Iniciá sesión y reenviá la verificación desde Mi cuenta.'
          :'Sesión iniciada. Tu progreso está sincronizado.';
        notice(msg,data.emailVerificationSent===false);
      }
    }catch(err){notice(err.message,true)}
    finally{btn.disabled=false;}
  }
  async function restoreProgress(){
    if(!bridge)return;
    const saved=await request('/api/progress');
    let next=saved.state;
    if(!next){
      // Only import existing guest work when the account has no prior progress.
      const local=bridge.getState();
      if(Array.isArray(local.done)&&local.done.length || local.task || local.notes || Object.keys(local.moduleQuiz||{}).length){
        await request('/api/progress',{method:'PUT',body:JSON.stringify({state:local})});next=local;
      }
    }
    bridge.applyRemote(next||{});
    try{localStorage.removeItem(COURSE_KEY)}catch{}
  }
  async function logout(){
    if(timer){clearTimeout(timer);timer=null;}if(user&&pending)await flush();
    try{await request('/api/auth/logout',{method:'POST',body:'{}'});}catch{}
    user=null;pending=null;refreshUI();bridge?.applyRemote({});
    try{localStorage.removeItem(COURSE_KEY)}catch{}
    render();notice('Sesión cerrada. Los datos personales ya no permanecen abiertos en este navegador.');
  }
  function queueSave(s){
    if(!user)return;pending=JSON.parse(JSON.stringify(s));
    if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;flush()},850);
    indicator.textContent='Guardando…';
  }
  async function flush(){
    if(saving||!pending||!user)return;
    saving=true;const next=pending;pending=null;
    try{await request('/api/progress',{method:'PUT',body:JSON.stringify({state:next})});indicator.textContent='Progreso sincronizado';}
    catch(err){pending=next;indicator.textContent='Cambios sin sincronizar';console.warn('LASTLab save',err.message)}
    finally{saving=false;if(pending&&user&&!timer)timer=setTimeout(()=>{timer=null;flush()},1600)}
  }
  async function submitQuiz(unit,answerMap){
    if(!user)throw Error('No hay sesión activa.');
    return request('/api/quiz/submit',{method:'POST',body:JSON.stringify({unit,answers:answerMap})});
  }
  function changePasswordForm(){
    slot.innerHTML=`<p>Para cambiar tu contraseña, confirmá primero la actual.</p><form id="passwordForm"><div class="row"><label for="oldPass">Contraseña actual</label><input id="oldPass" name="oldPassword" type="password" autocomplete="current-password" required></div><div class="row"><label for="newPass">Contraseña nueva (12 caracteres como mínimo)</label><input id="newPass" name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div><button class="primary">Cambiar contraseña</button><button type="button" class="secondary" id="back">Volver</button></form><div class="notice" id="accountNotice" hidden></div>`;
    $('#back').onclick=render;
    $('#passwordForm').onsubmit=async e=>{e.preventDefault();let b=Object.fromEntries(new FormData(e.currentTarget));try{await request('/api/auth/change-password',{method:'POST',body:JSON.stringify(b)});user=null;bridge?.applyRemote({});refreshUI();render();notice('Contraseña actualizada. Iniciá sesión nuevamente.')}catch(err){notice(err.message,true)}};
  }
  async function loadAcademicFeedback(){
    const host=$('#academicFeedback');if(!host)return;
    try{
      const data=await request('/api/progress');
      if(!host.isConnected)return;
      const fb=data.teacherFeedback;
      host.innerHTML=fb?.text
        ?'<div class="admin-section"><h3>Devolución de tu docente</h3>'
          +'<p class="hint">Actualizada: '+esc(new Date(fb.updatedAt*1000).toLocaleString('es'))+'</p>'
          +'<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(fb.text)+'</pre></div>'
        :'';
    }catch(error){console.warn('Devolución docente',error.message);}
  }
  async function loadHybridAccount(){
    const host=$('#hybridAccount');if(!host)return;
    if(!recoveryFeatures.emailRecovery&&!recoveryFeatures.backupRecovery){host.hidden=true;return;}
    host.hidden=false;
    host.innerHTML='<div class="admin-section recovery-panel"><h3>Recuperación autónoma</h3>'
      +(recoveryFeatures.emailRecovery?'<div id="emailStatus" class="hint">Consultando correo…</div>'
        +'<form id="emailForm"><div class="row"><label for="profileEmail">Correo electrónico</label><input id="profileEmail" type="email" name="email" maxlength="254" autocomplete="email" required></div>'
        +'<div class="row"><label for="profilePass">Contraseña actual (para asociar o cambiar el correo)</label><input id="profilePass" type="password" name="password" autocomplete="current-password" required></div>'
        +'<button type="submit" class="secondary">Guardar y verificar correo</button></form>'
        +'<button type="button" id="resendEmail" class="secondary">Reenviar verificación</button>':'')
      +(recoveryFeatures.backupRecovery?'<div id="backupStatus" class="hint">Consultando códigos…</div>'
        +'<p class="hint">Los códigos personales sirven sin correo, una sola vez cada uno. Guardalos fuera del campus.</p>'
        +'<form id="backupForm"><div class="row"><label for="backupPass">Contraseña actual</label><input id="backupPass" type="password" name="password" autocomplete="current-password" required></div>'
        +'<button type="submit" class="secondary">Crear o reemplazar mis ocho códigos</button></form>'
        +'<div id="newBackupCodes" hidden><label for="backupOutput">Códigos nuevos (guardalos ahora)</label><textarea id="backupOutput" readonly rows="6"></textarea><button type="button" class="secondary" id="copyBackup">Copiar códigos</button></div>':'')
      +'</div>';
    if(recoveryFeatures.emailRecovery){
      try{const p=await request('/api/account/email');if(!$('#emailStatus'))return;
        $('#emailStatus').textContent=p.email?(p.verified?'Correo verificado: ':'Correo pendiente de verificación: ')+p.email:'Todavía no registraste un correo.';
        if(p.email)$('#profileEmail').value=p.email;
      }catch(err){if($('#emailStatus'))$('#emailStatus').textContent=err.message;}
      const form=$('#emailForm');if(form)form.onsubmit=async e=>{
        e.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;
        try{const d=await request('/api/account/email',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
          await loadHybridAccount();notice(d.message);
        }catch(err){notice(err.message,true)}finally{btn.disabled=false;}
      };
      const resend=$('#resendEmail');if(resend)resend.onclick=async()=>{
        resend.disabled=true;
        try{const d=await request('/api/account/email/resend',{method:'POST',body:'{}'});notice(d.message);}
        catch(err){notice(err.message,true)}finally{resend.disabled=false;}
      };
    }
    if(recoveryFeatures.backupRecovery){
      try{const status=await request('/api/account/backup-codes');if($('#backupStatus'))$('#backupStatus').textContent='Códigos sin usar: '+status.remaining;}
      catch(err){if($('#backupStatus'))$('#backupStatus').textContent=err.message;}
      const form=$('#backupForm');if(form)form.onsubmit=async e=>{
        e.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;
        try{const d=await request('/api/account/backup-codes',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
          const box=$('#newBackupCodes');box.hidden=false;$('#backupOutput').value=d.codes.join('\n');form.reset();
          $('#backupStatus').textContent='Códigos sin usar: '+d.remaining;
          notice('Guardá los códigos ahora. Los anteriores dejaron de funcionar.');
        }catch(err){notice(err.message,true)}finally{btn.disabled=false;}
      };
      const copy=$('#copyBackup');if(copy)copy.onclick=()=>copySecret($('#backupOutput').value);
    }
  }
  let exportRows=[];
  async function copySecret(value){
    if(!value)return;
    try{await navigator.clipboard.writeText(value);notice('Código copiado. Compartilo únicamente con su destinatario.');}
    catch{notice('No se pudo copiar automáticamente. Seleccioná el código y copialo manualmente.',true);}
  }
  async function issueInvitesFromPanel(e){
    e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');
    button.disabled=true;notice('Generando códigos de invitación…');
    try{
      const data=await request('/api/admin/invites',{method:'POST',body:JSON.stringify({count:Number(form.elements.namedItem('count').value),label:form.elements.namedItem('label').value})});
      const box=$('#invitesCreated');box.hidden=false;
      $('#inviteCodes').value=data.codes.join('\n');
      notice(data.codes.length+' invitación(es) generada(s). Copiá los códigos ahora: no se pueden consultar después.');
      await loadInvitesFromPanel(true);
    }catch(err){notice(err.message,true)}finally{button.disabled=false;}
  }
  async function loadInvitesFromPanel(silent=false){
    try{
      if(!silent)notice('Consultando invitaciones…');
      const data=await request('/api/admin/invites');
      const rows=data.invites||[],container=$('#adminInvitesResult');
      container.innerHTML='<table class="invites-table"><thead><tr><th>Referencia</th><th>Creada</th><th>Estado</th><th>Acción</th></tr></thead><tbody>'
        +rows.map(r=>{
          const status=r.revoked_at?'Revocada':r.redeemed_at?'Usada':r.expires_at<Math.floor(Date.now()/1000)?'Vencida':'Disponible';
          const date=new Date(r.created_at*1000).toLocaleDateString('es');
          return '<tr><td>'+esc(r.label||'Sin referencia')+'</td><td>'+esc(date)+'</td><td>'+status+'</td><td>'+(status==='Disponible'?'<button class="secondary revoke-invite" data-hash="'+esc(r.token_hash)+'">Revocar</button>':'—')+'</td></tr>';
        }).join('')+'</tbody></table>';
      container.querySelectorAll('.revoke-invite').forEach(button=>button.onclick=async()=>{
        if(!confirm('¿Revocar esta invitación? No podrá utilizarse.'))return;
        try{await request('/api/admin/invites/revoke',{method:'POST',body:JSON.stringify({tokenHash:button.dataset.hash})});await loadInvitesFromPanel(true);notice('Invitación revocada.');}
        catch(err){notice(err.message,true);}
      });
      if(!silent)notice(rows.length+' invitación(es) registradas.');
    }catch(err){notice(err.message,true);}
  }
  async function issueRecoveryFromPanel(e){
    e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');
    button.disabled=true;notice('Creando código de recuperación…');
    try{
      const data=await request('/api/admin/recovery-code',{method:'POST',body:JSON.stringify({username:form.elements.namedItem('username').value})});
      $('#recoveryCreated').hidden=false;$('#resetCodeOutput').value=data.code;
      notice('Código de recuperación de '+data.username+' creado. Vence en 30 minutos; entregalo solo tras confirmar su identidad.');
    }catch(err){notice(err.message,true)}finally{button.disabled=false;}
  }
  async function loadStudentWork(username){
    const host=$('#studentWorkResult');if(!host)return;
    if(!username.trim()){notice('Ingresá el usuario del estudiante.',true);return;}
    host.textContent='Consultando entrega y evaluaciones…';
    try{
      const data=await request('/api/teacher/student-work?username='+encodeURIComponent(username.trim()));
      const attempts=data.attempts||[];
      const formatted=data.task?.trim()||'Todavía no hay propuesta escrita guardada.';
      const date=data.updatedAt?new Date(data.updatedAt*1000).toLocaleString('es'):'Sin entrega registrada';
      host.innerHTML='<h4>'+esc(data.student.displayName)+' ('+esc(data.student.username)+')</h4>'
        +'<p class="hint">Última actualización: '+esc(date)+'. Unidades completadas: '+Number(data.completed?.length||0)+'/10.</p>'
        +'<h4>Propuesta del taller</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(formatted)+'</pre>'
        +'<h4>Cuestionarios registrados</h4>'
        +(attempts.length?'<table><thead><tr><th>Unidad</th><th>Resultado</th><th>Fecha</th></tr></thead><tbody>'
          +attempts.map(a=>'<tr><td>'+Number(a.unit_number+1)+'</td><td>'+Number(a.score)+'/'+Number(a.total)+'</td><td>'+esc(new Date(a.created_at*1000).toLocaleString('es'))+'</td></tr>').join('')
          +'</tbody></table>':'<p>No hay cuestionarios enviados.</p>')
        +'<h4>Devolución docente</h4>'
        +'<form id="studentFeedbackForm"><textarea name="feedback" maxlength="3000" rows="5" placeholder="Escribí una devolución concreta y fundamentada para el estudiante." required>'+esc(data.feedback?.text||'')+'</textarea>'
        +'<button type="submit" class="primary">Guardar devolución</button></form>';
      $('#studentFeedbackForm').onsubmit=async event=>{
        event.preventDefault();
        const feedback=event.currentTarget.elements.namedItem('feedback').value;
        try{
          await request('/api/teacher/student-work',{method:'POST',body:JSON.stringify({username:data.student.username,feedback})});
          notice('Devolución guardada. El estudiante la verá en Mi cuenta.');
        }catch(error){notice(error.message,true);}
      };
      notice('Trabajo académico consultado.');
    }catch(err){host.textContent='';notice(err.message,true);}
  }
  async function grantTeacher(event){
    event.preventDefault();const form=event.currentTarget;
    const username=form.elements.namedItem('username').value.trim().toLowerCase();
    if(!username)return;
    try{await request('/api/admin/teachers',{method:'POST',body:JSON.stringify({username})});
      form.reset();notice('Acceso docente habilitado para '+username+'.');await listTeachers();}
    catch(err){notice(err.message,true);}
  }
  async function listTeachers(){
    try{
      const data=await request('/api/admin/teachers');
      const host=$('#teacherGrantResults');if(!host)return;
      host.innerHTML=(data.teachers||[]).length
        ?'<table><thead><tr><th>Usuario</th><th>Nombre</th><th>Acción</th></tr></thead><tbody>'
          +data.teachers.map(t=>'<tr><td>'+esc(t.username)+'</td><td>'+esc(t.display_name)+'</td><td><button class="secondary teacher-revoke" data-username="'+esc(t.username)+'">Revocar</button></td></tr>').join('')
          +'</tbody></table>'
        :'<p class="hint">Todavía no hay cuentas con permiso docente.</p>';
      host.querySelectorAll('.teacher-revoke').forEach(button=>button.onclick=async()=>{
        if(!confirm('¿Revocar el acceso docente de '+button.dataset.username+'?'))return;
        try{await request('/api/admin/teachers',{method:'DELETE',body:JSON.stringify({username:button.dataset.username})});await listTeachers();notice('Acceso docente revocado.');}
        catch(error){notice(error.message,true);}
      });
    }catch(err){notice(err.message,true);}
  }
  async function loadAdmin(){
    try{notice('Consultando resultados…');const result=await request('/api/admin/students');exportRows=result.students;
      $('#adminResult').innerHTML=`<table><thead><tr><th>Usuario</th><th>Nombre visible</th><th>Unidades</th><th>Intentos</th><th>Promedio</th><th>Tarea</th></tr></thead><tbody>${exportRows.map(r=>`<tr><td>${esc(r.username)}</td><td>${esc(r.display_name)}</td><td>${r.completed}/10</td><td>${r.quiz_attempts}</td><td>${r.avg_quiz_percent??'—'}%</td><td><button type="button" class="secondary student-review-link" data-username="${esc(r.username)}">Ver tarea</button></td></tr>`).join('')}</tbody></table>`;
      $('#adminResult').querySelectorAll('.student-review-link').forEach(button=>button.onclick=()=>{
        $('#reviewUsername').value=button.dataset.username;loadStudentWork(button.dataset.username);
      });
      $('#adminCSV').disabled=false;$('#adminCSV').onclick=exportCSV;notice(`${exportRows.length} estudiantes encontrados.`);
    }catch(err){notice(err.message,true)}
  }
  function exportCSV(){
    const escapeCSV=v=>`"${String(v??'').replace(/^[=+@-]/,"'&").replaceAll('"','""')}"`;
    const rows=[['Usuario','Nombre','Unidades','Intentos','Promedio (%)'],...exportRows.map(r=>[r.username,r.display_name,r.completed,r.quiz_attempts,r.avg_quiz_percent??''])];
    const csv='\ufeff'+rows.map(r=>r.map(escapeCSV).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lastlab-alumnos.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  async function connect(b){
    bridge=b;try{const res=await request('/api/auth/me');user=res.user;available=true;if(user)await restoreProgress();}catch{available=false;user=null;}
    refreshUI();
  }
  async function clearProgress(){
    if(!user)return false;
    await request('/api/progress',{method:'PUT',body:JSON.stringify({state:{}})});
    bridge?.applyRemote({});return true;
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&user&&pending)flush()});
  window.LASTAuth={connect,isLoggedIn:()=>Boolean(user),queueSave,submitQuiz,clearProgress,open};
  // Fragmentos: el token no se transmite en la URL HTTP, solo en el cuerpo POST.
  const fragment=location.hash||'';
  if(/^#restablecer-correo=[0-9a-f]{64}$/.test(fragment)){
    resetEmailToken=fragment.split('=')[1];loginTab='emailLink';setTimeout(open,0);
  }else if(/^#verificar-correo=[0-9a-f]{64}$/.test(fragment)){
    const token=fragment.split('=')[1];
    history.replaceState(null,'',location.pathname+location.search);
    setTimeout(async()=>{
      open();notice('Verificando correo…');
      try{const d=await request('/api/auth/verify-email',{method:'POST',body:JSON.stringify({token})});notice(d.message);}
      catch(err){notice(err.message,true);}
    },0);
  }
  request('/api/auth/features').then(d=>{
    recoveryFeatures.emailRecovery=!!d.emailRecovery;
    recoveryFeatures.backupRecovery=!!d.backupRecovery;
    if(dialog.open){const msg=$('#accountNotice')?.textContent;const error=$('#accountNotice')?.classList.contains('error');render();if(msg)notice(msg,error);}
  }).catch(()=>{});
  refreshUI();
})();
