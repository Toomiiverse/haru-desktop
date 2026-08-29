// Steam's record of their play — a key and an id, never a login.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecentlyPlayed, readSteamWebConfig, recentlyPlayed, recentlyPlayedUrl } from '../electron/steamweb';

test('the id has to look like one', () => {
  assert.equal(readSteamWebConfig({ steamId: ' 76561198000000000 ' }).steamId, '76561198000000000');
  assert.equal(readSteamWebConfig({ steamId: 'tommy' }).steamId, '');
  assert.equal(readSteamWebConfig(undefined).steamId, '');
});

test('the request carries the key and id, and the answer is reduced to names and minutes', () => {
  const url = new URL(recentlyPlayedUrl('K', '76561198000000000'));
  assert.equal(url.hostname, 'api.steampowered.com');
  assert.equal(url.searchParams.get('key'), 'K');
  assert.equal(url.searchParams.get('steamid'), '76561198000000000');
  assert.deepEqual(parseRecentlyPlayed({ response: { games: [{ name: 'Hades', playtime_2weeks: 120, playtime_forever: 9000 }, { appid: 1 }, { name: ' Elden Ring ', playtime_2weeks: '30' }] } }),
    [{ name: 'Hades', minutesLastFortnight: 120 }, { name: 'Elden Ring', minutesLastFortnight: 30 }]);
  assert.deepEqual(parseRecentlyPlayed({ response: {} }), []);
  assert.deepEqual(parseRecentlyPlayed(null), []);
});

test('nothing configured asks Steam nothing; a refused key is said plainly', async () => {
  let asked = 0;
  const never = async () => { asked++; return { ok: true, status: 200, json: async () => ({}) }; };
  assert.deepEqual(await recentlyPlayed('', { steamId: '76561198000000000' }, never), []);
  assert.deepEqual(await recentlyPlayed('K', { steamId: '' }, never), []);
  assert.equal(asked, 0);
  await assert.rejects(recentlyPlayed('K', { steamId: '76561198000000000' }, async () => ({ ok: false, status: 403, json: async () => ({}) })), /refused the key/);
  const got = await recentlyPlayed('K', { steamId: '76561198000000000' }, async () => ({ ok: true, status: 200, json: async () => ({ response: { games: [{ name: 'Hades', playtime_2weeks: 60 }] } }) }));
  assert.deepEqual(got, [{ name: 'Hades', minutesLastFortnight: 60 }]);
});
