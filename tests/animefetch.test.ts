// The watch on a fetch: which queue line is ours, what state it is in, which
// files Sonarr can now place once the show is named, and what she is handed to
// say. The scheduler handler itself lives in main.ts; these are the decisions
// it leans on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIME_FETCH_KIND, FETCH_EVERY_MS, FETCH_FOR_MS, fetchJob, fetchState, gaveUpPrompt, importPlan, landedFallback, landedPrompt, queueLineFor } from '../electron/animefetch';

const fetch = { title: 'Naruto', seriesId: 2, tvdbId: 78857, release: '[Anime Time] Naruto Complete (001-220 + Movies) [Batch]', infoHash: 'abcdef01', sizeBytes: 65 * 2 ** 30, episodes: 220, grabbedAt: '2026-09-18T01:00:00Z' };

test('the job is one per show, every five minutes, for three days', () => {
  const job = fetchJob(fetch, 1_000_000);
  assert.equal(job.id, 'anime-fetch:2');
  assert.equal(job.kind, ANIME_FETCH_KIND);
  assert.equal(job.dueAt, 1_000_000 + FETCH_EVERY_MS);
  assert.equal(job.payload?.until, 1_000_000 + FETCH_FOR_MS);
  assert.equal(job.payload?.infoHash, 'abcdef01');
  assert.equal(job.createdBy, 'app');
});

test('the queue line is found by hash first, then show, then title, whatever the case', () => {
  const byHash = { title: 'other', downloadId: 'ABCDEF01' };
  const byShow = { title: 'x', seriesId: 2 };
  const byTitle = { title: '[Anime Time] Naruto Complete (001-220 + Movies) [Batch]' };
  assert.equal(queueLineFor([byShow, byHash], fetch), byHash);
  assert.equal(queueLineFor([byTitle, byShow], fetch), byShow);
  assert.equal(queueLineFor([byTitle], fetch), byTitle);
  assert.equal(queueLineFor([{ title: 'Bleach', downloadId: 'FFFF' }], fetch), null);
  assert.equal(queueLineFor([byTitle], { ...fetch, infoHash: '' }), byTitle);
});

test('bytes still coming is downloading; all down is landed; Sonarr having given up on filing it is stuck', () => {
  assert.equal(fetchState({ sizeleft: 13 * 2 ** 30, trackedDownloadState: 'downloading' }), 'downloading');
  assert.equal(fetchState({ sizeleft: 0, status: 'completed', trackedDownloadState: 'importPending' }), 'stuck');
  assert.equal(fetchState({ sizeleft: 0, trackedDownloadStatus: 'warning', trackedDownloadState: 'importBlocked' }), 'stuck');
  assert.equal(fetchState({ sizeleft: 0, status: 'completed', trackedDownloadStatus: 'ok', trackedDownloadState: 'importing' }), 'landed');
  assert.equal(fetchState({}), 'downloading');
});

test('files Sonarr can read go in the plan under the named show; movies and objections are left where they are', () => {
  const plan = importPlan([
    { path: '/data/torrents/anime/pack/Naruto - 001.mkv', episodes: [{ id: 100 }], quality: { q: 1 }, languages: [{ id: 8 }], releaseGroup: 'Anime Time' },
    { path: '/data/torrents/anime/pack/Naruto - 002.mkv', episodes: [{ id: 101 }], quality: { q: 1 }, languages: [], downloadId: 'ABCDEF01' },
    { path: '/data/torrents/anime/pack/Movies/Naruto the Movie.mkv', episodes: [] },
    { path: '/data/torrents/anime/pack/Naruto - 003.mkv', episodes: [{ id: 102 }], rejections: [{ reason: 'Episode already imported' }] },
  ], 2, 'abcdef01');
  assert.deepEqual(plan.files.map(file => file.path), ['/data/torrents/anime/pack/Naruto - 001.mkv', '/data/torrents/anime/pack/Naruto - 002.mkv']);
  assert.deepEqual(plan.files[0], { path: '/data/torrents/anime/pack/Naruto - 001.mkv', seriesId: 2, episodeIds: [100], quality: { q: 1 }, languages: [{ id: 8 }], releaseGroup: 'Anime Time', downloadId: 'abcdef01', indexerFlags: 0 });
  assert.equal(plan.files[1].downloadId, 'ABCDEF01');
  assert.deepEqual(plan.skipped.map(item => item.why), ['no episode Sonarr could read', 'Episode already imported']);
});

test('what she is handed says the fact and the offer, and never a duration or a size', () => {
  const started = Date.parse('2026-09-18T01:00:00Z');
  const landed = landedPrompt('Naruto', 220, started, started + 3 * 3_600_000);
  assert.match(landed, /3 hours ago/);
  assert.match(landed, /220 episodes of Naruto/);
  assert.match(landed, /offer to put the first episode on/);
  assert.match(landed, /nothing about how long it took or what it weighed/);
  assert.match(gaveUpPrompt('Naruto', started, started + 4 * 86_400_000, 'the download never finished'), /4 days ago[\s\S]*never came: the download never finished/);
  assert.equal(landedFallback('Naruto', 220), 'Naruto is in — 220 episodes on Jellyfin. Want the first one on?');
});
