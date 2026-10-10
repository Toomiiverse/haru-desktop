// A small, persistent life simulation. The clock and rules own every outcome;
// a model may choose an available activity, but cannot write history or rewards.
import type { NudgeCandidate } from './nudges';
import { resolve } from 'node:path';
// The same native modules render the browser and plan the six residents. No duplicate engine.
const neighborhood = require(resolve(process.cwd(), 'elsewhere/neighborhood.mjs')) as typeof import('./neighborhood-contract');

export const WORLD_PLACES = [
  { id: 'home', name: 'Haru’s apartment', x: 570, y: 510, description: 'A neon-lit room above a futuristic city. Everything she needs, within reach.' },
  { id: 'park', name: 'Willow Park', x: 864, y: 560, description: 'The neighborhood pond and garden.' },
  { id: 'cafe', name: 'Sunbeam Café', x: 384, y: 560, description: 'Coffee, a meal and familiar faces.' },
  { id: 'library', name: 'Little Leaf Library', x: 144, y: 560, description: 'Books and a quiet reading corner.' },
  { id: 'market', name: 'Sunday Market', x: 864, y: 864, description: 'Flowers, crafts and neighborhood company.' },
  { id: 'studio', name: 'The Makers’ Studio', x: 624, y: 560, description: 'A shared creative space.' },
] as const;
export type PlaceId = typeof WORLD_PLACES[number]['id'];
export const ROOM_SPOTS = [
  { id: 'desk', name: 'Gaming setup', x: 578, y: 464, description: 'Dual monitors, an RGB tower and a suspiciously serious keyboard. Gaming, drawing and late-night anime.' },
  { id: 'bed', name: 'Sleep corner', x: 400, y: 594, description: 'A low bed, lavender sheets and a cat plush guarding her sleep schedule. It is losing.' },
  { id: 'shelf', name: 'Manga & figures', x: 864, y: 538, description: 'Manga spines, tiny heroes and absolutely no remaining shelf space. Allegedly.' },
  { id: 'window', name: 'City window', x: 460, y: 414, description: 'Neon towers, passing lights and rain on glass. The city is scenery for now; this room is home.' },
  { id: 'tea', name: 'Tea & music', x: 518, y: 604, description: 'A warm mug, a little speaker and a place to let the room go quiet.' },
] as const;
export type RoomSpot = typeof ROOM_SPOTS[number]['id'];
export const WORLD_FOCUSES = ['wander', 'gaming', 'reading', 'creative', 'relax'] as const;
export type WorldFocus = typeof WORLD_FOCUSES[number];
// Kept in saved state as a record of the earlier neighbourhood draft.
type PersonId = 'mina' | 'ren' | 'yui';
export const WORLD_ACTIONS = [
  { id: 'tea', label: 'Make tea', place: 'home', spot: 'tea', minutes: 20, focus: 'relax' },
  { id: 'rest', label: 'Take a nap', place: 'home', spot: 'bed', minutes: 90, focus: 'relax' },
  { id: 'sleep', label: 'Turn in for the night', place: 'home', spot: 'bed', minutes: 420, focus: 'relax' },
  { id: 'game', label: 'Play Neon Circuit', place: 'home', spot: 'desk', minutes: 45, focus: 'gaming' },
  { id: 'anime', label: 'Watch an anime episode', place: 'home', spot: 'desk', minutes: 25, focus: 'relax' },
  { id: 'read', label: 'Read The Midnight Tram', place: 'home', spot: 'shelf', minutes: 50, focus: 'reading' },
  { id: 'sketch', label: 'Draw on her tablet', place: 'home', spot: 'desk', minutes: 45, focus: 'creative' },
  { id: 'collect', label: 'Rearrange her figures', place: 'home', spot: 'shelf', minutes: 20, focus: 'creative' },
  { id: 'music', label: 'Put on some synthwave', place: 'home', spot: 'tea', minutes: 25, focus: 'relax' },
  { id: 'window', label: 'Watch the city lights', place: 'home', spot: 'window', minutes: 20, focus: 'wander' },
  { id: 'park', label: 'Walk by the pond', place: 'park', spot: 'window', minutes: 30, focus: 'wander' },
  { id: 'cafe', label: 'Have tea at Sunbeam Café', place: 'cafe', spot: 'tea', minutes: 35, focus: 'relax' },
  { id: 'library', label: 'Browse Little Leaf Library', place: 'library', spot: 'shelf', minutes: 45, focus: 'reading' },
  { id: 'market', label: 'Visit the neighborhood market', place: 'market', spot: 'window', minutes: 30, focus: 'wander' },
  { id: 'studio', label: 'Sketch at the Makers’ Studio', place: 'studio', spot: 'desk', minutes: 45, focus: 'creative' },
] as const;
export type WorldActionId = typeof WORLD_ACTIONS[number]['id'];
const LEGACY_ACTIONS = ['tea', 'rest', 'sleep', 'plant', 'water', 'harvest', 'read', 'sketch', 'mina', 'ren', 'yui', 'walk'];
const LEGACY_PLACES = ['home', 'cafe', 'library', 'garden', 'pond'];
const LEGACY_FOCUSES = ['wander', 'garden', 'reading', 'creative', 'social'];
export type WorldEvent = {
  id: string; at: string; minute: number; kind: 'arrival' | 'activity' | 'milestone';
  topic: string; text: string; line: string; manual: boolean; source: 'virtual-world';
};
export type WorldState = {
  version: 2; startedAt: string; updatedAt: number; minute: number; running: boolean;
  speed: 1 | 12 | 60; focus: WorldFocus; seed: number; sequence: number; controlVersion: number;
  location: PlaceId;
  room: { spot: RoomSpot; lighting: 'neon' | 'warm' | 'night'; games: number; episodes: number; arrangements: number };
  activity: { id: WorldActionId; place?: PlaceId; label?: string; from: PlaceId; fromSpot: RoomSpot; started: number; arrived: number; ends: number; by: 'routine' | 'local-model' | 'visitor'; manual: boolean } | null;
  neighborhood?: import('./neighborhood-contract').Neighborhood;
  needs: { energy: number; curiosity: number; company: number };
  garden: { planted: boolean; growth: number; moisture: number; harvests: number };
  projects: { reading: number; books: number; sketches: number; albums: number };
  relationships: Record<PersonId, number>;
  inventory: { basil: number; seeds: number };
  events: WorldEvent[]; recent: WorldActionId[]; suggested: { id: WorldActionId; by: 'local-model' | 'visitor' } | null;
  brain: { enabled: boolean; day: string; calls: number; lastAt: number; status: string };
};
const MINUTE = 60_000;
const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const action = (id: WorldActionId) => WORLD_ACTIONS.find(a => a.id === id)!;
const place = (id: PlaceId) => WORLD_PLACES.find(p => p.id === id)!;
export const worldClock = (minute: number) => ({ day: Math.floor(minute / 1440) + 1, hour: Math.floor(minute % 1440 / 60), minute: Math.floor(minute % 60) });
export const worldWeather = (minute: number) => ['Clear skies', 'A little cloudy', 'Soft rain', 'Clear skies'][Math.floor(minute / 1440) % 4];

