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
 return navigationPolicy('placeRequest',[query,key,near]);
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
 return navigationPolicy('areaOf',[address]);
}

export function parsePlaces(body: unknown): GooglePlace[] {
 return navigationPolicy('parsePlaces',[body]);
}

/** What a Google error reads as to her, without the project id and the console link. */
export function plainPlaceError(status: number, body: unknown): string {
 return navigationPolicy('plainPlaceError',[status,body]);
}

export async function searchGooglePlaces(query: string, key: string, near: { lat: number; lon: number } | null, fetchImpl: Fetcher): Promise<GooglePlace[]> {
 return coreNavRemote('google',[query,key,near],fetchImpl);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The facts in words, for her prompt: only what Google actually said, and the
 * door first — "closed for good" outranks a 4.8 rating. Today's hours by the
 * day name, because the list is Monday-first and today is whatever it is.
 */
export function placeWords(place: PlaceFacts & { name: string }, weekday: number): string {
 return navigationPolicy('placeWords',[place,weekday]);
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
 return navigationPolicy('placeAsk',[text]);
}

/** Her brief for a doors-and-hours question — no maps button under it, so no route talk either. */
export function placeNote(ask: PlaceAsk, place: GooglePlace | null, weekday: number): string {
 return navigationPolicy('placeNote',[ask,place,weekday]);
}
