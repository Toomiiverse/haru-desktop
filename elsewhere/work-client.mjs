import { renderWorld, portrait } from './work-map.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Not observed';
const badge=r=>`<span class="ww-badge" data-state="${esc(r.state)}">${esc(r.state)}</span>`;
const row=r=>`<button class="ww-row" data-item="${esc(r.id)}"><span><strong>${esc(r.title)}</strong><small>${esc(r.stage)}</small></span><span>${badge(r)}<small>${esc(r.model||'No model dispatch recorded')}</small></span></button>`;
const list=(rows,empty)=>rows.length?rows.map(row).join(''):`<p class="ww-empty">${esc(empty)}</p>`;
const assets=(html,urls)=>{if(urls)for(const [from,to]of Object.entries(urls))html=html.replaceAll(`href="${from}"`,`href="${to}"`);return html;};

function map(data,selected,urls){
  const box=document.createElement('div');
  box.innerHTML=renderWorld(data.scene,selected||'home',{walkers:new Map(structuredClone(data.scene.walkers)),spectator:true,reducedMotion:true,workView:true});
  box.querySelector('svg').setAttribute('aria-label','Haru’s work town. Inspect a building or work category.');
  for(const[id,label]of Object.entries(data.placeLabels)){
    const target=box.querySelector(`[data-location="${CSS.escape(id)}"]`);if(!target)continue;
    target.setAttribute('aria-label',`Inspect ${label}`);target.querySelector('title').textContent=`${label} · recorded work`;
    target.querySelector('.location-label text').textContent=label;
    const rect=target.querySelector('.location-label rect'),width=label.length*9+32;rect.setAttribute('width',width);rect.setAttribute('x',-width/2);
    target.querySelector('.occupancy-count').textContent='';
  }
  for(const actor of [data.haru,...data.residents]){
    const target=box.querySelector(`[data-npc="${CSS.escape(actor.id)}"]`);if(!target)continue;
    target.setAttribute('aria-label',`Inspect ${actor.name}: ${actor.role}, ${actor.state}`);target.setAttribute('data-work-state',actor.state);
    target.querySelector('title').textContent=`${actor.name} · ${actor.role} · ${actor.state}`;
  }
  return assets(box.innerHTML,urls);
}

function detail(data){
  if(data.items)return `<p class="ww-eyebrow">RETAINED OBSERVATIONS · LAST 30 DAYS</p><h2 id="ww-detail-title">Recorded work history</h2>${list(data.items,'No retained work observations.')} ${data.nextBefore?`<button class="ww-button" data-older="${data.nextBefore}">Older work</button>`:''}<p class="ww-muted">Source windows are bounded; underlying ledgers keep their existing history.</p>`;
  if(data.simulated)return `<p class="ww-eyebrow">Historical archive · simulated</p><h2 id="ww-detail-title">Earlier fictional world</h2><p>These preserved entries describe the retired simulation.</p><ol class="ww-history">${data.events.slice().reverse().map(e=>`<li><time>${time(Date.parse(e.at))}</time><p>${esc(e.text)}</p>${e.manual?'<small>Skipped game time</small>':''}</li>`).join('')}</ol>`;
  const r=data.item;
  const facts=[['Started',time(r.startedAt)],['Last recorded change',time(r.eventAt)],['Last observed',time(r.observedAt)],['Model dispatched',r.model||'No model dispatch recorded'],['Evidence',r.completionBasis+' · '+(r.outcomeConfirmed?'outcome confirmed':'no confirmed application outcome')],['Source reference',r.sourceRef]];
  return `<p class="ww-eyebrow">${esc(r.jobKind||r.source)} · ${esc(r.category)}</p><h2 id="ww-detail-title">${esc(r.title)}</h2><p>${badge(r)} ${esc(r.stage)}</p><dl class="ww-facts">${facts.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${r.result?`<h3>Recorded result</h3><pre>${esc(r.result)}</pre>`:''}<h3>Recorded steps</h3><ol class="ww-history">${data.history.map(e=>`<li><time>${time(e.eventAt)}</time><p>${esc(e.stage)} · ${esc(e.state)}</p></li>`).join('')||'<li>No retained step history.</li>'}</ol>${data.nextBefore?`<button class="ww-button" data-older="${data.nextBefore}">Older steps</button>`:''}<p class="ww-muted">Inspection only. Manage work through Haru’s existing chat and task controls.</p>`;
}