export function newWorld(now: number, seed = 7319): WorldState {
  return { version: 2, startedAt: new Date(now).toISOString(), updatedAt: now, minute: 9 * 60,
    running: true, speed: 12, focus: 'wander', seed: seed >>> 0 || 7319, sequence: 1, controlVersion: 0,
    location: 'home', room: { spot: 'desk', lighting: 'neon', games: 0, episodes: 0, arrangements: 0 }, activity: null, needs: { energy: 82, curiosity: 62, company: 54 },
    garden: { planted: false, growth: 0, moisture: 65, harvests: 0 },
    projects: { reading: 0, books: 0, sketches: 0, albums: 0 },
    relationships: { mina: 0, ren: 0, yui: 0 }, inventory: { basil: 0, seeds: 3 },
    events: [{ id: 'world-1', at: new Date(now).toISOString(), minute: 540, kind: 'arrival', topic: 'arrival',
      text: 'Haru settled into her virtual cyberpunk apartment, with a gaming desk, a bed and a view of the neon city.',
      line: 'Dual monitors. A proper bed. My standards are finally being acknowledged.', manual: false, source: 'virtual-world' }],
    recent: [], suggested: null,
    brain: { enabled: true, day: '', calls: 0, lastAt: 0, status: 'Routines are running. Haru can choose a plan when the room is quiet.' },
  };
}

