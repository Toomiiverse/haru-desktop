import { LOCATIONS, canAccess, homeFor } from './engine.mjs';
// Supplied atlases are rendered unchanged through native SVG viewports; see assets/world/README.md.
// Fixed map geometry also serves as the loading placeholder. The town cannot be empty;
// an empty resident list leaves its public places and seven separate homes available.
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = value => /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value || '') ? value : '#A8B99F';

export const WORLD_WIDTH = 1000, WORLD_HEIGHT = 1000;
export const places = Object.fromEntries([
  ['home',0,0,[0,656,80,64]], ['home-lina',1,0,[96,336,64,64]],
  ['home-theo',2,0,[0,400,80,64]], ['home-maya',3,0,[0,464,48,64]],
  ['library',0,1,[0,528,80,64]], ['cafe',1,1,[160,336,80,64]],
  ['studio',2,1,[96,592,64,64]], ['park',3,1,null],
  ['home-felix',0,2,[160,656,48,64]], ['home-jules',1,2,[208,400,48,64]],
  ['home-bea',2,2,[160,464,80,64]], ['market',3,2,[208,528,48,64]],
].map(([id,column,row,art]) => {
  const {name,label} = LOCATIONS.find(location => location.id === id);
  const x = 144+column*240, y = 256+row*304, width = art ? art[2]*2 : 128;
  return [id,{name,label,x,y,art,bounds:[x-width/2,y-176,width,128]}];
}));
export function npcSetting(npc, walker) {
  if (walker?.inside) return {location:walker.inside,inside:true};
  const fallback = places[npc.location] || places.park;
  const [x,y] = walker?.position || [fallback.x,fallback.y];
  const nearest = Object.entries(places).reduce((a,b) => Math.hypot(x-a[1].x,y-a[1].y) <= Math.hypot(x-b[1].x,y-b[1].y) ? a : b);
  return {location:nearest[0],inside:false};
}

// ponytail: three fixed lanes and connecting avenues, not free-placement pathfinding.
// A tile navigation graph is only needed if the player can edit buildings or roads.
export function walkingRoute(from, to) {
  const lane = p => [256,496,736].reduce((a,b) => Math.abs(p[0]-a) <= Math.abs(p[0]-b) ? a : b);
  const a = lane(from), b = lane(to);
  const avenue = [336,640,944].reduce((a,b) => Math.abs(from[1]-a) <= Math.abs(from[1]-b) ? a : b);
  const route = [from, [a,from[1]], ...(a === b ? [] : [[a,avenue],[b,avenue]]), [b,to[1]], to];
  return route.filter((p,i) => i === 0 || p[0] !== route[i-1][0] || p[1] !== route[i-1][1]).map(p => [...p]);
}

export function syncWalkers(walkers, npcs) {
  for (const [index,npc] of npcs.entries()) {
    const destination = canAccess(npc.id,npc.location) ? npc.location : homeFor(npc.id);
    const place = places[destination] || places.park;
    const indoors = Boolean(LOCATIONS.find(location => location.id === destination)?.indoors);
    const column = index < 3 ? index % 3 : 2 - index % 3;
    const patio = [place.x + (column - 1) * 48, place.y + (index < 3 ? -10 : 22)];
    const target = indoors ? [place.x,place.y-32] : patio;
    let walker = walkers.get(npc.id);
    if (!walker) {
      walker = { position:patio, destination, indoors, inside:null, route:indoors ? [[place.x,patio[1]],target] : [], phase:index, direction:'down', moving:indoors };
      walkers.set(npc.id,walker);
    } else if (walker.destination !== destination) {
      walker.route = walkingRoute(walker.position,target).slice(1);
      walker.destination = destination;
      walker.indoors = indoors;
      walker.inside = !walker.route.length && indoors ? destination : null;
      walker.moving = walker.route.length > 0;
    }
  }
}

export function stepWalkers(walkers, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  let arrived = false;
  for (const walker of walkers.values()) {
    let distance = seconds * 128;
    walker.moving = walker.route.length > 0;
    if (walker.moving) walker.phase += seconds * 7;
    while (distance > 0 && walker.route.length) {
      const target = walker.route[0];
      const dx = target[0] - walker.position[0], dy = target[1] - walker.position[1];
      const length = Math.hypot(dx,dy);
      if (length) walker.direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      if (length <= distance) { walker.position = [...target]; walker.route.shift(); distance -= length; }
      else { walker.position[0] += dx / length * distance; walker.position[1] += dy / length * distance; distance = 0; }
    }
    walker.moving = walker.route.length > 0;
    if (!walker.moving && walker.indoors && !walker.inside) { walker.inside = walker.destination; arrived = true; }
  }
  return arrived;
}

// Each 54 × 104 block holds three 18 × 26 frames in down / left / right / up order.
const sprites = { lina:[54,0], theo:[108,104], maya:[108,312], felix:[108,0], jules:[54,312], bea:[162,312], player:[108,208] };
// A distinct, existing atlas actor represents Haru; her illustrated face uses her own server artwork.
sprites.haru = [162,104];
export function spriteFrame(id, direction = 'down', frame = 1) {
  const [x,y] = sprites[Object.hasOwn(sprites,id) ? id : 'player'];
  const row = Math.max(0,['down','left','right','up'].indexOf(direction));
  const column = Number.isInteger(frame) && frame >= 0 && frame <= 2 ? frame : 1;
  return `${x + column*18} ${y + row*26} 18 26`;
}
const walkingFrame = (walker, reducedMotion = false) => walker.moving && !reducedMotion ? [0,1,2,1][Math.floor(walker.phase)%4] : 1;

