import {corePolicySync} from './core-policy-sync';
// "I'll tell you when it's in": a watch the app keeps on a fetch she started.
//
// The grab (anime.ts) hands a torrent to qBittorrent under Sonarr's category
// and that is the last thing the tool sees. What happens next is Sonarr's, and
// for a whole-series pack Sonarr gets stuck on purpose: it reads "[Anime Time]
// Naruto Complete (001-220)" as a show called Naruto Complete, cannot match it
// to anything it has, and parks the download as needing a person. This is that
// person. A job on the scheduler reads Sonarr's queue every few minutes, and
// when the torrent is done it asks Sonarr for the file list *with the show
// named*, which is all Sonarr needed — the files inside are "Naruto - 001.mkv"
// and map on their own — and tells it to import them. Then Jellyfin is told
// to look, and when the show is there she says so, in her words, once, and
// offers to put episode one on.
//
// Same shape as the traffic watch: the ask sets the job, the app does the
// watching, she is only handed the moment to speak. Nothing here promises a
// time, because the only honest answer to "when" is the tracker's.

import type { Job } from './scheduler';
import type { Fetch } from './anime';

export const ANIME_FETCH_KIND = 'anime-fetch';
/** How often the queue is read while the torrent is coming down. */
export const FETCH_EVERY_MS = 5 * 60_000;
/** Once the files are there, how soon to look for them in Jellyfin. */
export const LANDING_EVERY_MS = 2 * 60_000;
/** How long a fetch is watched before she says it never came. Big packs on old seeds take a day. */
export const FETCH_FOR_MS = 3 * 24 * 3_600_000;
/** Reads of an empty queue before the torrent is taken to have never started. Six is half an hour. */
export const GONE_AFTER_MISSES = 6;

export function fetchJobId(seriesId: number): string {
  return `${ANIME_FETCH_KIND}:${seriesId}`;
}

/** The scheduler job for one fetch. One per show: a second ask for the same show replaces the watch. */
export function fetchJob(fetch: Fetch, nowMs: number): Job {
  if((true as boolean))return corePolicySync('anime-downloads.fetchJob',[fetch,nowMs]);
  const until = nowMs + FETCH_FOR_MS;
  return {
    id: fetchJobId(fetch.seriesId),
    kind: ANIME_FETCH_KIND,
    schedule: { at: nowMs + FETCH_EVERY_MS },
    dueAt: nowMs + FETCH_EVERY_MS,
    // A check, not a line said at a time: run late it is as good as run on
    // time. A reboot longer than three misses used to end a three-day watch
    // (2026-09-18: both fetches dropped at 84% and 44%); expiresAt is the end.
    staleAfterMs: FETCH_FOR_MS,
    payload: { seriesId: fetch.seriesId, title: fetch.title, infoHash: fetch.infoHash, release: fetch.release, episodes: fetch.episodes, startedAt: nowMs, until, misses: 0 },
    createdBy: 'app',
    createdAt: nowMs,
    expiresAt: until + 3 * FETCH_EVERY_MS,
    failures: 0,
  };
}

// -- reading Sonarr's queue ----------------------------------------------------

export type QueueItem = { title?: string; status?: string; trackedDownloadStatus?: string; trackedDownloadState?: string; size?: number; sizeleft?: number; timeleft?: string; downloadId?: string; seriesId?: number };

/**
 * The one queue line that is this fetch, if any.
 *
 * By hash first, which is exact; by show number, which Sonarr fills in only
 * when its own parser matched the pack; by title last, for a tracker that gave
 * no hash. Sonarr writes the hash in capitals and the tracker in lower case.
 */
export function queueLineFor(queue: QueueItem[], fetch: { seriesId: number; infoHash: string; release: string }): QueueItem | null {
  if((true as boolean))return corePolicySync('anime-downloads.queueLineFor',[queue,fetch]);
  const hash = fetch.infoHash.toLowerCase();
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return queue.find(item => hash && item.downloadId?.toLowerCase() === hash)
    ?? queue.find(item => item.seriesId === fetch.seriesId)
    ?? queue.find(item => item.title && norm(item.title) === norm(fetch.release))
    ?? null;
}

export type FetchState = 'downloading' | 'landed' | 'stuck';