/** Unknown versions and damaged saves are refused, never silently overwritten. */
export function readWorld(value: unknown, now: number): WorldState {
  if (value === undefined || value === null) return newWorld(now);
  const s = value as WorldState;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const legacy = (s?.version as number) === 1;
  const knownAction = (id: unknown) => legacy ? LEGACY_ACTIONS.includes(String(id)) : WORLD_ACTIONS.some(a => a.id === id);
  const knownPlace = (id: unknown) => legacy ? LEGACY_PLACES.includes(String(id)) : WORLD_PLACES.some(p => p.id === id);
  const knownSpot = (id: unknown) => ROOM_SPOTS.some(p => p.id === id);
  if (!s || ![1, 2].includes(s.version) || !Number.isFinite(Date.parse(s.startedAt)) || !finite(s.updatedAt)
    || !finite(s.minute) || !finite(s.sequence) || !finite(s.seed) || !finite(s.controlVersion)
    || typeof s.running !== 'boolean' || ![1, 12, 60].includes(s.speed) || !(legacy ? LEGACY_FOCUSES.includes(String(s.focus)) : WORLD_FOCUSES.includes(s.focus))
    || !knownPlace(s.location) || (s.neighborhood !== undefined && (!neighborhood.validNeighborhood(s.neighborhood) || s.neighborhood.lastHour !== Math.floor(s.minute / 60)))
    || !s.needs || !Object.values(s.needs).every(finite) || !['energy', 'curiosity', 'company'].every(k => finite(s.needs[k as keyof typeof s.needs]))
    || !s.garden || !['growth', 'moisture', 'harvests'].every(k => finite(s.garden[k as 'growth'])) || typeof s.garden.planted !== 'boolean'
    || !s.projects || !['reading', 'books', 'sketches', 'albums'].every(k => finite(s.projects[k as 'reading']))
    || !s.relationships || !(['mina', 'ren', 'yui'] as const).every(id => finite(s.relationships[id]))
    || !s.inventory || !finite(s.inventory.basil) || !finite(s.inventory.seeds)
    || !Array.isArray(s.events) || !s.events.every(e => e && typeof e.id === 'string' && finite(e.minute) && Number.isFinite(Date.parse(e.at))
      && ['arrival', 'activity', 'milestone'].includes(e.kind) && typeof e.topic === 'string' && typeof e.text === 'string' && typeof e.line === 'string' && typeof e.manual === 'boolean' && e.source === 'virtual-world')
    || !Array.isArray(s.recent) || !s.recent.every(knownAction) || !(s.suggested === null || (s.suggested && knownAction(s.suggested.id) && ['local-model', 'visitor'].includes(s.suggested.by)))
    || !s.brain || typeof s.brain.enabled !== 'boolean' || typeof s.brain.day !== 'string' || !finite(s.brain.calls) || !finite(s.brain.lastAt) || typeof s.brain.status !== 'string'
    || (!legacy && (!s.room || !knownSpot(s.room.spot) || !['neon', 'warm', 'night'].includes(s.room.lighting)
      || !['games', 'episodes', 'arrangements'].every(k => finite(s.room[k as 'games']))))
    || !(s.activity === null || (s.activity && knownAction(s.activity.id) && knownPlace(s.activity!.from) && (legacy || knownSpot(s.activity.fromSpot))
      && finite(s.activity.started) && finite(s.activity.arrived) && finite(s.activity.ends)
      && s.activity.started <= s.activity.arrived && s.activity.arrived < s.activity.ends
      && ['routine', 'local-model', 'visitor'].includes(s.activity.by) && typeof s.activity.manual === 'boolean'))) {
    throw new Error('The world save could not be read. It has been left intact.');
  }
  const next = structuredClone(s);
  if (legacy) {
    next.version = 2;
    next.location = 'home';
    next.room = newWorld(now).room;
    next.activity = null; // An unfinished trip is not a completed experience.
    next.suggested = null;
    next.recent = next.recent.filter(id => WORLD_ACTIONS.some(a => a.id === id));
    if (!WORLD_FOCUSES.includes(next.focus)) next.focus = 'wander';
    next.controlVersion++;
    next.updatedAt = now;
    next.brain.status = 'Settling into her apartment. Her indoor routines are ready.';
    record(next, now, 'arrival', 'apartment', 'Moved home to her virtual cyberpunk apartment. Earlier neighbourhood memories are kept in her journal.',
      'A gaming rig, a bed, and nobody borrowing my figures. Excellent.', false);
  }
  if (next.activity) { next.activity.place = action(next.activity.id).place; next.activity.label = action(next.activity.id).label; }
  return next;
}