export function paintWalkers(svg, walkers, following = '', reducedMotion = false) {
  if (!svg || svg.classList.contains('room-art')) return;
  for (const node of svg.querySelectorAll('.town-npc')) {
    const walker = walkers.get(node.dataset.npc);
    if (!walker) continue;
    const [x,y] = walker.position;
    node.style.display = walker.inside ? 'none' : '';
    node.setAttribute('tabindex',walker.inside ? '-1' : '0');
    node.setAttribute('aria-hidden',String(Boolean(walker.inside)));
    node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    node.classList.toggle('walking',walker.moving);
    node.classList.toggle('following',node.dataset.npc === following);
    const sprite = node.querySelector('.map-sprite');
    const crop = spriteFrame(node.dataset.npc,walker.direction,walkingFrame(walker,reducedMotion));
    if (sprite?.getAttribute('viewBox') !== crop) sprite?.setAttribute('viewBox',crop);
    node.dataset.direction = walker.direction;
  }
  for (const label of svg.querySelectorAll('[data-occupancy]')) {
    const count = [...walkers.values()].filter(walker => walker.inside === label.dataset.occupancy).length;
    label.textContent = count ? `${count} inside` : '';
  }
}

// Crops keep their exact aspect ratio, so neighboring atlas cells never bleed into the viewport.
function tile(sx, sy, width, height, x, y, scale = 2) {
  return `<svg x="${x}" y="${y}" width="${width*scale}" height="${height*scale}" viewBox="${sx} ${sy} ${width} ${height}" overflow="hidden" aria-hidden="true"><use href="#town-tiles"/></svg>`;
}
function citizen(npc, walker = {}, isPlayer = false, reducedMotion = false, atlas = 'town-residents') {
  return `<ellipse class="sprite-shadow" cy="1" rx="15" ry="5"/><g class="sprite-placeholder"><rect x="-16" y="-44" width="32" height="44" rx="3"/><text text-anchor="middle" y="-16">${esc(String(npc.name || '?').slice(0,1))}</text></g><svg class="map-sprite" x="-18" y="-48" width="36" height="52" viewBox="${spriteFrame(npc.id,walker.direction,walkingFrame(walker,reducedMotion))}" overflow="hidden" aria-hidden="true"><use href="#${atlas}"/></svg>${isPlayer ? '<path class="player-marker" d="m-7-62h14l-7 8Z"/>' : ''}`;
}

const artStyles = `
  .neighborhood-art{--map-grass:#76C564;--map-path:#CB9A4E;--map-path-edge:#9B7942;--map-ink:#253C37;--map-paper:#FFF7DF;--map-accent:#235C49;--map-hover:#DCEAB4;--map-shadow:#283E3A;--map-night:#20264F;display:block;width:100%;height:auto;overflow:hidden;font-family:inherit}
  .neighborhood-art,.neighborhood-art image,.neighborhood-art use,.map-sprite{image-rendering:pixelated}
  .map-ground{fill:var(--map-grass)}.map-path{fill:var(--map-path)}
  .map-night{fill:var(--map-night);opacity:0;pointer-events:none}.evening .map-night{opacity:.42}
  .town-location,.town-npc{cursor:pointer;outline:none}
  .location-hit{fill:transparent}.location-selection{fill:none;stroke:transparent;stroke-width:3}
  .neighborhood-art:not(.tiles-ready) .location-hit{fill:var(--map-accent);fill-opacity:.14}
  .location-label rect,.npc-nameplate rect{fill:var(--map-paper);stroke:var(--map-accent);stroke-width:2}
  .location-label text{fill:var(--map-ink);font-size:15px;font-weight:750;letter-spacing:.4px}
  .location-label .occupancy-count{font-size:12px;fill:var(--map-paper);paint-order:stroke;stroke:var(--map-ink);stroke-width:3px}
  .town-location:hover .location-label rect{fill:var(--map-hover)}
  .town-location:active .location-label rect{fill:var(--map-path)}
  .town-location:focus-visible .location-selection,.town-location:hover .location-selection{stroke:var(--map-accent)}
  .town-location[aria-pressed="true"] .location-label rect{fill:var(--map-accent)}
  .town-location[aria-pressed="true"] .location-label text{fill:var(--map-paper)}
  .town-location[aria-pressed="true"] .location-selection{stroke:var(--map-paper);stroke-dasharray:8 4}
  .npc-focus{fill:transparent;stroke:transparent;stroke-width:2}
  .town-npc:hover .npc-focus,.town-npc:focus-visible .npc-focus{stroke:var(--map-accent);fill:var(--map-paper);fill-opacity:.5}
  .town-npc:active{opacity:.7}.sprite-shadow{fill:var(--map-shadow);opacity:.3}
  .follow-ring{fill:var(--map-paper);fill-opacity:.5;stroke:var(--map-accent);stroke-width:2;visibility:hidden}
  .town-npc.following .follow-ring{visibility:visible}
  .npc-nameplate{opacity:0;pointer-events:none}.npc-nameplate text{fill:var(--map-ink);font-size:12px;font-weight:700}
  .town-npc:hover .npc-nameplate,.town-npc:focus-visible .npc-nameplate,.town-npc.following .npc-nameplate{opacity:1}
  .player-marker{fill:var(--map-paper);stroke:var(--map-accent);stroke-width:2}
  .camera-follow .location-label,.camera-follow .location-selection{opacity:0;pointer-events:none}
  .camera-follow .town-location:focus-visible .location-label{opacity:1}
  .town-location[aria-disabled="true"],.town-npc[aria-disabled="true"]{opacity:.5;pointer-events:none;cursor:not-allowed}
  .sprite-placeholder rect{fill:var(--map-accent)}.sprite-placeholder text{fill:var(--map-paper);font-size:18px}
  .sprites-ready .sprite-placeholder{display:none}
  .map-art-notice{display:none;fill:var(--map-paper);stroke:var(--map-ink);stroke-width:4;paint-order:stroke;font-size:15px}
  .tiles-unavailable .map-art-notice{display:block}
  @media(prefers-reduced-motion:no-preference){.location-label rect,.npc-focus{transition:fill 150ms ease,stroke 150ms ease}}
`;

