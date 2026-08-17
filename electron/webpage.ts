// The two pages the phone ever sees.
//
// Written as plain HTML with no build step and no imports. The desktop app is
// React through Vite, and a second Vite target for one chat screen would mean a
// second build to keep working, a second set of assets to ship, and a packaging
// path to get wrong — for a page that is a stage, a list and a text box.
//
// Nothing is fetched from anywhere: no fonts, no icons, no framework. That is
// what lets the server send a content policy forbidding every outside origin,
// which in turn means a hostile string that reaches this page has nowhere to
// send anything it finds. Her portrait is served by us, from us.
//
// The look follows AIRI (airi.moeru.ai): the character is the page rather than
// an ornament on it, colour comes from one rotatable hue in OKLCH rather than a
// list of hex codes, and everything sits on soft, generously rounded glass. Two
// things are deliberately not copied — her palette stays pink rather than AIRI's
// green, because she is not that character, and the hue does not animate, which
// on a companion you glance at all day would be a fidget rather than a feature.

/** One number to move the whole palette. 350 is Haru's pink; 150 would be AIRI's green. */
const HUE = 350;

const SHELL = `
  :root {
    color-scheme: dark;
    --hue: ${HUE};
    /* OKLCH so lightness stays perceptually even as the hue turns — the reason
       the reference uses it, and the reason a hand-picked hex per shade is not
       needed. */
    --bg:      oklch(16% 0.035 var(--hue));
    --bg-lift: oklch(21% 0.045 var(--hue));
    --ink:     oklch(96% 0.012 var(--hue));
    --ink-dim: oklch(72% 0.030 var(--hue));
    --accent:  oklch(78% 0.130 var(--hue));
    --accent-ink: oklch(22% 0.070 var(--hue));
    --glass:   oklch(30% 0.045 var(--hue) / 0.55);
    --edge:    oklch(70% 0.060 var(--hue) / 0.16);
    --mine:    oklch(38% 0.075 var(--hue) / 0.85);
    --r-lg: 22px;
    --r-md: 16px;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink);
    font: 16px/1.55 ui-rounded, "SF Pro Rounded", "Segoe UI Variable", system-ui, -apple-system, sans-serif;
    /* The glow she sits in. Fixed, so it does not slide around under scrolling. */
    background-image:
      radial-gradient(120% 70% at 50% -10%, oklch(42% 0.12 var(--hue) / 0.55), transparent 60%),
      radial-gradient(90% 50% at 100% 100%, oklch(38% 0.10 calc(var(--hue) + 60) / 0.35), transparent 70%);
    background-attachment: fixed;
  }
  input, textarea, button { font: inherit; color: inherit; }
  input, textarea {
    background: var(--glass); border: 1px solid var(--edge); border-radius: var(--r-md);
    padding: .8rem 1rem; width: 100%; backdrop-filter: blur(12px);
  }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); }
  button {
    background: var(--accent); color: var(--accent-ink); border: 0;
    border-radius: 999px; padding: .75rem 1.3rem; font-weight: 650; letter-spacing: .01em;
  }
  button:disabled { opacity: .45; }
  .err { color: oklch(72% 0.16 25); min-height: 1.4em; font-size: .9rem; }
`;