/** Additive move-in: keep the apartment history, clock, projects and existing activity. */
export function moveToNeighborhood(s: WorldState, now: number): WorldState {
  if (s.neighborhood) return s;
  const next = structuredClone(s);
  next.neighborhood = neighborhood.createNeighborhood(next);
  record(next,now,'arrival','willowbrook','Haru made her home in the virtual Willowbrook neighborhood, alongside Lina, Theo, Maya, Felix, Jules and Bea. Her earlier apartment history is preserved.','A whole neighborhood. I suppose I can leave the gaming chair occasionally.',false);
  return next;
}

export function worldActions(s: WorldState): typeof WORLD_ACTIONS[number][] {
  const h = worldClock(s.minute).hour;
  return WORLD_ACTIONS.filter(a => (s.neighborhood || a.place === 'home') && (a.id !== 'sleep' || h >= 22 || h < 7));
}

function random(s: WorldState) {
  s.seed = (Math.imul(1664525, s.seed) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}

function choose(s: WorldState): WorldActionId {
  const available = worldActions(s);
  if (available.some(a => a.id === 'sleep') && s.needs.energy < 85) return 'sleep';
  if (s.needs.energy < 22) return 'rest';
  const weights = available.map(a => {
    let w = 1;
    if (a.focus === s.focus) w += 4;
    if (a.id === 'rest' || a.id === 'sleep') w = s.needs.energy < 50 ? 3 : 0.05;
    if (a.id === 'tea') w += (100 - s.needs.energy) / 45;
    if (a.id === 'read' || a.id === 'sketch') w += s.needs.curiosity / 30;
    if (a.id === 'anime' || a.id === 'game') w += s.needs.company / 35;
    if (s.recent.slice(-3).includes(a.id)) w *= 0.12;
    return { id: a.id, w };
  });
  let pick = random(s) * weights.reduce((n, a) => n + a.w, 0);
  for (const a of weights) { pick -= a.w; if (pick <= 0) return a.id; }
  return weights.at(-1)!.id;
}

function start(s: WorldState, id: WorldActionId, by: NonNullable<WorldState['activity']>['by'], manual: boolean) {
  const a = action(id);
  const travel = s.neighborhood && (a.place !== s.location || a.place !== 'home') ? neighborhood.neighborhoodTravel(s,a.place) : a.spot === s.room.spot ? 0 : 2;
  s.activity = { id, place:a.place, label:a.label, from:s.location, fromSpot: s.room.spot, started: s.minute, arrived: s.minute + travel, ends: s.minute + travel + a.minutes, by, manual };
}

function record(s: WorldState, now: number, kind: WorldEvent['kind'], topic: string, text: string, line: string, manual: boolean) {
  s.events.push({ id: `world-${++s.sequence}`, at: new Date(now).toISOString(), minute: s.minute, kind, topic, text, line, manual, source: 'virtual-world' });
  s.events = s.events.slice(-100);
}

function complete(s: WorldState, now: number) {
  const a = s.activity!;
  let text = '', line = '', milestone = false;
  let topic: string = a.id;
  switch (a.id) {
    case 'park': case 'cafe': case 'library': case 'market': case 'studio': {
      const company = neighborhood.recordNeighborhoodVisit(s);
      const destination = neighborhood.placeName(action(a.id).place);
      s.needs.energy = clamp(s.needs.energy + (a.id === 'cafe' ? 15 : -4));
      s.needs.curiosity = clamp(s.needs.curiosity - 24); s.needs.company = clamp(s.needs.company - (company.length ? 30 : 8));
      text = `Completed a visit to ${destination} in virtual Willowbrook${company.length ? ', spending time near '+company.join(', ') : ''}.`;
      line = company.length ? `A little company at ${destination}. Not a bad reason to go outside.` : `Spent some time at ${destination}. A change of scenery was overdue.`;
      topic = 'willowbrook-'+a.id;
      break;
    }
    case 'game':
      s.room.games++; s.needs.curiosity = clamp(s.needs.curiosity - 24); s.needs.company = clamp(s.needs.company - 25);
      text = `Completed session ${s.room.games} of the fictional racing game Neon Circuit at her gaming desk.`;
      line = ['The racing line was impeccable. The barrier was simply in the wrong place.', 'One more race is a perfectly reasonable unit of time.', 'The RGB adds at least three horsepower. I have decided this.'][s.room.games % 3];
      milestone = s.room.games % 5 === 0; topic = 'neon-circuit'; break;
    case 'anime':
      s.room.episodes++; s.needs.curiosity = clamp(s.needs.curiosity - 20); s.needs.company = clamp(s.needs.company - 35);
      text = `Watched episode ${s.room.episodes} of the fictional anime Afterlight on her desktop.`;
      line = ['Another episode. For narrative closure, obviously.', 'The opening theme is doing a suspicious amount of emotional work.', 'Watching anime at my own desk. A defensible use of the evening.'][s.room.episodes % 3];
      milestone = s.room.episodes % 6 === 0; topic = 'afterlight'; break;
    case 'collect':
      s.room.arrangements++; s.needs.curiosity = clamp(s.needs.curiosity - 16);
      text = 'Rearranged the anime figures and manga on her apartment shelf.';
      line = 'Reorganised the figures. This is curation, not procrastination.'; break;
    case 'music':
      s.needs.energy = clamp(s.needs.energy + 10); s.needs.company = clamp(s.needs.company - 20);
      text = 'Listened to a fictional synthwave mix in her virtual room.';
      line = 'Synthwave and neon. I am allowed to be predictable when the combination works.'; break;
    case 'window':
      s.needs.curiosity = clamp(s.needs.curiosity - 15); s.needs.energy = clamp(s.needs.energy + 8);
      text = 'Watched the neon skyline through her apartment window.';
      line = 'The city is doing all that and I get to stay in here. Ideal arrangement.'; break;
    case 'read':
      s.projects.reading += 25; s.needs.curiosity = clamp(s.needs.curiosity - 35);
      text = `Read another chapter of the fictional manga mystery The Midnight Tram (${s.projects.reading}% of this reading).`;
      line = 'A suspicious tram timetable. Finally, public transport with literary ambition.';
      if (s.projects.reading >= 100) {
        s.projects.books++; s.projects.reading = 0; milestone = true;
        text = `Finished reading the in-world manga mystery The Midnight Tram. Completed readings: ${s.projects.books}.`;
        line = 'Finished The Midnight Tram in my virtual apartment. I stand by being suspicious of the timetable.';
      }
      topic = 'midnight-tram'; break;
    case 'sketch':
      s.projects.sketches++; s.needs.curiosity = clamp(s.needs.curiosity - 28);
      text = `Added digital city sketch ${s.projects.sketches} to her tablet sketchbook.`;
      line = 'Drew another neon skyline. The undo button remains my most trusted collaborator.';
      if (s.projects.sketches % 4 === 0) {
        s.projects.albums++; milestone = true;
        text = `Completed sketch album ${s.projects.albums}, with four more drawings of the fictional neon city.`;
        line = 'Four city sketches finished. I’m calling it a series, which makes the repetition artistic.';
      }
      topic = 'sketchbook'; break;
    case 'sleep': case 'rest':
      s.needs.energy = clamp(s.needs.energy + (a.id === 'sleep' ? 95 : 55));
      text = a.id === 'sleep' ? 'Slept at her apartment and woke up rested.' : 'Took a nap at her apartment.';
      line = 'Rested. My formidable intellect can resume its very demanding schedule.'; break;
    case 'tea':
      s.needs.energy = clamp(s.needs.energy + 20); text = 'Made tea in her apartment.';
      line = 'Tea acquired. Civilisation continues.'; break;

  }
  record(s, now, milestone ? 'milestone' : 'activity', topic, text, line, a.manual);
  s.recent = [...s.recent, a.id].slice(-8);
  s.activity = null;
}

/** At most a simulated day per invocation. No network and no wall-clock access. */
export function advanceWorld(saved: WorldState, minutes: number, now: number, manual = false): WorldState {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) throw new Error('Invalid world interval.');
  const s = structuredClone(saved);
  const end = s.minute + minutes;
  while (s.minute < end) {
    if (!s.activity) {
      const proposed = s.suggested;
      s.suggested = null;
      const valid = proposed && worldActions(s).some(a => a.id === proposed.id);
      start(s, valid ? proposed.id : choose(s), valid ? proposed.by : 'routine', manual);
    }
    if (manual) s.activity!.manual = true;
    const step = Math.min(1, end - s.minute, s.activity!.ends - s.minute);
    if (step <= 0) { complete(s, now); continue; }
    const asleep = s.activity!.id === 'sleep' || s.activity!.id === 'rest';
    s.needs.energy = clamp(s.needs.energy - (asleep ? 0 : 0.055) * step);
    s.needs.curiosity = clamp(s.needs.curiosity + 0.025 * step);
    s.needs.company = clamp(s.needs.company + 0.028 * step);
    s.minute += step;
    if (s.neighborhood) neighborhood.tickNeighborhood(s,step);
    if (s.minute >= s.activity!.arrived) { s.location = action(s.activity!.id).place; s.room.spot = action(s.activity!.id).spot; }
    if (s.minute >= s.activity!.ends) complete(s, now);
  }
  s.updatedAt = now;
  return s;
}

