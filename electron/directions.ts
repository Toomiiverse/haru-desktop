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

// Everything a question can trail off with that is not part of the place: "from
// here right now?", "this morning?", "please". Repeated, because they stack.
const TAIL = String.raw`(?:\s+(?:from here|from where i am|from home|right now|at the moment|this (?:morning|afternoon|evening|arvo)|today|tonight|currently|please|pls|now|thanks|(?:going|heading|driving|on (?:my|the) way)?\s*(?:back(?: home)?|home)))*\s*[?.!]*\s*$`;
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
    // Traffic claims go with the route talk: both are things she cannot see.
    return paragraph.split(/(?<=[.!?])\s+/).filter(sentence => !ROUTE_TALK.test(sentence) && !TRAFFIC_CLAIM.test(sentence)).join(' ');
  }).filter(p => p.trim());
  const out = kept.join('\n\n').trim();
  if (out) return out;
  const first = reply.trim().match(/^[^.!?\n]*[.!?]?/);
  return (first?.[0] ?? reply).trim();
}

// A street address, as Australians write one: "40 Boddington Circuit",
// "2/62 Fitzgerald St, Northbridge WA 6003". A number, one to three name words,
// a street suffix; then a suburb only when it is capitalised, and a state.
// "5 minutes drive" has the shape and is excluded by the unit words.
const SUFFIX = String.raw`(?:street|st|road|rd|circuit|cct|avenue|ave|av|drive|dr|way|court|ct|place|pl|crescent|cres|cr|lane|ln|parade|pde|terrace|tce|boulevard|blvd|bvd|highway|hwy|close|cl|loop|rise|grove|gr|mews|square|sq|esplanade|esp|promenade|prom|gardens|gdns|retreat|rtt|entrance|ent|view|vista|turn|bend|green|heights|hts|link|mall|nook|pass|ridge|row|trail|walk|wynd|cove|dale|glade|approach|app|broadway|circle|cir|crossing|parkway|pkwy|parkway|track|trk)`;
const UNIT = String.raw`(?!(?:min|mins|minutes?|hours?|hrs?|km|kms|k|m|metres?|meters?|secs?|seconds?|days?|weeks?|months?|years?|dollars?|bucks|percent|people|guys|times)\b)`;
const ADDRESS = new RegExp(String.raw`\b(\d{1,5}[a-z]?(?:\/\d{1,5})?\s+${UNIT}(?:[a-z][a-z'’-]+\s+){1,3}${SUFFIX})\b\.?((?:,?\s+[A-Za-z][a-z]+(?:\s+[A-Z][a-z]+)?)?(?:,?\s+(?:WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\b)?(?:\s+\d{4}\b)?)`, 'i');
const NOT_A_SUBURB = /^,?\s+(?:And|But|Then|Now|Today|Tomorrow|Please|Pls|Thanks|Thank|So|Or|If|When|Where|Which|That|This|Right|Later|Tonight|Instead|Again|First|Next|Asap|Before|After)\b/;

