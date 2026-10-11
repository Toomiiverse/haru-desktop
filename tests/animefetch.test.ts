// The watch on a fetch: which queue line is ours, what state it is in, which
// files Sonarr can now place once the show is named, and what she is handed to
// say. The scheduler handler itself lives in main.ts; these are the decisions
// it leans on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIME_FETCH_KIND, FETCH_EVERY_MS, FETCH_FOR_MS, fetchJob, fetchState, gaveUpPrompt, importPlan, landedFallback, landedPrompt, queueLineFor } from '../electron/animefetch';

const fetch = { title: 'Naruto', seriesId: 2, tvdbId: 78857, release: '[Anime Time] Naruto Complete (001-220 + Movies) [Batch]', infoHash: 'abcdef01', sizeBytes: 65 * 2 ** 30, episodes: 220, grabbedAt: '2026-09-18T01:00:00Z' };

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