export function mountWorkWorld(root,transport,{assetUrls=null,chatHref='/',onOpenChat=null}={}){
  let data=null,connected=false,error='',expired=false,reading=false,disposed=false,place=null,resident=null,detailId=null,detailEpoch=0,inspectionFocus=null;
  const dialog=document.createElement('dialog');dialog.className='ww-dialog';dialog.setAttribute('aria-labelledby','ww-detail-title');root.classList.add('haru-work-world');root.after(dialog);
  function render(){
    if(disposed)return;
    const focused=root.querySelector(':focus'),key=focused?.getAttributeNames().find(k=>k.startsWith('data-')),value=key?focused.getAttribute(key):null;
    const status=`<div class="ww-connection" role="status"><i data-connected="${connected&&!data?.stale}"></i><span>${expired?'Sign-in expired':connected?data?.stale?'Observer delayed · last received state':'Connected · real activity':data?'Connection lost · last received state':'Connecting to Haru'}${data?`<small>Observed ${time(data.observedAt)}</small>`:''}</span><button class="ww-button" data-refresh ${reading||expired?'disabled':''}>Refresh</button></div>${error?`<p class="ww-error" role="alert">${esc(error)}${expired?' <a href="/elsewhere">Sign in again</a>':''}</p>`:''}`;
    if(!data){root.innerHTML=`<main class="ww-main"><h1>Haru’s work world</h1>${status}<div class="ww-skeleton" aria-hidden="true"></div></main>`;return;}
    root.innerHTML=`<a class="ww-skip" href="#ww-main">Skip to recorded work</a><header class="ww-header"><a class="ww-brand" href="${esc(chatHref)}" data-chat>haru<span> / work world</span></a><a href="${esc(chatHref)}" data-chat>Open Haru’s chat ↗</a></header><main class="ww-main" id="ww-main" tabindex="-1">${status}<div class="ww-heading"><div><p class="ww-eyebrow">WILLOWBROOK · REAL WORK</p><h1>A place for everything<br>Haru is doing.</h1></div><div class="ww-now"><span>${esc(data.haru.state)}</span><strong>${esc(data.haru.activity)}</strong><small>Town movement illustrates recorded activity.</small></div></div><div class="ww-layout"><section class="ww-map-panel" aria-labelledby="ww-town-heading"><div class="ww-map-toolbar"><h2 id="ww-town-heading">The work town</h2><button class="ww-button" data-overview>Town overview</button></div><div class="ww-map">${map(data,place,assetUrls)}</div></section></div><section class="ww-team"><div class="ww-section-heading"><h2>Haru’s agents and system services</h2><span>Roles, routes and recorded activity</span></div><div class="ww-residents">${[data.haru,...data.residents].map(r=>`<button class="ww-resident" data-resident="${r.id}">${assets(portrait({...r,career:r.role},40),assetUrls)}<span><strong>${esc(r.name)}</strong><small>${esc(r.role)}</small><small class="ww-agent-route" aria-label="Configured route">${esc(r.routeLabel||'Route not reported')}</small>${r.summary?`<small>${esc(r.summary)}</small>`:''}</span>${badge(r)}</button>`).join('')}</div></section><section class="ww-board"><div class="ww-section-heading"><h2>The town board</h2><span>Steps and receipts · no estimated percentages</span></div><div class="ww-board-columns"><div><h3>Active &amp; queued <span>${data.active.length}</span></h3>${list(data.active,'No active or queued work recorded.')}</div><div><h3>Needs attention</h3>${list(data.attention.slice(0,6),'No recorded failures or uncertain outcomes.')}</div><div><h3>Recent activity</h3>${list(data.recent.filter(r=>!data.active.some(a=>a.id===r.id)).slice(0,8),'Recorded results will appear here.')}</div></div></section><details class="ww-coverage"><summary>Activity coverage and source health</summary><p>${esc(data.coverageNote)}</p><dl>${Object.entries(data.sources).map(([name,s])=>`<div><dt>${esc(name)}</dt><dd>${esc(s.state)} · ${time(s.observedAt)}${s.truncated?' · recent window truncated':''}${s.droppedFacts?' · '+s.droppedFacts+' observations dropped':''}</dd></div>`).join('')}</dl><p>Presentation observations are retained for ${data.retentionDays} days. Underlying task records retain their existing storage rules.</p></details><footer class="ww-footer"><span>Real timestamps · read-only inspection</span><button data-history>Recorded work history</button>${data.archiveAvailable?'<button data-archive>Earlier fictional journal</button>':''}<a href="/assets/world/README.md">Art credits</a></footer></main>`;
    if(key)root.querySelector(`[${key}="${CSS.escape(value)}"]`)?.focus({preventScroll:true});
  }
  function inspect(kind,id,focus){
    const actor=kind==='agent'?[data.haru,...data.residents].find(r=>r.id===id):null;
    const area=kind==='place'?data.places.find(p=>p.id===id):null;
    if(!actor&&!area)return;
    const rows=actor?(actor.records||data.recent.filter(r=>(actor.recordedItemIds||actor.itemIds||[]).includes(r.id))):data.recent.filter(r=>r.place===id);
    detailId=null;detailEpoch++;inspectionFocus=focus;
    dialog.innerHTML=`<button class="ww-close" data-close aria-label="Close work details">×</button><p class="ww-eyebrow">${actor?actor.agentKind==='service'?'SYSTEM SERVICE':'SYSTEM AGENT':'WORK AREA'}</p><h2 id="ww-detail-title">${esc(actor?actor.name+' · '+actor.role:data.placeLabels[id])}</h2>${actor?`<p class="ww-muted">${esc(actor.routeLabel||'Route not reported')}</p>`:''}<p class="ww-muted">${esc(actor?actor.activity:area.description)}</p>${actor?.summary?`<p>${esc(actor.summary)}</p>`:''}${actor?.details?`<ul>${actor.details.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:''}${list(rows.slice(0,8),'No recorded work in this view.')}`;
    if(!dialog.open)dialog.showModal();
    dialog.querySelector('[data-close]').focus();
  }
  async function refresh(){
    if(reading||expired||disposed||document.hidden)return;reading=true;
    try{const next=await transport.snapshot();if(disposed)return;if(next?.version!==1||next.mode!=='work')throw Error('The work view is unavailable in this server build.');data=next;connected=true;error='';}
    catch(e){if(disposed)return;connected=false;expired=e.status===401;error=e.message||'Could not read work activity.';}
    finally{reading=false;render();}
  }
  async function open(id,before){
    detailId=id;const epoch=++detailEpoch;
    if(!dialog.open){dialog.innerHTML='<button class="ww-close" data-close aria-label="Close work details">×</button><h2 id="ww-detail-title">Opening work details…</h2>';dialog.showModal();dialog.querySelector('[data-close]').focus();}
    try{const result=await transport.detail(id,before);if(disposed||detailId!==id||epoch!==detailEpoch||!dialog.open)return;dialog.innerHTML=`<button class="ww-close" data-close aria-label="Close work details">×</button>${detail(result)}`;dialog.querySelector('[data-close]').focus();}
    catch(e){if(disposed||epoch!==detailEpoch||!dialog.open)return;dialog.innerHTML=`<button class="ww-close" data-close aria-label="Close work details">×</button><h2 id="ww-detail-title">Details unavailable</h2><p role="alert">${esc(e.message)}</p>`;dialog.querySelector('[data-close]').focus();}
  }
  const click=e=>{if(onOpenChat&&e.target.closest('[data-chat]')){e.preventDefault();onOpenChat();return;}const t=e.target.closest('[data-refresh],[data-overview],[data-place],[data-location],[data-resident],[data-npc],[data-item],[data-archive],[data-history]');if(!t||t.disabled||!root.contains(t))return;
    if(t.hasAttribute('data-refresh'))void refresh();else if(t.hasAttribute('data-item')){inspectionFocus=null;void open(t.dataset.item);}else if(t.hasAttribute('data-history')){inspectionFocus=null;void open('history');}else if(t.hasAttribute('data-archive')){inspectionFocus=null;void open('archive');}else if(t.hasAttribute('data-overview')){place=null;resident=null;render();}else if(t.hasAttribute('data-resident')||t.hasAttribute('data-npc')){resident=t.dataset.resident||t.dataset.npc;place=null;render();inspect('agent',resident,`[${t.hasAttribute('data-resident')?'data-resident':'data-npc'}="${CSS.escape(resident)}"]`);}else{place=t.dataset.place||t.dataset.location;resident=null;render();inspect('place',place,`[data-location="${CSS.escape(place)}"]`);}};
  const key=e=>{const t=e.target.closest('svg [role="button"]');if(t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();t.dispatchEvent(new MouseEvent('click',{bubbles:true}));}};
  const close=()=>{const id=detailId,focus=inspectionFocus;detailId=null;inspectionFocus=null;detailEpoch++;root.querySelector(focus||(id==='archive'?'[data-archive]':id==='history'?'[data-history]':`[data-item="${CSS.escape(id||'')}"]`))?.focus({preventScroll:true});};
  const modal=e=>{if(e.target.closest('[data-item]'))void open(e.target.closest('[data-item]').dataset.item);else if(e.target.closest('[data-close]'))dialog.close();else if(e.target.closest('[data-older]'))void open(detailId,Number(e.target.closest('[data-older]').dataset.older));};
  const offline=()=>{connected=false;error='Offline. Showing the last received activity.';render();};const visible=()=>{if(!document.hidden)void refresh();};
  root.addEventListener('click',click);root.addEventListener('keydown',key);dialog.addEventListener('click',modal);dialog.addEventListener('close',close);window.addEventListener('offline',offline);window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible);
  render();void refresh();const timer=setInterval(refresh,3000);
  return()=>{disposed=true;detailEpoch++;clearInterval(timer);root.removeEventListener('click',click);root.removeEventListener('keydown',key);window.removeEventListener('offline',offline);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible);dialog.remove();root.innerHTML='';};
}

export const browserTransport={async read(path){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok){const e=Error(r.status===401?'Sign in again to read Haru’s work.':'Haru’s work records could not be reached.');e.status=r.status;throw e;}return r.json();},snapshot(){return this.read('/api/world/work');},detail(id,before){return this.read('/api/world/work/items/'+encodeURIComponent(id)+(before?'?before='+before:''));}};
const app=document.querySelector('#work-app');if(app)mountWorkWorld(app,browserTransport);