/** @param {{player?:{name?:string,location?:string,color?:string},npcs?:Array<{id:string,name:string,color?:string,location?:string,action?:string}>,hour?:number}} state @param {string} selectedLocation */
export function renderWorld(state = {}, selectedLocation = 'home', { walkers = new Map(), spectator = false, reducedMotion = false, className = '' } = {}) {
  syncWalkers(walkers,state.npcs || []);
  // Native textured rectangles join into a road network. Both textures have solid-color fallbacks.
  const roads = [...[240,544,848,320,624,928].map(y => [64,y,872,64]), ...[224,464,704].map(x => [x,224,64,768])];
  let ground = `<rect class="map-ground" width="${WORLD_WIDTH}" height="${WORLD_HEIGHT}"/><rect width="${WORLD_WIDTH}" height="${WORLD_HEIGHT}" fill="url(#town-grass)"/>`;
  for (const [x,y,w,h] of roads) ground += `<rect class="map-path" x="${x}" y="${y}" width="${w}" height="${h}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#town-path)"/>`;
  const scenery = [], controls = [];
  for (const [id,originalPlace] of Object.entries(places)) {
    const place = id === 'home' && state.npcs?.some(n => n.id === 'haru') ? {...originalPlace,name:'Haru’s home',label:'Haru’s'} : originalPlace;
    const [x,y,w,h] = place.bounds;
    if (place.art) scenery.push(tile(...place.art,x,y));
    // Individual gardens and porch props reinforce the owners' different silhouettes and roof styles.
    for (const offset of [-80,-48,-16,16,48]) scenery.push(tile(80,208,16,16,place.x+offset,y-30));
    if (id === 'home-lina') for (const offset of [-104,76]) scenery.push(tile(64,288,16,16,place.x+offset,y+80),tile(80,288,16,16,place.x+offset,y+48));
    else if (id === 'home-maya') for (const [dx,dy] of [[-104,24],[-88,88],[64,32],[64,96]]) scenery.push(tile(144,208,32,32,place.x+dx,y+dy));
    else if (id === 'home-bea') for (const dx of [-112,80]) scenery.push(tile(0,192,16,16,place.x+dx,y+96),tile(48,192,16,16,place.x+dx,y+64));
    else scenery.push(tile(48,192,16,16,place.x-112,y+80));
    if (id === 'home-theo') scenery.push(roomTile('town-furniture',furnishings.table,place.x+80,y+72,1),roomTile('town-furniture',furnishings.kettle,place.x+80,y+56,1));
    if (id === 'home-felix') scenery.push(roomTile('town-furniture',furnishings.books,place.x+64,y+72,1),tile(112,224,16,16,place.x-80,y+96));
    if (id === 'home-jules') scenery.push(roomTile('town-furniture',furnishings.workbench,place.x+64,y+72,1),roomTile('town-furniture',furnishings.cabinet,place.x-88,y+64,1));
    const labelY = y-18, labelWidth = place.label.length*9+32;
    const count = [...walkers.values()].filter(walker => walker.inside === id).length;
    controls.push(`<g class="town-location" data-location="${id}" role="button" tabindex="0" aria-label="Explore ${esc(place.name)}" aria-pressed="${selectedLocation===id}"><title>${esc(place.name)} — click to explore</title><rect class="location-hit" x="${x}" y="${y}" width="${w}" height="${h}"/><rect class="location-selection" x="${x-4}" y="${y-4}" width="${w+8}" height="${h+8}"/><g class="location-label" transform="translate(${place.x} ${labelY})"><rect x="${-labelWidth/2}" y="-14" width="${labelWidth}" height="28" rx="2"/><text text-anchor="middle" y="5">${place.label}</text><text class="occupancy-count" data-occupancy="${id}" text-anchor="middle" y="34">${count ? `${count} inside` : ''}</text></g></g>`);
  }
  // Pond garden, flower boxes, shop goods and signposts all use the same 16px tile palette.
  scenery.push(tile(176,0,48,48,816,400),tile(64,288,16,16,792,480),tile(80,288,16,16,912,480));
  // A forest rim makes the orthogonal town feel like a handheld overworld.
  for (let x=-32;x<1000;x+=80) {
    scenery.push(tile(144+(Math.floor((x+32)/80)%2)*48,240,48,48,x,-34));
    scenery.push(tile(144+(Math.floor((x+32)/80)%2)*48,240,48,48,x,974));
  }
  for (const y of [64,144,224,384,464,544,688,768,848]) {
    scenery.push(tile(144,240,48,48,-38,y),tile(192,240,48,48,946,y));
  }
  for (const x of [240,480,720]) for (const y of [112,416,720]) scenery.push(tile(144,208,32,32,x,y));
  for (const y of [296,600,904]) for (const x of [80,432,672,912]) scenery.push(tile(112,192,16,16,x,y));
  const actors = (state.npcs || []).map(npc => {
    const walker = walkers.get(npc.id), [x,y] = walker.position;
    return `<g class="town-npc" style="display:${walker.inside ? 'none' : 'inline'}" transform="translate(${x} ${y})" data-npc="${esc(npc.id)}" data-direction="${walker.direction}" role="button" tabindex="${walker.inside ? '-1' : '0'}" aria-hidden="${Boolean(walker.inside)}" aria-label="Talk to ${esc(npc.name)}${npc.action ? `, ${esc(npc.action)}` : ''}"><title>${esc(npc.name)}${npc.action ? ` · ${esc(npc.action)}` : ''}</title><rect class="npc-focus" x="-22" y="-50" width="44" height="58" rx="3"/><ellipse class="follow-ring" cy="2" rx="22" ry="8"/>${citizen(npc,walker,false,reducedMotion)}<g class="npc-nameplate" transform="translate(0 19)"><rect x="-32" y="-10" width="64" height="20" rx="2"/><text text-anchor="middle" y="4">${esc(String(npc.name).split(' ')[0])}</text></g></g>`;
  });
  const playerPlace = places[state.player?.location] || places.home;
  if (!spectator) actors.push(`<g transform="translate(${playerPlace.x+64} ${playerPlace.y+18})" aria-label="${esc(state.player?.name || 'You')}, current location">${citizen({id:'player',name:state.player?.name},{},true)}</g>`);
  return `<svg class="neighborhood-art pixel-world ${state.hour >= 19 || state.hour < 6 ? 'evening' : ''} ${esc(className)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}" role="group" aria-label="Willowbrook, a top-down pixel-art anime town with seven separate homes and five public places. Explore a building or select a resident."><style>${artStyles}</style>
    <defs><image id="town-tiles" width="304" height="720" href="/assets/world/serene-village.png" onload="this.closest('svg')?.classList.add('tiles-ready')" onerror="this.closest('svg')?.classList.add('tiles-unavailable')"/><image id="town-residents" width="216" height="416" href="/assets/world/townspeople.png" onload="this.closest('svg')?.classList.add('sprites-ready')" onerror="this.closest('svg')?.classList.add('sprites-unavailable')"/>
    <image id="town-furniture" width="256" height="1424" href="/assets/world/interiors.png"/>
    <pattern id="town-grass" patternUnits="userSpaceOnUse" width="32" height="32">${tile(64,0,16,16,0,0)}</pattern><pattern id="town-path" patternUnits="userSpaceOnUse" width="32" height="32">${tile(160,32,16,16,0,0)}</pattern></defs>
    <g class="map-scenery" aria-hidden="true">${ground}${scenery.join('')}<rect class="map-night" width="${WORLD_WIDTH}" height="${WORLD_HEIGHT}"/></g>${controls.join('')}${actors.join('')}<text class="map-art-notice" x="500" y="960" text-anchor="middle">Map artwork unavailable · destinations still work</text></svg>`;
}

