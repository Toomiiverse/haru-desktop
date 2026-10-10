/** Presentation only; all data and action state come from Core. Never renders email HTML. */
export function gmailPage():string{return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gmail · Haru</title>
<style>
:root{color-scheme:dark;font:16px/1.6 system-ui;background:#111318;color:#eceef3}body{margin:0}main{max-width:760px;margin:auto;padding:24px}a{color:#b8d6fa}h1{font-size:1.8rem}h2{font-size:1.15rem}section,article{border-top:1px solid #41464f;padding:20px 0}label{display:block;margin:12px 0}input[type=text],input[type=password]{display:block;width:100%;box-sizing:border-box;background:#1c2027;color:inherit;border:1px solid #697281;padding:10px;font:inherit;border-radius:5px}button{background:#e0e6ed;color:#111318;border:0;border-radius:5px;min-height:44px;padding:10px 16px;margin:4px 8px 4px 0;font:inherit;cursor:pointer}button.secondary{background:#303844;color:#fff}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:#1c2027;padding:14px}small,.muted{color:#bec4ce}#notice{min-height:26px;overflow-wrap:anywhere}#connect-link[hidden]{display:none}#connect-link{display:block;overflow-wrap:anywhere}details{margin:12px 0}summary{cursor:pointer}article h3{font-size:1rem}.row{display:flex;flex-wrap:wrap;gap:6px}code{overflow-wrap:anywhere}input[type=checkbox]{width:20px;height:20px;vertical-align:middle;margin-right:8px}@media(max-width:400px){main{padding:16px}}
</style><main><nav><a href="/">← Back to Haru</a></nav><h1>Gmail</h1><p>Inbox conversations, occasional summaries, and email actions you approve.</p>
<p id="notice" role="status" aria-live="polite">Loading connection…</p>
<section><h2>Connection</h2><p id="connection"></p><p id="freshness" class="muted"></p>
<details id="setup"><summary>Set up Google sign-in</summary><p>Create a separate Google OAuth <strong>Desktop app</strong> client with Gmail API enabled. Calendar and Tasks keep their existing connection.</p>
<form id="credentials"><label>Client ID<input id="client-id" type="text" required autocomplete="off"></label><label>Client secret<input id="client-secret" type="password" required autocomplete="off"></label><button>Save sign-in settings</button></form>
<p class="muted">Sign in from a desktop browser. When Haru runs on another machine, forward port 8766 to her server over SSH first. Google apps left in external Testing mode require authorization again after seven days.</p></details>
<div class="row"><button id="connect">Connect Gmail</button><button id="sync" class="secondary">Check now</button><button id="refresh" class="secondary">Refresh status</button><button id="disconnect" class="secondary">Disconnect</button></div><a id="connect-link" target="_blank" rel="noopener" hidden>Open Google sign-in</a>
<p id="signin-help" class="muted"></p><p class="muted">Disconnect removes Haru’s saved access token. You can also <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">revoke the Google grant</a>.</p></section>
<section><h2>How Haru uses email</h2><label><input id="spontaneous" type="checkbox">Let Haru offer an inbox summary when the moment fits</label><p class="muted">At most twice a day, at least four hours apart, respecting her existing quiet hours. No fixed schedule or individual new-email alerts.</p>
<label><input id="memory" type="checkbox">Remember useful email details with their source</label><p class="muted">Selected email excerpts may be processed by Haru’s current cloud providers. Disconnecting clears the inbox cache; accepted memories remain until you ask her to forget them.</p></section>
<section><h2>Actions to review</h2><p>Every mailbox change requires approval. Review all recipients and the complete message before sending. Attachments are not supported.</p><div id="operations"></div></section></main>
<script>
const $=id=>document.getElementById(id);let state=null;let busy=false;
function notice(text){$('notice').textContent=text;}
function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
async function api(op,args={}){const r=await fetch('/api/gmail/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Haru-Gmail-UI':'1'},body:JSON.stringify(args)});const data=await r.json();if(!r.ok)throw Error(data.error||'Gmail request failed');return data;}
async function load(){const r=await fetch('/api/gmail',{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not load Gmail');state=data;render();}
async function run(action){if(busy)return;busy=true;document.querySelectorAll('button,input').forEach(n=>n.disabled=true);try{await action();await load();}catch(e){notice(e.message||'The result could not be confirmed. Refresh status before trying again.');}finally{busy=false;document.querySelectorAll('button,input').forEach(n=>n.disabled=false);if(state)render();}}
function render(){
 $('connection').textContent=state.connected?'Connected as '+state.account:state.configured?'Ready to connect':'Google sign-in needs setup';
 $('freshness').textContent=state.lastSync?'Last successful check: '+new Date(state.lastSync*1000).toLocaleString()+(state.stale?' · Needs a fresh check':''):'No successful inbox check yet';
 $('spontaneous').checked=state.settings.spontaneous;$('memory').checked=state.settings.memory;
 $('connect').disabled=busy||state.connected||state.signInPending||!state.configured;$('disconnect').disabled=busy||(!state.connected&&!state.signInPending);$('sync').disabled=busy||!state.connected;
 if(state.lastError)notice(state.lastError);
 const list=$('operations');list.replaceChildren();
 const pending=state.operations.slice().reverse();if(!pending.length)list.append(node('p','No email actions to review. Ask Haru in chat to prepare one.'));
 for(const op of pending){const article=document.createElement('article');article.id=op.id;article.append(node('h3',op.action.replaceAll('_',' ')+' · '+op.status),node('p','Account: '+op.account+' · Action '+op.id));
  const p=op.preview||{};if(p.message)article.append(node('p','Message: '+p.message.subject+' — '+p.message.from));
  if(p.email){article.append(node('p','To: '+p.email.to.join(', ')),node('p','Cc: '+(p.email.cc.join(', ')||'None')),node('p','Bcc: '+(p.email.bcc.join(', ')||'None')),node('p','Subject: '+p.email.subject),node('pre',p.email.body));}
  if(p.labels)article.append(node('pre',JSON.stringify(p.labels,null,2)));
  if(op.status==='prepared'){article.append(node('p','Approval expires '+new Date(op.expiresAt*1000).toLocaleTimeString()));const approve=node('button','Approve '+op.action.replaceAll('_',' '));approve.disabled=busy||Date.now()>=op.expiresAt*1000;approve.onclick=()=>run(async()=>{const result=await api('confirm',{id:op.id,previewHash:op.previewHash});notice(result.result?.meaning||'Action status: '+result.status);});const cancel=node('button','Cancel');cancel.className='secondary';cancel.onclick=()=>run(async()=>{await api('cancel',{id:op.id});notice('Action cancelled.');});article.append(approve,cancel);}
  if(op.status==='unknown'){article.append(node('p','The outcome is unknown. Haru will not repeat this action automatically.'));const check=node('button','Check outcome');check.onclick=()=>run(async()=>{const r=await api('reconcile',{id:op.id});notice('Action status: '+r.status);});article.append(check);}
  if(op.result)article.append(node('p',op.result.meaning||op.status));if(op.error)article.append(node('p',op.error));list.append(article);
 }
}
$('credentials').onsubmit=e=>{e.preventDefault();run(async()=>{await api('credentials',{client_id:$('client-id').value.trim(),client_secret:$('client-secret').value.trim()});$('client-secret').value='';notice('Sign-in settings saved. Connect Gmail next.');});};
$('connect').onclick=()=>run(async()=>{const r=await api('connect');$('connect-link').href=r.url;$('connect-link').hidden=false;$('signin-help').textContent=r.instructions;notice('Open Google sign-in to authorize Gmail.');});
$('refresh').onclick=()=>run(async()=>{notice('Status refreshed.');});
$('sync').onclick=()=>run(async()=>{await api('sync');notice('Inbox check completed.');});
$('disconnect').onclick=()=>run(async()=>{await api('disconnect');notice('Gmail disconnected. Accepted memories remain.');});
for(const key of ['spontaneous','memory'])$(key).onchange=()=>{const checked=$(key).checked;run(async()=>{await api('settings',{[key]:checked});notice('Preference saved.');});};
load().then(()=>notice('')).catch(e=>notice(e.message));
</script></html>`;}
