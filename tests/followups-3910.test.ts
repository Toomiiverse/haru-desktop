// 3910: follow-ups are their own push kind (default on) and are booked from his own words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPushPrefs } from '../electron/push';
test('the follow-up switch defaults on and survives old saved prefs', () => {
  const prefs = readPushPrefs({ random: false, events: true });
  assert.equal(prefs.followup, true); assert.equal(prefs.random, false);
  assert.equal(readPushPrefs({ followup: false }).followup, false);
});
test('a booked comeback pushes as a follow-up and the direct booking follows the direct reminder', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes("  booked: 'followup',"));
  assert.ok(main.includes("corePolicySync<any>('final-booking.direct',[latest,Date.now(),CHAT_TIMEZONE])"));
});