// Original cutaway arrangements of the supplied 16px furniture. No source images are altered.
const furnishings = {
  bed:[96,16,32,64], sofa:[16,1152,48,32], books:[160,1088,32,48],
  table:[112,208,48,32], chair:[64,336,16,32], plant:[208,704,32,48],
  fern:[192,720,16,32], cabinet:[112,768,32,48], desk:[48,576,32,32],
  globe:[224,576,16,32], rug:[112,240,64,48], window:[112,384,32,32],
  picture:[0,320,32,32], study:[80,576,32,32], workbench:[32,576,32,32],
  flowers:[0,848,48,32], kettle:[0,1056,48,32], sink:[0,208,32,16],
};
function roomTile(id, crop, x, y, scale = 2) {
  const [sx,sy,w,h] = crop;
  return `<svg x="${x}" y="${y}" width="${w*scale}" height="${h*scale}" viewBox="${sx} ${sy} ${w} ${h}" overflow="hidden" aria-hidden="true"><use href="#${id}"/></svg>`;
}

// Authored floor plans, not palette swaps: shape, partitions, work areas and furnishings all differ.
export const HOME_ROOMS = {
  haru:{floor:'M32 64H704V448H32Z',walls:'M448 64V240M448 336V448',spot:[376,280],
    labels:[['GAMING & DRAWING',216,242],['MANGA & FIGURES',344,402],['REST & RECHARGE',560,286],['TEA & MUSIC',560,426]],
    furniture:[['window',104,36],['window',536,36],['desk',112,112],['study',176,112],['chair',168,180],['picture',296,80],['books',296,304],['books',360,304],['rug',96,288],['sofa',112,304],['bed',488,112],['cabinet',608,120],['table',496,344],['kettle',496,320],['fern',640,304]]},
  player:{floor:'M32 64H736V448H32Z',walls:'M472 64V260M472 360V448M472 304H568M632 304H736',spot:[392,280],
    labels:[['LIVING',200,408],['BEDROOM',592,282],['WASHROOM',592,422]],
    furniture:[['window',104,36],['window',572,36],['plant',56,96],['bed',520,112],['cabinet',632,184],['sink',648,352],['rug',168,232],['sofa',184,164],['table',184,304],['books',352,96],['fern',416,360]]},
  lina:{floor:'M32 64H704V448H288V384H32Z',walls:'M480 64V232M480 328V448M480 296H552M632 296H704',spot:[376,292],
    labels:[['OPEN ATELIER',224,352],['SKETCH NOOK',360,190],['SLEEPING WING',584,278],['WASH',600,422]],
    furniture:[['window',128,36],['window',560,36],['easel',88,120],['easel',208,136],['desk',344,104],['picture',408,84],['rug',144,248],['chair',272,264],['bed',512,112],['cabinet',624,120],['sink',640,352],['flowers',296,368],['fern',416,368]]},
  theo:{floor:'M64 64H704V448H64Z',walls:'M464 64V240M464 320V448M464 288H560M640 288H704',spot:[400,300],
    labels:[['BREAKFAST KITCHEN',240,208],['CONVERSATION LOUNGE',256,424],['REST',568,264],['WASH',600,420]],
    furniture:[['window',136,36],['window',552,36],['workbench',104,112],['workbench',168,112],['workbench',232,112],['kettle',112,88],['sink',248,88],['cabinet',352,96],['rug',160,288],['table',184,300],['chair',136,296],['chair',296,296],['sofa',176,224],['bed',504,104],['fern',632,192],['sink',624,344]]},
  maya:{floor:'M64 96H432V64H704V416H512V448H64Z',walls:'M320 96V240M320 336V448M496 64V232M496 320V416',spot:[400,292],
    labels:[['POTTING ROOM',192,256],['SUNROOM',208,428],['GREEN RETREAT',576,284],['WASH',576,390]],
    furniture:[['window',144,68],['window',552,36],['workbench',144,160],['flowers',128,132],['plant',80,112],['plant',240,112],['fern',256,304],['fern',336,104],['plant',368,336],['rug',96,304],['chair',144,308],['bed',536,112],['plant',632,96],['sink',592,328],['flowers',352,192]]},
  felix:{floor:'M128 64H640V224H704V448H128Z',walls:'M448 64V208M448 288V352M448 352H544M624 352H704',spot:[392,304],
    labels:[['PRIVATE LIBRARY',280,226],['RESEARCH DESK',240,410],['SLEEP',544,296],['WASH',592,428]],
    furniture:[['window',320,36],['books',144,96],['books',208,96],['books',272,96],['books',352,96],['rug',176,288],['study',192,304],['globe',320,320],['bed',496,104],['cabinet',568,104],['sink',632,384],['fern',592,240],['picture',464,312]]},
  jules:{floor:'M64 64H400V144H704V448H64Z',walls:'M288 64V192M64 240H176M256 240H400M560 144V288M560 368V448',spot:[472,288],
    labels:[['COMPACT RETREAT',176,224],['BUILD & REPAIR',432,412],['MARKET STOCK',624,360],['WASH',160,428]],
    furniture:[['window',176,36],['window',576,116],['bed',96,96],['desk',208,112],['workbench',336,200],['workbench',400,200],['workbench',432,336],['chair',336,312],['cabinet',592,176],['cabinet',592,272],['flowers',576,368],['sink',112,352],['rug',336,304],['picture',432,148]]},
  bea:{floor:'M64 64H704V352H544V448H224V352H64Z',walls:'M448 64V192M448 272V352M544 288H704',spot:[400,272],
    labels:[['READING PARLOR',224,322],['KEEPSAKES',368,182],['BEDROOM',568,278],['TEA CORNER',384,426]],
    furniture:[['window',136,36],['window',552,36],['books',96,96],['books',160,96],['rug',152,224],['sofa',168,160],['chair',288,240],['picture',352,88],['cabinet',344,112],['bed',512,112],['fern',632,176],['table',304,352],['kettle',312,336],['flowers',432,352],['sink',624,308]]},
};

