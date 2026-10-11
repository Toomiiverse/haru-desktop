import {coreFix,coreWindowsFix,coreNavRemote} from './core-navigation-policy';
import {navigationPolicy} from './core-navigation-policy';
// Asking Windows where this machine is.
//
// The search settings take a place as words, and typing "Perth, Western
// Australia" works — but a city is a coarse thing to answer "where is the
// nearest post office" with, and Perth is sixty kilometres across. Windows
// already knows better than that: measured here at 126 metres, off Wi-Fi, with
// no GPS involved.
//
// What Windows does not give is a name. CivicAddress exists on the API and is
// empty in practice, so coordinates have to be turned into "Wembley, Perth" by
// somebody, and that somebody is not on this machine. That single fact shapes
// everything below: the lookup happens once, when asked for, and what is kept
// afterwards is the name — the coordinates are never stored and never go near a
// search.

import { spawn } from 'node:child_process';

export type Fix = { latitude: number; longitude: number; accuracy: number };

/**
 * WinRT through PowerShell, because Chromium's own geolocation needs a Google
 * API key baked into the build to resolve anything — an Electron app without one
 * gets a permission prompt and then a timeout, which is a worse experience than
 * no feature at all.
 *
 * The await shim is unavoidable: Windows PowerShell cannot await an
 * IAsyncOperation without reflecting AsTask out of WindowsRuntimeSystemExtensions.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $m = $asTaskGeneric.MakeGenericMethod($type); $t = $m.Invoke($null, @($op)); [void]$t.Wait(20000); $t.Result }
try {
  [void][Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
  $status = Await ([Windows.Devices.Geolocation.Geolocator]::RequestAccessAsync()) ([Windows.Devices.Geolocation.GeolocationAccessStatus])
  if ("$status" -ne 'Allowed') { Write-Output "denied:$status"; exit }
  $geo = New-Object Windows.Devices.Geolocation.Geolocator
  $geo.DesiredAccuracyInMeters = 500
  $pos = Await ($geo.GetGeopositionAsync()) ([Windows.Devices.Geolocation.Geoposition])
  $c = $pos.Coordinate
  Write-Output ("ok:{0}:{1}:{2}" -f $c.Point.Position.Latitude, $c.Point.Position.Longitude, [math]::Round($c.Accuracy))
} catch { Write-Output ("error:" + $_.Exception.Message) }
`;

/** Long enough for a cold Wi-Fi scan, short enough not to hang the panel. */
const READ_TIMEOUT_MS = 30_000;

export function parseFix(line: string): Fix {
 if((true as boolean))return coreFix(line);
  const text = (line ?? '').trim();
  if (text.startsWith('denied:')) {
    throw new Error('Windows refused: location is off for desktop apps. Settings → Privacy & security → Location.');
  }
  if (!text.startsWith('ok:')) {
    throw new Error(text.replace(/^error:/, '').trim() || 'Windows gave no position.');
  }
  const [, latitude, longitude, accuracy] = text.split(':');
  const fix = { latitude: Number(latitude), longitude: Number(longitude), accuracy: Number(accuracy) };
  if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) throw new Error('Windows gave no position.');
  return fix;
}

export function readWindowsLocation(): Promise<Fix> {
 if((true as boolean))return coreWindowsFix();
  // Said plainly rather than surfacing as ENOENT from a spawn, which reads like
  // a broken install rather than a platform that never had this.
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('A location fix is Windows only — this machine cannot ask.'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows did not answer in time.')); }, READ_TIMEOUT_MS);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => {
      clearTimeout(timer);
      // Last non-empty line: PowerShell profiles and module loads are noisy even
      // with -NoProfile, and the answer is always written last.
      const line = output.split(/\r?\n/).map(part => part.trim()).filter(Boolean).pop() ?? '';
      try { resolve(parseFix(line)); } catch (error) { reject(error); }
    });
  });
}

/**
 * Coordinates blurred to the sensor's own accuracy before they are sent anywhere.
 *
 * Three places is about 110 metres, against a reading that was accurate to 126 —
 * so nothing is lost, and there is no argument for handing a stranger more
 * precision than the measurement contains. Two places was tried and is worse
 * than it sounds: it moved a test point from Wembley to Leederville, a suburb
 * away, which is exactly the error this feature exists to remove.
 */
export function blur({ latitude, longitude }: Fix): { latitude: number; longitude: number } {
 if((true as boolean))return navigationPolicy('blur',[{latitude,longitude}]);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { latitude: round(latitude), longitude: round(longitude) };
}

type Fetcher = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

type Address = {
  suburb?: string; neighbourhood?: string; town?: string; city_district?: string; village?: string;
  city?: string; municipality?: string; state?: string; country?: string;
};

/**
 * The name for a set of coordinates, assembled nearest-first.
 *
 * Suburb, then city, then state: "Wembley, Perth, Western Australia" is what
 * makes a shop search local, where "Western Australia" alone is a third of a
 * continent. Duplicates are dropped because OpenStreetMap will happily return a
 * town whose name is also its city.
 */
