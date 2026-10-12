// The tally behind the services panel.
//
// Three things it can get wrong quietly, which is why they are here rather than
// left to be noticed: a day boundary, so "today" is his day and not UTC's; a
// call that failed still costing a call, because the quota is spent either way;
// and a file:// read counted as an API call, which it is not — the same fetch
// serves both.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiUsage, counted, hostOf, serviceName } from '../electron/apiusage';

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);

test('one host, one day, counted with its failures', () => {
  const usage = new ApiUsage();
  usage.record('https://graphql.anilist.co/', true, at('2026-09-20'));
  usage.record('https://graphql.anilist.co/', true, at('2026-09-20'));
  usage.record('https://graphql.anilist.co/', false, at('2026-09-20'));
  const [row] = usage.report(at('2026-09-20'));
  assert.equal(row.service, 'AniList');
  assert.deepEqual([row.today, row.week, row.month, row.failed], [3, 3, 3, 1]);
});

test('the hosts of one service are one row — a quota is per key, not per subdomain', () => {
  const usage = new ApiUsage();
  usage.record('https://oauth2.googleapis.com/token', true, at('2026-09-20'));
  usage.record('https://tasks.googleapis.com/tasks/v1/lists', true, at('2026-09-20'));
  const rows = usage.report(at('2026-09-20'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].month, 2);
});

test('yesterday is this week but not today, and a month back is neither', () => {
  const usage = new ApiUsage();
  usage.record('https://api.open-meteo.com/v1/forecast', true, at('2026-09-19'));
  usage.record('https://api.open-meteo.com/v1/forecast', true, at('2026-08-01'));
  const [row] = usage.report(at('2026-09-20'));
  assert.deepEqual([row.today, row.week, row.month], [0, 1, 1]);
});

test('a local server is its own service, port and all', () => {
  assert.equal(serviceName('localhost:11434'), 'Ollama');
  assert.equal(serviceName('127.0.0.1:9880'), 'GPT-SoVITS');
  assert.notEqual(hostOf('http://127.0.0.1:11434/api/chat'), hostOf('http://127.0.0.1:9880/tts'));
});

test('reading a file through the same fetch is not usage', () => {
  const usage = new ApiUsage();
  usage.record('file:///C:/Users/x/photo.png', true, at('2026-09-20'));
  assert.deepEqual(usage.report(at('2026-09-20')), []);
});

test('a fetch that throws is still a call that was spent', async () => {
  const usage = new ApiUsage();
  const failing = counted(async (_url: string) => { throw new Error('offline'); }, usage);
  await assert.rejects(() => failing('https://api.search.brave.com/res/v1/web/search'));
  const [row] = usage.report();
  assert.deepEqual([row.month, row.failed], [1, 1]);
});

test('a 429 counts as a call and as a failure', async () => {
  const usage = new ApiUsage();
  const limited = counted(async (_url: string) => ({ ok: false, status: 429 }), usage);
  await limited('https://routes.googleapis.com/directions/v2:computeRoutes');
  const [row] = usage.report();
  assert.deepEqual([row.service, row.month, row.failed], ['Google', 1, 1]);
});

test('older than thirty days is dropped when it is written back', () => {
  const usage = new ApiUsage({
    '2026-09-20': { 'graphql.anilist.co': [4, 0] },
    '2026-01-01': { 'graphql.anilist.co': [900, 3] },
  });
  const saved = usage.snapshot(at('2026-09-20'));
  assert.deepEqual(Object.keys(saved), ['2026-09-20']);
  assert.equal(usage.dirty, false);
});

test('a saved tally comes back', () => {
  const usage = new ApiUsage({ '2026-09-20': { 'api.steampowered.com': [7, 1] } });
  const [row] = usage.report(at('2026-09-20'));
  assert.deepEqual([row.service, row.today, row.failed], ['Steam', 7, 1]);
});