export function interiorResidents(state, location, walkers) {
  return (state.npcs || []).filter(npc => walkers.get(npc.id)?.inside === location && canAccess(npc.id,location));
}

/** @param {string} id @param {object} state @param {{walkers?:Map,className?:string}} options */
export function renderInterior(id, state, {walkers = new Map(),className = ''} = {}) {
  const originalPlace = LOCATIONS.find(location => location.id === id);
  const place = id === 'home' && state.npcs?.some(n => n.id === 'haru') ? {...originalPlace,name:'Haru’s home',owner:'haru'} : originalPlace;
  if (!place?.indoors) return '';
  const objects = [], labels = [];
  const put = (kind,x,y) => objects.push(kind === 'easel'
    ? `<g transform="translate(${x} ${y})"><path class="room-easel" d="M16 24V100M48 24V100M8 68H56"/>${roomTile('room-furniture',furnishings.picture,0,0)}</g>`
    : roomTile('room-furniture',furnishings[kind],x,y));
  const label = (text,x,y) => labels.push(`<text class="room-label" x="${x}" y="${y}">${esc(text)}</text>`);
  let partitions = '', floor = 'M32 64H736V448H32Z';
  const layout = HOME_ROOMS[place.owner];
  if (!layout) { put('window',104,36); put('window',572,36); put('plant',56,96); put('plant',648,96); }
  if (place.owner) {
    floor = layout.floor;
    partitions = `<path class="room-wall" d="${layout.walls}"/>`;
    // Rugs are laid down first so furniture never sits beneath them.
    layout.furniture.filter(item => item[0] === 'rug').forEach(item => put(...item));
    layout.furniture.filter(item => item[0] !== 'rug').forEach(item => put(...item));
    layout.labels.forEach(item => label(...item));
    if (place.owner === 'player' && state.homeLevel > 0) put('flowers',304,352);
  } else if (id === 'cafe') {
    for (const x of [96,160,224,288]) put('workbench',x,112);
    put('kettle',128,88); put('kettle',256,88); put('cabinet',528,96);
    for (const x of [144,352,560]) { put('rug',x-16,272); put('table',x,304); put('chair',x+24,256); put('chair',x+24,360); }
    label('COFFEE BAR',232,212); label('SUNBEAM LOUNGE',384,436);
  } else if (id === 'library') {
    for (const x of [144,208,272,400,464,528]) put('books',x,96);
    for (const x of [128,320,512]) { put('rug',x-16,272); put('study',x,292); put('study',x+64,292); }
    put('globe',624,332); label('LITTLE LEAF COLLECTION',384,226); label('READING LOUNGE',384,420);
  } else if (id === 'studio') {
    for (const x of [152,336,520]) { put('desk',x,120); put('picture',x,80); put('rug',x-32,296); put('workbench',x,312); put('chair',x+16,368); }
    put('flowers',72,336); label('PAINT & SKETCH',384,252); label('MAKERS’ TABLES',384,440);
  } else if (id === 'market') {
    for (const x of [120,336,552]) { put('cabinet',x,96); put('workbench',x,304); put('flowers',x-16,272); }
    for (const x of [192,408,624]) put('fern',x,352);
    label('BOOKS',152,218); label('HANDMADE',368,218); label('FLOWERS',584,218); label('SUNDAY MARKET HALL',384,432);
  }
  const residents = interiorResidents(state,id,walkers);
  // The fixed layout has no empty geometry; the surrounding UI supplies an empty-occupancy message.
  // Native floor/wall primitives reserve the scene while atlas images load and remain on failure.
  const actors = residents.map((npc,index) => {
    const [x,y] = layout ? layout.spot : [224+index%3*144,264+Math.floor(index/3)*112];
    return `<g class="room-npc town-npc" transform="translate(${x} ${y})" data-npc="${npc.id}" role="button" tabindex="0" aria-label="Talk to ${esc(npc.name)} inside ${esc(place.name)}"><rect class="npc-focus" x="-24" y="-52" width="48" height="66" rx="3"/>${citizen(npc,{},false,true,'room-residents')}<text class="room-label resident-label" y="24" text-anchor="middle">${esc(npc.name.split(' ')[0])}</text></g>`;
  });
  return `<svg class="neighborhood-art pixel-world room-art ${esc(className)}" data-scene="${id}" data-interior="${id}" viewBox="0 0 768 512" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="${esc(place.name)} furnished cutaway layout${place.owner ? ', owner-only home' : ', public place'}"><style>${artStyles}</style><defs><image id="room-furniture" width="256" height="1424" href="/assets/world/interiors.png" onload="this.closest('svg')?.classList.add('tiles-ready')" onerror="this.closest('svg')?.classList.add('tiles-unavailable')"/><image id="room-builder" width="272" height="368" href="/assets/world/room-builder.png" onerror="this.closest('svg')?.classList.add('tiles-unavailable')"/><image id="room-residents" width="216" height="416" href="/assets/world/townspeople.png" onload="this.closest('svg')?.classList.add('sprites-ready')" onerror="this.closest('svg')?.classList.add('sprites-unavailable')"/><pattern id="room-wood" width="32" height="32" patternUnits="userSpaceOnUse">${roomTile('room-builder',[64,192,16,16],0,0)}</pattern></defs>
    <rect class="room-surround" width="768" height="512"/><path class="room-shadow" d="${floor}" transform="translate(8 12)"/><path class="room-floor" d="${floor}"/><path d="${floor}" fill="url(#room-wood)"/><path class="room-wall" d="${floor}"/><path class="room-wall-top" d="${floor}"/>${partitions}<path class="room-entry" d="M340 448H428V472H340Z"/>
    <g aria-hidden="true">${objects.join('')}${labels.join('')}</g>${actors.join('')}<text class="room-label" x="384" y="493">${place.owner ? 'PRIVATE HOME · OWNER ONLY' : 'PUBLIC · EVERYONE WELCOME'}</text><text class="map-art-notice" x="384" y="248" text-anchor="middle">Room artwork unavailable · residents and doors still work</text></svg>`;
}

