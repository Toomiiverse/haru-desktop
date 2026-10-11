import {navigationPolicy} from './core-navigation-policy';
import {locationPolicy,toldPolicy,locationClock} from './core-location-policy';
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
const TAIL = String.raw`(?:\s+(?:from here|from where i am|from home|right now|at the moment|this (?:morning|afternoon|evening|arvo)|today|tonight|currently|please|pls|now|thanks|(?:going|heading|driving|on (?:my|the) way)?\s*(?:back(?: to)? home|back|(?:to )?home)))*\s*[?.!]*\s*$`;
const ASKS: { pattern: RegExp; nearest?: boolean }[] = [
  { pattern: new RegExp(String.raw`\b(?:directions?|the way|a route|route|navigat(?:e|ion))\s+(?:to|for|towards?)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\bhow (?:do|can|would|should|did) (?:i|we) get (?:back )?(?:to|home to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:take|guide|walk|drive|navigate|get) (?:me|us) (?:back )?to\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:take|guide|walk|drive|get) (?:me|us) (home)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\bhow far (?:is|to|away is)\s+(.+?)` + TAIL, 'i') },
  // "How long to get home" read as a place called "get", and "how long will it
  // take to drive back home" as one called "drive back": home comes first.
  { pattern: new RegExp(String.raw`\bhow long (?:to|till|until|before|(?:will|would|does) it take(?: (?:me|us))? to) (?:get|go|drive|walk|head|ride|i'?m|i am|we'?re|we are|i get|we get) (?:back )?(?:to )?(home)` + TAIL, 'i') },
  // Travel time is a route question too. Without these she guessed — "roughly
  // 45 minutes to an hour" for a half-hour drive — and a guess about a journey
  // is exactly the confident wrong number the map exists to replace.
  { pattern: new RegExp(String.raw`\bhow long (?:does|would|will|did|should) it take (?:(?:me|us) )?(?:to (?:get|drive|walk|travel|go|ride|cycle|bus|train) )?(?:back )?(?:to|from [^?]+? to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\bhow long (?:to|till|until) (?:(?:i|we) )?(?:get to |reach |arrive at )?(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:travel|drive|driving|journey|trip) time (?:to|from [^?]+? to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\beta (?:to|for)\s+(.+?)` + TAIL, 'i') },
  // "How's the traffic into Perth?" was answered "Traffic's fine" — she cannot
  // see traffic. The map can; so it is a route question, and the button shows it.
  // "check traffic to get back home" had "get back home" as the place.
  { pattern: new RegExp(String.raw`\btraffic\s+(?:like\s+)?(?:to|for) (?:get|go|drive|head|ride|walk)(?: back)?(?: to)?\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:how(?:'s| is| are|'re) the )?traffic\s+(?:like\s+)?(?:from [^?]+? )?(?:into|to|towards?|on the way to|heading to|going to)\s+(.+?)` + TAIL, 'i') },
  { pattern: new RegExp(String.raw`\b(?:where(?:'s| is)|find(?: me)?|nearest|closest)\s+(?:the |a )?(?:nearest|closest)\s+(.+?)` + TAIL, 'i'), nearest: true },
];
const NOT_A_PLACE = /^(?:there|here|it|that|this|you|her|him|them|me|us|the point|sleep|bed|work on it|the top|the bottom|get|go|drive|walk|head|ride)$/i;
/** "How long does it take to boil an egg" has the shape of a journey and none of the substance. */
const NOT_A_JOURNEY = /^(?:you|i|we|they|he|she|it|this|that|boil|cook|make|bake|do|finish|learn|read|write|build|fix|charge|download|install|render|compile|get ready|fall asleep|heal|recover|grow|dry|load|update|stop|start|be)\b/i;

/** Tidied for a search: quotes, a leading article, a trailing "from here" gone; casing kept for names. */
export function cleanDestination(raw: string): string {
 return navigationPolicy('cleanDestination',[raw]);
}

/** The ask in a message, if it is one: where to, and whether "the nearest" of something. */
export function directionsAsk(text: string): DirectionsAsk | null {
 return navigationPolicy('directionsAsk',[text]);
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
 return navigationPolicy('dropRouteTalk',[reply]);
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
 return navigationPolicy('streetAddress',[text]);
}

