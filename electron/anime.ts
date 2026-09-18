// "Let's watch some Naruto": on if it is here, fetched if it is not.
//
// One ask, three servers. Jellyfin knows what is on the box and where he is up
// to; if the show is there, the next unwatched episode goes on whatever Jellyfin
// player is open. If it is not, Prowlarr searches Nyaa, one release is picked
// here (subtitled, fits the disk, covers the episode he needs), Prowlarr hands
// it to qBittorrent under Sonarr's category, and Sonarr files it under the right
// show once it lands. Every step reports what actually happened; she only puts
// it into words, so she cannot say a download started when it did not — the
// same failure as the reschedule she claimed and never made (2026-09-14).
//
// Why not Sonarr's own search: measured 2026-09-18, its interactive search for
// Naruto season 1 had not answered after two minutes, while Prowlarr answered
// the same question in one second. And Sonarr cannot on its own map a
// whole-series pack titled "Naruto Complete (001-220)" to Naruto — it reads the
// show's name as "Naruto Complete" — so the import has to be told which show it
// is anyway, which is what the import step (animefetch.ts) does.
//
// Why the picker is not TRaSH's: its tiers want the original Blu-ray encodes,
// 187 to 350 GB for Naruto, and list every group that makes a 60 GB version as
// low quality. On a 450 GB disk that he also lives on, the 60 GB version is the
// right answer, so "LQ group" is a small penalty here and not a veto. The vetoes
// are the ones that make an episode unwatchable: AV1 (nothing in the house
// plays it), raws, dubs-only, and subtitles in a language he does not read.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ImportCandidate, ImportFile } from './animefetch';

export type AnimeConfig = {
  enabled: boolean;
  sonarr: { url: string; apiKeyFile: string };
  prowlarr: { url: string; apiKeyFile: string };
  /** Where Sonarr keeps what she fetches, and the quality profile it is filed under, by name. */
  rootFolder: string;
  profile: string;
  /** Free space to leave on the disk. A fetch that would eat into it needs their word first. */
  keepFreeGb: number;
  /** The address her links use, when the server's own address only works from the box. */
  linkUrl: string;
};

const STACK = path.join(homedir(), 'anime-server');

export const DEFAULT_ANIME: AnimeConfig = {
  enabled: false,
  sonarr: { url: 'http://127.0.0.1:8989', apiKeyFile: path.join(STACK, 'sonarr', 'config', 'config.xml') },
  prowlarr: { url: 'http://127.0.0.1:9696', apiKeyFile: path.join(STACK, 'prowlarr', 'config', 'config.xml') },
  rootFolder: '/data/media/anime',
  profile: '[Anime] Remux-1080p',
  keepFreeGb: 50,
  linkUrl: '',
};

const text = (value: unknown, fallback: string): string => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
const trimSlash = (url: string) => url.replace(/\/+$/, '');

export function readAnimeConfig(saved: unknown): AnimeConfig {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_ANIME };
  const record = saved as Record<string, unknown>;
  const sonarr = (record.sonarr ?? {}) as Record<string, unknown>;
  const prowlarr = (record.prowlarr ?? {}) as Record<string, unknown>;
  const keep = typeof record.keepFreeGb === 'number' && Number.isFinite(record.keepFreeGb) ? Math.max(0, record.keepFreeGb) : DEFAULT_ANIME.keepFreeGb;
  return {
    enabled: record.enabled === true,
    sonarr: { url: trimSlash(text(sonarr.url, DEFAULT_ANIME.sonarr.url)), apiKeyFile: text(sonarr.apiKeyFile, DEFAULT_ANIME.sonarr.apiKeyFile) },
    prowlarr: { url: trimSlash(text(prowlarr.url, DEFAULT_ANIME.prowlarr.url)), apiKeyFile: text(prowlarr.apiKeyFile, DEFAULT_ANIME.prowlarr.apiKeyFile) },
    rootFolder: text(record.rootFolder, DEFAULT_ANIME.rootFolder),
    profile: text(record.profile, DEFAULT_ANIME.profile),
    keepFreeGb: keep,
    linkUrl: trimSlash(text(record.linkUrl, '')),
  };
}

/**
 * The key out of a Servarr app's own config.xml.
 *
 * Read from the app's file rather than pasted into hers: the stack and she live
 * on the same box, and a second copy is a second place it can go stale or leak.
 * Empty when the file is not there, which is a switched-off feature and not a
 * broken one.
 */
