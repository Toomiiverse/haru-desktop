import {coreNavRemote} from './core-navigation-policy';
import {navigationPolicy} from './core-navigation-policy';
// The road, from somebody who can see it.
//
// Asked how long to Rockingham she said "forty-five minutes to an hour" for a
// half-hour drive, and asked about the traffic she said "fine". She had a
// straight-line distance and a maps button, and nothing about the road. Google's
// Routes API has the road, with live traffic, and gives back a duration now and
// a duration on a normal day — which is the whole of what "how long" and
// "how's the traffic" are asking.
//
// Always between coordinates. "Murdoch University, WA" as a bare string was
// routed a thousand kilometres north; her phone and her named places are
// already coordinates, and the destination has been geocoded by the time this
// runs. She quotes what came back and nothing else.

export type Route = {
  /** With traffic as it is now. */
  minutes: number;
  /** On a normal day. */
  typicalMinutes: number;
  km: number;
  /** The main roads, as Google names them. */
  via: string;
};

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

export function routeRequest(from: { lat: number; lon: number }, to: { lat: number; lon: number }, key: string) {
 return navigationPolicy('routeRequest',[from,to,key]);
}

export function parseRoute(body: unknown): Route | null {
 return navigationPolicy('parseRoute',[body]);
}

/** What a Google error reads as to her, without the project id and the console link. */
export function plainRouteError(status: number, body: unknown): string {
 return navigationPolicy('plainRouteError',[status,body]);
}

export async function computeRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }, key: string, fetchImpl: Fetcher): Promise<Route> {
 return coreNavRemote('route',[from,to,key],fetchImpl);
}

/**
 * The road in words, for her prompt. The traffic is said only when it is
 * worth saying — a couple of minutes either way is not news — and the typical
 * time is given whenever the live one is slower, so "how's the traffic" has a
 * real answer in it.
 */
export function routeWords(route: Route, fromWhere: 'here' | 'home'): string {
 return navigationPolicy('routeWords',[route,fromWhere]);
}

/**
 * Her stated numbers, made Google's. Told 18 minutes via Alexander Drive she
 * still wrote "about 10 minutes via Stirling Hwy" — her own guess from an
 * hour earlier, sitting in the history. The minutes, the distance and the
 * roads she names are replaced with the route's; the rest of the line is hers.
 */
export function fixStatedRoute(reply: string, route: Route): string {
 return navigationPolicy('fixStatedRoute',[reply,route]);
}