/** Long downtime is paused, not replayed into a flood of fresh experiences. */
export function tickWorld(saved: WorldState, now: number): WorldState {
  if (now <= saved.updatedAt) return saved;
  const elapsed = now - saved.updatedAt;
  if (!saved.running || elapsed > 60_000) return { ...saved, updatedAt: now };
  return advanceWorld(saved, elapsed * saved.speed / MINUTE, now);
}

export type WorldCommand = { type: 'running'; value: boolean } | { type: 'speed'; value: 1 | 12 | 60 }
  | { type: 'lighting'; value: WorldState['room']['lighting'] } | { type: 'focus'; value: WorldFocus } | { type: 'brain'; value: boolean }
  | { type: 'advance'; minutes: 30 } | { type: 'suggest'; action: WorldActionId };
export function readWorldCommand(raw: unknown): WorldCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if ((c.type === 'running' || c.type === 'brain') && typeof c.value === 'boolean') return { type: c.type, value: c.value };
  if (c.type === 'lighting' && ['neon', 'warm', 'night'].includes(String(c.value))) return { type: 'lighting', value: c.value as WorldState['room']['lighting'] };
  if (c.type === 'speed' && [1, 12, 60].includes(c.value as number)) return { type: 'speed', value: c.value as 1 | 12 | 60 };
  if (c.type === 'focus' && WORLD_FOCUSES.includes(c.value as WorldFocus)) return { type: 'focus', value: c.value as WorldFocus };
  if (c.type === 'advance' && c.minutes === 30) return { type: 'advance', minutes: 30 };
  if (c.type === 'suggest' && WORLD_ACTIONS.some(a => a.id === c.action)) return { type: 'suggest', action: c.action as WorldActionId };
  return null;
}
export function commandWorld(saved: WorldState, raw: unknown, now: number): WorldState {
  const c = readWorldCommand(raw);
  if (!c) throw new Error('That world control is not recognised.');
  let s = tickWorld(saved, now);
  s = structuredClone(s);
  s.controlVersion++;
  if (c.type === 'running') s.running = c.value;
  if (c.type === 'lighting') s.room.lighting = c.value;
  if (c.type === 'speed') s.speed = c.value;
  if (c.type === 'focus') { s.focus = c.value; s.suggested = null; }
  if (c.type === 'brain') s.brain.enabled = c.value;
  if (c.type === 'advance') {
    if (s.running) throw new Error('Pause the world before skipping ahead.');
    s = advanceWorld(s, c.minutes, now, true);
  }
  if (c.type === 'suggest') {
    if (!worldActions(s).some(a => a.id === c.action)) throw new Error('That activity is not available right now.');
    // A suggestion is a next activity; a visit must not erase an ongoing task.
    s.suggested = { id: c.action, by: 'visitor' };
  }
  s.updatedAt = now;
  return s;
}

