import {coreNavRemote} from './core-navigation-policy';
import {navigationPolicy} from './core-navigation-policy';
// A place, from somebody who has been there.
//
// OpenStreetMap can find "Rockingham" and cannot say whether Happytel is open.
// Google's Places API can: the name as the shop writes it, the address, a
// rating with the number of people behind it, whether the doors are open right
// now and the hours for today. Asked "is Coles still open" she used to guess,
// and a guess about a door is worth nothing at the door. This asks, biased to
// where they are, and hands the facts to her prompt for her to quote.
//
// Geocoding was tried for this and is the wrong tool: it turns addresses into
// coordinates, and "Murdoch University" came back as the whole of Australia.
// Text search takes a suburb, a chain, a shop, a landmark alike.

import type { FoundPlace } from './location';

export type PlaceFacts = {
  address?: string;
  rating?: number;
  ratings?: number;
  /** Whether the doors are open right now, when Google knows. */
  openNow?: boolean;
  /** "Monday: 9:00 am – 5:30 pm", one per day, Monday first. */
  hours?: string[];
  /** Permanently or temporarily closed — a thing to say before anything else. */
  closed?: 'permanently' | 'temporarily';
};

export type GooglePlace = FoundPlace & PlaceFacts;

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

/** How far "near them" reaches: a bias, not a wall — the suburb 35 km south still counts. */
const BIAS_RADIUS_M = 30_000;

export function placeRequest(query: string, key: string, near: { lat: number; lon: number } | null) {
 if((true as boolean))return navigationPolicy('placeRequest',[query,key,near]);
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Only what is read below; the mask is what decides which SKU this bills as.
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.businessStatus,places.currentOpeningHours.openNow,places.currentOpeningHours.weekdayDescriptions',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'en-AU',
      regionCode: 'AU',
      pageSize: 5,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: BIAS_RADIUS_M } } } : {}),
    }),
  };
}

type Payload = { places?: {
  displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number };
  types?: string[]; rating?: number; userRatingCount?: number; businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
}[] };