export function loginPage(): string {
  return `<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name=theme-color content="#171029">
<title>Haru</title><style>${SHELL}
  main { max-width: 25rem; margin: 0 auto; padding: 12vh 1.4rem 2rem; }
  .face {
    width: 116px; height: 116px; margin: 0 auto 1.5rem; border-radius: 50%;
    background: var(--glass) center/cover no-repeat; border: 1px solid var(--edge);
    box-shadow: 0 18px 50px oklch(30% 0.12 var(--hue) / 0.5);
  }
  h1 { font-size: 1.75rem; margin: 0 0 .25rem; text-align: center; letter-spacing: -.02em; }
  p.sub { color: var(--ink-dim); margin: 0 0 2rem; font-size: .95rem; text-align: center; }
  label { display: block; margin: 0 0 .85rem; }
  label span { display: block; font-size: .82rem; color: var(--ink-dim); margin: 0 0 .35rem .2rem; }
  .row { display: flex; align-items: center; gap: .6rem; margin: 1.1rem 0 1.4rem .2rem; color: var(--ink-dim); font-size: .9rem; }
  .row input { width: auto; accent-color: var(--accent); }
  #go { width: 100%; padding: .85rem; }
</style>
<main>
  <div class=face style="background-image:url('/portrait')"></div>
  <h1>Haru</h1>
  <p class=sub>She is at home. Sign in to reach her.</p>
  <form id=f>
    <label><span>Name</span><input name=username autocomplete=username autocapitalize=none required></label>
    <label><span>Password</span><input name=password type=password autocomplete=current-password required></label>
    <div class=row><input type=checkbox id=r name=remember checked><label for=r style="margin:0">Remember this device</label></div>
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
<meta name=theme-color content="#171029">
<title>Haru</title><style>${SHELL}
  body { display:flex; flex-direction:column; height:100dvh; overflow:hidden; }

  /* The stage. She is the top of the page and everything else sits under her,
     which is the whole point of the reference: a companion, not a chat log with
     an avatar in the corner. */
  .stage { position:relative; flex:0 0 auto; height:min(34dvh,260px); display:flex; align-items:flex-end; justify-content:center; }
  .stage img { height:100%; object-fit:contain; filter:drop-shadow(0 16px 40px oklch(25% 0.12 var(--hue) / 0.6)); }
  /* The model sits exactly where the portrait did, and the portrait stays until
     it is drawing — 28MB over a tunnel is a few seconds, and a blank stage for
     those seconds reads as broken rather than as loading. */
  .stage canvas { position:absolute; inset:0; width:100%; height:100%; opacity:0; transition:opacity .6s ease; }
  .stage.alive canvas { opacity:1; }
  .stage.alive img { opacity:0; transition:opacity .6s ease; }
  /* Faded into the page rather than cut off, so there is no hard edge where she ends. */
  .stage::after { content:''; position:absolute; inset:auto 0 0 0; height:64px; background:linear-gradient(transparent, var(--bg)); pointer-events:none; }
  .stage.faceless { height:auto; min-height:3.2rem; }
  .stagenote { position:absolute; left:0; right:0; bottom:.4rem; margin:0; text-align:center; font-size:.76rem; color:var(--ink-dim); opacity:.75; padding:0 1rem; }
  .who { position:absolute; top:.9rem; left:1.1rem; display:flex; align-items:center; gap:.5rem; font-weight:650; letter-spacing:-.01em; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  .out { position:absolute; top:.75rem; right:.9rem; background:var(--glass); color:var(--ink-dim); border:1px solid var(--edge); padding:.4rem .9rem; font-size:.82rem; font-weight:500; backdrop-filter:blur(12px); }

  nav { display:flex; gap:.3rem; padding:.35rem; margin:0 .9rem; background:var(--glass); border:1px solid var(--edge); border-radius:999px; backdrop-filter:blur(14px); }
  nav button { flex:1; background:none; color:var(--ink-dim); padding:.5rem .4rem; font-size:.9rem; font-weight:550; }
  nav button.on { background:var(--accent); color:var(--accent-ink); }

  section { flex:1; overflow-y:auto; padding:1rem .9rem 1.2rem; display:none; -webkit-overflow-scrolling:touch; }
  section.on { display:block; }

  .msg { max-width:82%; padding:.7rem 1rem; border-radius:var(--r-lg); margin:0 0 .55rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .them { background:var(--glass); border:1px solid var(--edge); border-bottom-left-radius:7px; backdrop-filter:blur(12px); }
  .me { background:var(--mine); border:1px solid var(--edge); margin-left:auto; border-bottom-right-radius:7px; }
  .sys { color:var(--ink-dim); font-size:.84rem; text-align:center; max-width:100%; background:none; border:0; }

  form.compose { display:flex; gap:.5rem; padding:.6rem .9rem calc(.6rem + env(safe-area-inset-bottom)); align-items:flex-end; }
  form.compose textarea { resize:none; max-height:7rem; border-radius:var(--r-lg); }
  form.compose button { padding:.8rem 1.15rem; }

  /* A wide window is not a big phone.
     Stretched across a desktop browser the bubbles ran the full 1700px and the
     text became unreadable at about six words a line, so the column is capped
     at a comfortable measure and she moves alongside it rather than sitting on
     top — which is closer to the reference on a wide screen anyway: the
     character is the room, and the conversation happens in it. */
  @media (min-width: 900px) {
    body { display:grid; grid-template-columns: minmax(280px, 34vw) minmax(0, 1fr); grid-template-rows: auto 1fr auto; column-gap:1rem; padding:0 1.5rem; }
    .stage { grid-row: 1 / -1; height:auto; align-items:center; padding-bottom:2rem; }
    .stage img { height:auto; max-height:74dvh; max-width:100%; }
    .stage::after { display:none; }
    .who { top:1.4rem; left:.4rem; }
    .out { position:fixed; top:1rem; right:1.5rem; z-index:3; }
    nav { grid-column:2; margin:1rem 0 0; align-self:start; max-width:44rem; }
    section { grid-column:2; padding:1rem 0; max-width:44rem; }
    form.compose { grid-column:2; padding:.6rem 0 1.2rem; max-width:44rem; }
    .msg { max-width:min(82%, 46rem); }
  }

  .card { background:var(--glass); border:1px solid var(--edge); border-radius:var(--r-lg); padding:.85rem 1rem; margin:0 0 .6rem; backdrop-filter:blur(12px); }
  .card h3 { margin:0 0 .15rem; font-size:1rem; font-weight:600; }
  .card time { color:var(--ink-dim); font-size:.85rem; }
  .card button { background:none; border:1px solid var(--edge); color:var(--ink-dim); padding:.4rem .85rem; font-size:.85rem; margin-top:.6rem; font-weight:500; }
  .done { opacity:.4; }
  .quiet { color:var(--ink-dim); text-align:center; padding:2rem 0; }
  .jrow { display:flex; gap:.6rem; margin:.6rem 0; }
</style>
<div class=stage>
  <div class=who><span class=dot></span> Haru</div>
  <button class=out id=out>Sign out</button>
  <img src="/portrait" alt="" onerror="this.closest('.stage').classList.add('faceless')">
</div>
<nav>
  <button data-t=chat class=on>Chat</button>
  <button data-t=agenda>Agenda</button>
  <button data-t=journal>Journal</button>
  <button data-t=memory>Memory</button>
</nav>
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

document.querySelectorAll('nav button[data-t]').forEach(b=>b.onclick=()=>{
  tab=b.dataset.t;
  document.querySelectorAll('nav button[data-t]').forEach(x=>x.classList.toggle('on',x===b));
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
        entries.slice().reverse().map(e=>'<div class=card><time>'+esc(e.date)+'</time><p style="margin:.3rem 0 0">'+esc(e.text)+'</p></div>').join('');
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

// ---- The stage ------------------------------------------------------------
//
// Loaded after everything else and allowed to fail without taking the page with
// it. She is 28MB of model behind a tunnel: on a slow connection the chat should
// already be working while this is still arriving, and on a phone that cannot
// manage WebGL at all the portrait simply stays.
(async function stage(){
  const host=document.querySelector('.stage');
  if(!host) return;
  const script=src=>new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error(src));document.head.appendChild(s);});
  try{
    const {entry}=await get('/api/model');
    if(!entry){ console.log('[stage] no model imported on the desktop'); return; }
    // Order matters: the plugin reads a global PIXI when it loads, and the
    // Cubism runtime has to exist before any model is built.
    await script('/lib/pixi.js');
    // pixi builds its shaders with new Function(), which a policy without
    // 'unsafe-eval' refuses — in every browser, which is why this failed in
    // three of them and looked like a blocker in none. This module replaces that
    // one mechanism, so the policy stays shut rather than being widened to allow
    // eval on a page that renders somebody's chat history.
    await script('/lib/noeval.js');
    PIXI.install && PIXI.install({});
    // Live2D's runtime, served from us rather than from their CDN. Fetched from
    // outside, this was the one thing on the page a shield could quietly stop —
    // and Brave with Shields up did exactly that.
    try { await script('/lib/cubismcore.js'); }
    catch { throw new Error('the Live2D runtime is missing from this build'); }
    if(!window.Live2DCubismCore) throw new Error('the Live2D runtime loaded but did not start');
    await script('/lib/live2d.js');
    if(!window.PIXI||!PIXI.live2d) throw new Error('the Live2D plugin did not attach to pixi');
    // The bundled build does not always find the ticker on its own, and without
    // one she loads and then never moves.
    try { PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker); } catch {}
    const canvas=document.createElement('canvas');
    host.appendChild(canvas);
    const app=new PIXI.Application({view:canvas,backgroundAlpha:0,antialias:true,resolution:Math.min(devicePixelRatio||1,2),autoDensity:true,resizeTo:host});
    const model=await PIXI.live2d.Live2DModel.from('/model/'+encodeURIComponent(entry),{autoInteract:false});
    app.stage.addChild(model);
    // Anchored at the bottom middle and scaled to fit, the same way the desktop
    // does it: a Live2D model's own origin is nowhere useful.
    const fit=()=>{
      const w=app.renderer.screen.width,h=app.renderer.screen.height;
      if(!model.width||!model.height)return;
      model.scale.set(Math.min(w/(model.width/model.scale.x),h/(model.height/model.scale.y))*0.92);
      model.anchor.set(0.5,1);
      model.position.set(w/2,h);
    };
    fit();
    new ResizeObserver(fit).observe(host);
    // Her eyes follow a finger or a cursor, and nothing else — no dragging, no
    // hit areas. On a phone the pointer is wherever it was last touched, which
    // is close enough to being looked at.
    host.addEventListener('pointermove',e=>{const r=host.getBoundingClientRect();model.focus(e.clientX-r.left,e.clientY-r.top);});
    host.classList.add('alive');
    console.log('[stage] '+entry+' is up');
  }catch(error){
    // Said on the page, not only in a console nobody has open. The portrait
    // staying put looks identical to the portrait being the design, so without
    // this a broken stage is invisible — which is how the first attempt at it
    // looked like it had simply been ignored.
    const why=(error&&error.message||String(error));
    console.warn('[stage] staying with the portrait: '+why);
    const note=document.createElement('p');
    note.className='stagenote';
    note.textContent='She is not moving — '+why+'.';
    host.appendChild(note);
  }
})();
</script>`;
}