export function worldView(s: WorldState) {
  const current = s.activity && action(s.activity.id);
  const moving = s.activity && s.minute < s.activity.arrived;
  const target = ROOM_SPOTS.find(p => p.id === (current?.spot ?? s.room.spot))!;
  const from = ROOM_SPOTS.find(p => p.id === (s.activity?.fromSpot ?? s.room.spot))!;
  const t = moving ? clamp((s.minute - s.activity!.started) / (s.activity!.arrived - s.activity!.started), 0, 1) : 1;
  return { ...s, ...(s.neighborhood ? {neighborhood:neighborhood.neighborhoodView(s)} : {}), clock: worldClock(s.minute), weather: worldWeather(s.minute), places: WORLD_PLACES,
    spots: ROOM_SPOTS, people: [], actions: worldActions(s),
    current: current ? { ...current, moving: !!moving, progress: clamp((s.minute - s.activity!.arrived) / (s.activity!.ends - s.activity!.arrived), 0, 1) } : null,
    position: { x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t },
  };
}

export function worldNote(s: WorldState | null): string {
  if (!s) return '';
  const clock = worldClock(s.minute);
  if (s.neighborhood) {
    const moment = neighborhood.neighborhoodMoment(s);
    return `[Your virtual Willowbrook neighborhood — simulated experiences, not evidence about the human or real-world places.]\nGame day ${clock.day}, ${clock.hour}:${String(clock.minute).padStart(2,'0')}. You are ${moment.moving ? 'walking toward '+neighborhood.placeName(moment.destination) : (moment.inside ? 'inside ' : 'near ')+neighborhood.placeName(moment.location)}.\nCurrent activity: ${s.activity ? action(s.activity.id).label+' (not yet completed)' : 'between activities'}.\nYou feel ${s.needs.energy < 30 ? 'physically tired' : 'rested enough to explore'}${s.needs.company > 70 ? ', and could use some company' : ''}.\nNearby neighbors: ${moment.nearby.map(n=>n.name).join(', ') || 'nobody nearby right now'}. The other six residents live independently and have their own private homes.\nCompleted events:\n${s.events.slice(-5).map(e=>'- '+e.text).join('\n')}\nKeep these experiences in their virtual setting. Do not invent encounters or claim that a planned activity has finished.`;
  }
  return `[Your virtual cyberpunk apartment — a local game, with its own clock. These are simulated experiences, never evidence about the human’s activities or real-world places.]
Game day ${clock.day}, ${clock.hour}:${String(clock.minute).padStart(2, '0')}; ${s.running ? 'running' : 'paused'}. Location: ${place(s.location).name}, ${ROOM_SPOTS.find(p => p.id === s.room.spot)!.name}. Only this room is currently simulated. The city outside is scenery.
Current activity: ${s.activity ? action(s.activity.id).label + ' (not yet completed)' : 'between activities'}.
Recorded completed events:
${s.events.slice(-4).map(e => `- Game day ${worldClock(e.minute).day}: ${e.text}`).join('\n')}
When referring to these experiences, make the virtual setting clear. Do not claim to have read real books or met real people from this game.`;
}

