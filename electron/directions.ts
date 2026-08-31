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
  // Travel time is a route question too. Without these she guessed — "roughly
  // 45 minutes to an hour" for a half-hour drive — and a guess about a journey
  // is exactly the confident wrong number the map exists to replace.
  { pattern: new RegExp(String.raw`\bhow long (?:does|would|will|did|should) it take (?:(?:me|us) )?(?:to (?:get|drive|walk|travel|go|ride|cycle|bus|train) )?(?:back )?(?:to|from [^?]+? to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\bhow long (?:to|till|until) (?:(?:i|we) )?(?:get to |reach |arrive at )?(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:travel|drive|driving|journey|trip) time (?:to|from [^?]+? to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\beta (?:to|for)\s+(.+?)` + TAIL, 'i') },
  // "How's the traffic into Perth?" was answered "Traffic's fine" — she cannot
  // see traffic. The map can; so it is a route question, and the button shows it.
  { pattern: new RegExp(String.raw`\b(?:how(?:'s| is| are|'re) the )?traffic\s+(?:like\s+)?(?:from [^?]+? )?(?:into|to|towards?|on the way to|heading to|going to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:where(?:'s| is)|find(?: me)?|nearest|closest)\s+(?:the |a )?(?:nearest|closest)\s+(.+?)` + TAIL, 'i'), nearest: true },
];
const NOT_A_PLACE = /^(?:there|here|it|that|this|you|her|him|them|me|us|the point|sleep|bed|work on it|the top|the bottom)$/i;
/** "How long does it take to boil an egg" has the shape of a journey and none of the substance. */
const NOT_A_JOURNEY = /^(?:you|i|we|they|he|she|it|this|that|boil|cook|make|bake|do|finish|learn|read|write|build|fix|charge|download|install|render|compile|get ready|fall asleep|heal|recover|grow|dry|load|update|stop|start|be)\b/i;

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
    // "the nearest Coles" is a Coles, searched near them — the word itself
    // means nothing to a map and everything to how the search is bounded.
    const cleaned = cleanDestination(m[1]);
    const near = /^(?:the )?(?:nearest|closest|nearby|near(?:by)? )\s*/i.exec(cleaned);
    const destination = near ? cleanDestination(cleaned.slice(near[0].length)) : cleaned;
    if (destination.length < 2 || NOT_A_PLACE.test(destination) || NOT_A_JOURNEY.test(destination)) return null;
    return { destination, nearest: nearest === true || near !== null };
  }
  return null;
}

/**
 * Her words about the way somewhere, without the way somewhere.
 *
 * Told plainly not to, a small model still writes "via Canning Hwy, bus 950,
 * 15–20 mins" — roads it has never seen and buses that do not exist. The
 * button under her words is the route; anything of hers that reads as one is
 * cut, list items first, then any sentence that names roads, buses, turns or
 * journey times. Her first sentence always survives, so she still said
 * something.
 */
const ROUTE_TALK = /\b(?:via|hwy|highway|freeway|motorway|exit \d|turn (?:left|right)|(?:bus|train|tram|ferry|route)(?:es)? ?\d|(?:take|catch) the (?:bus|train|tram|ferry)|\d+\s*(?:-|–|to)?\s*\d*\s*(?:mins?|minutes|hrs?|hours)\b|parking|car ?park|campus lots?|head (?:north|south|east|west)|left onto|right onto|roundabout)/i;
export function dropRouteTalk(reply: string): string {
  const paragraphs = reply.split(/\n\s*\n/);
  const kept = paragraphs.map(paragraph => {
    if (/^\s*(?:[-*•]|\d+[.)])\s/.test(paragraph)) return '';
    return paragraph.split(/(?<=[.!?])\s+/).filter(sentence => !ROUTE_TALK.test(sentence)).join(' ');
  }).filter(p => p.trim());
  const out = kept.join('\n\n').trim();
  if (out) return out;
  const first = reply.trim().match(/^[^.!?\n]*[.!?]?/);
  return (first?.[0] ?? reply).trim();
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
export function directionsNote(ask: DirectionsAsk, found: Found | null, where: Whereabouts, nowMs = Date.now(), road?: string): string {
  const from = startingPoint(where, nowMs);
  if (!found) {
    return `They asked the way to "${ask.destination}". The map was searched and nothing was found by that name${from ? '' : ', and she does not know where they are to search nearby'}. Say so in your own way; do not invent an address or a route, and do not offer a link — none will be attached.`;
  }
  const at = from ? placeAt(where.places, { lat: found.lat, lon: found.lon, accuracy: 0 }) : null;
  // The road, when Google has answered (routes.ts); the straight line otherwise.
  const distance = road ? ` ${road}` : from ? ` It is about ${km(distanceM(from, found))} from ${from.known === 'here' ? 'where they are' : 'home'}.` : '';
  const there = at && from && distanceM(from, found) < 200 ? ' They are already there, as far as the phone can tell.' : '';
  return `They asked the way to "${ask.destination}". Found: ${found.name}.${distance}${there} The app is attaching a button under your words that opens their maps with the route. You do not know the roads, buses or journey times there, so anything you say about the route would be made up and will be cut; one or two lines of yours, in your voice, about them going, is all that is wanted.`;
}

/** Her words with the button's link under them, as a markdown link the page and the desktop both render. */
export function withDirections(reply: string, found: Found): string {
  const label = `Directions to ${found.name.split(',')[0].trim() || 'there'}`;
  return `${reply.trim()}\n\n[${label}](${mapsLink(found)})`;
}
