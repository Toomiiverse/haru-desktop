// The two pages the phone ever sees.
//
// Written as plain HTML with no build step and no imports. The desktop app is
// React through Vite, and a second Vite target for one chat screen would mean a
// second build to keep working, a second set of assets to ship, and a packaging
// path to get wrong — for a page that is a list, a text box and four tabs.
//
// Nothing is fetched from anywhere: no fonts, no icons, no framework. That is
// what lets the server send a content policy forbidding every outside origin,
// which in turn means a hostile string that reaches this page has nowhere to
// send anything it finds.

const SHELL = `
  :root { color-scheme: dark; --bg:#16132a; --panel:#1e1a38; --line:#2f2a52; --text:#e9e6f5; --dim:#a49dc4; --accent:#f2a3c0; --mine:#3a3163; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; }
  input, textarea, button { font: inherit; color: inherit; }
  input, textarea { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:.7rem .9rem; width:100%; }
  input:focus, textarea:focus { outline:none; border-color:var(--accent); }
  button { background:var(--accent); color:#241a2c; border:0; border-radius:12px; padding:.7rem 1.1rem; font-weight:600; }
  button:disabled { opacity:.5; }
  .err { color:#ff9a9a; min-height:1.4em; font-size:.9rem; }
`;

export function loginPage(): string {
  return `<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Haru</title><style>${SHELL}
  main { max-width:26rem; margin:0 auto; padding:18vh 1.25rem 2rem; }
  h1 { font-size:1.6rem; margin:0 0 .25rem; }
  p.sub { color:var(--dim); margin:0 0 1.75rem; font-size:.95rem; }
  label { display:block; margin:0 0 .9rem; }
  label span { display:block; font-size:.85rem; color:var(--dim); margin-bottom:.35rem; }
  .row { display:flex; align-items:center; gap:.6rem; margin:1rem 0 1.25rem; color:var(--dim); font-size:.9rem; }
  .row input { width:auto; accent-color:var(--accent); }
</style>
<main>
  <h1>Haru</h1>
  <p class=sub>She is at home. Sign in to reach her.</p>
  <form id=f>
    <label><span>Name</span><input name=username autocomplete=username autocapitalize=none required></label>
    <label><span>Password</span><input name=password type=password autocomplete=current-password required></label>
    <div class=row><input type=checkbox id=r name=remember checked><label for=r style=margin:0>Remember this device</label></div>
    <button id=go>Sign in</button>
    <p class=err id=e></p>
  </form>
</main>
<script>
const f=document.getElementById('f'),e=document.getElementById('e'),go=document.getElementById('go');
f.addEventListener('submit',async ev=>{
  ev.preventDefault(); e.textContent=''; go.disabled=true; go.textContent='…';
  const d=new FormData(f);
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({username:d.get('username'),password:d.get('password'),remember:d.get('remember')==='on',device:navigator.userAgent.slice(0,60)})});
    if(r.ok){location.reload();return;}
    e.textContent=(await r.json().catch(()=>({}))).error||'That did not work.';
  }catch{ e.textContent='Could not reach her.'; }
  go.disabled=false; go.textContent='Sign in';
});
</script>`;
}

