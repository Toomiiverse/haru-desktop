// Where their phone says they are, and what she makes of it.
//
// The phone offers a spot — coordinates, an accuracy, what kind of network it
// is on — only once they have switched sharing on, and the spot stays on this
// machine. Nothing here turns coordinates into a name on its own: the names
// are theirs, given by standing somewhere and calling it "home" or "the store",
// and after that a spot inside a place's radius simply *is* that place. What
// reaches the prompt is a sentence — "at the store, on mobile data, a few
// minutes ago" — and never a number, because she has no use for numbers and a
// model handed them will read them out.

export type NetKind = 'wifi' | 'cellular' | 'ethernet' | 'unknown';
export const NET_KINDS: readonly NetKind[] = ['wifi', 'cellular', 'ethernet', 'unknown'];

export type Spot = { lat: number; lon: number; accuracy: number; at: string; net: NetKind };
export type Place = { name: string; lat: number; lon: number; radiusM: number; added: string };
export type Whereabouts = { enabled: boolean; last: Spot | null; places: Place[] };

export const DEFAULT_WHEREABOUTS: Whereabouts = { enabled: false, last: null, places: [] };

/** A spot older than this says where they were, not where they are, and is left out. */
export const SPOT_STALE_MS = 3 * 60 * 60_000;
/** A phone's own accuracy is trusted up to here; a worse fix is still a fix, but it names no place. */
export const ACCURACY_CAP_M = 500;
/** Places are at least this wide, so a fix that wanders a little at home is still at home. */
export const PLACE_MIN_RADIUS_M = 150;
export const PLACE_LIMIT = 30;
export const PLACE_NAME_LIMIT = 40;

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** The phone's report, or nothing: coordinates on the globe, a sane accuracy, a network she has a word for. */
export function readSpot(body: unknown, now = new Date()): Spot | null {
  const record = (body ?? {}) as Record<string, unknown>;
  if (!finite(record.lat, -90, 90) || !finite(record.lon, -180, 180)) return null;
  // Four places is about eleven metres — everything a phone can honestly claim,
  // and nothing a config file needs more of.
  const round = (v: number) => Math.round(v * 10_000) / 10_000;
  const accuracy = finite(record.accuracy, 0, 100_000) ? Math.round(record.accuracy) : ACCURACY_CAP_M;
  const net = NET_KINDS.includes(record.net as NetKind) ? record.net as NetKind : 'unknown';
  return { lat: round(record.lat), lon: round(record.lon), accuracy, at: now.toISOString(), net };
}

export function readWhereabouts(saved: unknown): Whereabouts {
  const record = (saved ?? {}) as Record<string, unknown>;
  const last = record.last && typeof record.last === 'object' ? readSpot(record.last) : null;
  const lastAt = last && typeof (record.last as Record<string, unknown>).at === 'string' ? (record.last as Record<string, unknown>).at as string : null;
  const places: Place[] = [];
  for (const entry of Array.isArray(record.places) ? record.places : []) {
    const p = (entry ?? {}) as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name.trim() || !finite(p.lat, -90, 90) || !finite(p.lon, -180, 180)) continue;
    places.push({
      name: p.name.trim().slice(0, PLACE_NAME_LIMIT),
      lat: p.lat, lon: p.lon,
      radiusM: finite(p.radiusM, PLACE_MIN_RADIUS_M, 5000) ? p.radiusM : PLACE_MIN_RADIUS_M,
      added: typeof p.added === 'string' ? p.added : '',
    });
    if (places.length >= PLACE_LIMIT) break;
  }
  return { enabled: record.enabled === true, last: last && lastAt && Number.isFinite(Date.parse(lastAt)) ? { ...last, at: lastAt } : null, places };
}

/** Great-circle distance in metres. Haversine: accurate to a metre over any distance a phone walks. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (deg: number) => deg * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * The place a spot is at, or nothing. The nearest one whose radius reaches the
 * spot — a fix's own uncertainty widens the net a little, so a rough reading
 * taken at home still says home, but a reading too rough to trust (a cell
 * tower's idea of where a phone is) names nothing rather than the wrong thing.
 */
