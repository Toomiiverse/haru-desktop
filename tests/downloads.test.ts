// qBittorrent through a fake: the login, the list, and stop/start on all or one show.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Downloads, downloadsReady, namesShow, plainName, readDownloadsConfig, standing, type DownloadsHost } from '../electron/downloads';

const TORRENTS = [
  { hash: '58d964e3', name: '[Anime Time] Naruto Complete (001-220 + Movies) [BD] [Dual Audio][1080p]', state: 'downloading', progress: 0.38, dlspeed: 4_200_000, upspeed: 0, eta: 3600, size: 70e9 },
  { hash: 'de2fee7c', name: '[Sotark] Naruto Shippuden (001-500 complete series) [480p][720p]', state: 'stalledDL', progress: 0.19, dlspeed: 0, upspeed: 0, eta: 8640000, size: 60e9 },
  { hash: 'aa11', name: '[Judas] Made in Abyss S1 [BD 1080p]', state: 'stoppedUP', progress: 1, dlspeed: 0, upspeed: 0, eta: 8640000, size: 12e9 },
];

function fake(options: { stopMissing?: boolean; lapse?: boolean } = {}) {
  const calls: { url: string; method: string; body?: string; cookie?: string }[] = [];
  let logins = 0;
  let lapsed = options.lapse ?? false;
  const fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body, cookie: init?.headers?.Cookie });
    const respond = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });
    if (url.endsWith('/auth/login')) {
      logins++;
      const params = new URLSearchParams(init?.body ?? '');
      return params.get('password') === 'hunter2' ? respond(200, 'Ok.', { 'set-cookie': 'SID=abc123; HttpOnly; path=/' }) : respond(200, 'Fails.');
    }
    if (init?.headers?.Cookie !== 'SID=abc123') return respond(403, 'Forbidden');
    if (lapsed) { lapsed = false; return respond(403, 'Forbidden'); }
    if (url.endsWith('/torrents/info')) return respond(200, JSON.stringify(TORRENTS));
    if (url.endsWith('/torrents/stop') || url.endsWith('/torrents/start')) return options.stopMissing ? respond(404, '') : respond(200, '');
    if (url.endsWith('/torrents/pause') || url.endsWith('/torrents/resume')) return respond(200, '');
    return respond(404, '');
  };
  const host: DownloadsHost = {
    fetch: fetch as unknown as DownloadsHost['fetch'],
    readFile: () => 'hunter2\n',
    known: () => [{ title: 'Naruto', infoHash: '58D964E3' }, { title: 'Naruto Shippuden', infoHash: 'de2fee7c' }],
  };
  const downloads = new Downloads({ url: 'http://qb:8080', username: 'admin', passwordFile: '/pw' }, host);
  return { downloads, calls, logins: () => logins, host };
}

test('the config reads forward and is only ready with the password file', () => {
  assert.equal(readDownloadsConfig(undefined), null);
  assert.equal(readDownloadsConfig({ enabled: false }), null);
  const config = readDownloadsConfig({ enabled: true, qbittorrent: { url: 'http://qb:8080/' } })!;
  assert.equal(config.url, 'http://qb:8080');
  assert.equal(config.username, 'admin');
  assert.match(config.passwordFile, /qbittorrent-password$/);
  assert.equal(downloadsReady(config, () => false), false);
  assert.equal(downloadsReady(config, () => true), true);
  assert.equal(downloadsReady(null, () => true), false);
});

test('states fold to a few words, names shed their tags, and a show is matched by its words', () => {
  assert.equal(standing('stoppedDL'), 'paused');
  assert.equal(standing('pausedUP'), 'done');
  assert.equal(standing('stalledUP'), 'seeding');
  assert.equal(standing('forcedDL'), 'downloading');
  assert.equal(standing('queuedDL'), 'queued');
  assert.equal(standing('checkingResumeData'), 'checking');
  assert.equal(standing('missingFiles'), 'error');
  assert.equal(plainName('[Anime Time] Naruto Complete (001-220) [BD]'), 'Naruto Complete (001-220)');
  assert.ok(namesShow('[Sotark] Naruto Shippuden (001-500)', 'naruto'));
  assert.ok(namesShow('[Sotark] Naruto Shippuden (001-500)', 'Naruto Shippuden'));
  assert.ok(!namesShow('[Anime Time] Naruto Complete (001-220)', 'shippuden'));
  assert.ok(!namesShow('anything', ''));
});