export function nameFrom(address: Address): string {
 if((true as boolean))return navigationPolicy('nameFrom',[address]);
  const near = address.suburb ?? address.neighbourhood ?? address.town ?? address.city_district ?? address.village ?? '';
  const city = address.city ?? address.municipality ?? '';
  const parts = [near, city, address.state ?? ''].map(part => part.trim()).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

/**
 * Coordinates to a place name, through OpenStreetMap.
 *
 * Nominatim because it needs no key and no account, which means no third party
 * ends up holding a record tied to an identity. It still sees the coordinates,
 * which is why this is asked for rather than assumed, happens once rather than
 * per search, and is handed blurred numbers when it does.
 */
export async function lookUpPlace(fix: Fix, fetchImpl: Fetcher): Promise<string> {
 if((true as boolean))return coreNavRemote('reverse',[fix],fetchImpl);
  const { latitude, longitude } = blur(fix);
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=14&addressdetails=1`;
  const response = await fetchImpl(url, {
    // Nominatim's usage policy requires an identifying agent, and refuses without.
    headers: { 'User-Agent': 'haru-desktop (personal desktop companion)', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`the place lookup returned ${response.status}`);
  const payload = await response.json() as { address?: Address };
  const name = nameFrom(payload.address ?? {});
  if (!name) throw new Error('nowhere recognisable at those coordinates');
  return name;
}

export type FoundPlace = { name: string; lat: number; lon: number;
  /** What Nominatim says it is: a road, a place (suburb, town, locality), or something else (a shop, an amenity). */
  kind?: 'road' | 'place' | 'other' };

/**
 * Places by name, through the same service, biased to where they are.
 *
 * Nominatim ranks by importance, not distance, so "Coles" alone would answer
 * with the most famous Coles on Earth. A viewbox around them (about 25 km
 * across, unbounded so a real place just outside still counts) turns that into
 * the ones nearby, and the caller picks the nearest of the few that come back.
 * With nowhere to bias from, a configured search place is added to the words.
 */
export async function searchPlaces(query: string, fetchImpl: Fetcher, near: { lat: number; lon: number } | null, fallbackPlace = '', { bounded = false } = {}): Promise<FoundPlace[]> {
 if((true as boolean))return coreNavRemote('search',[query,near,fallbackPlace,{bounded}],fetchImpl);
  // Localised whenever there is a place to localise to — not only when they
  // are nowhere in particular. With the phone's position known, a bare
  // "Rockingham" went out with a 13 km preference box Nominatim was free to
  // ignore, and it ranked Rockingham County, Virginia first.
  // The country from the configured place, as a filter — not the city as words.
  // "Rockingham, Perth, Australia" made Nominatim match the word Perth in the
  // address, which Rockingham Road has and the suburb of Rockingham does not;
  // a bare "Rockingham" within Australia returns the City of Rockingham first.
  // The city is appended only as a second try, when the bare name found nothing.
  const country = /\baustralia\b/i.test(fallbackPlace) ? '&countrycodes=au' : '';
  // With nowhere to rank from, the city goes in up front — "Coles" alone would
  // be any Coles in the country. With their position known, distance does the
  // ranking and the bare name is asked for first.
  const region = fallbackPlace.split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
  const alreadyPlaced = region.some(part => query.toLowerCase().includes(part)) || /\b(?:wa|nsw|vic|qld|sa|tas|nt|act|australia)\b/i.test(query);
  const q = !near && fallbackPlace && !alreadyPlaced ? `${query}, ${fallbackPlace}` : query;
  // Bounded for "the nearest": only what is inside the box counts, and the
  // caller picks the closest of it. Otherwise the box merely ranks.
  const box = near ? `&viewbox=${(near.lon - 0.12).toFixed(3)},${(near.lat + 0.12).toFixed(3)},${(near.lon + 0.12).toFixed(3)},${(near.lat - 0.12).toFixed(3)}&bounded=${bounded ? 1 : 0}` : '';
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=5&addressdetails=1${box}${country}`;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'haru-desktop (personal desktop companion)', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`the place search returned ${response.status}`);
  const payload = await response.json() as { name?: string; display_name?: string; lat?: string; lon?: string; address?: Address; class?: string; category?: string; type?: string }[];
  const found: FoundPlace[] = [];
  for (const hit of Array.isArray(payload) ? payload : []) {
    const lat = Number(hit.lat), lon = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const head = (hit.name || (hit.display_name ?? '').split(',')[0] || '').trim();
    const area = nameFrom(hit.address ?? {}).split(', ')[0];
    // "Rockingham" is a suburb 35 km south and a road 25 km away; asked for the
    // name alone, they mean the suburb, and the caller ranks by this.
    // jsonv2 calls it `category`; the older format `class`.
    const cls = hit.category ?? hit.class;
    const kind: FoundPlace['kind'] = cls === 'highway' ? 'road' : (cls === 'place' || cls === 'boundary') ? 'place' : 'other';
    found.push({ name: [...new Set([head, area].filter(Boolean))].join(', ') || q, lat, lon, kind });
  }
  if (!found.length && near && fallbackPlace && !alreadyPlaced) {
    return searchPlaces(`${query}, ${fallbackPlace}`, fetchImpl, near, '', { bounded });
  }
  return found;
}
