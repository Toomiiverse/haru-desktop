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