export function apiKeyFrom(file: string, readFile: (file: string, encoding: 'utf8') => string = (at, encoding) => readFileSync(at, encoding)): string {
  try {
    const match = /<ApiKey>([^<]+)<\/ApiKey>/.exec(readFile(file, 'utf8'));
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

// -- what the servers say ----------------------------------------------------

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

type JellyfinItem = { Id: string; Name: string; ProductionYear?: number; SeriesName?: string; SeriesId?: string; ParentIndexNumber?: number; IndexNumber?: number; UserData?: { Played?: boolean } };
type JellyfinSession = { Id: string; Client?: string; DeviceName?: string; DeviceId?: string; SupportsRemoteControl?: boolean; LastActivityDate?: string; NowPlayingItem?: { Name?: string; SeriesName?: string } };
type SonarrSeries = { id: number; title: string; tvdbId: number; monitored: boolean; year?: number; statistics?: { episodeFileCount?: number; episodeCount?: number } };
type SonarrLookup = { title: string; tvdbId: number; year?: number; status?: string; seriesType?: string; seasons?: { seasonNumber: number }[] } & Record<string, unknown>;
type SonarrEpisode = { id: number; seasonNumber: number; episodeNumber: number; absoluteEpisodeNumber?: number; hasFile: boolean; title?: string };
type SonarrParse = { parsedEpisodeInfo?: { seriesTitle?: string; absoluteEpisodeNumbers?: number[]; episodeNumbers?: number[]; seasonNumber?: number; fullSeason?: boolean; quality?: { quality?: { name?: string } } } | null; customFormats?: { name: string }[] };
type SonarrQueueItem = { title?: string; status?: string; trackedDownloadStatus?: string; trackedDownloadState?: string; size?: number; sizeleft?: number; timeleft?: string; downloadId?: string; seriesId?: number; errorMessage?: string };
export type ProwlarrRelease = { guid: string; indexerId: number; title: string; size?: number; seeders?: number; infoHash?: string; publishDate?: string };

/** A fetch she started, kept so "how's Naruto going" and the import step can find it. */
export type Fetch = {
  title: string;
  seriesId: number;
  tvdbId: number;
  release: string;
  /** Lowercase; Sonarr's queue carries it upper. Empty when the indexer gave none. */
  infoHash: string;
  sizeBytes: number;
  episodes: number;
  grabbedAt: string;
  /** Set by the import step once Sonarr has filed it. */
  importedAt?: string;
};

export type Keys = { jellyfinUrl: string; jellyfinUserId: string; jellyfinKey: string; sonarrKey: string; prowlarrKey: string };

const QUICK_MS = 15_000;
/** Nyaa through Prowlarr answered in a second on 2026-09-18; the allowance is for a bad night. */
const SEARCH_MS = 25_000;

export function normaliseTitle(title: string): string {
  return (title ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Which of the candidates they mean, or the shortlist to ask about.
 *
 * "Naruto" against Naruto, Naruto Shippuden and Boruto: the exact title wins
 * outright, because that is what they said. Without an exact match, one
 * candidate that starts with what they said is taken; more than one is a
 * question for them, not a guess — a wrong guess here is 60 GB of the wrong
 * show.
 */
export function matchTitle<T extends { title: string }>(wanted: string, candidates: T[]): { one: T } | { several: T[] } | null {
  const want = normaliseTitle(wanted);
  if (!want || !candidates.length) return null;
  const exact = candidates.filter(item => normaliseTitle(item.title) === want);
  if (exact.length) return { one: exact[0] };
  const starts = candidates.filter(item => normaliseTitle(item.title).startsWith(want));
  if (starts.length === 1) return { one: starts[0] };
  if (starts.length > 1) return { several: starts.slice(0, 4) };
  const contains = candidates.filter(item => ` ${normaliseTitle(item.title)} `.includes(` ${want} `));
  if (contains.length === 1) return { one: contains[0] };
  if (contains.length > 1) return { several: contains.slice(0, 4) };
  return null;
}

// -- picking a release -------------------------------------------------------

/** Subtitles he cannot read, named in the title. TRaSH only knows VOSTFR. */
const FOREIGN_SUBS = /\b(?:czech|polish|italian|german|french|spanish|portugu[eê]s|pt-br|arabic|russian|hungarian|turkish|indonesian|vietnamese|thai|persian|farsi)\b[^\]]{0,12}\bsubs?\b|\b(?:cz|pl|ita|ger|fre|spa|por|ara|rus|hun|tur|ind|vie)\s*subs?\b|\.hu\]/i;
const VETO_FORMATS = new Set(['AV1', 'VOSTFR', 'Dubs Only', 'Anime Raws']);
const GB = 2 ** 30;

export type Rated = {
  release: ProwlarrRelease;
  ok: boolean;
  why?: string;
  score: number;
  /** How many episodes the pack holds, as far as its title says. */
  episodes: number;
  sizeGb: number;
  /** Leaves the room they asked to keep. */
  fits: boolean;
  /** Fits at all, with a few GB to spare. */
  squeezes: boolean;
  formats: string[];
};

export type Want = { title: string; absolute: number; season: number; freeGb: number; keepFreeGb: number };

/** What a pack's title adds after the show's name: "Naruto Complete", "Naruto (Complete Series)", "Naruto Collection". */
const PACK_WORDS = /\b(?:complete|collection|batch|series|the complete series|full)\b/g;

/**
 * Whether the release is the show and not a neighbour. "Naruto" against the
 * group Naruto-Kun.Hu's One Piece uploads, or against Naruto Shippuden: the
 * name Sonarr read out of the title must be the show's, pack words aside. A
 * title Sonarr could not read at all is not vouched for either way.
 */
export function sameShow(parsedTitle: string | undefined, wanted: string): boolean | null {
  if (!parsedTitle) return null;
  const strip = (value: string) => normaliseTitle(value).replace(PACK_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return strip(parsedTitle) === strip(wanted);
}

/**
 * One release, judged.
 *
 * The score is roughly TRaSH's shape — group tiers on top, dual audio a nudge —
 * with two departures. A pack is worth as many points as it has episodes, so a
 * whole series beats one file when both would do: the point of the fetch is to
 * watch the show, not episode one. And a low-quality group costs a hundred, not
 * ten thousand, for the reason at the top of the file.
 */
export function rateRelease(release: ProwlarrRelease, parsed: SonarrParse, want: Want): Rated {
  const formats = (parsed.customFormats ?? []).map(format => format.name);
  const info = parsed.parsedEpisodeInfo ?? undefined;
  const sizeGb = (release.size ?? 0) / GB;
  const absolutes = info?.absoluteEpisodeNumbers ?? [];
  const numbers = info?.episodeNumbers ?? [];
  const covers = absolutes.includes(want.absolute)
    || (info?.seasonNumber === want.season && (numbers.includes(want.absolute) || (info?.fullSeason === true && !absolutes.length)));
  const episodes = absolutes.length || numbers.length || (info?.fullSeason ? 12 : 0);
  const base = { release, episodes, sizeGb, formats, fits: sizeGb > 0 && sizeGb <= want.freeGb - want.keepFreeGb, squeezes: sizeGb > 0 && sizeGb <= want.freeGb - 5 };
  const veto = formats.find(name => VETO_FORMATS.has(name));
  if (veto) return { ...base, ok: false, why: veto, score: -1 };
  if (sameShow(info?.seriesTitle, want.title) === false) return { ...base, ok: false, why: 'another show', score: -1 };
  if (FOREIGN_SUBS.test(release.title)) return { ...base, ok: false, why: 'foreign subtitles', score: -1 };
  if ((release.seeders ?? 0) < 2) return { ...base, ok: false, why: 'no seeders', score: -1 };
  if (!(sizeGb > 0)) return { ...base, ok: false, why: 'no size', score: -1 };
  if (!covers) return { ...base, ok: false, why: `does not hold episode ${want.absolute}`, score: -1 };
  let score = 0;
  for (const name of formats) {
    const tier = /^Anime (BD|Web) Tier (\d+)$/.exec(name);
    if (tier) score += (tier[1] === 'BD' ? 1500 : 700) - 100 * Number(tier[2]);
    else if (/^Remux Tier/.test(name)) score += 1000;
    else if (name === 'Anime LQ Groups') score -= 100;
    else if (name === 'Anime Dual Audio') score += 10;
  }
  score += Math.min(episodes, 300);
  score += Math.min(release.seeders ?? 0, 300) / 10;
  score -= sizeGb / 10;
  return { ...base, ok: true, score };
}

/** The one to fetch: best that leaves the room; failing that, best that fits at all, for them to approve. */
export function pickRelease(rated: Rated[]): { pick: Rated; needsWord: boolean } | null {
  const good = rated.filter(item => item.ok).sort((a, b) => b.score - a.score);
  const roomy = good.find(item => item.fits);
  if (roomy) return { pick: roomy, needsWord: false };
  const tight = good.find(item => item.squeezes);
  return tight ? { pick: tight, needsWord: true } : null;
}

// -- the link ----------------------------------------------------------------

export type WatchInput = { title: string; tvdbId?: number; confirm?: boolean; where?: string };

/** What a Jellyfin session calls itself, read for the kind of thing it is running on. */
const PHONE = /\b(?:iphone|ipad|ios|android|mobile|safari|swiftfin|streamyfin|findroid|infuse)\b/i;
const DESK = /\b(?:chrome|chromium|firefox|edge|opera|brave|windows|desktop|media player|jellyfin desktop|linux|macos)\b/i;
const TV = /\b(?:tv|television|telly|roku|shield|fire|tizen|webos|android tv|apple tv|chromecast|bravia)\b/i;

/**
 * The players that are where they said. "Phone" is any session that reads as
 * a phone, "desk" or "pc" anything that reads as a computer, "tv" a
 * television; anything else is matched against the device's own name. No
 * word, every player.
 */
export function playersWhere<T extends { Client?: string; DeviceName?: string }>(players: T[], where: string | undefined): T[] {
  const said = (where ?? '').trim().toLowerCase();
  if (!said) return players;
  const label = (player: T) => `${player.DeviceName ?? ''} ${player.Client ?? ''}`;
  if (/^(?:my )?(?:phone|mobile|iphone|ipad|tablet)$/.test(said)) return players.filter(player => PHONE.test(label(player)));
  if (/^(?:my )?(?:desk|desktop|pc|computer|laptop|browser|chrome)$/.test(said)) return players.filter(player => DESK.test(label(player)) && !PHONE.test(label(player)));
  if (/^(?:my |the )?(?:tv|telly|television)$/.test(said)) return players.filter(player => TV.test(label(player)));
  return players.filter(player => label(player).toLowerCase().includes(said));
}

export class AnimeLink {
  private serverId = '';

  constructor(
    private readonly config: AnimeConfig,
    private readonly keys: Keys,
    private readonly fetcher: Fetcher,
    private readonly memory: { fetches(): Fetch[]; keep(fetch: Fetch): void; markImported?(seriesId: number, atIso: string): void },
  ) {}

  /** The import step (animefetch.ts) says the show is filed; "how's it going" stops calling it stalled. */
  markImported(seriesId: number, atIso = new Date().toISOString()): void {
    this.memory.markImported?.(seriesId, atIso);
  }

  private async json<T>(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = QUICK_MS): Promise<T> {
    const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
    const body = await response.text();
    return (body ? JSON.parse(body) : null) as T;
  }

  // Jellyfin ------------------------------------------------------------------

  private jf<T>(pathAndQuery: string, init: { method?: string; body?: string } = {}): Promise<T> {
    const headers = {
      Authorization: `MediaBrowser Client="Haru", Device="Haru", DeviceId="haru-desktop", Version="1.0.0", Token="${this.keys.jellyfinKey}"`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    return this.json<T>(`${this.keys.jellyfinUrl}${pathAndQuery}`, { ...init, headers });
  }

  async findOnServer(title: string): Promise<JellyfinItem | null> {
    const user = encodeURIComponent(this.keys.jellyfinUserId);
    const found = await this.jf<{ Items?: JellyfinItem[] }>(`/Items?userId=${user}&IncludeItemTypes=Series&Recursive=true&SearchTerm=${encodeURIComponent(title)}&Limit=6`);
    const items = (found?.Items ?? []).map(item => ({ ...item, title: item.Name }));
    const match = matchTitle(title, items);
    return match && 'one' in match ? match.one : (items[0] ?? null);
  }

  /** The next unwatched episode, or the first when it has all been seen. */
  async nextEpisode(seriesId: string): Promise<{ episode: JellyfinItem; fresh: boolean } | null> {
    const user = encodeURIComponent(this.keys.jellyfinUserId);
    const next = await this.jf<{ Items?: JellyfinItem[] }>(`/Shows/NextUp?userId=${user}&seriesId=${encodeURIComponent(seriesId)}&Limit=1`);
    if (next?.Items?.[0]) return { episode: next.Items[0], fresh: false };
    const unplayed = await this.jf<{ Items?: JellyfinItem[] }>(`/Items?userId=${user}&ParentId=${encodeURIComponent(seriesId)}&IncludeItemTypes=Episode&Recursive=true&Filters=IsUnplayed&SortBy=ParentIndexNumber,IndexNumber&Limit=1`);
    if (unplayed?.Items?.[0]) return { episode: unplayed.Items[0], fresh: true };
    const first = await this.jf<{ Items?: JellyfinItem[] }>(`/Items?userId=${user}&ParentId=${encodeURIComponent(seriesId)}&IncludeItemTypes=Episode&Recursive=true&SortBy=ParentIndexNumber,IndexNumber&Limit=1`);
    return first?.Items?.[0] ? { episode: first.Items[0], fresh: true } : null;
  }

  /** Jellyfin apps of his that will take a play command, most recently used first. Her own device is not one. */
  async players(): Promise<JellyfinSession[]> {
    const user = encodeURIComponent(this.keys.jellyfinUserId);
    const sessions = await this.jf<JellyfinSession[]>(`/Sessions?controllableByUserId=${user}&activeWithinSeconds=960`);
    return (sessions ?? [])
      .filter(session => session.SupportsRemoteControl !== false && session.DeviceId !== 'haru-desktop' && !/^Haru\b/i.test(session.Client ?? ''))
      .sort((a, b) => Date.parse(b.LastActivityDate ?? '') - Date.parse(a.LastActivityDate ?? ''));
  }

  async play(sessionId: string, itemId: string): Promise<void> {
    await this.jf(`/Sessions/${encodeURIComponent(sessionId)}/Playing?playCommand=PlayNow&itemIds=${encodeURIComponent(itemId)}`, { method: 'POST' });
  }

  async link(itemId: string): Promise<string> {
    if (!this.serverId) {
      try { this.serverId = (await this.jf<{ Id?: string }>('/System/Info'))?.Id ?? ''; } catch { /* the link works without it */ }
    }
    const base = this.config.linkUrl || this.keys.jellyfinUrl;
    return `${base}/web/#/details?id=${encodeURIComponent(itemId)}${this.serverId ? `&serverId=${encodeURIComponent(this.serverId)}` : ''}`;
  }

  async rescanLibrary(): Promise<void> {
    await this.jf('/Library/Refresh', { method: 'POST' });
  }

  // Sonarr --------------------------------------------------------------------

  private sonarr<T>(pathAndQuery: string, init: { method?: string; body?: string } = {}, timeoutMs = QUICK_MS): Promise<T> {
    return this.json<T>(`${this.config.sonarr.url}/api/v3${pathAndQuery}`, { ...init, headers: { 'X-Api-Key': this.keys.sonarrKey, 'Content-Type': 'application/json', Accept: 'application/json' } }, timeoutMs);
  }

  async shows(): Promise<SonarrSeries[]> {
    return (await this.sonarr<SonarrSeries[]>('/series')) ?? [];
  }

  async lookUp(term: string): Promise<SonarrLookup[]> {
    return (await this.sonarr<SonarrLookup[]>(`/series/lookup?term=${encodeURIComponent(term)}`)) ?? [];
  }

  async addShow(found: SonarrLookup): Promise<SonarrSeries> {
    const profiles = (await this.sonarr<{ id: number; name: string }[]>('/qualityprofile')) ?? [];
    const profile = profiles.find(item => item.name === this.config.profile) ?? profiles[0];
    if (!profile) throw new Error('Sonarr has no quality profile to file it under');
    const body = {
      ...found,
      qualityProfileId: profile.id,
      rootFolderPath: this.config.rootFolder,
      seriesType: 'anime',
      monitored: true,
      seasonFolder: true,
      addOptions: { monitor: 'all', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
    };
    return this.sonarr<SonarrSeries>('/series', { method: 'POST', body: JSON.stringify(body) });
  }

  async monitor(series: SonarrSeries): Promise<void> {
    if (series.monitored) return;
    const full = await this.sonarr<Record<string, unknown>>(`/series/${series.id}`);
    await this.sonarr(`/series/${series.id}`, { method: 'PUT', body: JSON.stringify({ ...full, monitored: true }) });
  }

  async episodes(seriesId: number): Promise<SonarrEpisode[]> {
    return (await this.sonarr<SonarrEpisode[]>(`/episode?seriesId=${seriesId}`)) ?? [];
  }

  async parse(title: string): Promise<SonarrParse> {
    return (await this.sonarr<SonarrParse>(`/parse?title=${encodeURIComponent(title)}`)) ?? {};
  }

  async freeGb(): Promise<number> {
    const folders = (await this.sonarr<{ path: string; freeSpace?: number }[]>('/rootfolder')) ?? [];
    const root = folders.find(folder => trimSlash(folder.path) === trimSlash(this.config.rootFolder)) ?? folders[0];
    return (root?.freeSpace ?? 0) / GB;
  }

  async queue(): Promise<SonarrQueueItem[]> {
    const page = await this.sonarr<{ records?: SonarrQueueItem[] }>('/queue?includeUnknownSeriesItems=true&pageSize=100');
    return page?.records ?? [];
  }

  async show(seriesId: number): Promise<SonarrSeries | null> {
    return this.sonarr<SonarrSeries | null>(`/series/${seriesId}`).catch(() => null);
  }

  /**
   * The files in a finished download, read with the show named. Named is the
   * whole trick: without it Sonarr cannot place a pack it could not parse;
   * with it, each file's own number is enough (animefetch.ts).
   */
  async importCandidates(downloadId: string, seriesId: number): Promise<ImportCandidate[]> {
    return (await this.sonarr<ImportCandidate[]>(`/manualimport?downloadId=${encodeURIComponent(downloadId)}&seriesId=${seriesId}&filterExistingFiles=true`, {}, SEARCH_MS)) ?? [];
  }

  async manualImport(files: ImportFile[]): Promise<void> {
    await this.sonarr('/command', { method: 'POST', body: JSON.stringify({ name: 'ManualImport', files, importMode: 'auto' }) });
  }

  /** How many episodes of the show Jellyfin has, by its own name for it; 0 when it is not there yet. */
  async episodesOnServer(title: string): Promise<{ series: string; episodes: number } | null> {
    const series = await this.findOnServer(title);
    if (!series) return null;
    const user = encodeURIComponent(this.keys.jellyfinUserId);
    const page = await this.jf<{ TotalRecordCount?: number }>(`/Items?userId=${user}&ParentId=${encodeURIComponent(series.Id)}&IncludeItemTypes=Episode&Recursive=true&Limit=1`);
    return { series: series.Name, episodes: page?.TotalRecordCount ?? 0 };
  }

  // Prowlarr ------------------------------------------------------------------

  private prowlarr<T>(pathAndQuery: string, init: { method?: string; body?: string } = {}, timeoutMs = QUICK_MS): Promise<T> {
    return this.json<T>(`${this.config.prowlarr.url}/api/v1${pathAndQuery}`, { ...init, headers: { 'X-Api-Key': this.keys.prowlarrKey, 'Content-Type': 'application/json', Accept: 'application/json' } }, timeoutMs);
  }

  /**
   * Nyaa's anime category, 5070, is the one Sonarr's anime type searches too.
   *
   * Several phrasings, merged: Nyaa answers with its newest 75 matches, and for
   * a show with weekly re-uploads that page is all singles — the whole-series
   * packs sit further back and only surface when the query names them. A
   * second on each, measured 2026-09-18.
   */
  async search(title: string): Promise<ProwlarrRelease[]> {
    const seen = new Map<string, ProwlarrRelease>();
    for (const phrasing of [title, `${title} batch`, `${title} complete`, `${title} dual audio`]) {
      const found = await this.prowlarr<ProwlarrRelease[]>(`/search?query=${encodeURIComponent(phrasing)}&type=search&limit=100&categories=5070`, {}, SEARCH_MS).catch(() => null);
      for (const release of found ?? []) if (release?.guid && !seen.has(release.guid)) seen.set(release.guid, release);
    }
    return [...seen.values()];
  }

  async grab(release: ProwlarrRelease): Promise<void> {
    await this.prowlarr('/search', { method: 'POST', body: JSON.stringify({ guid: release.guid, indexerId: release.indexerId }) });
  }

  // -- the ask ----------------------------------------------------------------

  /**
   * "Let's watch X". What comes back is facts and a `note` on how to say them;
   * `ok: false` on the answers that changed nothing, so the deeds ledger does
   * not record a fetch she only asked about.
   */
  async watch(input: WatchInput): Promise<Record<string, unknown>> {
    const title = input.title.trim();
    const onServer = await this.findOnServer(title);
    if (onServer) return this.putOn(onServer, input.where);

    // Not on the server. In Sonarr already?
    const shows = await this.shows();
    const known = input.tvdbId ? shows.find(show => show.tvdbId === input.tvdbId) : (match => match && 'one' in match ? match.one : null)(matchTitle(title, shows));
    if (known) {
      const files = known.statistics?.episodeFileCount ?? 0;
      if (files > 0) {
        // Sonarr has it and Jellyfin does not: the scan has not caught up.
        void this.rescanLibrary().catch(() => undefined);
        return { ok: true, outcome: 'arriving', show: known.title, episodesIn: files, note: `${known.title} has ${files} episode${files === 1 ? '' : 's'} on disk and Jellyfin is being told to look. Say it is just landing and to give it a minute; do not call it playing.` };
      }
      const going = await this.progressOf(known);
      if (going) return { ok: false, outcome: 'downloading', ...going, note: `${known.title} is already on its way — quote the progress as it is. Do not start it again.` };
      return this.fetch(known, title, input);
    }

    // New to the house: which show do they mean?
    const found = await this.lookUp(title);
    const wanted = input.tvdbId ? found.find(item => item.tvdbId === input.tvdbId) : null;
    const match = wanted ? { one: wanted } : matchTitle(title, found);
    if (!match) return { ok: false, outcome: 'unknown', note: `Nothing called "${title}" could be found to fetch. Say so plainly and ask how it is spelt or what it is also called.` };
    if ('several' in match) {
      return {
        ok: false,
        outcome: 'which',
        choices: match.several.map(item => ({ title: item.title, year: item.year ?? null, tvdbId: item.tvdbId })),
        note: 'More than one show fits. Ask which they mean, in your own voice, then call this again with that one\'s tvdbId. Do not pick for them.',
      };
    }
    const added = await this.addShow(match.one);
    return this.fetch(added, title, input, true);
  }

  /** "How's Naruto going": where a fetch is up to, or what is on the server. */
  async status(title: string): Promise<Record<string, unknown>> {
    const shows = await this.shows();
    const match = matchTitle(title, shows);
    const show = match && 'one' in match ? match.one : null;
    if (!show) {
      const onServer = await this.findOnServer(title);
      if (onServer) return { ok: true, outcome: 'in', show: onServer.Name, note: 'It is on the server and nothing is downloading. Say so.' };
      return { ok: true, outcome: 'nothing', note: `Nothing is fetching or on the server for "${title}". Say so; offer to get it if they want.` };
    }
    const going = await this.progressOf(show);
    if (going) return { ok: true, outcome: 'downloading', ...going, note: 'Quote the progress as it is, in one line. Do not guess a finish time beyond what is here.' };
    const files = show.statistics?.episodeFileCount ?? 0;
    if (files > 0) return { ok: true, outcome: 'in', show: show.title, episodesIn: files, note: `${files} episode${files === 1 ? '' : 's'} on disk. Say it is in.` };
    const fetch = this.memory.fetches().find(item => item.seriesId === show.id && !item.importedAt);
    if (fetch) return { ok: true, outcome: 'stalled', show: show.title, release: fetch.release, since: fetch.grabbedAt, note: 'She started this fetch but nothing is downloading now — it may have finished and be waiting to file, or it stopped. Say you cannot see it moving; do not promise a time.' };
    return { ok: true, outcome: 'nothing', show: show.title, note: 'Sonarr knows the show but nothing is downloading or on disk. Say so; offer to fetch it.' };
  }

  private async putOn(series: JellyfinItem, where?: string): Promise<Record<string, unknown>> {
    const next = await this.nextEpisode(series.Id);
    if (!next) return { ok: false, outcome: 'empty', show: series.Name, note: `${series.Name} is on the server but has no episodes in it yet. Say so.` };
    const { episode } = next;
    const number = episode.ParentIndexNumber != null && episode.IndexNumber != null ? `S${episode.ParentIndexNumber}E${episode.IndexNumber}` : '';
    const label = `${number ? `${number} ` : ''}"${episode.Name}"`;
    const link = await this.link(episode.Id);
    const everyone = await this.players();
    const players = playersWhere(everyone, where);
    if (!players.length) {
      const elsewhere = everyone.map(player => player.DeviceName || player.Client || 'a player').join(', ');
      const because = where
        ? `Nothing on their ${where.replace(/^my /, '')} has Jellyfin open${elsewhere ? ` (open right now: ${elsewhere})` : ''}, so nothing could be started there. Say so, and that Jellyfin has to be open and signed in on it first`
        : 'Nothing of theirs has Jellyfin open, so nothing could be started. Say so';
      return { ok: true, outcome: 'ready', show: series.Name, episode: label, link, openElsewhere: everyone.map(player => player.DeviceName || player.Client || ''), note: `${because}. Say ${label} is up next and give them the link exactly as written: ${link}` };
    }
    const player = players[0];
    await this.play(player.Id, episode.Id);
    const on = player.DeviceName || player.Client || 'their player';
    return { ok: true, outcome: 'playing', show: series.Name, episode: label, on, continuing: !next.fresh, note: `${label} is now playing on ${on}. Say so in a line, as yourself. Do not read the link out.` };
  }

  private async progressOf(show: SonarrSeries): Promise<Record<string, unknown> | null> {
    const fetches = this.memory.fetches().filter(item => item.seriesId === show.id);
    const hashes = new Set(fetches.map(item => item.infoHash.toLowerCase()).filter(Boolean));
    const want = normaliseTitle(show.title);
    const item = (await this.queue()).find(entry => entry.seriesId === show.id
      || (entry.downloadId && hashes.has(entry.downloadId.toLowerCase()))
      || normaliseTitle(entry.title ?? '').includes(want));
    if (!item) return null;
    const size = item.size ?? 0;
    const left = item.sizeleft ?? 0;
    const percent = size > 0 ? Math.max(0, Math.min(100, Math.round(((size - left) / size) * 100))) : null;
    return {
      show: show.title,
      release: item.title ?? '',
      percent,
      leftGb: Math.round(left / GB * 10) / 10,
      sizeGb: Math.round(size / GB * 10) / 10,
      timeLeft: item.timeleft ?? null,
      state: item.trackedDownloadState ?? item.status ?? null,
      trouble: item.errorMessage ?? null,
    };
  }

  private async fetch(show: SonarrSeries, asked: string, input: WatchInput, justAdded = false): Promise<Record<string, unknown>> {
    const episodes = await this.episodes(show.id);
    const next = episodes.filter(episode => episode.seasonNumber > 0 && !episode.hasFile).sort((a, b) => (a.absoluteEpisodeNumber ?? 9999) - (b.absoluteEpisodeNumber ?? 9999) || a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)[0];
    const want: Want = { title: show.title, absolute: next?.absoluteEpisodeNumber ?? 1, season: next?.seasonNumber ?? 1, freeGb: await this.freeGb(), keepFreeGb: this.config.keepFreeGb };
    const results = await this.search(show.title);
    const promising = results.filter(release => (release.seeders ?? 0) >= 2).sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0)).slice(0, 25);
    const rated: Rated[] = [];
    for (const release of promising) rated.push(rateRelease(release, await this.parse(release.title), want));
    const picked = pickRelease(rated);
    if (!picked) {
      const seen = results.length;
      return { ok: false, outcome: 'nothing-usable', show: show.title, searched: seen, note: seen ? `${seen} releases came up for ${show.title} but none is usable — subtitled, seeded and holding episode ${want.absolute} within the space on the disk. Say you could not find a good copy; do not offer one of them anyway.` : `Nothing at all came up for ${show.title} on the tracker. Say so.` };
    }
    const { pick } = picked;
    const sizeGb = Math.round(pick.sizeGb);
    if (picked.needsWord && input.confirm !== true) {
      return {
        ok: false,
        outcome: 'needs-word',
        confirm: true,
        show: show.title,
        release: pick.release.title,
        sizeGb,
        freeGb: Math.round(want.freeGb),
        keepFreeGb: this.config.keepFreeGb,
        note: `The best copy is ${sizeGb} GB and the disk has ${Math.round(want.freeGb)} GB free, which would leave less than the ${this.config.keepFreeGb} GB they like kept. Do not start it. Tell them the size and ask for the word, then call this again with confirm: true.`,
      };
    }
    await this.monitor(show);
    await this.grab(pick.release);
    this.memory.keep({
      title: show.title,
      seriesId: show.id,
      tvdbId: show.tvdbId,
      release: pick.release.title,
      infoHash: (pick.release.infoHash ?? '').toLowerCase(),
      sizeBytes: pick.release.size ?? 0,
      episodes: pick.episodes,
      grabbedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      outcome: 'fetching',
      show: show.title,
      added: justAdded,
      release: pick.release.title,
      episodes: pick.episodes,
      sizeGb,
      seeders: pick.release.seeders ?? 0,
      note: `${show.title} was not on the server, so the fetch has started: ${pick.episodes} episode${pick.episodes === 1 ? '' : 's'}, ${sizeGb} GB. Say that in a line or two, as yourself — it is coming, roughly how big it is, and that you will tell them when it is in. Do not give a time; they can ask how it is going.`,
    };
  }
}