export function appPage(): string {
  return `<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Haru</title><style>${SHELL}
  body { display:flex; flex-direction:column; height:100dvh; }
  header { display:flex; gap:.4rem; padding:.6rem .75rem; border-bottom:1px solid var(--line); overflow-x:auto; }
  header button { background:none; color:var(--dim); padding:.4rem .8rem; border-radius:999px; font-weight:500; }
  header button.on { background:var(--panel); color:var(--text); }
  header .out { margin-left:auto; color:var(--dim); font-size:.85rem; }
  section { flex:1; overflow-y:auto; padding:1rem .9rem; display:none; }
  section.on { display:block; }
  .msg { max-width:85%; padding:.6rem .85rem; border-radius:16px; margin:0 0 .6rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .them { background:var(--panel); border-bottom-left-radius:5px; }
  .me { background:var(--mine); margin-left:auto; border-bottom-right-radius:5px; }
  .sys { color:var(--dim); font-size:.85rem; text-align:center; max-width:100%; }
  form.compose { display:flex; gap:.5rem; padding:.65rem; border-top:1px solid var(--line); }
  form.compose textarea { resize:none; max-height:7rem; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:.75rem .9rem; margin:0 0 .6rem; }
  .card h3 { margin:0 0 .2rem; font-size:1rem; font-weight:600; }
  .card time { color:var(--dim); font-size:.85rem; }
  .card button { background:none; border:1px solid var(--line); color:var(--dim); padding:.35rem .7rem; font-size:.85rem; margin-top:.5rem; }
  .done { opacity:.45; }
  .quiet { color:var(--dim); }
  .jrow { display:flex; gap:.6rem; margin:.6rem 0; }
</style>
<header>
  <button data-t=chat class=on>Chat</button>
  <button data-t=agenda>Agenda</button>
  <button data-t=journal>Journal</button>
  <button data-t=memory>Memory</button>
  <button class=out id=out>Sign out</button>
</header>
<section id=chat class=on></section>
<form class=compose id=cf><textarea id=ci rows=1 placeholder="Say something…"></textarea><button id=cb>Send</button></form>
<section id=agenda></section>
<section id=journal></section>
<section id=memory></section>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const get=u=>fetch(u).then(r=>r.ok?r.json():Promise.reject(r));
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.ok?r.json():Promise.reject(r));
let tab='chat';

document.querySelectorAll('header button[data-t]').forEach(b=>b.onclick=()=>{
  tab=b.dataset.t;
  document.querySelectorAll('header button[data-t]').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('section').forEach(s=>s.classList.toggle('on',s.id===tab));
  $('cf').style.display = tab==='chat' ? 'flex' : 'none';
  load();
});
$('out').onclick=()=>post('/api/logout').then(()=>location.reload());

function bubbles(list){
  $('chat').innerHTML = list.map(m=>{
    const cls = m.role==='user'?'me':m.role==='assistant'?'them':'sys';
    return '<div class="msg '+cls+'">'+esc(m.content)+'</div>';
  }).join('') || '<p class=quiet>Nothing yet today.</p>';
  $('chat').scrollTop = $('chat').scrollHeight;
}

async function load(){
  try{
    if(tab==='chat') bubbles((await get('/api/chat')).messages);
    if(tab==='agenda'){
      const {items}=await get('/api/agenda');
      $('agenda').innerHTML = items.length ? items.map(i=>
        '<div class="card'+(i.done?' done':'')+'"><h3>'+esc(i.title)+'</h3><time>'+esc(i.date)+'</time>'+
        (i.kind==='task'&&!i.done?'<br><button data-done="'+esc(i.id)+'">Tick off</button>':'')+'</div>').join('')
        : '<p class=quiet>Nothing on.</p>';
      $('agenda').querySelectorAll('[data-done]').forEach(b=>b.onclick=async()=>{b.disabled=true;await post('/api/agenda/done',{id:b.dataset.done});load();});
    }
    if(tab==='journal'){
      const {entries}=await get('/api/journal');
      $('journal').innerHTML =
        '<div class=card><textarea id=jt rows=3 placeholder="How was today?"></textarea>'+
        '<div class=jrow><input id=jm type=number min=1 max=10 placeholder="Mood 1-10"><input id=ja type=number min=1 max=10 placeholder="Anxiety 1-10"></div>'+
        '<button id=jsave>Save</button></div>'+
        entries.slice().reverse().map(e=>'<div class=card><time>'+esc(e.date)+'</time><p style=margin:.3rem_0_0>'+esc(e.text)+'</p></div>').join('');
      $('jsave').onclick=async()=>{
        const text=$('jt').value.trim(); if(!text)return;
        $('jsave').disabled=true;
        await post('/api/journal',{text,mood:Number($('jm').value)||undefined,anxiety:Number($('ja').value)||undefined});
        load();
      };
    }
    if(tab==='memory'){
      const {memories}=await get('/api/memory');
      $('memory').innerHTML = memories.length ? memories.map(m=>'<div class=card>'+esc(m)+'</div>').join('') : '<p class=quiet>She has not written anything down.</p>';
    }
  }catch(r){ if(r&&r.status===401) location.reload(); }
}

const ci=$('ci');
ci.addEventListener('input',()=>{ci.style.height='auto';ci.style.height=Math.min(ci.scrollHeight,112)+'px';});
$('cf').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const text=ci.value.trim(); if(!text)return;
  ci.value=''; ci.style.height='auto'; $('cb').disabled=true;
  $('chat').insertAdjacentHTML('beforeend','<div class="msg me">'+esc(text)+'</div><div class="msg them" id=wait>…</div>');
  $('chat').scrollTop=$('chat').scrollHeight;
  try{
    const a=await post('/api/chat',{text});
    document.getElementById('wait').remove();
    if(a.ignored) $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">She is not answering that.</div>');
    else $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(a.reply)+'</div>');
  }catch(r){
    document.getElementById('wait').remove();
    if(r&&r.status===401){location.reload();return;}
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">That did not get through.</div>');
  }
  $('cb').disabled=false; $('chat').scrollTop=$('chat').scrollHeight;
});
load();
</script>`;
}
