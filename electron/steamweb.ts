// What Steam says they have been playing.
//
// Read-only, and never their login. Steam's Web API answers for any profile
// whose game details are public, given an API key the account holder makes at
// steamcommunity.com/dev/apikey and the account's 64-bit id. That is a key and
// a number in config, not a password and a Steam Guard code handed to a model
// running unattended at three in the morning — which was asked for, and is the
// one form of this that should not exist.

import type { SteamRecent } from './gamenight';

export type SteamWebConfig = { steamId: string };

export function readSteamWebConfig(saved: unknown): SteamWebConfig {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const steamId = typeof record.steamId === 'string' && /^\d{17}$/.test(record.steamId.trim()) ? record.steamId.trim() : '';
  return { steamId };
}

export function recentlyPlayedUrl(key: string, steamId: string): string {
  const url = new URL('https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/');
  url.searchParams.set('key', key);
  url.searchParams.set('steamid', steamId);
  url.searchParams.set('format', 'json');
  return url.toString();
}

/** The shape Steam answers with, reduced to what the night needs. */
export function parseRecentlyPlayed(body: unknown): SteamRecent[] {
  const games = (body as { response?: { games?: unknown } })?.response?.games;
  if (!Array.isArray(games)) return [];
  return games
    .map(game => game as { name?: unknown; playtime_2weeks?: unknown })
    .filter(game => typeof game.name === 'string' && game.name.trim())
    .map(game => ({ name: (game.name as string).trim(), minutesLastFortnight: Math.max(0, Math.round(Number(game.playtime_2weeks ?? 0)) || 0) }));
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function recentlyPlayed(key: string, config: SteamWebConfig, fetchImpl: Fetcher): Promise<SteamRecent[]> {
  if (!key || !config.steamId) return [];
  const response = await fetchImpl(recentlyPlayedUrl(key, config.steamId));
  if (!response.ok) throw new Error(response.status === 403 ? 'Steam refused the key.' : response.status === 401 ? 'Steam does not know that key.' : `Steam answered ${response.status}.`);
  return parseRecentlyPlayed(await response.json());
}