// A claim about the roads right now. She cannot see them, and with no route in
// hand every word of it is invented — "traffic's already thick, you'll hit the
// main drag, then the inner loop" was written for a trip nobody looked up.
const TRAFFIC_CLAIM = /\btraffic(?:'s| is| was)?\s*(?:already\s+|pretty\s+|a bit\s+)?(?:bad|thick|heavy|light|fine|clear|moving|backed up|jammed|slow|quiet)\b|\b(?:roads?|it)(?:'s| is| are|'re)\s*(?:pretty\s+)?(?:clear|busy|jammed|backed up|chaos)\b|\byou'?ll (?:hit|be stuck|get stuck)\b/i;

/** Whether her reply claims to know what the roads are doing. */
export function claimsTraffic(reply: string): boolean {
 return navigationPolicy('claimsTraffic',[reply]);
}

// "how long will that take?", "is traffic bad?" — a journey question with the
// place left in the sentence before it, or in the same breath: "I'm going to
// Starbucks in Murdoch then work, so how long will that take?"
// Told rather than asked counts too: "Haru check the traffic going back to
// home" got "I don't have access to live traffic data. You'd need to check
// Google Maps" (2026-09-17), with her holding both and the ask in plain words.
const BARE_JOURNEY = new RegExp(String.raw`^(?:.*\b)?(?:so\s+)?(?:how long (?:will|would|does|is) (?:that|it|this)(?: take| be)?|is (?:the )?traffic (?:bad|heavy|ok|okay|alright|any good)|how(?:'s|’s|s| is) (?:the )?traffic|what(?:'s|’s|s| is) (?:the )?traffic like|how bad is (?:the )?traffic|(?:is there )?(?:any|much) traffic|(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:check|look up|look at|pull up|get)(?: me)?\s+(?:the |on (?:the )?)?(?:traffic|travel time|drive time|eta)(?: (?:report|update))?)` + TAIL, 'i');
/** Where they said they were off to, in their own words: "going to X", "stopping by X", "off to X". */
export function destinationNamed(text: string): string | null {
 return navigationPolicy('destinationNamed',[text]);
}

/** "pick up the cpu", "the Dianella address" — a thing to do, not a place; the place is an address they gave. */
const ERRAND = /^(?:(?:to )?(?:pick|pick up|grab|collect|fetch|drop off|drop off at|drop)\b|.*\baddress\b)/i;
/** Going home, however they put it: "going back", "heading home", "the way back", "back home". */
// Any wording, as long as it asks about the roads and not something else
// called traffic: after "check the traffic going back to home" came "Haru check
// traffic to get back home", which the anchored BARE_JOURNEY missed again. A
// request (a verb or question word up front, or a question mark) naming
// traffic, the drive time or an eta; statements about the day are not asks.
const ROAD_WORD = /\b(?:traffic|drive time|travel time|eta)\b(?!\s*(?:lights?|cams?|cameras?|signals?|cones?))|\b(?:drive|roads?|commute|trip|ride|journey)\s+(?:back(?: home)?|home)\b/i;
const NOT_ROADS = /\b(?:web ?site|site|web|page|server|network|api|seo|search|organic|google analytics|analytics)\s+traffic\b|\btraffic\s+(?:to|on|for) (?:the |my |our )?(?:web ?site|site|page|server|store page|shop page)\b/i;
const REQUEST = /^(?:(?:hey |ok |oi )?haru[,!.]?\s+)?(?:(?:can|could|would|will) you\s+|please\s+|pls\s+)?(?:check|look|see|find|get|pull|tell|what|what's|whats|how|how's|hows|is|are|any|much)\b|\?\s*$/i;
function asksAboutRoads(line: string): boolean {
  return ROAD_WORD.test(line) && !NOT_ROADS.test(line) && REQUEST.test(line.trim());
}
// "Check again" after a route question is that question, asked again.
const AGAIN = /^(?:(?:hey |ok )?haru[,!.]?\s+)?(?:(?:can you |could you |please )?(?:check|try|look|do(?: it| that)?|ask)(?: it| that| the traffic)? (?:again|now)|again|once more|re-?check(?: it)?|refresh(?: it)?|and now|what about now|how about now)(?: please| pls)?[?.!\s]*$/i;

const HOMEWARD = /\b(?:(?:going|heading|driving|getting|get|head|go|come|coming|on (?:my|the) way|(?:the |my )?(?:way|drive|trip|run))\s+(?:back(?: to)?(?: home)?|(?:to )?home)|back home|(?:traffic|eta|travel time|drive time)\s+(?:back\s+)?(?:to\s+)?home)\b/i;

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
 return navigationPolicy('directionsAskFrom',[latest,recentUser]);
}

/** A place she knows by that name — "home", "the store", "my place" for home. */
export function matchNamedPlace(destination: string, places: Place[]): Place | null {
 return navigationPolicy('matchNamedPlace',[destination,places]);
}

/** Where they are for the purposes of "from here": a fresh fix, else home. */
export function startingPoint(where: Whereabouts, nowMs = Date.now()): { lat: number; lon: number; known: 'here' | 'home' } | null {
 return locationPolicy('startingPoint',[where,nowMs]);
}

/** Apple Maps opens this on an iPhone with the route asked for; the page turns it into Google Maps on anything else. */
export function mapsLink(found: Found): string {
 return navigationPolicy('mapsLink',[found]);
}

export function googleMapsLink(found: Found): string {
 return navigationPolicy('googleMapsLink',[found]);
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
 return navigationPolicy('directionsNote',[ask,found,where,nowMs,road,facts]);
}

// A maps link, as the app writes one under her words — and as she then copied
// it, coordinates invented, once one sat in her own history. The app attaches
// the button; she never types one.
const MAPS_LINK = /\s*\[[^\]\n]*\]\(\s*https?:\/\/(?:maps\.apple\.com|(?:www\.)?google\.com\/maps|maps\.google\.com|goo\.gl\/maps|maps\.app\.goo\.gl)[^)\s]*\)|\s*https?:\/\/(?:maps\.apple\.com|(?:www\.)?google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl)\S*/gi;

/** The text without any maps link in it: her history as she should see it, and her line as she may write it. */
export function withoutMapsLinks(text: string): string {
 return navigationPolicy('withoutMapsLinks',[text]);
}

/** Her words with the button's link under them, as a markdown link the page and the desktop both render. */
export function withDirections(reply: string, found: Found, route?: { minutes: number; typicalMinutes: number; km: number; via: string }): string {
 return navigationPolicy('withDirections',[reply,found,route]);
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
 return navigationPolicy('withoutTrafficDenials',[messages,hasRoute]);
}