export function worldNudgeCandidates(s: WorldState | null, now: number): NudgeCandidate[] {
  if (!s || !s.running) return [];
  const seen = new Set<string>();
  // Earlier neighbourhood events remain history, but do not trigger fresh room nudges.
  const movedIn = s.events.slice().reverse().findIndex(e => e.kind === 'arrival' && e.topic === 'apartment');
  const currentEvents = movedIn < 0 ? s.events : s.events.slice(s.events.length - movedIn);
  return currentEvents.slice().reverse().filter(e => e.kind === 'milestone' && !e.manual && Date.parse(e.at) <= now && now - Date.parse(e.at) < 6 * 3_600_000)
    .filter(e => { if (seen.has(e.topic)) return false; seen.add(e.topic); return true; }).slice(0, 2).map(e => ({
      weight: 0.6, subject: { key: `world:${e.topic}`, kind: 'own', revision: e.id, occurredAt: e.at,
        expiresAt: new Date(Date.parse(e.at) + 6 * 3_600_000).toISOString(),
        material: `A recorded event in your VIRTUAL GAME WORLD (not the real world), game day ${worldClock(e.minute).day}: ${e.text}\nYour in-game reaction: ${e.line}`,
        instruction: 'Share one short, sharp observation about this completed virtual-world event. Make the setting clear with “in my virtual apartment” or similar. No question, no claim about the human, and no invented event or book content.',
      },
    }));
}
