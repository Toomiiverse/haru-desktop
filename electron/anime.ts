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
import {corePolicySync} from './core-policy-sync';
import {runAnimePlayback, type PlaybackMemory} from './anime-playback';
import {runAnimeDownload,runAnimeFetchWatch,type DownloadMemory} from './anime-downloads';
import { homedir } from 'node:os';
import path from 'node:path';
import type {Job,Outcome} from './scheduler';
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
  return corePolicySync('anime-downloads.config',[saved??null,homedir()]);
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

type JellyfinItem = { Id: string; Name: string; ProductionYear?: number; ProviderIds?: {Tvdb?: string}; SeriesName?: string; SeriesId?: string; ParentIndexNumber?: number; IndexNumber?: number; UserData?: { Played?: boolean } };
type JellyfinSession = { Id: string; Client?: string; DeviceName?: string; DeviceId?: string; SupportsRemoteControl?: boolean; LastActivityDate?: string; PlayState?: {IsPaused?: boolean}; NowPlayingItem?: { Id?: string; Name?: string; SeriesName?: string } };
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
  return corePolicySync('anime-playback.matchTitle',[wanted,candidates]);
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
  return corePolicySync('anime-downloads.sameShow',[parsedTitle??null,wanted]);
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
  return corePolicySync('anime-downloads.rateRelease',[release,parsed,want]);
}

/** The one to fetch: best that leaves the room; failing that, best that fits at all, for them to approve. */
export function pickRelease(rated: Rated[]): { pick: Rated; needsWord: boolean } | null {
  return corePolicySync('anime-downloads.pickRelease',[rated]);
}

// -- the link ----------------------------------------------------------------

export type WatchInput = { title: string; tvdbId?: number; jellyfinSeriesId?: string; confirm?: boolean; where?: string };

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
  return corePolicySync('anime-playback.playersWhere',[players,where??null]);
}

export class AnimeLink {
  private serverId = '';

  constructor(
    private readonly config: AnimeConfig,
    private readonly keys: Keys,
    private readonly fetcher: Fetcher,
    private readonly memory: { fetches(): Fetch[]; keep(fetch: Fetch): void | Promise<void>; markImported?(seriesId: number, atIso: string): void } & PlaybackMemory & DownloadMemory,
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
    const found = await this.jf<{ Items?: JellyfinItem[];TotalRecordCount?:number }>(`/Items?userId=${user}&IncludeItemTypes=Series&Recursive=true&SearchTerm=${encodeURIComponent(title)}&EnableTotalRecordCount=true&Limit=${(100)}`);
    if((typeof found?.TotalRecordCount==='number')&&found.TotalRecordCount>(found.Items?.length??0))throw Error('anime_library_truncated');
    const items = (found?.Items ?? []).map(item => ({ ...item, title: item.Name }));
    const match = matchTitle(title, items);
    if(match&&'several' in match)throw Error('anime_title_ambiguous');
      return match&&'one' in match?match.one:null;
  }

  /** The next unwatched episode, or the first when it has all been seen. */
  async nextEpisode(seriesId: string): Promise<{ episode: JellyfinItem; fresh: boolean } | null> {
    throw Error('anime_legacy_playback_not_permitted');
  }

