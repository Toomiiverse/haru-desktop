import test from 'node:test';
import assert from 'node:assert/strict';
import { readPushPrefs } from '../electron/push';

test('4750: a wake time is kept only in its exact shape, and a body without it leaves it alone', () => {
  assert.equal(readPushPrefs({ wakeAt: '2026-10-23T06:30' }).wakeAt, '2026-10-23T06:30');
  assert.equal(readPushPrefs({ wakeAt: '6:30' }).wakeAt, '');
  assert.equal(readPushPrefs({ wakeAt: '2026-10-23T24:00' }).wakeAt, '');
  assert.equal(readPushPrefs({}).wakeAt, '');
  const current = readPushPrefs({ wakeAt: '2026-10-23T06:30' });
  assert.equal(readPushPrefs({ ...current, random: false }).wakeAt, '2026-10-23T06:30');   // the sheet's save merges over it
});