/** A close establishing shot of the actual nearby place, not the NPC's planned destination. */
export function renderPlaceExterior(id, state, options = {}) {
  const place = places[id] || places.park;
  const x = Math.max(0,Math.min(WORLD_WIDTH-416,place.x-208)), y = Math.max(0,Math.min(WORLD_HEIGHT-312,place.y-232));
  return renderWorld(state,id,{...options,spectator:true}).replace(`viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}"`,`data-scene="${Object.hasOwn(places,id) ? esc(id) : 'park'}" data-exterior="true" data-center="${place.x} ${place.y-112}" viewBox="${x} ${y} 416 312"`);
}

// Shared by standalone and server dialogue: fill the window at integer source-pixel scale.
export function fitConversationScene(svg, width, height) {
  if (!svg) return;
  const indoors = svg.classList.contains('room-art');
  const [x,y] = indoors ? [384,256] : svg.dataset.center.split(' ').map(Number);
  const scale = Math.max(1,Math.ceil(Math.max(width/(indoors ? 768 : 624),height/(indoors ? 512 : 432))*2)/2);
  const w = width/scale, h = height/scale;
  const left = Math.max(0,Math.min((indoors ? 768 : WORLD_WIDTH)-w,x-w/2));
  const top = Math.max(0,Math.min((indoors ? 512 : WORLD_HEIGHT)-h,y-h/2));
  svg.setAttribute('viewBox',`${Math.round(left*scale)/scale} ${Math.round(top*scale)/scale} ${w} ${h}`);
}

