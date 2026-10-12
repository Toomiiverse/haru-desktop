// Observer only: all decisions, arrivals and memories come from Haru's server.
import { LOCATIONS, encounterFor, replyExpression } from './engine.mjs';
import { renderWorld, renderInterior, renderPlaceExterior, fitConversationScene, portrait, dialoguePortrait, npcSetting, paintWalkers } from './world.mjs';
const app = document.querySelector('#app'), dialog = document.querySelector('#dialog');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name = id => id === 'home' ? 'Haru’s home' : LOCATIONS.find(p=>p.id===id)?.name || 'Willowbrook';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let world, game, walkers = new Map(), previous = new Map(), receivedAt=0;
let selected=null, following='haru', follow=false, connected=false, busy=false, reading=false, expired=false, error='', revision=0, conversation=null;
const clock = () => `${String(world.clock.hour).padStart(2,'0')}:${String(world.clock.minute).padStart(2,'0')}`;
async function api(command) {
  const r = await fetch(command ? '/api/world/control' : '/api/world',{method:command?'POST':'GET',headers:command?{'content-type':'application/json'}:{},body:command?JSON.stringify(command):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(r.status===401){expired=true;throw Error('Sign in again to reconnect.');}
  const data=await r.json(); if(!r.ok)throw Error(data.error || 'The world could not be reached.');
  if(data.neighborhood?.game?.npcs?.length!==7 || !Array.isArray(data.neighborhood.walkers))throw Error('The neighborhood is not ready on the server yet.');
  return data;
}
function accept(data) {
  if(data.updatedAt!==world?.updatedAt || !world){previous=walkers;walkers=new Map(data.neighborhood.walkers);receivedAt=performance.now();}
  world=data; game=data.neighborhood.game; connected=true; error=''; render();
}
async function refresh() {
  if(reading||busy||expired||document.hidden||dialog.open)return;
  reading=true; const requested=revision;
  try{const data=await api();if(requested===revision&&!busy)accept(data);}
  catch(e){if(requested===revision){connected=false;error=e.name==='TimeoutError'?'The server is taking a while. No local simulation is running.':e.message;render();}}
  finally{reading=false;app.querySelector('[data-refresh]')?.removeAttribute('disabled');}
}
async function command(value) {
  if(!connected||busy)return; busy=true;revision++;render();
  try{accept(await api(value));}catch(e){connected=false;error=`${e.message} No command will be retried automatically.`;}
  finally{busy=false;render();}
}
function render() {
  if(conversation)return;
  const active=document.activeElement, focus=active?.getAttributeNames().find(k=>k.startsWith('data-'));
  const focusValue=focus?active.getAttribute(focus):null;
  const status = `<div class="server-connection" role="status"><span>${connected?'● Connected to Haru’s server':world?'◇ Offline · last received state':'◇ Waiting for Haru’s server'}</span><button data-refresh ${reading||busy||expired?'disabled':''}>Refresh</button>${expired?'<a href="/elsewhere">Sign in again ↗</a>':''}</div>${error?`<p class="save-warning" role="alert">${esc(error)}</p>`:''}`;
  if(!world){app.innerHTML=`<main id="main"><h1>Opening Willowbrook…</h1>${status}<div class="server-map-skeleton" aria-hidden="true"></div></main>`;return;}
  const observed=game.npcs.find(n=>n.id===following)||game.npcs.at(-1), watcher=walkers.get(observed.id);
  const inside=follow?watcher.inside:selected&&LOCATIONS.find(p=>p.id===selected)?.indoors?selected:null;
  const frame=inside?renderInterior(inside,game,{walkers}):selected&&!follow?renderPlaceExterior(selected,game,{walkers,reducedMotion:reduced.matches}):renderWorld(game,selected||'home',{walkers,spectator:true,reducedMotion:reduced.matches});
  const where=watcher.moving?`Walking to ${name(watcher.destination)}`:`${watcher.inside?'Inside':'Near'} ${name(npcSetting(observed,watcher).location)}`;
  const locked=!connected||busy;
  app.innerHTML=`<header class="topbar"><a class="wordmark" href="/elsewhere">elsewhere<span>✳</span></a><span class="brand-tagline">Haru’s life in Willowbrook</span><a class="server-chat-link" href="/">Haru’s full chat ↗</a></header><main id="main" tabindex="-1">${status}<div class="page-heading watch-heading"><div><p class="eyebrow">SEVEN RESIDENTS · ONE SHARED WORLD</p><h1>Welcome home, Haru<span>.</span></h1><p>The neighborhood you created. Now living on her server.</p></div><div class="server-clock">Day ${world.clock.day} · ${clock()}<small>${world.running?`${world.speed}× pace`:'Paused'} · server time</small></div></div>
  <section class="spectator-shell"><div class="watch-toolbar"><button class="camera-button" data-overview>Town overview</button><button class="camera-button" data-follow="haru" aria-pressed="${follow&&following==='haru'}">Follow Haru</button><span class="watch-clock">${inside?esc(name(inside)):follow?esc(observed.name):selected?esc(name(selected)):'Willowbrook'}</span><button class="camera-button" data-pause ${locked?'disabled':''}>${world.running?'Pause world':'Resume world'}</button><label>Pace <select id="server-speed" aria-label="World pace" ${locked?'disabled':''}>${[1,12,60].map(n=>`<option value="${n}" ${world.speed===n?'selected':''}>${n===1?'Real time':n+'×'}</option>`).join('')}</select></label></div>
  <div class="watch-layout"><div class="watch-stage"><div class="world-art">${frame}</div><div class="watch-roster" aria-label="Follow a resident">${game.npcs.map(n=>`<button data-follow="${n.id}" aria-pressed="${follow&&following===n.id}" class="${following===n.id?'selected':''}">${portrait(n,40)}<span>${esc(n.name.split(' ')[0])}</span></button>`).join('')}</div></div>
  <aside class="watch-inspector"><p class="eyebrow">${esc(observed.trait)} · ${esc(observed.career)}</p><h2>${esc(observed.name)}</h2><p class="server-where">${esc(where)}</p><p>${esc(observed.action)}</p><p class="resident-thought">${esc(observed.thought)}</p><button class="primary wide" data-npc="${observed.id}" ${locked?'disabled':''}>Talk to ${esc(observed.name.split(' ')[0])}</button><p class="small muted">Point and click to visit. No player avatar or movement controls.</p><div class="server-suggestions"><h3>Suggest Haru’s next activity</h3><p class="small muted">She finishes her current activity first.</p>${world.actions.filter(a=>!selected||a.place===selected).map(a=>`<button class="secondary" data-suggest="${a.id}" ${locked?'disabled':''}>${esc(a.label)}</button>`).join('')||'<p class="small muted">This is another resident’s private home. Haru cannot enter.</p>'}</div></aside></div></section>
  <nav class="map-destinations" aria-label="Explore buildings">${LOCATIONS.map(p=>`<button data-location="${p.id}">${esc(p.id==='home'?'Haru’s home':p.label)}</button>`).join('')}</nav>
  <section class="community-section"><div class="section-heading"><h2>People of Willowbrook</h2><span class="small muted">Six local agents, and Haru</span></div><div class="community-grid">${game.npcs.map(n=>`<button class="resident-card" data-npc="${n.id}" ${locked?'disabled':''}><div class="resident-header">${portrait(n)}<div><h3>${esc(n.name)}</h3><span>${esc(n.career)}</span></div></div><p>${esc(walkers.get(n.id).moving?'On the way to '+name(walkers.get(n.id).destination):n.action)}</p></button>`).join('')}</div></section>
  <section class="panel server-journal"><h2>Haru’s world journal</h2><p class="small muted">Completed experiences join her existing Core memory journal.</p>${world.events.length?`<ol>${world.events.slice(-8).reverse().map(e=>`<li>${esc(e.text)}${e.manual?' · skipped ahead':''}</li>`).join('')}</ol>`:'<p>◇ <strong>A new page</strong> — her experiences will appear here.</p>'}</section><footer><span>Server-owned world · your standalone save is untouched</span><a href="/assets/world/README.md">Art credits &amp; license</a></footer></main>`;
  if(focus)app.querySelector(`[${focus}="${CSS.escape(focusValue)}"]`)?.focus({preventScroll:true});
}
function backdrop(c) {
  app.innerHTML=`<div class="conversation-world">${c.setting.inside?renderInterior(c.setting.location,c.game,{walkers:c.walkers}):renderPlaceExterior(c.setting.location,c.game,{walkers:c.walkers,reducedMotion:true})}</div>`;
  fitConversationScene(app.querySelector('.conversation-world .neighborhood-art'),innerWidth,innerHeight);
}
window.addEventListener('resize',()=>{if(conversation)fitConversationScene(app.querySelector('.conversation-world .neighborhood-art'),innerWidth,innerHeight);});
function openConversation(id) {
  if(!connected||!game)return;
  const npc=game.npcs.find(n=>n.id===id); if(!npc)return;
  const walker=walkers.get(id), setting=npcSetting(npc,walker);
  const phrases={game:'at my gaming desk',anime:'watching an episode',read:'reading',sketch:'working on a drawing',rest:'taking a little rest',sleep:'resting at home',tea:'making tea',music:'listening to music',window:'enjoying the view',collect:'rearranging my figures',park:'spending some time by the pond',cafe:'having a tea break',library:'browsing the library',market:'visiting the market',studio:'sketching at the studio'};
  const lines=id==='haru'?[{speaker:'Haru',text:walker.moving?`I’m on my way to ${name(walker.destination)}. Walk with me a moment?`:`You caught me ${phrases[world.current?.id]||'between plans'}. What’s on your mind?`,expression:'neutral'}]:encounterFor(npc,setting,walker.moving).lines;
  conversation={id,npc,setting,lines,index:0,ready:false,draft:'',pending:false,error:'',history:[],game:structuredClone(game),walkers:structuredClone(walkers),entrance:true,returnFocus:document.activeElement};
  backdrop(conversation); drawConversation(); dialog.showModal();dialog.querySelector('[data-next]')?.focus({preventScroll:true});
}
function drawConversation() {
  const c=conversation;if(!c)return;
  const line=c.lines[c.index];
  dialog.className=`dialogue-scene world-dialogue${c.ready?' is-replying':''}`;
  dialog.innerHTML=`<button class="dialog-close icon-button" data-close aria-label="Close conversation">×</button><section class="dialogue-stage"><div class="vn-cast-frame ${c.entrance?'portrait-enter':''}">${dialoguePortrait(c.npc,c.pending?'thoughtful':c.ready?'neutral':line.expression)}</div><section class="dialogue-content vn-textbox"><div class="dialogue-line-top"><h2 id="dialog-title" class="speaker-name">${esc(c.npc.name)}</h2><span>View held · server life continues</span></div><div class="chat-reply" role="status" aria-live="polite">${c.pending?'<p>Thinking…</p><div class="reply-skeleton" aria-hidden="true"><span></span><span></span></div>':`<p>${esc(line.text)}</p>`}</div>${c.ready?`<section class="dialogue-custom"><form id="server-chat" aria-busy="${c.pending}"><label for="message">Write my own reply</label>${c.error?`<p class="ai-error" role="alert" tabindex="-1">${esc(c.error)}</p>`:''}<textarea id="message" name="message" rows="2" maxlength="280" required ${c.pending||!connected?'disabled':''}>${esc(c.draft)}</textarea><p class="dialogue-note">${c.id==='haru'?'This goes to Haru’s existing chat and shared memory, using her configured model.':'Optional NPC reply via Venice GLM 4.7 Flash. Shares this scene and recent dialogue; uses API credits. Encounter-only.'} No automatic retries. Never enter secrets.</p><div class="custom-send-row"><span>280 characters maximum</span><button class="dialogue-next" ${c.pending||!connected?'disabled':''}>${c.pending?'Waiting…':'Send'}</button></div>${c.pending?'<button class="ai-cancel" data-cancel type="button">Cancel waiting</button>':''}</form></section>`:''}<div class="dialogue-advance"><span>${c.setting.inside?'Inside':'Near'} ${esc(name(c.setting.location))}</span><button class="dialogue-next" data-next ${c.pending?'disabled':''}>${c.ready?'Leave':c.index<c.lines.length-1?'Continue':'Reply'} <kbd>E</kbd></button></div></section></section>`;
  c.entrance=false;
  dialog.querySelector(c.pending?'[data-cancel]':c.error?'.ai-error':c.ready?'#message':'[data-next]')?.focus({preventScroll:true});
}
function nextLine(){const c=conversation;if(!c||c.pending)return;if(c.index<c.lines.length-1)c.index++;else if(!c.ready)c.ready=true;else{dialog.close();return;}drawConversation();}
async function haruReply(message,c,signal) {
  const r=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:message,requestId:c.requestId}),signal});
  if(!r.ok)throw Error(r.status===401?'Sign-in expired. Open Haru’s full chat to reconnect.':'Haru could not receive this message.');
  const reader=r.body.getReader(), decoder=new TextDecoder();let buffer='';
  try { for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let split;
    while((split=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,split);buffer=buffer.slice(split+2);for(const line of packet.split('\n'))if(line.startsWith('data: ')){const data=JSON.parse(line.slice(6));if(data.error)throw Error(data.error);if(data.pending)throw Error('Haru is still answering this message. Check her full chat; sending again will not start another answer.');if(data.done)return data.reply || (data.ignored?'Haru is not answering right now. You can return to her full chat.':'No reply this time.');}}
    if(done)throw Error('Connection ended before her reply. Check Haru’s full chat before repeating the message.');
  }} finally {await reader.cancel().catch(()=>{});}
}
async function send(message) {
  const c=conversation;if(!c?.ready||c.pending||!connected||!message.trim()||message.length>280)return;
  if(c.sentText!==message){c.requestId=crypto.randomUUID();c.sentText=message;}
  c.draft=message;c.pending=true;c.error='';const controller=c.controller=new AbortController();drawConversation();
  try {
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(c.id==='haru'?210000:50000)]);
    let reply;
    if(c.id==='haru')reply=await haruReply(message,c,signal);
    else{const r=await fetch('/api/elsewhere/dialogue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({npcId:c.id,message,history:c.history.slice(-8)}),signal});const data=await r.json();if(!r.ok)throw Error(data.error||'No reply was received.');reply=data.reply;}
    if(conversation!==c||controller.signal.aborted)return;
    if(typeof reply!=='string'||!reply.trim())throw Error('No reply was received.');
    c.history.push({role:'user',content:message},{role:'assistant',content:reply.slice(0,1800)});c.history=c.history.slice(-8);
    c.lines=[{speaker:c.npc.name,text:reply,expression:replyExpression(reply)}];c.index=0;c.ready=false;c.draft='';c.sentText=null;
  }catch(e){if(conversation!==c)return;c.error=controller.signal.aborted?'Waiting cancelled. The reply may still be saved or use credits. Nothing was retried.':e.message;}
  finally{if(conversation===c){c.pending=false;drawConversation();}}
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-refresh],[data-pause],[data-suggest],[data-follow],[data-overview],[data-location],[data-npc],[data-close],[data-next],[data-cancel]');if(!target||target.disabled)return;
  const d=target.dataset;
  if(d.close!==undefined)dialog.close();else if(d.next!==undefined)nextLine();else if(d.cancel!==undefined)conversation?.controller?.abort();
  else if(d.refresh!==undefined)void refresh();else if(d.pause!==undefined)void command({type:'running',value:!world.running});else if(d.suggest)void command({type:'suggest',action:d.suggest});
  else if(d.npc)openConversation(d.npc);else if(d.follow){following=d.follow;follow=true;selected=null;render();}else if(d.overview!==undefined){follow=false;selected=null;render();}else if(d.location){selected=d.location;follow=false;render();}
});
document.addEventListener('change',e=>{if(e.target.id==='server-speed')void command({type:'speed',value:Number(e.target.value)});});
dialog.addEventListener('input',e=>{if(e.target.id==='message'&&conversation)conversation.draft=e.target.value;});
dialog.addEventListener('submit',e=>{if(e.target.id==='server-chat'){e.preventDefault();void send(String(new FormData(e.target).get('message')).trim());}});
dialog.addEventListener('close',()=>{const c=conversation;c?.controller?.abort();conversation=null;render();if(c)app.querySelector(`[data-npc="${CSS.escape(c.id)}"]`)?.focus({preventScroll:true});void refresh();});
document.addEventListener('keydown',e=>{if(dialog.open&&e.key.toLowerCase()==='e'&&!e.target.closest('input,textarea,select')&&!e.repeat){e.preventDefault();nextLine();}const button=e.target.closest('svg [role="button"]');if(button&&(e.key==='Enter'||e.key===' ')){e.preventDefault();button.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
let lastFrame=0;
function frame(now){const dt=lastFrame?Math.min(.1,(now-lastFrame)/1000):0;lastFrame=now;
  if(world&&!dialog.open&&!document.hidden){const svg=app.querySelector('.world-art .neighborhood-art');if(svg){const visible=structuredClone(walkers);for(const [id,w] of visible){const old=previous.get(id),delta=old?Math.hypot(old.position[0]-w.position[0],old.position[1]-w.position[1]):Infinity;
    // Replays short, already-received steps only. Large accelerated jumps use authoritative stops.
    if(connected&&world.running&&!reduced.matches&&old&&!old.inside&&!w.inside&&delta<=64){const t=Math.min(1,(now-receivedAt)/10000);w.position=old.position.map((v,i)=>v+(w.position[i]-v)*t);}
    if(connected&&world.running&&!reduced.matches)w.phase+=(now-receivedAt)/1000*7;
  }paintWalkers(svg,visible,follow?following:'',reduced.matches||!connected||!world.running);
  if(follow&&!svg.classList.contains('room-art')){const w=visible.get(following),x=Math.max(0,Math.min(480,w.position[0]-260)),y=Math.max(0,Math.min(480,w.position[1]-260));svg.setAttribute('viewBox',`${x} ${y} 520 520`);}}}
  requestAnimationFrame(frame);
}
window.addEventListener('offline',()=>{revision++;connected=false;error='Offline. Showing the last server state; no local simulation or queued commands.';render();});
window.addEventListener('online',()=>void refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
void refresh();setInterval(refresh,3000);requestAnimationFrame(frame);
