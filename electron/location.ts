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
 return coreFix(line);
}

export function readWindowsLocation(): Promise<Fix> {
 return coreWindowsFix();
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
 return navigationPolicy('blur',[{latitude,longitude}]);
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
 return navigationPolicy('nameFrom',[address]);
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
 return coreNavRemote('reverse',[fix],fetchImpl);
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
 return coreNavRemote('search',[query,near,fallbackPlace,{bounded}],fetchImpl);
}