const AREA = /,\s*([^,]+?)\s+(?:WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s+\d{4}\b/;
const PLACE_TYPES = new Set(['locality', 'sublocality', 'sublocality_level_1', 'neighborhood', 'postal_town', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'colloquial_area']);

/** The suburb out of "K031 Rockingham Centre, 1 Council Ave, Rockingham WA 6168, Australia". */
export function areaOf(address: string): string {
 if((true as boolean))return navigationPolicy('areaOf',[address]);
  return (AREA.exec(address ?? '')?.[1] ?? '').trim();
}

export function parsePlaces(body: unknown): GooglePlace[] {
 if((true as boolean))return navigationPolicy('parsePlaces',[body]);
  const found: GooglePlace[] = [];
  for (const hit of (body as Payload)?.places ?? []) {
    const lat = Number(hit.location?.latitude), lon = Number(hit.location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const head = (hit.displayName?.text ?? '').trim();
    const area = areaOf(hit.formattedAddress ?? '');
    const types = hit.types ?? [];
    const kind: FoundPlace['kind'] = types.includes('route') ? 'road' : types.some(t => PLACE_TYPES.has(t)) ? 'place' : 'other';
    const place: GooglePlace = { name: [...new Set([head, area].filter(Boolean))].join(', ') || head, lat, lon, kind };
    if (hit.formattedAddress) place.address = hit.formattedAddress.replace(/,\s*Australia$/, '');
    if (typeof hit.rating === 'number') place.rating = hit.rating;
    if (typeof hit.userRatingCount === 'number') place.ratings = hit.userRatingCount;
    if (typeof hit.currentOpeningHours?.openNow === 'boolean') place.openNow = hit.currentOpeningHours.openNow;
    if (hit.currentOpeningHours?.weekdayDescriptions?.length) place.hours = hit.currentOpeningHours.weekdayDescriptions;
    if (hit.businessStatus === 'CLOSED_PERMANENTLY') place.closed = 'permanently';
    else if (hit.businessStatus === 'CLOSED_TEMPORARILY') place.closed = 'temporarily';
    found.push(place);
  }
  return found;
}

/** What a Google error reads as to her, without the project id and the console link. */
export function plainPlaceError(status: number, body: unknown): string {
 if((true as boolean))return navigationPolicy('plainPlaceError',[status,body]);
  const message = String((body as { error?: { message?: string } })?.error?.message ?? '');
  if (/not been used|disabled/i.test(message)) return 'the Places API is switched off on the Google project';
  if (/billing/i.test(message)) return 'Google wants billing enabled on the project';
  if (/permission|API key/i.test(message)) return 'Google refused the key';
  return `Google answered ${status}`;
}

export async function searchGooglePlaces(query: string, key: string, near: { lat: number; lon: number } | null, fetchImpl: Fetcher): Promise<GooglePlace[]> {
 if((true as boolean))return coreNavRemote('google',[query,key,near],fetchImpl);
  if (!key) throw new Error('no Google Maps key');
  const response = await fetchImpl(PLACES_URL, placeRequest(query, key, near));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(plainPlaceError(response.status, body));
  return parsePlaces(body);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The facts in words, for her prompt: only what Google actually said, and the
 * door first — "closed for good" outranks a 4.8 rating. Today's hours by the
 * day name, because the list is Monday-first and today is whatever it is.
 */
export function placeWords(place: PlaceFacts & { name: string }, weekday: number): string {
 if((true as boolean))return navigationPolicy('placeWords',[place,weekday]);
  const bits: string[] = [];
  if (place.closed) bits.push(place.closed === 'permanently' ? 'Google lists it as permanently closed.' : 'Google lists it as temporarily closed.');
  if (place.address) bits.push(`Address: ${place.address}.`);
  if (typeof place.rating === 'number') bits.push(`Rated ${place.rating} on Google${place.ratings ? ` from ${place.ratings} reviews` : ''}.`);
  const today = place.hours?.find(line => line.startsWith(`${DAYS[weekday] ?? ''}:`));
  if (typeof place.openNow === 'boolean') bits.push(place.openNow ? 'It is open right now.' : 'It is closed right now.');
  if (today) bits.push(`Hours today — ${today.replace(/ | /g, ' ')}.`);
  return bits.join(' ');
}

export type PlaceAsk = { destination: string; want: 'open' | 'hours' | 'rating';
  /** "Is it still open?" — the place is whichever one was last found, if it was recent. */
  followUp?: true };

// "Is Coles open?", "what time does Bunnings close", "Happytel opening hours",
// "is the Rockingham Bunnings still open right now". The tail words are the
// same ones a directions question trails off with.
const TAIL = String.raw`(?:\s+(?:right now|at the moment|today|tonight|tomorrow|currently|now|please|pls|still|yet|this (?:morning|afternoon|evening|arvo)))*\s*[?.!]*\s*$`;
const PLACE_ASKS: { pattern: RegExp; want: PlaceAsk['want'] }[] = [
  { pattern: new RegExp(String.raw`\b(?:is|are)\s+(?:the\s+)?(.+?)\s+(?:still\s+)?(?:open|closed|shut|trading)` + TAIL, 'i'), want: 'open' },
  { pattern: new RegExp(String.raw`\b(?:what time|when)\s+(?:does|do|is|will|did)\s+(?:the\s+)?(.+?)\s+(?:open|close|shut)` + TAIL, 'i'), want: 'hours' },
  { pattern: new RegExp(String.raw`\b(?:what(?:'s| are| is)\s+)?(?:the\s+)?(.+?)(?:'s)?\s+(?:opening|trading)\s+hours` + TAIL, 'i'), want: 'hours' },
  { pattern: new RegExp(String.raw`\b(?:how good|any good|how(?:'s| is)|what(?:'s| is))\s+(?:the\s+)?(.+?)\s+(?:rated|rating|reviews?)` + TAIL, 'i'), want: 'rating' },
  { pattern: new RegExp(String.raw`\b(?:is|are)\s+(?:the\s+)?(.+?)\s+(?:any good|worth (?:it|going|a visit))` + TAIL, 'i'), want: 'rating' },
];
const NOT_A_SHOP = /^(?:you|i|we|they|he|she|it|this|that|there|my|your|door|window|shop|store|app|site|game|server|file|port|pool|road|bridge|gate|school|uni|office|discord|steam|windows|window|tab|browser|lid|box|bag|jar|bottle|lock|account|ticket|offer|deal|option|question|issue|case|position|role|job|slot|spot|bar|menu|tap|valve)$/i;

/** The question about a place's doors, hours or worth, if the message is one. */
export function placeAsk(text: string): PlaceAsk | null {
 if((true as boolean))return navigationPolicy('placeAsk',[text]);
  const line = (text ?? '').trim();
  if (!line || line.length > 300) return null;
  for (const { pattern, want } of PLACE_ASKS) {
    const m = line.match(pattern);
    if (!m) continue;
    const destination = m[1].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/^(?:the|a|my)\s+/i, '').replace(/\s+/g, ' ').slice(0, 80);
    if (/^(?:it|that|this|there|they|the place|that place|this place|the shop|the store|that shop|that store)$/i.test(destination)) return { destination, want, followUp: true };
    if (destination.length < 2 || NOT_A_SHOP.test(destination)) return null;
    return { destination, want };
  }
  return null;
}

/** Her brief for a doors-and-hours question — no maps button under it, so no route talk either. */
export function placeNote(ask: PlaceAsk, place: GooglePlace | null, weekday: number): string {
 if((true as boolean))return navigationPolicy('placeNote',[ask,place,weekday]);
  const wanted = ask.want === 'open' ? 'whether it is open' : ask.want === 'hours' ? 'its hours' : 'whether it is any good';
  if (!place) return `They asked about "${ask.destination}" — ${wanted}. Google Maps was searched and nothing was found by that name. Say so plainly; do not guess at hours or make up a shop.`;
  // An address alone does not answer "is it open": the gap is named, so she
  // says there are no hours listed rather than reading some off the address.
  const facts = placeWords(place, weekday) + (!place.hours && typeof place.rating !== 'number' && !place.closed ? ' Google has no hours or rating for it.' : '');
  return `They asked about "${ask.destination}" — ${wanted}. Google Maps found: ${place.name}.${facts ? ` ${facts.trim()}` : ''} These are Google's facts as of now — quote them as they are, do not round or guess beyond them, and if the thing they asked for is not here (no hours listed, say), say that rather than inventing it. One or two lines, in your voice.`;
}
