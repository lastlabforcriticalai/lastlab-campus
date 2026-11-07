(() => {
  'use strict';
  const COURSE_KEY='fibia-v1';
  let user=null, bridge=null, timer=null, pending=null, saving=false, available=true, loginTab='login';
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
  function formMarkup(){return `<div class="tabset"><button type="button" data-tab="login" class="${loginTab==='login'?'active':''}">Ingresar</button><button type="button" data-tab="register" class="${loginTab==='register'?'active':''}">Crear usuario</button></div>
    <p>${loginTab==='login'?'Ingresá con tu usuario y contraseña para recuperar tu avance.':'Creá una cuenta para conservar tus evaluaciones y actividades aunque cambies de dispositivo.'}</p>
    <form id="accountForm"><div class="row"><label for="userInput">Nombre de usuario</label><input id="userInput" name="username" maxlength="30" minlength="3" pattern="[a-zA-Z0-9_.-]{3,30}" autocomplete="username" required placeholder="ejemplo: estudiante_01"></div>
    ${loginTab==='register'?'<div class="row"><label for="nameInput">Nombre visible (opcional)</label><input id="nameInput" name="displayName" maxlength="80" autocomplete="nickname"></div><div class="row"><label for="inviteInput">Código de activación (solo cuenta inicial)</label><input id="inviteInput" type="password" name="inviteCode" autocomplete="off" placeholder="Solo si las inscripciones están cerradas"><small>Este código es diferente de la contraseña. No se comparte ni se guarda en el navegador.</small></div>':''}
    <div class="row"><label for="passInput">Contraseña (mínimo 12 caracteres)</label><input type="password" id="passInput" name="password" autocomplete="${loginTab==='login'?'current-password':'new-password'}" required minlength="${loginTab==='login'?1:12}" maxlength="128"></div>
    <button class="primary" type="submit">${loginTab==='login'?'Iniciar sesión':'Crear mi cuenta'}</button></form>
    <div class="notice" id="accountNotice" hidden></div><p class="hint">En esta primera versión no solicitamos correo electrónico. Guardá tu contraseña: la recuperación automática todavía no está habilitada.</p>`;}
  function adminMarkup(){return `<p class="muted">Cuenta docente · <b>${esc(user.username)}</b></p><div class="controls"><button type="button" class="secondary" id="adminLoad">Consultar progreso de estudiantes</button><button type="button" class="secondary" id="adminCSV" disabled>Exportar CSV</button></div><div id="adminResult" class="table-wrap"></div>`;}
  function render(){
    if(!user){slot.innerHTML=formMarkup();slot.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{loginTab=el.dataset.tab;render()}));$('#accountForm').addEventListener('submit',onSubmit);return;}
    slot.innerHTML=`<p>Sesión iniciada como <b>${esc(user.displayName||user.username)}</b>. Tu avance se guarda en Cloudflare D1 y puede recuperarse desde otros dispositivos.</p>
    <div class="controls"><button class="primary" id="logout">Cerrar sesión</button><button class="secondary" id="passwordChange">Cambiar contraseña</button></div>
    <div class="notice" id="accountNotice" hidden></div>${user.role==='admin'?adminMarkup():''}
    <p class="hint">Privacidad: conservamos el nombre de usuario, el avance y los intentos de evaluación. No se piden documentos ni datos financieros.</p>`;
    $('#logout').onclick=logout;
    $('#passwordChange').onclick=changePasswordForm;
    if(user.role==='admin')$('#adminLoad').onclick=loadAdmin;
  }
  async function onSubmit(e){
    e.preventDefault();const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));
    notice('Conectando con el campus…');
    const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try{
      const data=await request('/api/auth/'+(loginTab==='login'?'login':'register'),{method:'POST',body:JSON.stringify(values)});
      user=data.user;await restoreProgress();refreshUI();render();notice('Sesión iniciada. Tu progreso está sincronizado.');
    }catch(err){notice(err.message,true)}finally{submit.disabled=false;}
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
  let exportRows=[];
  async function loadAdmin(){
    try{notice('Consultando resultados…');const result=await request('/api/admin/students');exportRows=result.students;
      $('#adminResult').innerHTML=`<table><thead><tr><th>Usuario</th><th>Nombre visible</th><th>Unidades</th><th>Intentos</th><th>Promedio</th></tr></thead><tbody>${exportRows.map(r=>`<tr><td>${esc(r.username)}</td><td>${esc(r.display_name)}</td><td>${r.completed}/10</td><td>${r.quiz_attempts}</td><td>${r.avg_quiz_percent??'—'}%</td></tr>`).join('')}</tbody></table>`;
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
  refreshUI();
})();