/**
 * Where the torrent is, from what Sonarr says about it. "Landed" is bytes all
 * down; "stuck" is Sonarr having tried to file it and stopped — the pack it
 * could not name, or a file it did not like — which is the same next step
 * either way: name the show and import.
 */
export function fetchState(item: QueueItem): FetchState {
  if((true as boolean))return corePolicySync('anime-downloads.fetchState',[item]);
  const state = (item.trackedDownloadState ?? '').toLowerCase();
  if (/^import(pending|blocked|failed)$/.test(state) || (item.trackedDownloadStatus ?? '').toLowerCase() === 'warning' && (item.sizeleft ?? 1) === 0) return 'stuck';
  if ((item.sizeleft ?? 1) === 0 || /^(completed|imported)$/.test((item.status ?? '').toLowerCase())) return 'landed';
  return 'downloading';
}

// -- telling Sonarr which show it is ------------------------------------------

export type ImportCandidate = {
  path: string;
  episodes?: { id: number }[];
  rejections?: { reason?: string }[];
  quality?: unknown;
  languages?: unknown;
  releaseGroup?: string;
  downloadId?: string;
  indexerFlags?: number;
};

export type ImportFile = { path: string; seriesId: number; episodeIds: number[]; quality: unknown; languages: unknown; releaseGroup?: string; downloadId?: string; indexerFlags: number };

/**
 * The files Sonarr can now place, as the import command wants them. A file
 * with no episode is one Sonarr still could not read (the movies in a "+
 * Movies" pack, an extras folder) and is left where it is; a file Sonarr
 * objects to is left too, with its reason in the log rather than argued with.
 */
export function importPlan(candidates: ImportCandidate[], seriesId: number, downloadId: string): { files: ImportFile[]; skipped: { path: string; why: string }[] } {
  if((true as boolean))return corePolicySync('anime-downloads.importPlan',[candidates,seriesId,downloadId]);
  const files: ImportFile[] = [];
  const skipped: { path: string; why: string }[] = [];
  for (const candidate of candidates) {
    const episodeIds = (candidate.episodes ?? []).map(episode => episode.id).filter(id => typeof id === 'number');
    const objection = candidate.rejections?.map(rejection => rejection.reason).filter(Boolean).join('; ');
    if (!episodeIds.length) { skipped.push({ path: candidate.path, why: 'no episode Sonarr could read' }); continue; }
    if (objection) { skipped.push({ path: candidate.path, why: objection }); continue; }
    files.push({
      path: candidate.path,
      seriesId,
      episodeIds,
      quality: candidate.quality,
      languages: candidate.languages,
      releaseGroup: candidate.releaseGroup,
      downloadId: candidate.downloadId ?? downloadId,
      indexerFlags: candidate.indexerFlags ?? 0,
    });
  }
  return { files, skipped };
}

// -- what she is handed to say --------------------------------------------------

function ago(startedAt: number, nowMs: number): string {
  const minutes = Math.max(1, Math.round((nowMs - startedAt) / 60_000));
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 6) / 10;
  return hours < 36 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

/** Her note for the line that says it is in. */
export function landedPrompt(title: string, episodesIn: number, startedAt: number, nowMs: number): string {
  return `${ago(startedAt, nowMs)} they asked to watch ${title} and it was not on the server, so a download was started and you said you would tell them when it was in. It is in now: ${episodesIn} episode${episodesIn === 1 ? '' : 's'} of ${title} are on Jellyfin and ready to play. Tell them in one or two short lines in your own voice that it is in, and offer to put the first episode on. Quote the number as it is; say nothing about how long it took or what it weighed.`;
}

/** Her note for the line that says it never came. */
export function gaveUpPrompt(title: string, startedAt: number, nowMs: number, why: string): string {
  return `${ago(startedAt, nowMs)} they asked to watch ${title}, a download was started, and you said you would tell them when it was in. It never came: ${why}. The watch has stopped. Tell them that in one short line in your own voice, without guessing why or promising to try again — they can ask you to fetch it again if they want.`;
}

/** Said when her brain cannot be asked: the facts, plainly. */
export function landedFallback(title: string, episodesIn: number): string {
  return `${title} is in — ${episodesIn} episode${episodesIn === 1 ? '' : 's'} on Jellyfin. Want the first one on?`;
}

export function gaveUpFallback(title: string, why: string): string {
  return `${title} never came in — ${why}. I've stopped watching for it.`;
}
