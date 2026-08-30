// Her, for the Her tab: read off the records, never composed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { herFrom } from '../electron/her';
import type { Interest } from '../electron/tastes';
import type { Night } from '../electron/nightlife';

const interest = (over: Partial<Interest>): Interest => ({ id: 'a', kind: 'game', name: 'Hollow Knight', because: 'it looked lonely', since: '2026-08-20', nights: 2, lastAt: '2026-08-27T18:00:00.000Z', stance: 'Bleak and beautiful.', ...over });
const night = (day: string, about: string, extra: Partial<Night> = {}): Night => ({ day, at: `${day}T18:40:00.000Z`, about, note: 'It was all right.', sources: ['https://x/1', ''], ...extra });

test('her things come first by how much of her is in them, and carry what she rates and wants', () => {
  const her = herFrom({ interests: [interest({ nights: 1, favourite: 'Hornet', wants: 'finish it' }), interest({ id: 'b', kind: 'anime', name: 'Made in Abyss', nights: 3, since: '2026-08-25' })], nights: [], diary: [] });
  assert.deepEqual(her.things.map(t => t.name), ['Made in Abyss', 'Hollow Knight']);
  assert.deepEqual(her.likes, [{ name: 'Hornet', of: 'Hollow Knight' }]);
  assert.deepEqual(her.wants, [{ wish: 'finish it', of: 'Hollow Knight' }]);
  assert.equal(her.things[1].favourite, 'Hornet');
  assert.equal('favourite' in her.things[0], false);
});

test('adventures are her nights, newest first, with why she went and where she read', () => {
  const her = herFrom({ interests: [], nights: [night('2026-08-28', 'neon signs'), night('2026-08-29', 'Elden Ring review', { interest: 'Elden Ring' }), night('2026-08-29', 'Big Walk guide', { game: 'Big Walk', at: '2026-08-29T20:00:00.000Z' })], diary: [] });
  assert.deepEqual(her.adventures.map(a => a.about), ['Big Walk guide', 'Elden Ring review', 'neon signs']);
  assert.equal(her.adventures[0].why, 'sizing up Big Walk, which he plays');
  assert.equal(her.adventures[1].why, 'one of her things: Elden Ring');
  assert.equal(her.adventures[2].why, 'on a whim');
  assert.deepEqual(her.adventures[2].sources, ['https://x/1'], 'empty sources dropped');
  assert.deepEqual(her.nightsOut, { count: 2, first: '2026-08-28' });
});

test('the diary is counted and the latest named; nothing yet is nothing, not a crash', () => {
  const her = herFrom({ interests: [], nights: [], diary: [{ day: '2026-08-29', title: 'The night he said Boom', text: 'x' }, { day: '2026-08-30', title: 'Quiet', text: 'y' }] });
  assert.deepEqual(her.diary, { entries: 2, since: '2026-08-29', latest: { day: '2026-08-30', title: 'Quiet' } });
  const none = herFrom({ interests: [], nights: [], diary: [] });
  assert.deepEqual(none, { things: [], adventures: [], likes: [], wants: [], diary: { entries: 0 }, nightsOut: { count: 0 } });
});