export function placeAt(places: Place[], spot: { lat: number; lon: number; accuracy?: number }): Place | null {
  const slack = Math.min(spot.accuracy ?? 0, ACCURACY_CAP_M);
  if ((spot.accuracy ?? 0) > ACCURACY_CAP_M * 2) return null;
  let best: Place | null = null, bestDistance = Infinity;
  for (const place of places) {
    const d = distanceM(place, spot);
    if (d <= place.radiusM + slack && d < bestDistance) { best = place; bestDistance = d; }
  }
  return best;
}

export function homeOf(places: Place[]): Place | null {
  return places.find(p => /^(at )?home$/i.test(p.name)) ?? null;
}

/** The latest word from the phone, kept. */
export function absorb(state: Whereabouts, spot: Spot): Whereabouts {
  return { ...state, last: spot };
}

/**
 * Where they are standing, given a name. The same name again moves the place
 * here (they were wrong the first time, or moved house); the radius takes the
 * fix's accuracy so a rough fix makes a wide place rather than a place the next
 * fix falls outside of.
 */
export function namePlace(state: Whereabouts, rawName: string, now = new Date()): Whereabouts {
  const name = rawName.trim().replace(/\s+/g, ' ').slice(0, PLACE_NAME_LIMIT);
  if (!name || !state.last) return state;
  const radiusM = Math.max(PLACE_MIN_RADIUS_M, Math.min(state.last.accuracy, ACCURACY_CAP_M));
  const place: Place = { name, lat: state.last.lat, lon: state.last.lon, radiusM, added: now.toISOString() };
  const rest = state.places.filter(p => p.name.toLowerCase() !== name.toLowerCase());
  return { ...state, places: [place, ...rest].slice(0, PLACE_LIMIT) };
}

export function forgetPlace(state: Whereabouts, name: string): Whereabouts {
  const key = name.trim().toLowerCase();
  return { ...state, places: state.places.filter(p => p.name.toLowerCase() !== key) };
}

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

function onNet(net: NetKind): string {
  return net === 'cellular' ? ', on mobile data' : net === 'wifi' ? ', on Wi-Fi' : '';
}

/**
 * The one line the prompt gets, or nothing: sharing off, no word yet, or a word
 * too old to mean anything, all say nothing rather than guess. Words only —
 * a place by the name they gave it, a distance from home in round kilometres
 * when she has a home to measure from, the kind of network, how long ago.
 */
export function describeWhereabouts(state: Whereabouts, nowMs = Date.now()): string {
  if (!state.enabled || !state.last) return '';
  const age = nowMs - Date.parse(state.last.at);
  if (!Number.isFinite(age) || age < 0 || age > SPOT_STALE_MS) return '';
  const place = placeAt(state.places, state.last);
  const when = ago(age);
  let where: string;
  if (place) {
    where = `Their phone says they are at ${place.name}${onNet(state.last.net)}, as of ${when}.`;
  } else {
    const home = homeOf(state.places);
    const km = home ? distanceM(home, state.last) / 1000 : null;
    const away = km === null ? '' : km < 1 ? ', not far from home' : `, about ${km < 10 ? km.toFixed(1) : Math.round(km)} km from home`;
    where = `Their phone puts them somewhere she has no name for${away}${onNet(state.last.net)}, as of ${when}.`;
  }
  return `${where} Background: use it when it is relevant, and it is fair game for needling, but she has no coordinates and never quotes any.`;
}

/** What the page is told: names, never numbers. */
export function whereForPage(state: Whereabouts, nowMs = Date.now()): { enabled: boolean; at: string | null; fresh: boolean; net: NetKind | null; places: string[] } {
  const last = state.last;
  const fresh = !!last && nowMs - Date.parse(last.at) <= SPOT_STALE_MS;
  return { enabled: state.enabled, at: last ? placeAt(state.places, last)?.name ?? null : null, fresh, net: last?.net ?? null, places: state.places.map(p => p.name) };
}
