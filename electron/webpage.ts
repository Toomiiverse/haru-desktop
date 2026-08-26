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
<link rel=manifest href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/portrait">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Haru">
<title>Haru</title><style>${SHELL}
  main { max-width: 25rem; margin: 0 auto; padding: 14vh 1.4rem 2rem; }
  h1 { font-size: 1.75rem; margin: 0 0 .25rem; text-align: center; letter-spacing: -.02em; }
  p.sub { color: var(--ink-dim); margin: 0 0 2rem; font-size: .95rem; text-align: center; }
  label { display: block; margin: 0 0 .85rem; }
  label span { display: block; font-size: .82rem; color: var(--ink-dim); margin: 0 0 .35rem .2rem; }
  .row { display: flex; align-items: center; gap: .6rem; margin: 1.1rem 0 1.4rem .2rem; color: var(--ink-dim); font-size: .9rem; }
  .row input { width: auto; accent-color: var(--accent); }
  #go { width: 100%; padding: .85rem; }
</style>
<main>
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
<link rel=manifest href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/portrait">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Haru">
<title>Haru</title><style>${SHELL}
  body { display:flex; flex-direction:column; height:100dvh; overflow:hidden; }

  .topbar { display:flex; align-items:center; gap:.6rem; padding:.7rem 1rem; flex:0 0 auto; }
  .topbar .name { font-weight:700; letter-spacing:-.01em; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  #out { margin-left:auto; background:var(--glass); color:var(--ink-dim); border:1px solid var(--edge); padding:.4rem .9rem; font-size:.82rem; font-weight:500; backdrop-filter:blur(12px); }

  #chat { flex:1; overflow-y:auto; padding:1rem .9rem 1.2rem; -webkit-overflow-scrolling:touch; }

  .msg { max-width:82%; padding:.7rem 1rem; border-radius:var(--r-lg); margin:0 0 .55rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .msg b { font-weight:700; }
  .msg code { font-family:ui-monospace,monospace; font-size:.88em; background:rgba(255,255,255,.08); border-radius:.3rem; padding:.05rem .3rem; }
  .them { background:var(--glass); border:1px solid var(--edge); border-bottom-left-radius:7px; backdrop-filter:blur(12px); }
  .me { background:var(--mine); border:1px solid var(--edge); margin-left:auto; border-bottom-right-radius:7px; }
  .sys { color:var(--ink-dim); font-size:.84rem; text-align:center; max-width:100%; background:none; border:0; }

  form.compose { display:flex; gap:.5rem; padding:.6rem .9rem calc(.6rem + env(safe-area-inset-bottom)); align-items:flex-end; }
  form.compose textarea { resize:none; max-height:7rem; border-radius:var(--r-lg); }
  form.compose button { padding:.8rem 1.15rem; }
  form.compose .icon { background:var(--glass); border:1px solid var(--edge); padding:.7rem .85rem; font-size:1.05rem; line-height:1; backdrop-filter:blur(12px); }
  /* Held down, it should look held down. Recording with no sign of recording is
     how you end up sending thirty seconds of a room. */
  form.compose .icon.hot { background:var(--accent); border-color:var(--accent); animation:pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow:0 0 0 .55rem oklch(78% 0.13 var(--hue) / 0.18); } }

  .quiet { color:var(--ink-dim); text-align:center; padding:2rem 0; }

  /* A wide window is not a big phone. Stretched across a desktop browser the
     bubbles ran the full 1700px and the text became unreadable at about six
     words a line, so the column is capped at a comfortable measure and centred. */
  @media (min-width: 900px) {
    body { max-width:44rem; margin:0 auto; }
    #out { position:fixed; top:1rem; right:1.5rem; z-index:3; }
    .msg { max-width:min(82%, 46rem); }
  }
</style>
<div class=topbar><span class=dot></span><span class=name>Haru</span><button id=out>Sign out</button></div>
<section id=chat></section>
<form class=compose id=cf><button type=button id=mic class=icon title="Hold to talk">🎙</button><textarea id=ci rows=1 placeholder="Say something…"></textarea><button id=cb>Send</button></form>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The same handful of marks she writes on the desktop, applied to text that has
// already been escaped — so the only tags that can ever reach the page are the
// three put there here.
const md=s=>s.replace(/\\*\\*\\s*([^*]+?)\\s*\\*\\*/g,'<b>$1</b>').replace(/\`([^\`\\n]+?)\`/g,'<code>$1</code>').replace(/\\*([^*\\s][^*\\n]*?)\\*/g,'<i>$1</i>');
const get=u=>fetch(u).then(r=>r.ok?r.json():Promise.reject(r));
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.ok?r.json():Promise.reject(r));

$('out').onclick=()=>post('/api/logout').then(()=>location.reload());

function bubbles(list){
  $('chat').innerHTML = list.map(m=>{
    const cls = m.role==='user'?'me':m.role==='assistant'?'them':'sys';
    return '<div class="msg '+cls+'">'+md(esc(m.content))+'</div>';
  }).join('') || '<p class=quiet>Nothing yet today.</p>';
  $('chat').scrollTop = $('chat').scrollHeight;
}

async function load(){
  try{
    bubbles((await get('/api/chat')).messages);
  }catch(r){ if(r&&r.status===401) location.reload(); }
}

const ci=$('ci');

// ---- Her voice ------------------------------------------------------------
//
// Asked for after the words are already on screen, never before: a reply that
// waits for its own recording arrives late and reads as her being slow, when she
// was not. If she has no voice set up the request 503s and nothing happens,
// which is the correct amount of fuss.
//
// One Audio element, reused for every line, rather than a fresh one per reply.
// iOS Safari only allows programmatic play() on an element that has already
// played inside a user gesture — and the gesture here is the send tap, which is
// long gone by the time an 8-17s reply comes back. A fresh Audio element made at
// that point is unprivileged and play() is silently rejected: nothing plays,
// nothing throws, and it looks exactly like a broken voice. Priming this element
// inside the tap (see the submit handler below) carries that privilege forward
// to the later play() on the same element, which Safari does allow.
const player=new Audio();
function primeVoice(){ player.play().catch(()=>{}); player.pause(); }
async function speak(text){
  try{
    player.pause();
    const r=await fetch('/api/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
    if(!r.ok) return;
    const url=URL.createObjectURL(await r.blob());
    const previous=player.src;
    player.src=url;
    player.onended=player.onerror=()=>{ URL.revokeObjectURL(url); if(previous) URL.revokeObjectURL(previous); };
    await player.play();
  }catch(e){ console.warn('[voice] '+(e&&e.message||e)); }
}

// ---- Her ears -------------------------------------------------------------
//
// Held rather than toggled. A toggle leaves a microphone open in a pocket, and
// on a phone that is the difference between a feature and a liability.
const mic=$('mic');
let recorder=null,chunks=[];
async function startHearing(){
  if(recorder) return;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    recorder=new MediaRecorder(stream);
    chunks=[];
    recorder.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
      recorder=null; mic.classList.remove('hot');
      if(blob.size<1200) return;
      mic.disabled=true;
      try{
        const r=await fetch('/api/listen',{method:'POST',headers:{'content-type':blob.type.split(';')[0]},body:blob});
        const {text}=await r.json();
        // Put into the box rather than sent: a transcript is a guess, and one
        // you cannot see before it is sent is one you cannot correct.
        if(text){ ci.value=(ci.value?ci.value+' ':'')+text; ci.focus(); ci.dispatchEvent(new Event('input')); }
      }catch(e){ console.warn('[ears] '+(e&&e.message||e)); }
      mic.disabled=false;
    };
    recorder.start();
    mic.classList.add('hot');
  }catch(e){
    console.warn('[ears] '+(e&&e.message||e));
    mic.title='No microphone: '+(e&&e.message||e);
  }
}
function stopHearing(){ if(recorder&&recorder.state!=='inactive') recorder.stop(); }
mic.addEventListener('pointerdown',e=>{e.preventDefault();startHearing();});
for(const done of ['pointerup','pointerleave','pointercancel']) mic.addEventListener(done,stopHearing);

ci.addEventListener('input',()=>{ci.style.height='auto';ci.style.height=Math.min(ci.scrollHeight,112)+'px';});
// Counts sends, only so each waiting bubble can be told from the last one.
let waiting=0;
$('cf').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const text=ci.value.trim(); if(!text)return;
  primeVoice();
  ci.value=''; ci.style.height='auto'; $('cb').disabled=true;
  // The waiting bubble used to be id="wait", a fixed string, and was taken back
  // out with a bare document.getElementById('wait').remove().
  //
  // Two things went wrong with that. bubbles() rebuilds the list with innerHTML,
  // so any tab switch or nudge arriving mid-send destroyed the element — and the
  // lookup then returned null and .remove() threw. Because the identical call
  // sat in the catch as well as the try, the throw escaped the handler
  // altogether, which meant the line re-enabling the send button never ran: her
  // reply was thrown away and the composer stayed dead until a reload. The fixed
  // id also collided whenever two sends overlapped, so one bubble was orphaned
  // on screen for good.
  //
  // So: an id of its own, removal that tolerates the node having gone, and the
  // button re-enabled from a finally where nothing can step over it.
  const id='wait'+(++waiting);
  $('chat').insertAdjacentHTML('beforeend','<div class="msg me">'+esc(text)+'</div><div class="msg them" id='+id+'>…</div>');
  $('chat').scrollTop=$('chat').scrollHeight;
  const stopWaiting=()=>{const bubble=document.getElementById(id); if(bubble) bubble.remove();};
  // The waiting bubble doubles as the reply bubble: words land in it as the
  // stream delivers them, and the final processed reply replaces them when the
  // stream ends. textContent rather than innerHTML — her words are text, not
  // markup, and the model is not a source we escape from, it is the source.
  const show=t=>{const bubble=document.getElementById(id); if(!bubble) return false; bubble.textContent=t; $('chat').scrollTop=$('chat').scrollHeight; return true;};
  try{
    const r=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
    if(!r.ok) throw r;
    const reader=r.body.getReader(); const dec=new TextDecoder();
    let buf='',said='',reply=null,ignored=false,error=null;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      let at;
      while((at=buf.indexOf('\\n'))>=0){
        const line=buf.slice(0,at).trim(); buf=buf.slice(at+1);
        if(!line.startsWith('data:'))continue;
        let ev; try{ev=JSON.parse(line.slice(5));}catch{continue;}
        if(ev.error) error=ev.error;
        else if(ev.text==='\uFFFD'){ said=''; show('…'); }
        else if(ev.text){ said+=ev.text; show(said); }
        else if(ev.done){ reply=ev.reply; ignored=Boolean(ev.ignored); }
      }
    }
    if(error) throw new Error(error);
    if(ignored){
      // Whatever she was about to say does not exist: the bubble goes, the note
      // takes its place, and nothing is spoken.
      stopWaiting();
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">She is not answering that.</div>');
    } else {
      // The processed reply is the one that counts — the stream can carry words
      // she later trims as repetition — so it replaces what was shown.
      if(reply!==null) show(reply);
      if(reply){
        // Started here and not waited on: the words are already on screen, and
        // her voice can catch up in its own time.
        void speak(reply);
      }
    }
  }catch(r){
    stopWaiting();
    if(r&&r.status===401){location.reload();return;}
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">That did not get through.</div>');
  }finally{
    $('cb').disabled=false; $('chat').scrollTop=$('chat').scrollHeight;
  }
});
load();

// ---- Her, speaking first ---------------------------------------------------
//
// The point of carrying her about is that she mentions the thing you have not
// done, rather than waiting to be asked. There are no notifications here, so the
// moment to do it is while the page is open — which is also the only moment she
// has anyone's attention.
//
// Asked on opening, again when the page comes back to the front, and slowly
// while it sits there. The deciding is all on her side: most of these return
// nothing, because most of the time there is nothing worth saying.
async function askIfSheHasSomethingToSay(){
  if(document.hidden) return;
  try{
    const {line}=await get('/api/nudge');
    if(!line) return;
    if(tab!=='chat'){ document.querySelector('nav button[data-t=chat]').click(); }
    $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(line)+'</div>');
    $('chat').scrollTop=$('chat').scrollHeight;
    void speak(line);
  }catch(r){ if(r&&r.status===401) location.reload(); }
}
setTimeout(askIfSheHasSomethingToSay,1500);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) askIfSheHasSomethingToSay(); });
// Four minutes: she is being carried around, not watched. Anything faster reads
// as pestering, and the spacing on her side would refuse it anyway.
setInterval(askIfSheHasSomethingToSay,4*60_000);
</script>`;
}