/** The street address in the text, if there is one: number, street, and the suburb when it was given. */
export function streetAddress(text: string): string | null {
  const m = ADDRESS.exec(text ?? '');
  if (!m) return null;
  let rest = m[2] ?? '';
  // The suburb only when written as a name — the regex is case-blind for the
  // street, and "40 Boddington Circuit tomorrow" has no suburb in it.
  if (rest && !/^,?\s+(?:[A-Z][a-z]|WA\b|NSW\b|VIC\b|QLD\b|SA\b|TAS\b|NT\b|ACT\b)/.test(rest)) rest = '';
  if (NOT_A_SUBURB.test(rest)) rest = '';
  return `${m[1]}${rest}`.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

// A claim about the roads right now. She cannot see them, and with no route in
// hand every word of it is invented — "traffic's already thick, you'll hit the
// main drag, then the inner loop" was written for a trip nobody looked up.
const TRAFFIC_CLAIM = /\btraffic(?:'s| is| was)?\s*(?:already\s+|pretty\s+|a bit\s+)?(?:bad|thick|heavy|light|fine|clear|moving|backed up|jammed|slow|quiet)\b|\b(?:roads?|it)(?:'s| is| are|'re)\s*(?:pretty\s+)?(?:clear|busy|jammed|backed up|chaos)\b|\byou'?ll (?:hit|be stuck|get stuck)\b/i;

/** Whether her reply claims to know what the roads are doing. */
export function claimsTraffic(reply: string): boolean {
  return TRAFFIC_CLAIM.test(reply ?? '');
}

// "how long will that take?", "is traffic bad?" — a journey question with the
// place left in the sentence before it, or in the same breath: "I'm going to
// Starbucks in Murdoch then work, so how long will that take?"
const BARE_JOURNEY = new RegExp(String.raw`^(?:.*\b)?(?:so\s+)?(?:how long (?:will|would|does|is) (?:that|it|this)(?: take| be)?|is (?:the )?traffic (?:bad|heavy|ok|okay|alright|any good)|how(?:'s|’s|s| is) (?:the )?traffic|what(?:'s|’s|s| is) (?:the )?traffic like)` + TAIL, 'i');
/** Where they said they were off to, in their own words: "going to X", "stopping by X", "off to X". */
export function destinationNamed(text: string): string | null {
  const m = new RegExp(String.raw`\b(?:going|heading|off|driving|walking|nipping|popping|stopping(?: by| in| at)?|on my way)\s+(?:to|by|at|into|over to|down to|round to)?\s*([A-Z][\w'&-]*(?:\s+(?:in|at|on)\s+[A-Z][\w'&-]*|\s+[A-Z][\w'&-]*){0,3})`, '').exec(text ?? '');
  const named = m?.[1]?.trim().replace(/\s+(?:then|and|so|but)$/i, '').trim();
  return named && named.length > 2 ? named.slice(0, 60) : null;
}

/** "pick up the cpu", "the Dianella address" — a thing to do, not a place; the place is an address they gave. */
const ERRAND = /^(?:(?:to )?(?:pick|pick up|grab|collect|fetch|drop off|drop off at|drop)\b|.*\baddress\b)/i;
/** Going home, however they put it: "going back", "heading home", "the way back", "back home". */
const HOMEWARD = /\b(?:(?:going|heading|driving|getting|get|head|go|come|coming|on (?:my|the) way|(?:the |my )?(?:way|drive|trip|run))\s+(?:back(?: home)?|home)|back home)\b/i;

/** The ask with no place in it: "give me the directions", "directions please", "how do I get there". */
const BARE_ASK = /^(?:(?:can|could|would|will) you )?(?:(?:give|send|show|get|shoot) me )?(?:the |some |those |a )?(?:directions?|route|way there)(?: there| to (?:it|that|there|the place))?(?: please| pls| again| now| thanks)*[?.!\s]*$|^how (?:do|can|would) (?:i|we) get there(?: from here)?[?.!\s]*$/i;

/**
 * The ask, with what they said just before in mind.
 *
 * "Give me directions to pick up the CPU" is not a place, and searched as one it
 * found the shop they work at. The place was in the message before it: "40
 * Boddington Circuit". So an errand takes the address they gave — in this
 * message or a recent one — and an address on its own, or a bare "give me the
 * directions", after a directions question, is that question answered.
 */
export function directionsAskFrom(latest: string, recentUser: string[]): DirectionsAsk | null {
  const remembered = () => {
    for (const earlier of [...recentUser].reverse()) { const found = streetAddress(earlier); if (found) return found; }
    return null;
  };
  const ask = directionsAsk(latest);
  if (ask) {
    if (!ERRAND.test(ask.destination)) return ask;
    const address = streetAddress(latest) ?? remembered();
    return address ? { destination: address, nearest: false } : null;
  }
  const line = (latest ?? '').trim();
  // A journey question with the place named in the same message or a recent one.
  if (BARE_JOURNEY.test(line)) {
    const named = destinationNamed(line) ?? (() => {
      for (const earlier of [...recentUser].reverse()) { const found = destinationNamed(earlier); if (found) return found; }
      return null;
    })();
    if (named) return { destination: named, nearest: false };
    // "What's the traffic like going back" — no place named, because home is
    // not a name they use. Asked that from the shop, with her holding live
    // traffic and their position, she said she could not check and told him
    // to open Waze. "Back" and "home" are the place she knows as home.
    if (HOMEWARD.test(line) || recentUser.slice(-3).some(earlier => HOMEWARD.test(earlier))) return { destination: 'home', nearest: false };
  }
  if (BARE_ASK.test(line)) {
    const address = remembered();
    return address ? { destination: address, nearest: false } : null;
  }
  const here = streetAddress(line);
  if (here && line.length <= here.length + 40 && recentUser.slice(-3).some(earlier => directionsAsk(earlier) !== null || BARE_ASK.test(earlier.trim()))) {
    return { destination: here, nearest: false };
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
export function directionsNote(ask: DirectionsAsk, found: Found | null, where: Whereabouts, nowMs = Date.now(), road?: string, facts?: string): string {
  const from = startingPoint(where, nowMs);
  if (!found) {
    return `They asked the way to "${ask.destination}". The map was searched and nothing was found by that name${from ? '' : ', and she does not know where they are to search nearby'}. Say so in your own way; do not invent an address or a route, and do not offer a link — none will be attached.`;
  }
  const at = from ? placeAt(where.places, { lat: found.lat, lon: found.lon, accuracy: 0 }) : null;
  // The road, when Google has answered (routes.ts); the straight line otherwise.
  const distance = road ? ` ${road}` : from ? ` It is about ${km(distanceM(from, found))} from ${from.known === 'here' ? 'where they are' : 'home'}.` : '';
  const there = at && from && distanceM(from, found) < 200 ? ' They are already there, as far as the phone can tell.' : '';
  // What Google knows about the place itself (places.ts) — the door, the rating
  // — so "how long to Bunnings" can also say it shuts in twenty minutes.
  const about = facts ? ` ${facts}` : '';
  // With Google's numbers in hand the old closing line — "you do not know the
  // journey times, anything you say will be cut" — contradicted them, and the
  // hosted model resolved it by telling him to open Waze. The numbers are hers
  // to say; what she still does not know is everything else about the road.
  const limits = road
    ? 'The minutes, the distance and the roads named above are Google\'s, live, and are yours to say — say them plainly. Do not say you cannot check the traffic, and do not send them to a maps app; the app is attaching a button under your words that opens theirs with the route. Beyond those numbers you do not know the route, so nothing else about roads, turns or buses.'
    : 'The app is attaching a button under your words that opens their maps with the route. You do not know the roads, buses or journey times there, so anything you say about the route would be made up and will be cut; one or two lines of yours, in your voice, about them going, is all that is wanted.';
  return `They asked the way to "${ask.destination}". Found: ${found.name}.${distance}${there}${about} ${limits}`;
}

// A maps link, as the app writes one under her words — and as she then copied
// it, coordinates invented, once one sat in her own history. The app attaches
// the button; she never types one.
const MAPS_LINK = /\s*\[[^\]\n]*\]\(\s*https?:\/\/(?:maps\.apple\.com|(?:www\.)?google\.com\/maps|maps\.google\.com|goo\.gl\/maps|maps\.app\.goo\.gl)[^)\s]*\)|\s*https?:\/\/(?:maps\.apple\.com|(?:www\.)?google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl)\S*/gi;

/** The text without any maps link in it: her history as she should see it, and her line as she may write it. */
export function withoutMapsLinks(text: string): string {
  return (text ?? '').replace(MAPS_LINK, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Her words with the button's link under them, as a markdown link the page and the desktop both render. */
export function withDirections(reply: string, found: Found): string {
  const label = `Directions to ${found.name.split(',')[0].trim() || 'there'}`;
  return `${reply.trim()}\n\n[${label}](${mapsLink(found)})`;
}

// Her saying she cannot see the road, kept in the history and copied.
//
// Asked the traffic three times in a row she said three times that she
// could not check it, had no GPS, and that he should open Waze. When the
// route was then put in front of her — 29 minutes, live, with the roads
// named — she said it a fourth time, word for word, because the three were
// in the conversation and she copies what she can see over what she is told.
// The same finding as the reminder denials (withoutStaleDenials in main.ts):
// only replies the route now contradicts are dropped, and only while a route
// is in hand, so a denial made with no route behind it stands.
const CANT_SEE_THE_ROAD = /\b(?:can'?t|cannot|don'?t|do not|unable to|no way to) (?:check|see|access|pull|get|have|look at|track)\b[^.!?\n]{0,40}\b(?:traffic|roads?|drive time|journey time|gps|location|maps? app|live)|\bdon'?t have (?:access to )?(?:live |real[- ]time )?traffic|\bno (?:live |real[- ]time )?traffic (?:data|access|feed)|\bopen (?:waze|google maps|apple maps|your (?:own )?(?:damn |bloody )?(?:phone|maps?( app)?))/i;

/** The history without her claims that she cannot see the road, once she can. */
export function withoutTrafficDenials<T extends { role: string; content: string }>(messages: T[], hasRoute: boolean): T[] {
  if (!hasRoute) return messages;
  return messages.filter(message => !(message.role === 'assistant' && CANT_SEE_THE_ROAD.test(message.content.replace(/[‘’]/g, "'"))));
}
