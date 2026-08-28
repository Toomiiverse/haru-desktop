// The way somewhere, asked of her and answered by the maps app.
//
// She is not a maps app and does not pretend to be: what she does is notice
// the question, find the place — one she knows by name, or one the map service
// can find near them — say her piece about it, and hand over a link that opens
// the phone's own maps with the route already asked for. The link is built
// here, from coordinates, and never by the model: a 9B model asked to type a
// URL will type something that looks like one.

import type { Place, Whereabouts } from './whereabouts';
import { distanceM, homeOf, placeAt, SPOT_STALE_MS } from './whereabouts';

export type DirectionsAsk = { destination: string; nearest: boolean };
export type Found = { name: string; lat: number; lon: number };

const TAIL = String.raw`\s*(?:from here|from where i am|from home|please|pls|now)?\s*[?.!]*\s*$`;
const ASKS: { pattern: RegExp; nearest?: boolean }[] = [
  { pattern: new RegExp(String.raw`\b(?:directions?|the way|a route|route|navigat(?:e|ion))\s+(?:to|for|towards?)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\bhow (?:do|can|would|should|did) (?:i|we) get (?:back )?(?:to|home to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:take|guide|walk|drive|navigate|get) (?:me|us) (?:back )?to\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:take|guide|walk|drive|get) (?:me|us) (home)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\bhow far (?:is|to|away is)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:where(?:'s| is)|find(?: me)?|nearest|closest)\s+(?:the |a )?(?:nearest|closest)\s+(.+?)` + TAIL, 'i'), nearest: true },
];
const NOT_A_PLACE = /^(?:there|here|it|that|this|you|her|him|them|me|us|the point|sleep|bed|work on it|the top|the bottom)$/i;

/** Tidied for a search: quotes, a leading article, a trailing "from here" gone; casing kept for names. */
export function cleanDestination(raw: string): string {
  return raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/^(?:the|a|my)\s+(?=\S)/i, m => (/^my/i.test(m) ? '' : m)).replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** The ask in a message, if it is one: where to, and whether "the nearest" of something. */
export function directionsAsk(text: string): DirectionsAsk | null {
  const line = (text ?? '').trim();
  if (!line || line.length > 300) return null;
  for (const { pattern, nearest } of ASKS) {
    const m = line.match(pattern);
    if (!m) continue;
    const destination = cleanDestination(m[1]);
    if (destination.length < 2 || NOT_A_PLACE.test(destination)) return null;
    return { destination, nearest: nearest === true };
  }
  return null;
}

/** A place she knows by that name — "home", "the store", "my place" for home. */
export function matchNamedPlace(destination: string, places: Place[]): Place | null {
  const key = destination.toLowerCase().replace(/^(?:the|my)\s+/, '').trim();
  if (/^(?:place|house|home|flat|apartment)$/.test(key)) return homeOf(places);
  return places.find(p => p.name.toLowerCase().replace(/^the\s+/, '') === key) ?? null;
}

/** Where they are for the purposes of "from here": a fresh fix, else home. */
export function startingPoint(where: Whereabouts, nowMs = Date.now()): { lat: number; lon: number; known: 'here' | 'home' } | null {
  if (where.enabled && where.last && nowMs - Date.parse(where.last.at) <= SPOT_STALE_MS) return { lat: where.last.lat, lon: where.last.lon, known: 'here' };
  const home = homeOf(where.places);
  return home ? { lat: home.lat, lon: home.lon, known: 'home' } : null;
}

/** Apple Maps opens this on an iPhone with the route asked for; the page turns it into Google Maps on anything else. */
export function mapsLink(found: Found): string {
  return `https://maps.apple.com/?daddr=${found.lat.toFixed(5)},${found.lon.toFixed(5)}&dirflg=d`;
}

export function googleMapsLink(found: Found): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${found.lat.toFixed(5)},${found.lon.toFixed(5)}`;
}

function km(m: number): string {
  return m < 950 ? `${Math.round(m / 50) * 50} m` : m < 10_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
}

/**
 * What she is told about it, before she speaks. The facts and the shape of
 * the reply: the app puts the link under her words, so her words must not try
 * to be the directions. Nothing found is said plainly too — a model that is
 * not told will invent a street.
 */
export function directionsNote(ask: DirectionsAsk, found: Found | null, where: Whereabouts, nowMs = Date.now()): string {
  const from = startingPoint(where, nowMs);
  if (!found) {
    return `They asked the way to "${ask.destination}". The map was searched and nothing was found by that name${from ? '' : ', and she does not know where they are to search nearby'}. Say so in your own way; do not invent an address or a route, and do not offer a link — none will be attached.`;
  }
  const at = from ? placeAt(where.places, { lat: found.lat, lon: found.lon, accuracy: 0 }) : null;
  const distance = from ? ` It is about ${km(distanceM(from, found))} from ${from.known === 'here' ? 'where they are' : 'home'}.` : '';
  const there = at && from && distanceM(from, found) < 200 ? ' They are already there, as far as the phone can tell.' : '';
  return `They asked the way to "${ask.destination}". Found: ${found.name}.${distance}${there} The app is attaching a button under your words that opens their maps with the route, so do not write a link, an address, or turn-by-turn directions — one or two lines of yours, in your voice, is all that is wanted.`;
}

/** Her words with the button's link under them, as a markdown link the page and the desktop both render. */
export function withDirections(reply: string, found: Found): string {
  const label = `Directions to ${found.name.split(',')[0].trim() || 'there'}`;
  return `${reply.trim()}\n\n[${label}](${mapsLink(found)})`;
}