const looks = {
  lina: ['#F2C2A6','#AB244E','#609BC9','long'],
  theo: ['#B77F60','#23354F','#D3A154','spiky'],
  maya: ['#E0A884','#3D315C','#679988','long'],
  felix: ['#EDBC9C','#94ABC9','#527AAE','glasses'],
  jules: ['#C99476','#63428E','#C39B4D','spiky'],
  bea: ['#C38C70','#A5A3BB','#795795','glasses'],
  player: ['#EDBC9C','#424C71','#547C84','spiky'],
};
function characterStyle(npc) {
  const [skin,hair,eyes] = looks[Object.hasOwn(looks,npc.id) ? npc.id : 'player'];
  return `--avatar-accent:${color(npc.color)};--avatar-skin:${skin};--avatar-hair:${hair};--avatar-eyes:${eyes};--avatar-ink:#242331;--avatar-cream:#F9F6FC;--avatar-blush:#E58692;--avatar-coat:#32303F;--avatar-crimson:#8F314D;--avatar-gold:#E7E4EF`;
}

// Each local atlas has three registered expression cells; browser SVG viewports do the cropping.
// Avatar primitives reserve their dimensions while loading and show an initial on error; no skeleton needed.
function illustratedPortrait(npc, emotion, className, crop, size, fullBody = false, viewLabel = fullBody ? 'full-body view, ' : '') {
  const id = Object.hasOwn(looks,npc.id) ? npc.id : 'player';
  const expressions = ['neutral','warm','guarded'];
  const frame = Math.max(0,expressions.indexOf(emotion));
  const [left,top,width,height] = crop;
  const x = frame*512+left;
  return `<svg class="${esc(className)}" ${size ? `width="${size}" height="${size}"` : ''} viewBox="${x} ${top} ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(npc.name || 'Neighbor')}, ${viewLabel}${expressions[frame]} expression" data-expression="${expressions[frame]}" style="${characterStyle({...npc,id})}"><g class="portrait-fallback"><rect x="${x}" y="${top}" width="${width}" height="${height}" fill="var(--avatar-coat)"/><text x="${x+width/2}" y="${top+height*.55}" text-anchor="middle" font-family="serif" font-size="${width/3}" fill="var(--avatar-cream)">${esc(String(npc.name || '?').slice(0,1))}</text></g><image onload="this.closest('svg')?.classList.add('portrait-ready')" onerror="this.closest('svg')?.classList.add('portrait-unavailable')" data-character-art="${id}" href="/assets/${fullBody ? 'fullbody' : 'portraits'}/${id}-${fullBody ? 'v1' : 'v2'}.png" x="0" y="0" width="1536" height="1024"/></svg>`;
}

/** @param {{id?:string,name?:string,color?:string,trait?:string}} npc @param {number} size */
export function portrait(npc = {}, size = 48) {
  if (npc.id === 'haru') return haruPortrait('neutral', 'character-portrait', Number.isFinite(size) ? Math.max(16,Math.min(200,size)) : 48);
  const dimension = Number.isFinite(size) ? Math.max(16,Math.min(200,size)) : 48;
  return illustratedPortrait(npc,'warm','character-portrait',[50,0,412,412],dimension);
}

