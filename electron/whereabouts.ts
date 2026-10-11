import {locationPolicy,toldPolicy,locationClock} from './core-location-policy';
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
 return locationPolicy('readSpot',[body,now.toISOString()]);
}

export function readWhereabouts(saved: unknown): Whereabouts {
 return locationPolicy('readWhereabouts',[saved]);
}

/** Great-circle distance in metres. Haversine: accurate to a metre over any distance a phone walks. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
 return locationPolicy('distanceM',[a,b]);
}

/**
 * The place a spot is at, or nothing. The nearest one whose radius reaches the
 * spot — a fix's own uncertainty widens the net a little, so a rough reading
 * taken at home still says home, but a reading too rough to trust (a cell
 * tower's idea of where a phone is) names nothing rather than the wrong thing.
 */
export function placeAt(places: Place[], spot: { lat: number; lon: number; accuracy?: number }): Place | null {
 return locationPolicy('placeAt',[places,spot]);
}

export function homeOf(places: Place[]): Place | null {
 return locationPolicy('homeOf',[places]);
}

/** The latest word from the phone, kept. */
export function absorb(state: Whereabouts, spot: Spot): Whereabouts {
 return locationPolicy('absorb',[state,spot]);
}

/**
 * Where they are standing, given a name. The same name again moves the place
 * here (they were wrong the first time, or moved house); the radius takes the
 * fix's accuracy so a rough fix makes a wide place rather than a place the next
 * fix falls outside of.
 */
export function namePlace(state: Whereabouts, rawName: string, now = new Date()): Whereabouts {
 return locationPolicy('namePlace',[state,rawName,now.toISOString()]);
}

export function forgetPlace(state: Whereabouts, name: string): Whereabouts {
 return locationPolicy('forgetPlace',[state,name]);
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
 return locationPolicy('describeWhereabouts',[state,nowMs]);
}

/** What the page is told: names, never numbers. */
export function whereForPage(state: Whereabouts, nowMs = Date.now()): { enabled: boolean; at: string | null; fresh: boolean; net: NetKind | null; places: string[] } {
 return locationPolicy('whereForPage',[state,nowMs]);
}

/** Where the phone found them, when they had not said they were going. */
export type Arrival = { place: string; at: string };

/** How long an arrival is still news worth a word. */
export const ARRIVAL_FRESH_MS = 3 * 60 * 60_000;

// Words that name no place on their own: "the shop" and "the house" are half
// the places anyone has, and matching on them would call every arrival
// announced.
const VAGUE = new Set(['the', 'and', 'for', 'shop', 'store', 'house', 'place', 'centre', 'center', 'building', 'street', 'road']);

/**
 * Did they say themselves that they were going there?
 *
 * Their words only. She told him to go home and he went; that is her sentence,
 * not his, and being told by her own suggestion is not being told. Home is
 * matched loosely because it is said a dozen ways; anywhere else has to be
 * named, since the alternative is her complaining about a trip she was told
 * about in words this could not match.
 */
export function saidTheyWereGoing(place: string, said: string[]): boolean {
 return locationPolicy('saidTheyWereGoing',[place,said]);
}

/**
 * What she has to say about finding out from the phone.
 *
 * Deliberately an annoyance and not a question: she knows where they are, so
 * asking would be theatre. The complaint is that she was not told.
 */
export function unannouncedArrivalNote(arrival: Arrival | null | undefined, nowMs: number, clockNow: (ms: number) => string): string {
 return locationPolicy('unannouncedArrivalNote',[arrival,nowMs,locationClock(arrival,clockNow)]);
}

/**
 * The history without her claims that she cannot see where they are, once she can.
 *
 * The same finding as the traffic denials (withoutTrafficDenials in
 * directions.ts) and the reminder denials before those: she copies what she can
 * see over what she is told. On 2026-09-07 she answered "how come you can't see
 * my screen or where I am" with "I just can't. That's how I'm built… No location
 * tracking, no screen peeking, no secret camera in your pocket" — while tracking
 * was switched on, her store held a fix accurate to fourteen metres from seven
 * minutes earlier, and three of her own replies further up the same transcript
 * read "You're at The PC Project, as your phone says". Two prompt lines invited
 * the first denial; this stops the denial teaching the next one.
 *
 * Gated the same way: only while she actually has a fresh fix, so a denial made
 * on a night when the phone had told her nothing is true and stays.
 */
const CANT_SEE_WHERE = /\b(?:can'?t|cannot|don'?t|do not|unable to|no way to) (?:see|know|track|access|tell|check|find)\b[^.!?\n]{0,40}\b(?:where you are|where they are|your location|their location|location)\b|\bno location (?:tracking|access|data|services?)\b|\bdon'?t have (?:access to )?(?:your |their )?location\b|\bnot? (?:tracking|track) (?:your|their) (?:location|whereabouts|phone)\b/i;

export function withoutWhereDenials<T extends { role: string; content: string }>(messages: T[], knowsWhere: boolean): T[] {
 return locationPolicy('withoutWhereDenials',[messages,knowsWhere]);
}

// Somewhere she already knows they regularly are.
//
// saidTheyWereGoing asks whether they announced the trip. It is the wrong
// question for a routine: nobody announces their own shift every week, and she
// has it written down three times over — "Tommy works at Happytel Rockingham
// every Sunday from 12-4:30pm only". On Sunday 2026-09-20 his phone reached
// Happytel at 12:21, theirWordsLately reached back only three hours and his
// last word on it was three hours and thirty-eight minutes old, so she filed it
// as a slight and put her irritation from nothing to a third of the way up —
// which is what made the 12:21 notification read "you didn't have the decency
// to tell me". Left alone it fires again every Sunday at noon.
//
// Only a memory that says the place AND says it is regular counts, and when it
// names the days, today has to be one of them. A memory that merely mentions a
// place they went once is no licence.

// "on Thursdays" is a routine; "on Thursday" is a day something happened, and
// read as a routine it excused an arrival home every Thursday on the strength
// of "They started admin work from home on Thursday". The plural is the tell.
const REGULAR = /\b(every|each|usually|always|regularly|weekly|on\s+\w+days\b|works?\s+(?:at|in)|working\s+(?:at|in)|during the week|weekends?|weekdays?)\b/i;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKEND = new Set(['saturday', 'sunday']);

/**
 * Whether what she knows about them puts them at this place today.
 *
 * `weekday` is the local day name, lower case — "sunday". `known` is the text
 * of what she remembers; anything that is not about a routine is ignored.
 */
export function knownHaunt(place: string, known: string[], weekday: string): boolean {
 return locationPolicy('knownHaunt',[place,known,weekday]);
}
