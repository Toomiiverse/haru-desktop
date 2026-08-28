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

import { DEFAULT_TRANSITION_MS, EASE_OUT_CSS, emotionConfig, HARU_EMOTIONS, MOOD_TO_EMOTION } from './emotions';

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

// Her on stage: the supplied Haru artwork, one SVG per emotion, served by her
// own server from /emotions/ and crossfaded on the page. Two parts, on the
// bloub's pattern of a clock-free engine under a thin renderer — the pattern is
// kept; the geometry is not, because these files do not share a path topology
// and are not ours to redraw.
//
// The engine decides WHAT is shown: it is pure and clock-free, takes a time
// with every call, and sample(t) returns the frame for that time — which face,
// which face is leaving, how far along, and the opacity of each — so it can be
// tested with numbers and frozen at an instant. A change of face that arrives
// mid-fade starts from what is visible: the outgoing face keeps the opacity it
// had, the incoming one starts from nothing, and nothing jumps.
//
// The renderer decides HOW: two stacked images, opacity, a CSS transition with
// the engine's own easing. Nothing runs between changes — a face at rest is a
// static image — and a reduced-motion setting switches at once. The API the
// rest of the page speaks (express / think / notify / poke / state) is the one
// the old avatar had, so nothing else on the page changed hands.
const AVATAR = `
(() => {
  const EMOTIONS = ${JSON.stringify(HARU_EMOTIONS)};
  const LABELS = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].label])))};
  const TRANSITIONS = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].transition])))};
  const ADAPT = ${JSON.stringify(MOOD_TO_EMOTION)};
  const EASE_CSS = ${JSON.stringify(EASE_OUT_CSS)};
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // Cubic ease-out: deterministic, no overshoot, the same curve as EASE_CSS.
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  // ---- the engine: pure, clock-free ------------------------------------
  function createEmotionEngine(options) {
    const duration = () => (options && typeof options.duration === 'function' ? options.duration() : ${DEFAULT_TRANSITION_MS});
    let emotion = 'neutral', previous = null, startedAt = -Infinity, leavingFrom = 0, arrivingFrom = 1;
    const progress = (t) => {
      const d = previous === null ? 0 : (TRANSITIONS[emotion] === 'cut' ? 0 : duration());
      return d <= 0 ? 1 : clamp((t - startedAt) / d);
    };
    const engine = {
      /** The frame at time t. */
      sample(t) {
        const p = easeOut(progress(t));
        const opacity = arrivingFrom + (1 - arrivingFrom) * p;
        const previousOpacity = previous === null ? 0 : leavingFrom * (1 - p);
        return { emotion: emotion, previousEmotion: previous, transitionProgress: p, opacity: opacity, previousOpacity: previousOpacity, transitioning: p < 1 };
      },
      /** A new face at time t. Returns whether anything changed. */
      set(next, t) {
        if (EMOTIONS.indexOf(next) < 0) next = 'neutral';
        if (next === emotion) return false;
        const now = engine.sample(t);
        previous = emotion; emotion = next; startedAt = t;
        // From what is visible: the face now leaving keeps the opacity it had.
        leavingFrom = now.opacity; arrivingFrom = 0;
        return true;
      },
      emotion: () => emotion,
      duration: duration
    };
    return engine;
  }
  window.HaruEmotionEngine = createEmotionEngine;

  // ---- the renderer: two images and an opacity -------------------------
  const host = document.getElementById('stage');
  if (!host) return;
  const data = host.dataset || {};
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let fade = Number(data.transition) || ${DEFAULT_TRANSITION_MS};
  if (data.size) host.style.setProperty('--avatar-size', data.size + 'px');
  host.innerHTML = '<div id=avatar role=img aria-label="' + LABELS.neutral + '">'
    + '<img class=face alt="" draggable=false decoding=async>'
    + '<img class=face alt="" draggable=false decoding=async></div>';
  const box = document.getElementById('avatar');
  const faces = box.querySelectorAll('img');
  const engine = createEmotionEngine({ duration: () => (reduced ? 0 : fade) });
  const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let front = 0, resting = 'neutral', timer = null, frozenAt = null;

  // What the DOM shows for a frame. With a duration the browser eases the two
  // opacities from wherever they are, which is the engine's rule made of CSS;
  // frozen, or reduced, the frame's own numbers are written and nothing moves.
  function paint(frame, animate) {
    const fore = faces[front], back = faces[1 - front];
    const ease = animate && !reduced && engine.duration() > 0 ? 'opacity ' + engine.duration() + 'ms ' + EASE_CSS : 'none';
    fore.style.transition = ease; back.style.transition = ease;
    fore.style.opacity = animate ? '1' : String(frame.opacity);
    back.style.opacity = animate ? '0' : String(frame.previousOpacity);
    fore.classList.add('on'); back.classList.remove('on');
  }
  function show(name, t) {
    if (!engine.set(name, t)) return;
    const frame = engine.sample(t);
    box.setAttribute('aria-label', LABELS[frame.emotion] || ('Haru feeling ' + frame.emotion));
    const incoming = faces[1 - front];
    incoming.classList.remove('missing');
    incoming.onerror = () => { incoming.classList.add('missing'); };
    incoming.onload = () => { front = 1 - front; paint(frozenAt === null ? frame : engine.sample(frozenAt), frozenAt === null); };
    incoming.removeAttribute('src');
    incoming.src = '/emotions/' + frame.emotion + '.svg';
  }
  function settle(ms) { clearTimeout(timer); timer = setTimeout(() => show(resting, clock()), ms); }
  // What a prod does to her face, and for how long, before she settles back.
  const POKES = { exclaim: ['angry', 2000], burst: ['surprised', 1600], orbit: ['excited', 1600], comet: ['surprised', 1600], play: ['happy', 1600] };

  window.haruAvatar = {
    // Her mood for a line: the resting face, until the next one.
    express: (emotion) => { resting = ADAPT[emotion] || (EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral'); clearTimeout(timer); show(resting, clock()); },
    // They sent something: she thinks until the reply's mood lands, or for a long while.
    think: () => { clearTimeout(timer); show('thinking', clock()); settle(20000); },
    // She is starting to talk: a small pop, not a change of face.
    notify: () => { if (frozenAt !== null) return; box.classList.remove('pop'); if (typeof box.offsetWidth === 'number') void box.offsetWidth; box.classList.add('pop'); },
    poke: (what) => { const hit = POKES[what]; if (!hit) return; clearTimeout(timer); show(hit[0], clock()); settle(hit[1]); },
    // The frame at a time, from the engine: what a test, a thumbnail or a
    // future editor would ask for. Playback stopped, that is what is drawn.
    sample: (t) => engine.sample(t === undefined ? clock() : t),
    freeze: (t) => { frozenAt = t === undefined ? clock() : t; paint(engine.sample(frozenAt), false); },
    play: () => { frozenAt = null; paint(engine.sample(clock()), false); },
    state: () => { const f = engine.sample(frozenAt === null ? clock() : frozenAt); return { emotion: f.emotion, previousEmotion: f.previousEmotion, transitionProgress: f.transitionProgress, resting: resting, frozen: frozenAt !== null }; },
    setSize: (px) => host.style.setProperty('--avatar-size', px + 'px'),
    setTransition: (ms) => { fade = Math.max(0, Number(ms) || 0); }
  };
  show('neutral', clock());
  if (data.frozenAt !== undefined) window.haruAvatar.freeze(Number(data.frozenAt) || 0);
})();
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

  /* Installed on a phone the page draws under the status bar (viewport-fit=cover),
     so the bar pads itself past the clock the same way the compose box pads
     itself past the home indicator. Zero everywhere that has no notch. */
  .topbar { display:flex; align-items:center; gap:.6rem; padding:calc(.7rem + env(safe-area-inset-top)) 1rem .7rem; flex:0 0 auto; }
  .topbar .name { font-weight:700; letter-spacing:-.01em; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  #out { background:var(--glass); color:var(--ink-dim); border:1px solid var(--edge); padding:.4rem .9rem; font-size:.82rem; font-weight:500; backdrop-filter:blur(12px); }
  #bell { margin-left:auto; background:var(--glass); color:var(--ink); border:1px solid var(--edge); padding:.35rem .7rem; font-size:.95rem; line-height:1; backdrop-filter:blur(12px); }

  /* The bell's little card: what may buzz the phone, and when it must not. */
  #psheet { position:absolute; top:calc(3.6rem + env(safe-area-inset-top)); right:.9rem; z-index:5; width:min(21rem, calc(100vw - 1.8rem));
    background:var(--bg-lift); border:1px solid var(--edge); border-radius:var(--r-lg); padding:1rem;
    box-shadow:0 18px 40px rgba(0,0,0,.5); }
  #psheet p { margin:.35rem 0 0; color:var(--ink-dim); font-size:.9rem; }
  #psheet button { width:100%; margin-top:.6rem; }
  #psheet .off { background:var(--glass); color:var(--ink); border:1px solid var(--edge); }
  .prow { display:flex; align-items:center; gap:.5rem; margin:.4rem 0; font-size:.95rem; }
  .prow input[type=checkbox] { width:auto; accent-color:var(--accent); }
  .prow input[type=time] { width:auto; padding:.3rem .5rem; }

  #chat { flex:1; overflow-y:auto; padding:1rem .9rem 1.2rem; -webkit-overflow-scrolling:touch; }

  .msg { max-width:82%; padding:.7rem 1rem; border-radius:var(--r-lg); margin:0 0 .55rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .msg b { font-weight:700; }
  .msg code { font-family:ui-monospace,monospace; font-size:.88em; background:rgba(255,255,255,.08); border-radius:.3rem; padding:.05rem .3rem; }
  .them { background:var(--glass); border:1px solid var(--edge); border-bottom-left-radius:7px; backdrop-filter:blur(12px); }
  .me { background:var(--mine); border:1px solid var(--edge); margin-left:auto; border-bottom-right-radius:7px; }
  .sys { color:var(--ink-dim); font-size:.84rem; text-align:center; max-width:100%; background:none; border:0; }
  /* Under each of her bubbles: a small arrow, and behind it what they thought
     of the reply and asking again. Folded by default — a row of buttons under
     every message was a dock, not a conversation. */
  .acts { display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; margin:-.3rem 0 .6rem .25rem; max-width:82%; }
  .acts .dock { display:contents; }
  .acts .dock[hidden] { display:none; }
  .acts .more { padding:.05rem .5rem; font-size:.8rem; opacity:.7; }
  .acts .more.open { opacity:1; }
  .acts button { background:none; border:1px solid var(--edge); color:var(--ink-dim); border-radius:999px; padding:.15rem .55rem; font-size:.85rem; line-height:1.4; font-weight:500; }
  .acts button.on { background:var(--accent); color:var(--accent-ink); border-color:var(--accent); }
  .acts input { flex:1 1 10rem; font-size:.82rem; padding:.3rem .7rem; border-radius:999px; }
  .acts .said { font-size:.8rem; color:var(--ink-dim); font-style:italic; overflow-wrap:anywhere; }
  .acts .reacted { font-size:.95rem; line-height:1.4; }
  .acts .reacted { border:1px solid var(--edge); border-radius:999px; padding:.05rem .45rem; }

  form.compose { display:flex; gap:.5rem; padding:.6rem .9rem calc(.6rem + env(safe-area-inset-bottom)); align-items:flex-end; }
  form.compose textarea { resize:none; max-height:7rem; border-radius:var(--r-lg); }
  form.compose button { padding:.8rem 1.15rem; }
  form.compose .icon { background:var(--glass); border:1px solid var(--edge); padding:.7rem .85rem; font-size:1.05rem; line-height:1; backdrop-filter:blur(12px); }
  /* Held down, it should look held down. Recording with no sign of recording is
     how you end up sending thirty seconds of a room. */
  form.compose .icon.hot { background:var(--accent); border-color:var(--accent); animation:pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow:0 0 0 .55rem oklch(78% 0.13 var(--hue) / 0.18); } }

  .quiet { color:var(--ink-dim); text-align:center; padding:2rem 0; }

  /* Files waiting to ride the next message. Costing nothing until Send. */
  #chips { display:flex; flex-wrap:wrap; gap:.4rem; padding:0 .9rem .25rem; flex:0 0 auto; }
  #chips:empty { display:none; }
  .chip { display:flex; align-items:center; gap:.35rem; background:var(--glass); border:1px solid var(--edge);
    border-radius:999px; padding:.25rem .45rem .25rem .7rem; font-size:.82rem; backdrop-filter:blur(12px);
    max-width:14rem; }
  .chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chip button { background:none; border:0; color:var(--ink-dim); padding:0 .25rem; font-size:1rem; line-height:1; font-weight:400; }

  /* Her, on stage: the supplied Haru artwork, one SVG per emotion, served from
     her own server and crossfaded. Square, sized by --avatar-size, never
     stretched; no background of its own, so it sits on light and dark alike. */
  #stage { flex:0 0 auto; display:flex; justify-content:center; align-items:center; padding:.35rem 1rem 0; cursor:pointer; --avatar-size:min(31vw, 136px); }
  #avatar { position:relative; width:var(--avatar-size); height:var(--avatar-size); }
  #avatar .face { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; opacity:0; user-select:none; -webkit-user-drag:none; }
  #avatar .face.missing { visibility:hidden; }
  #avatar.pop { animation:pop .5s ease; }
  @keyframes pop { 30% { transform:scale(1.06); } }
  @media (prefers-reduced-motion: reduce) { #avatar .face { transition:none !important; } #avatar.pop { animation:none; } }

  /* A wide window is not a big phone. Stretched across a desktop browser the
     bubbles ran the full 1700px and the text became unreadable at about six
     words a line, so the column is capped at a comfortable measure and centred. */
  @media (min-width: 900px) {
    body { max-width:44rem; margin:0 auto; }
    #out { position:fixed; top:1rem; right:1.5rem; z-index:3; }
    .msg { max-width:min(82%, 46rem); }
  }
</style>
<div class=topbar><span class=dot></span><span class=name>Haru</span><button id=bell title="Notifications">🔔</button><button id=out>Sign out</button></div>
<div id=psheet hidden></div>
<section id=stage></section>
<section id=chat></section>
<div id=chips></div>
<form class=compose id=cf><button type=button id=att class=icon title="Attach a file">📎</button><button type=button id=mic class=icon title="Hold to talk">🎙</button><textarea id=ci rows=1 placeholder="Say something…"></textarea><button id=cb>Send</button></form>
<input type=file id=af multiple hidden>
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

// Installed on an iPhone, the reported viewport stops short of the screen: the
// page painted under the status bar but ended in a dead band above the home
// indicator — the background glow visibly seamed where the layout gave up.
// Only installed mode (navigator.standalone) lies like this, so only installed
// mode is corrected, and only in portrait — screen.height does not rotate on
// iOS, so landscape keeps the stylesheet's own 100dvh.
if(navigator.standalone){
  const fit=()=>{ document.body.style.height = window.innerWidth<window.innerHeight ? screen.height+'px' : ''; };
  fit(); addEventListener('resize',fit);
}

function bubbles(list){
  const last=[...list].reverse().find(m=>m.role==='assistant'&&m.id);
  $('chat').innerHTML = list.map(m=>{
    const cls = m.role==='user'?'me':m.role==='assistant'?'them':'sys';
    let html='<div class="msg '+cls+'">'+md(esc(m.content))+'</div>';
    if(m.role==='assistant'&&m.id) html+=acts(m,m===last);
    return html;
  }).join('') || '<p class=quiet>Nothing yet today.</p>';
  $('chat').scrollTop = $('chat').scrollHeight;
}
// What they thought of a reply, and asking again — the latter only under the
// last one, because only the last one can be done again. The id is the stored
// message's, handed out by the desk, so a rating names a reply rather than
// quoting it. A note already given is shown; otherwise there is a pen.
function acts(m,isLast){
  const on=r=>m.reaction===r?' class=on':'';
  // What is already on the reply stays in view beside the arrow — a thumb, an
  // emoji — so the state is not hidden with the buttons.
  const worn=(m.reaction==='up'?'<span class=reacted title="Marked good">👍</span>':m.reaction==='down'?'<span class=reacted title="Marked poor">👎</span>':'');
  return '<div class=acts data-id="'+esc(m.id)+'">'
    +'<button type=button class=more data-act=more title="Rate, react, ask again">▾</button>'+worn
    +'<span class=dock hidden>'
    +'<button type=button data-act=up'+on('up')+' title="Good">👍</button>'
    +'<button type=button data-act=down'+on('down')+' title="Poor">👎</button>'
    +(m.note?'<span class=said>'+esc(m.note)+'</span>':'<button type=button data-act=note title="Tell her why">✎</button>')
    +(isLast?'<button type=button data-act=again title="Ask her again">↻</button>':'')
    +'</span></div>';
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
// Counts the lines she has been asked to say, so a tap on her can drop one that
// is still being fetched as well as stop one already playing.
let speaking=0;
function primeVoice(){ player.play().catch(()=>{}); player.pause(); }
async function speak(text){
  const mine=++speaking;
  try{
    player.pause();
    const r=await fetch('/api/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
    if(!r.ok||mine!==speaking) return;
    const url=URL.createObjectURL(await r.blob());
    const previous=player.src;
    player.src=url;
    player.onended=player.onerror=()=>{ URL.revokeObjectURL(url); if(previous) URL.revokeObjectURL(previous); };
    await player.play();
  }catch(e){ console.warn('[voice] '+(e&&e.message||e)); }
}
// A tap on her. Mid-sentence it is a hand over her mouth: whatever she is
// saying stops, whatever she was about to say is dropped, and she pulls the
// "!" — cut off, and not happy about it. Otherwise it is a poke, and she
// bursts or spins, whichever the tap lands on.
function hush(){
  const talking=!player.paused&&!player.ended;
  speaking++;
  player.pause();
  if(!window.haruAvatar) return;
  if(talking) window.haruAvatar.poke('exclaim');
  else window.haruAvatar.poke(Math.random()<0.5?'burst':'orbit');
}
$('stage').addEventListener('click',hush);

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
// One reader for both ways a reply arrives — a send and a retry. Words land
// through show() as the stream delivers them; a U+FFFD means the round was
// thrown away and the bubble goes back to waiting.
async function readStream(r,show){
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
  return {reply,ignored,error};
}

$('cf').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const text=ci.value.trim(); if(!text&&!staged.length)return;
  primeVoice();
  // Taken off the shelf now, so a file picked while she is answering belongs to
  // the next message, not this one. Put back if the send never got through.
  const sent=staged; staged=[]; drawChips();
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
  const mine=(text?esc(text):'')+(sent.length?(text?'\\n':'')+'📎 '+esc(sent.map(f=>f.name).join(', ')):'');
  $('chat').insertAdjacentHTML('beforeend','<div class="msg me">'+mine+'</div><div class="msg them" id='+id+'>…</div>');
  $('chat').scrollTop=$('chat').scrollHeight;
  // Your message drops her into the thinking state while she works on the answer.
  if(window.haruAvatar) window.haruAvatar.think();
  const stopWaiting=()=>{const bubble=document.getElementById(id); if(bubble) bubble.remove();};
  // The waiting bubble doubles as the reply bubble: words land in it as the
  // stream delivers them, and the final processed reply replaces them when the
  // stream ends. textContent rather than innerHTML — her words are text, not
  // markup, and the model is not a source we escape from, it is the source.
  const show=t=>{const bubble=document.getElementById(id); if(!bubble) return false; bubble.textContent=t; $('chat').scrollTop=$('chat').scrollHeight; return true;};
  try{
    const r=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sent.length?{text,attachments:sent}:{text})});
    if(!r.ok) throw r;
    const {reply,ignored,error}=await readStream(r,show);
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
        if(window.haruAvatar){
          window.haruAvatar.notify();
          // Her mood for that line drives the avatar's state and face.
          post('/api/expression',{text:reply}).then(r=>window.haruAvatar.express(r.emotion)).catch(()=>{});
        }
        void speak(reply);
      }
    }
  }catch(r){
    stopWaiting();
    if(r&&r.status===401){location.reload();return;}
    // The files never left: back on the shelf so pressing Send again works.
    if(sent.length){ staged=sent.concat(staged); drawChips(); }
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">That did not get through.</div>');
  }finally{
    $('cb').disabled=false; $('chat').scrollTop=$('chat').scrollHeight;
    // The desk files the reply and hands it an id a moment later; re-read so
    // the bubble gets its row.
    setTimeout(load,1000);
  }
});
load();

// ---- Under her bubbles: thumbs, a note, and asking again --------------------
//
// A reply that got cut off, or that was not her, is asked for again: same
// message, her last answer left out, and the new one lands in the same bubble.
// The old words stay on screen until the new ones start arriving, and come
// back if nothing does.
async function askAgain(){
  const them=$('chat').querySelectorAll('.msg.them'); const last=them[them.length-1];
  if(!last||$('cb').disabled) return;
  const before=last.textContent;
  const id='wait'+(++waiting); last.id=id;
  $('cb').disabled=true;
  primeVoice();
  if(window.haruAvatar) window.haruAvatar.think();
  const show=t=>{const bubble=document.getElementById(id); if(!bubble) return false; bubble.textContent=t; $('chat').scrollTop=$('chat').scrollHeight; return true;};
  show('…');
  try{
    const r=await fetch('/api/chat/retry',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!r.ok) throw r;
    const {reply,ignored,error}=await readStream(r,show);
    if(error) throw new Error(error);
    if(ignored){
      const bubble=document.getElementById(id); if(bubble) bubble.remove();
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">She is not answering that.</div>');
    } else if(reply!==null){
      show(reply);
      if(reply){
        if(window.haruAvatar){ window.haruAvatar.notify(); post('/api/expression',{text:reply}).then(x=>window.haruAvatar.express(x.emotion)).catch(()=>{}); }
        void speak(reply);
      }
    }
  }catch(r){
    if(r&&r.status===401){location.reload();return;}
    show(before);
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">That did not get through.</div>');
  }finally{
    $('cb').disabled=false; setTimeout(load,1000);
  }
}
// A thumb lands on the reply the same way the desk's does — into her prompt,
// onto her mood — and she answers back in kind; the comeback is a bubble of its
// own. A note is the thumb explained, and it is the part she can actually
// learn from, so the pen is always there.
$('chat').addEventListener('click',async ev=>{
  const b=ev.target.closest('button[data-act]'); if(!b) return;
  const row=b.closest('.acts'); const id=row.dataset.id; const act=b.dataset.act;
  if(act==='more'){
    // One open at a time: the arrow is a drawer, not a setting.
    const dock=row.querySelector('.dock'); const opening=dock.hidden;
    for(const other of $('chat').querySelectorAll('.acts')){ const d=other.querySelector('.dock'); if(d){ d.hidden=true; } const a=other.querySelector('.more'); if(a){ a.classList.remove('open'); a.textContent='▾'; } }
    if(opening){ dock.hidden=false; b.classList.add('open'); b.textContent='▴'; }
    return;
  }
  if(act==='again') return askAgain();
  if(act==='note'){
    const input=document.createElement('input'); input.placeholder='Tell her why…'; input.maxLength=1000; input.enterKeyHint='send';
    b.replaceWith(input); input.focus();
    input.addEventListener('keydown',async e=>{
      if(e.key!=='Enter') return; e.preventDefault();
      const note=input.value.trim(); if(!note) return;
      input.disabled=true;
      try{ await post('/api/chat/rate',{id,note}); const said=document.createElement('span'); said.className='said'; said.textContent=note; input.replaceWith(said); }
      catch(r){ if(r&&r.status===401){location.reload();return;} input.disabled=false; }
    });
    return;
  }
  if(act==='up'||act==='down'){
    if(b.classList.contains('on')) return;
    for(const other of row.querySelectorAll('button[data-act=up],button[data-act=down]')) other.classList.remove('on');
    b.classList.add('on');
    try{
      const {line}=await post('/api/chat/rate',{id,reaction:act});
      if(line){
        $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(line)+'</div>');
        $('chat').scrollTop=$('chat').scrollHeight;
        if(window.haruAvatar){ window.haruAvatar.notify(); post('/api/expression',{text:line}).then(x=>window.haruAvatar.express(x.emotion)).catch(()=>{}); }
        void speak(line);
        // Her comeback has an id of its own once the desk has filed it.
        setTimeout(load,1200);
      }
    }catch(r){ if(r&&r.status===401){location.reload();return;} b.classList.remove('on'); }
  }
});

// ---- Files that ride the next message --------------------------------------
//
// The paperclip stages, and staging costs a copy and nothing else — same as the
// desktop. The bytes go up once, land in her keeping, and what comes back is
// the record the send carries. Nothing is read and no model is called until
// Send, so a file can be picked before deciding what to ask about it.
let staged=[];
function drawChips(){
  $('chips').innerHTML=staged.map((f,i)=>'<span class=chip><span>'+esc(f.name)+'</span><button type=button data-i='+i+' title="Remove">&times;</button></span>').join('');
  for(const b of $('chips').querySelectorAll('button')) b.onclick=()=>{
    const f=staged.splice(Number(b.dataset.i),1)[0];
    post('/api/attach/discard',{attachment:f}).catch(()=>{});
    drawChips();
  };
}
$('att').onclick=()=>$('af').click();
// A phone photo is several megabytes going up a home tunnel, and her own cap on
// a picture's way to a model is 1536 pixels wide — anything above that is
// thrown away at the other end regardless. Shrunk here, the upload is a tenth
// the size and nothing the model would ever see is lost. It also turns a HEIC
// into a JPEG on the one machine guaranteed to know how to read a HEIC.
async function shrunk(file){
  if(!/^image\\//.test(file.type)||file.size<400*1024) return file;
  try{
    const url=URL.createObjectURL(file);
    const img=new Image();
    await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=url;});
    URL.revokeObjectURL(url);
    const scale=Math.min(1,1536/(img.naturalWidth||1536));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',0.85));
    if(!blob||blob.size>=file.size) return file;
    return new File([blob],file.name.replace(/\\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
  }catch{ return file; }
}
$('af').onchange=async()=>{
  const picked=[...$('af').files].slice(0,6-staged.length);
  $('af').value='';
  for(const original of picked){
    const file=await shrunk(original);
    try{
      const r=await fetch('/api/attach?name='+encodeURIComponent(file.name||'file'),{method:'POST',headers:{'content-type':file.type||'application/octet-stream'},body:file});
      const out=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(out.error||'she could not take it');
      staged.push(out.attachment);
      drawChips();
    }catch(e){
      if(e&&e.status===401){location.reload();return;}
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">'+esc(file.name)+' did not attach — '+esc((e&&e.message)||'it did not get through')+'</div>');
      $('chat').scrollTop=$('chat').scrollHeight;
    }
  }
};

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
    $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(line)+'</div>');
    $('chat').scrollTop=$('chat').scrollHeight;
    if(window.haruAvatar){
      window.haruAvatar.notify();
      post('/api/expression',{text:line}).then(r=>window.haruAvatar.express(r.emotion)).catch(()=>{});
    }
    void speak(line);
  }catch(r){ if(r&&r.status===401) location.reload(); }
}
setTimeout(askIfSheHasSomethingToSay,1500);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) askIfSheHasSomethingToSay(); });
// Four minutes: she is being carried around, not watched. Anything faster reads
// as pestering, and the spacing on her side would refuse it anyway.
setInterval(askIfSheHasSomethingToSay,4*60_000);

// ---- Being told about her when nothing of hers is open ---------------------
//
// iOS only offers web push to a page installed from Share → Add to Home
// Screen, and only asks permission inside a tap. So the worker is registered on
// every load — it has to exist before anything can subscribe — and everything
// that needs a gesture waits behind the bell.
let sw=null;
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').then(async r=>{
    sw=r;
    // A subscription the server has forgotten — pruned as dead once, a restored
    // config — comes back on its own: re-posting the same one is a no-op.
    try{ const sub=await r.pushManager.getSubscription(); if(sub) await post('/api/push/subscribe',keysOf(sub)); }catch{}
  }).catch(()=>{});
}
function keysOf(sub){ const j=sub.toJSON(); return {endpoint:sub.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth}; }
function rawKey(s){ const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')); const bytes=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i); return bytes; }
const sheet=$('psheet');
$('bell').onclick=()=>{ if(sheet.hidden) void drawBell(); else sheet.hidden=true; };
async function drawBell(){
  sheet.hidden=false;
  if(!sw||!('PushManager' in window)){
    sheet.innerHTML='<p>Notifications need her installed first: open the Share menu, Add to Home Screen, then open her from there.</p>';
    return;
  }
  if(Notification.permission==='denied'){
    sheet.innerHTML='<p>Notifications for her are switched off in the phone settings.</p>';
    return;
  }
  let server;
  try{ server=await get('/api/push'); }
  catch(r){ if(r&&r.status===401){location.reload();return;} sheet.innerHTML='<p>Could not reach her.</p>'; return; }
  const sub=await sw.pushManager.getSubscription().catch(()=>null);
  if(!sub){
    sheet.innerHTML='<button id=pon>Let her reach this phone</button><p>She will only speak up when she has something: a reminder, or a thought of her own. Quiet overnight.</p>';
    $('pon').onclick=async()=>{
      try{
        if(await Notification.requestPermission()!=='granted'){ sheet.innerHTML='<p>She was not allowed to.</p>'; return; }
        const fresh=await sw.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:rawKey(server.key)});
        await post('/api/push/subscribe',keysOf(fresh));
        void drawBell();
      }catch(e){ console.warn('[push] '+(e&&e.message||e)); sheet.innerHTML='<p>That did not work.</p>'; }
    };
    return;
  }
  const p=server.prefs;
  const row=(id,label,on)=>'<label class=prow><input type=checkbox id='+id+(on?' checked':'')+'> '+label+'</label>';
  sheet.innerHTML=
    row('pr','Her own thoughts',p.random)+
    row('pe','Reminders and the journal',p.events)+
    row('ps','The machine she runs on',p.system)+
    '<div class=prow>Quiet from <input type=time id=pf value="'+p.quietFrom+'"> to <input type=time id=pt value="'+p.quietTo+'"></div>'+
    '<button id=ptry>Send a test</button>'+
    '<button id=poff class=off>Stop notifying this phone</button>';
  const save=()=>post('/api/push/prefs',{random:$('pr').checked,events:$('pe').checked,system:$('ps').checked,quietFrom:$('pf').value,quietTo:$('pt').value}).catch(()=>{});
  for(const id of ['pr','pe','ps','pf','pt']) $(id).onchange=save;
  $('ptry').onclick=async()=>{
    $('ptry').disabled=true;
    try{ const r=await post('/api/push/test'); $('ptry').textContent=r.delivered?'Sent — check the lock screen':'Nothing went out'; }
    catch{ $('ptry').textContent='That did not work'; }
  };
  $('poff').onclick=async()=>{
    try{ await post('/api/push/unsubscribe',{endpoint:sub.endpoint}); }catch{}
    try{ await sub.unsubscribe(); }catch{}
    void drawBell();
  };
}
${AVATAR}
</script>`;
}

/**
 * The worker behind her notifications — the one piece of the page that runs
 * with nothing open.
 *
 * Kept to the two events push needs. Every push puts up a notification: that is
 * the deal with iOS, and a worker that swallows one quietly loses the
 * permission. A tap brings the installed app to the front — there is exactly
 * one conversation, so the front page is the conversation — and any address the
 * payload names that is not one of ours falls back to '/'.
 */
export function serviceWorker(): string {
  return `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let m={}; try{ m=e.data?e.data.json():{}; }catch{}
  e.waitUntil(self.registration.showNotification(m.title||'Haru',{
    body:m.body||'',
    icon:'/portrait',
    data:{url:typeof m.url==='string'&&m.url.startsWith('/')&&!m.url.startsWith('//')?m.url:'/'}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(open=>{
    for(const client of open){ if('focus' in client){ client.focus(); return; } }
    return self.clients.openWindow(url);
  }));
});
`;
}
