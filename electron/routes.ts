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
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Only what is read below: the field mask is what keeps this on the cheap SKU.
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      languageCode: 'en-AU',
      units: 'METRIC',
    }),
  };
}

export function parseRoute(body: unknown): Route | null {
  const route = (body as { routes?: { duration?: string; staticDuration?: string; distanceMeters?: number; description?: string }[] })?.routes?.[0];
  if (!route || typeof route.duration !== 'string') return null;
  const seconds = (value?: string) => Number((value ?? '').replace(/s$/, ''));
  const now = seconds(route.duration);
  if (!Number.isFinite(now)) return null;
  const typical = Number.isFinite(seconds(route.staticDuration)) && route.staticDuration ? seconds(route.staticDuration) : now;
  return {
    minutes: Math.max(1, Math.round(now / 60)),
    typicalMinutes: Math.max(1, Math.round(typical / 60)),
    km: Math.round((Number(route.distanceMeters ?? 0) / 1000) * 10) / 10,
    via: String(route.description ?? '').trim(),
  };
}

/** What a Google error reads as to her, without the project id and the console link. */
export function plainRouteError(status: number, body: unknown): string {
  const message = String((body as { error?: { message?: string } })?.error?.message ?? '');
  if (/not been used|disabled/i.test(message)) return 'the Routes API is switched off on the Google project';
  if (/billing/i.test(message)) return 'Google wants billing enabled on the project';
  if (/permission|API key/i.test(message)) return 'Google refused the key';
  return `Google answered ${status}`;
}

export async function computeRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }, key: string, fetchImpl: Fetcher): Promise<Route> {
  if (!key) throw new Error('no Google Maps key');
  const response = await fetchImpl(ROUTES_URL, routeRequest(from, to, key));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(plainRouteError(response.status, body));
  const route = parseRoute(body);
  if (!route) throw new Error('Google found no road between them');
  return route;
}

/**
 * The road in words, for her prompt. The traffic is said only when it is
 * worth saying — a couple of minutes either way is not news — and the typical
 * time is given whenever the live one is slower, so "how's the traffic" has a
 * real answer in it.
 */
export function routeWords(route: Route, fromWhere: 'here' | 'home'): string {
  const from = fromWhere === 'here' ? 'from where they are' : 'from home';
  const slow = route.minutes >= route.typicalMinutes * 1.2 && route.minutes - route.typicalMinutes >= 4;
  const quick = route.typicalMinutes >= route.minutes * 1.2 && route.typicalMinutes - route.minutes >= 4;
  const traffic = slow ? ` — slower than usual (${route.typicalMinutes} on a normal day), so the traffic is heavy`
    : quick ? ` — quicker than usual (${route.typicalMinutes} on a normal day), the roads are clear`
    : ', about the same as a normal day';
  return `By car it is ${route.minutes} minutes ${from} right now${traffic}; ${route.km} km${route.via ? `, via ${route.via}` : ''}. These numbers are from Google with live traffic, as of now — quote them as they are, do not round them into a guess, and say nothing about the road beyond them.`;
}

/**
 * Her stated numbers, made Google's. Told 18 minutes via Alexander Drive she
 * still wrote "about 10 minutes via Stirling Hwy" — her own guess from an
 * hour earlier, sitting in the history. The minutes, the distance and the
 * roads she names are replaced with the route's; the rest of the line is hers.
 */
export function fixStatedRoute(reply: string, route: Route): string {
  let out = reply.replace(/\b(?:(?:about|around|roughly|approximately|maybe|some|under|over|nearly|almost)\s+)?(\d{1,3})(?:\s*(?:-|–|to)\s*\d{1,3})?\s*(?:min|mins|minutes)\b/gi,
    (m, n) => (Number(n) === route.minutes ? m : `${route.minutes} minutes`));
  out = out.replace(/\b(?:(?:about|around|roughly)\s+)?(?:half an hour|an hour|an hour and a half|two hours)\b/gi, m => {
    const said = /half an hour/i.test(m) ? 30 : /and a half/i.test(m) ? 90 : /two/i.test(m) ? 120 : 60;
    return Math.abs(said - route.minutes) <= 3 ? m : `${route.minutes} minutes`;
  });
  out = out.replace(/\b(?:(?:about|around|roughly)\s+)?(\d{1,3}(?:\.\d)?)\s*(?:km|kms|kilometres|kilometers)\b/gi,
    (m, n) => (Math.abs(Number(n) - route.km) < 0.6 ? m : `${route.km} km`));
  // "45 minutes to an hour" is two numbers made one twice over.
  out = out.replace(new RegExp(`${route.minutes} minutes\\s*(?:-|–|to|or)\\s*${route.minutes} minutes`, 'gi'), `${route.minutes} minutes`);
  if (route.via) out = out.replace(/\bvia\s+[^.,;!?\n]+/gi, m => (m.slice(4).trim().toLowerCase() === route.via.toLowerCase() ? m : `via ${route.via}`));
  return out;
}

