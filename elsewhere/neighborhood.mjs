// Server-side extension of Haru's existing world save. No second clock or memory writer.
import { createGame, advanceWorld, validSave, LOCATIONS, canAccess, homeFor } from './engine.mjs';
import { syncWalkers, stepWalkers, places, walkingRoute, npcSetting } from './world.mjs';

export const PIXELS_PER_MINUTE = 320;
const ids = [...createGame().npcs.map(n => n.id), 'haru'];
export const placeName = id => id === 'home' ? 'Haru’s home' : LOCATIONS.find(p => p.id === id)?.name || 'Willowbrook';

export function haruResident(s) {
  const target = s.activity?.place || s.location;
  return {id:'haru',name:'Haru',pronouns:'she/her',career:'Companion',trait:'Curious',color:'#CE8BB5',
    goal:'Make a life in Willowbrook',goalProgress:0,location:target,action:s.activity?.label || 'Taking a quiet moment',
    thought:s.needs.energy < 30 ? 'I could use some rest.' : 'A little curiosity goes a long way.',
    energy:s.needs.energy,hunger:80,social:100-s.needs.company,affinity:0,relationships:s.neighborhood?.relationships || {},memories:[]};
}

export function createNeighborhood(s) {
  const game = createGame('You');
  game.activeEvent = null; game.journal = [];
  game.day = Math.floor(s.minute / 1440) + 1; game.hour = Math.floor(s.minute / 60) % 24;
  for (const npc of game.npcs) npc.memories = [];
  const n = {version:1,game,lastHour:Math.floor(s.minute / 60),walkers:[],relationships:{}};
  const walkers = new Map();
  // Residents start at their own homes and walk to their first destinations.
  syncWalkers(walkers, [...game.npcs.map(npc => ({...npc,location:homeFor(npc.id)})),{...haruResident(s),location:'home'}]);
  stepWalkers(walkers, 100);
  syncWalkers(walkers, [...game.npcs,haruResident(s)]);
  n.walkers = [...walkers];
  return n;
}

export function validNeighborhood(n) {
  const point = p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 1100);
  return n?.version === 1 && validSave(n.game) && Number.isInteger(n.lastHour) && n.lastHour >= 0
    && n.relationships && Object.keys(n.relationships).length <= 6
    && Object.entries(n.relationships).every(([id,value]) => ids.includes(id) && id !== 'haru' && Number.isFinite(value) && value >= 0 && value <= 100)
    && Array.isArray(n.walkers) && n.walkers.length === 7 && new Set(n.walkers.map(e => e?.[0])).size === 7
    && n.walkers.every(entry => Array.isArray(entry) && entry.length === 2 && validWalker(...entry));
  function validWalker(id,w) {
    return ids.includes(id) && w && point(w.position) && canAccess(id,w.destination)
      && typeof w.indoors === 'boolean' && typeof w.moving === 'boolean' && Number.isFinite(w.phase) && w.phase >= 0
      && ['up','down','left','right'].includes(w.direction) && (w.inside === null || w.inside === w.destination && w.indoors)
      && Array.isArray(w.route) && w.route.length <= 12 && w.route.every(point);
  }
}

export function neighborhoodTravel(s, target) {
  const walker = new Map(s.neighborhood.walkers).get('haru');
  if (walker.destination === target && !walker.moving) return 0;
  const place = places[target];
  const destination = LOCATIONS.find(p => p.id === target).indoors ? [place.x,place.y-32] : [place.x+48,place.y+22];
  const route = walkingRoute(walker.position, destination);
  return route.slice(1).reduce((n,p,i) => n + Math.hypot(p[0]-route[i][0],p[1]-route[i][1]),0) / PIXELS_PER_MINUTE;
}

export function tickNeighborhood(s, minutes) {
  const n = s.neighborhood;
  while (n.lastHour < Math.floor(s.minute / 60)) {
    advanceWorld(n.game,1,{spectator:true}); n.lastHour++;
  }
  const walkers = new Map(n.walkers);
  syncWalkers(walkers,[...n.game.npcs,haruResident(s)]);
  stepWalkers(walkers,minutes * PIXELS_PER_MINUTE / 128);
  n.walkers = [...walkers];
}

export function neighborhoodView(s) {
  return {...s.neighborhood,game:{...s.neighborhood.game,npcs:[...s.neighborhood.game.npcs,haruResident(s)]}};
}

export function neighborhoodMoment(s) {
  const walkers = new Map(s.neighborhood.walkers), haru = haruResident(s), walker = walkers.get('haru');
  const setting = npcSetting(haru,walker);
  const nearby = s.neighborhood.game.npcs.filter(n => {
    const other = walkers.get(n.id);
    return walker.inside ? other.inside === walker.inside : !other.inside && Math.hypot(other.position[0]-walker.position[0],other.position[1]-walker.position[1]) < 90;
  });
  return {location:setting.location,inside:setting.inside,moving:walker.moving,destination:walker.destination,nearby};
}

export function recordNeighborhoodVisit(s) {
  const moment = neighborhoodMoment(s);
  for (const npc of moment.nearby) {
    s.neighborhood.relationships[npc.id] = Math.min(100,(s.neighborhood.relationships[npc.id] || 0) + 4);
    const text = `Spent time with Haru at ${placeName(moment.location)}.`;
    if (!npc.memories.some(m => m.day === s.neighborhood.game.day && m.text === text)) {
      npc.memories.unshift({day:s.neighborhood.game.day,text}); npc.memories = npc.memories.slice(0,8);
    }
  }
  return moment.nearby.map(n => n.name);
}