  /** Jellyfin apps of his that will take a play command, most recently used first. Her own device is not one. */
  async players(): Promise<JellyfinSession[]> {
    const user = encodeURIComponent(this.keys.jellyfinUserId);
    const sessions = await this.jf<JellyfinSession[]>(`/Sessions?controllableByUserId=${user}&activeWithinSeconds=960`);
    return corePolicySync('anime-playback.activePlayers',[sessions??[],Date.now()]);
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

  /**
   * The queue, one line per download.
   *
   * Sonarr lists a pack once per episode it holds — a 500-episode pack is 500
   * rows — so a page of 100 can hold one pack and nothing else. Seen live
   * 2026-09-18: Naruto Shippuden's rows would have pushed Naruto's one row off
   * the page, and the watch would have called it vanished. Every page is read,
   * and the rows fold to one per download id, which is what a fetch is.
   */
  async queue(): Promise<SonarrQueueItem[]> {
    return corePolicySync('anime-downloads.queueSnapshot',[await this.queueRaw()]);
  }

  /** Raw complete pagination. No download choice, grouping or capacity arithmetic. */
  private async queueRaw():Promise<SonarrQueueItem[]>{
    const rows:SonarrQueueItem[]=[];let total:number|undefined;
    for(let page=1;page<=10;page++){
      const got=await this.sonarr<{records?:SonarrQueueItem[];totalRecords?:number}>(`/queue?includeUnknownSeriesItems=true&pageSize=500&page=${page}`);
      if(!Array.isArray(got?.records)||!Number.isSafeInteger(got?.totalRecords)||got!.totalRecords!<0||got.records.length>500)throw Error('anime_queue_response_invalid');
      if(total!==undefined&&total!==got.totalRecords)throw Error('anime_queue_changed_during_read');
      total=got.totalRecords!;rows.push(...got.records);
      if(rows.length===total)return rows;
      if(rows.length>total||got.records.length<500)throw Error('anime_queue_incomplete');
    }
    throw Error('anime_queue_truncated');
  }

  /** Bytes still to come across everything downloading, which the free-space figure does not know about yet. */
  async inFlightGb(): Promise<number> {
    return (await this.queue()).reduce((sum, item) => sum + (item.sizeleft ?? 0), 0) / GB;
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
  runFetchWatch(job:Job,notificationTransport:(op:string,args:any[])=>Promise<unknown>):Promise<Outcome>{
    return runAnimeFetchWatch(job,(op,args)=>['notifyFacts','composeNotice','publish'].includes(op)?notificationTransport(op,args):this.downloadTransport(op,args),this.memory);
  }

  /** Exact Core-selected transport; no selection/profile/root fallback. */
  async downloadTransport(op:string,args:any[]):Promise<unknown>{
    switch(op){
      case 'shows':return this.shows();
      case 'lookup':return this.lookUp(args[0]);
      case 'profiles':return this.sonarr('/qualityprofile');
      case 'roots':return this.sonarr('/rootfolder');
      case 'queue':return {queue:await this.queue(),fetches:this.memory.fetches(),ledger:this.memory.downloadEffects?.()??null};
      case 'episodes':return this.episodes(args[0]);
      case 'search':return this.prowlarr(`/search?query=${encodeURIComponent(args[0])}&type=search&limit=100&categories=5070`,{},SEARCH_MS);
      case 'parse':return this.parse(args[0]);
      case 'show':return this.sonarr(`/series/${args[0]}`);
      case 'add':return this.sonarr('/series',{method:'POST',body:JSON.stringify(args[0])});
      case 'monitor':return this.sonarr(`/series/${args[0]}`,{method:'PUT',body:JSON.stringify(args[1])});
      case 'grab':await this.grab(args[0]);return null;
      case 'scan':await this.rescanLibrary();return null;
      case 'library':return this.playbackTransport('library',args);
      case 'libraryEpisodes':return this.episodesOnServer(args[0]);
      case 'importCandidates':return this.importCandidates(args[0],args[1]);
      case 'import':await this.manualImport(args[0]);return null;
      default:throw Error('anime_download_command_invalid');
    }
  }

  private async playbackTransport(op:string,args:any[]):Promise<unknown>{
    const user=encodeURIComponent(this.keys.jellyfinUserId);
    switch(op){
      case 'library':return (await this.jf<{Items?:JellyfinItem[];TotalRecordCount?:number}>(`/Items?userId=${user}&IncludeItemTypes=Series&Recursive=true&SearchTerm=${encodeURIComponent(args[0])}&Fields=ProviderIds&EnableTotalRecordCount=true&Limit=100`))??{Items:[]};
      case 'next':return (await this.jf<{Items?:JellyfinItem[]}>(`/Shows/NextUp?userId=${user}&seriesId=${encodeURIComponent(args[0])}&Limit=1`))?.Items??[];
      case 'unplayed':return (await this.jf<{Items?:JellyfinItem[]}>(`/Items?userId=${user}&ParentId=${encodeURIComponent(args[0])}&IncludeItemTypes=Episode&Recursive=true&Filters=IsUnplayed&SortBy=ParentIndexNumber,IndexNumber&Limit=1`))?.Items??[];
      case 'count':return (await this.jf<{TotalRecordCount?:number}>(`/Items?userId=${user}&ParentId=${encodeURIComponent(args[0])}&IncludeItemTypes=Episode&Recursive=true&Limit=1`))?.TotalRecordCount??0;
      case 'episode':return this.jf(`/Users/${user}/Items/${encodeURIComponent(args[0])}`);
      case 'sessions':return (await this.jf<JellyfinSession[]>(`/Sessions?controllableByUserId=${user}&activeWithinSeconds=960`))??[];
      case 'link':return this.link(args[0]);
      case 'play':await this.play(args[0],args[1]);return null;
      default:throw Error('anime_playback_command_invalid');
    }
  }

  async watch(input: WatchInput): Promise<Record<string, unknown>> {
    {
      const plan=await runAnimePlayback(input,(op,args)=>this.playbackTransport(op,args),this.memory);
      if(plan.delegateDownload)return this.watchDownload(input);
      if(!plan.result)throw Error('anime_playback_result_missing');
      return plan.result;
    }
  }

  /** Retained download policy; HARU_CORE_ANIME_PLAYBACK does not claim ownership. */
  private async watchDownload(input:WatchInput):Promise<Record<string,unknown>>{
    return runAnimeDownload(input,this.config,(op,args)=>this.downloadTransport(op,args),this.memory);
  }

  /** "How's Naruto going": where a fetch is up to, or what is on the server. */
  async status(title: string): Promise<Record<string, unknown>> {
    return runAnimeDownload({title},this.config,(op,args)=>this.downloadTransport(op,args),this.memory,'status');
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
    // What is still coming down counts as spent: the disk does not know yet,
    // but it will. Two 60 GB packs asked for a minute apart (2026-09-18) were
    // each judged against the full free space.
    const freeGb = Math.max(0, (await this.freeGb()) - (await this.inFlightGb().catch(() => 0)));
    const want: Want = { title: show.title, absolute: next?.absoluteEpisodeNumber ?? 1, season: next?.seasonNumber ?? 1, freeGb, keepFreeGb: this.config.keepFreeGb };
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
    await this.memory.keep({
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