// Transparent gutters are measured per row; the wider surprise gestures do not cross into another pose.
export const DIALOGUE_POSES = {
  lina:{cuts:[545,573],ground:[47,47,97,95]},
  theo:{cuts:[538,611],ground:[12,12,12,12]},
  maya:{cuts:[532,572],ground:[24,24,31,31]},
  felix:{cuts:[511,594],ground:[11,11,35,36]},
  jules:{cuts:[523,583],ground:[29,29,36,37]},
  bea:{cuts:[515,592],ground:[17,18,33,33]},
};
/** @param {{id?:string,name?:string,color?:string}} npc @param {string} emotion @param {string} className */
export function dialoguePortrait(npc = {}, emotion = 'neutral', className = '') {
  if (npc.id === 'haru') return haruPortrait(emotion, `dialogue-portrait ${className}`);
  if (!Object.hasOwn(DIALOGUE_POSES,npc.id)) return illustratedPortrait(npc,({happy:'warm',angry:'guarded'})[emotion] || emotion,`dialogue-portrait ${className}`,[0,0,512,620],undefined,true,'upper-body view, ');
  const expressions = ['attentive','happy','surprised','thoughtful'];
  const expression = ({neutral:'attentive',warm:'happy',guarded:'thoughtful',angry:'thoughtful'})[emotion] || emotion;
  const frame = Math.max(0,expressions.indexOf(expression)), row = Math.floor(frame/2), column = frame%2;
  const {cuts,ground} = DIALOGUE_POSES[npc.id];
  const left = column ? cuts[row] : 0, width = column ? 1086-left : cuts[row];
  const gesture = ['hands together','open-palm gesture','hand to chest and raised palm','hand on chin'][frame];
  // Native SVG crops unchanged artwork. A static offset grounds every pose at the textbox; no floating transforms.
  return `<svg class="dialogue-portrait ${esc(className)}" viewBox="-32 0 620 724" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(npc.name || 'Neighbor')}, upper-body view, ${expressions[frame]} expression, ${gesture}" data-expression="${expressions[frame]}" data-pose="${expressions[frame]}" style="${characterStyle(npc)}"><g class="portrait-fallback"><rect x="-32" width="620" height="724" fill="var(--avatar-coat)"/><text x="278" y="400" text-anchor="middle" font-family="serif" font-size="180" fill="var(--avatar-cream)">${esc(String(npc.name || '?').slice(0,1))}</text></g><svg data-pose-cell="${frame}" aria-hidden="true" x="${left-column*543}" y="${ground[frame]}" width="${width}" height="724" viewBox="${left} ${row*724} ${width} 724" overflow="hidden"><image onload="this.closest('.dialogue-portrait')?.classList.add('portrait-ready')" onerror="this.closest('.dialogue-portrait')?.classList.add('portrait-unavailable')" data-character-art="${npc.id}" href="/assets/dialogue/${npc.id}-poses-v1.png" width="1086" height="1448"/></svg></svg>`;
}

/** @param {{id?:string,name?:string,color?:string}} npc @param {string} emotion @param {string} className */
export function fullBodyPortrait(npc = {}, emotion = 'warm', className = '') {
  if (npc.id === 'haru') return haruPortrait(emotion, `fullbody-portrait ${className}`);
  return illustratedPortrait(npc,emotion,`fullbody-portrait ${className}`,[0,0,512,1024],undefined,true);
}

function haruPortrait(expression, className, size) {
  const face = ({happy:'happy',warm:'happy',surprised:'surprised',thoughtful:'thinking',guarded:'thinking',angry:'angry'})[expression] || 'neutral';
  // Her existing cat-eared avatar, not a newly generated or borrowed character portrait.
  return `<svg class="${esc(className)} haru-avatar" ${size ? `width="${size}" height="${size}"` : ''} viewBox="0 0 512 512" role="img" aria-label="Haru’s existing avatar, ${face} expression" data-expression="${face}"><defs><clipPath id="haru-avatar-circle"><circle cx="256" cy="256" r="246"/></clipPath></defs><g clip-path="url(#haru-avatar-circle)"><g class="portrait-fallback"><circle cx="256" cy="256" r="246" fill="#38283b"/><text x="256" y="300" text-anchor="middle" font-size="130" fill="#fec4cc">H</text></g><image onload="this.closest('.haru-avatar')?.classList.add('portrait-ready')" onerror="this.closest('.haru-avatar')?.classList.add('portrait-unavailable')" href="/emotions/${face}.svg" width="512" height="512"/></g></svg>`;
}

// Decorative art reserves the stage with a static gradient while loading; no animated skeleton.
// Location names remain real headings outside the artwork, including when an image is unavailable.
// ponytail: one daylight painting per location; add time-of-day selection when variant artwork exists.
/** @param {string} location @param {string} className */
export function dialogueBackdrop(location = 'home', className = '') {
  const id = ['home','cafe','studio','park','library','market'].includes(location) ? location : 'home';
  return `<div class="dialogue-backdrop ${esc(className)}" data-scene="${id}" aria-hidden="true"><img src="/assets/backgrounds/${id}-v1.png" alt="" decoding="async" onload="this.parentElement?.classList.add('scene-ready')" onerror="this.parentElement?.classList.add('scene-unavailable')"/><span class="scene-error">◇ Scenery unavailable</span></div>`;
}