test('status logs in once and says how each show is going', async () => {
  const { downloads, calls, logins } = fake();
  const status = await downloads.status() as { torrents: { show: string; state: string; percent: number; etaMinutes: number | null; downloadingKbps: number }[]; downloading: number; paused: number; finished: number };
  assert.equal(logins(), 1);
  assert.deepEqual(status.torrents.map(t => [t.show, t.state, t.percent, t.etaMinutes]), [
    ['Naruto', 'downloading', 38, 60], ['Naruto Shippuden', 'stalled', 19, null], ['Made in Abyss S1', 'done', 100, null],
  ]);
  assert.equal(status.downloading, 2);
  assert.equal(status.finished, 1);
  assert.equal(status.torrents[0].downloadingKbps, 4200);
  await downloads.status();
  assert.equal(logins(), 1, 'the session cookie is kept');
  assert.ok(calls.filter(c => c.url.endsWith('/torrents/info')).every(c => c.cookie === 'SID=abc123'));
});

test('pausing all stops every torrent; pausing one show stops only its hashes', async () => {
  const { downloads, calls } = fake();
  const all = await downloads.pause() as { paused: string[]; all: boolean };
  assert.deepEqual(all.paused, ['Naruto', 'Naruto Shippuden']);
  assert.equal(all.all, true);
  const stop = calls.find(c => c.url.endsWith('/torrents/stop'))!;
  assert.equal(stop.method, 'POST');
  assert.equal(new URLSearchParams(stop.body).get('hashes'), 'all');
  calls.length = 0;
  const one = await downloads.pause('shippuden') as { paused: string[] };
  assert.deepEqual(one.paused, ['Naruto Shippuden']);
  assert.equal(new URLSearchParams(calls.find(c => c.url.endsWith('/torrents/stop'))!.body).get('hashes'), 'de2fee7c');
  const none = await downloads.pause('bleach') as { error: string };
  assert.match(none.error, /Nothing downloading is called "bleach"/);
  assert.match(none.error, /Naruto, Naruto Shippuden, Made in Abyss S1/);
});

test('resuming acts only on what is paused, and an older qBittorrent gets pause/resume', async () => {
  const { downloads } = fake();
  const nothing = await downloads.resume() as { resumed: string[]; note: string };
  assert.deepEqual(nothing.resumed, []);
  assert.match(nothing.note, /already going/);
  const old = fake({ stopMissing: true });
  await old.downloads.pause();
  assert.ok(old.calls.some(c => c.url.endsWith('/torrents/stop')));
  assert.ok(old.calls.some(c => c.url.endsWith('/torrents/pause')), 'fell back to the old name');
});

test('a lapsed session logs in again once', async () => {
  const { downloads, logins } = fake({ lapse: true });
  const status = await downloads.status() as { torrents: unknown[] };
  assert.equal(status.torrents.length, 3);
  assert.equal(logins(), 2);
});

test('a wrong password is an error, not a pretend list', async () => {
  const { host } = fake();
  const wrong = new Downloads({ url: 'http://qb:8080', username: 'admin', passwordFile: '/pw' }, { fetch: host.fetch, readFile: () => 'nope' });
  await assert.rejects(() => wrong.status(), /refused the login/);
  const missing = new Downloads({ url: 'http://qb:8080', username: 'admin', passwordFile: '/pw' }, { fetch: host.fetch, readFile: () => { throw new Error('ENOENT'); } });
  await assert.rejects(() => missing.status(), /no qBittorrent password/);
});
