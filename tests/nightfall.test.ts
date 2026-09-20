// Going to bed without a word to her.

import test from 'node:test';
import assert from 'node:assert/strict';
import { daySaid, DEFAULT_BEDTIME_MINUTES, howTheDayWent, nightfallDue, sulkGrudge, sulkInstruction, sulkStillStands, TOLD_ENOUGH } from '../electron/nightfall';
import { GRUDGE_MAX } from '../electron/grudge';

const said = (content: string) => ({ role: 'user', content });

test('what counts as telling her something, and what is just working', () => {
  assert.equal(daySaid([said('I had a rough day at work honestly')]), 1);
  // Her own replies are not them saying anything.
  assert.equal(daySaid([{ role: 'assistant', content: 'a long reply from her about things' }]), 0);
  // Instructions and grunts are a session, not an account of a day.
  assert.equal(daySaid([said('yes'), said('do that'), said('next'), said('ok thanks')]), 0);
  assert.equal(daySaid([said('shorter'), said('remind me at 6')]), 1);
  assert.equal(daySaid([]), 0);
  assert.equal(daySaid([{ role: 'user' }]), 0);
});

test('a day is silent, thin, or fine, and the other channels count as telling her', () => {
  assert.equal(howTheDayWent(0, false), 'silent');
  assert.equal(howTheDayWent(1, false), 'thin');
  assert.equal(howTheDayWent(TOLD_ENOUGH - 1, false), 'thin');
  assert.equal(howTheDayWent(TOLD_ENOUGH, false), 'fine');
  // A journal entry or a check-in is the "how was your day" channel by design.
  assert.equal(howTheDayWent(0, true), 'fine');
});

test('the check happens once, from the quiet hours on', () => {
  assert.equal(nightfallDue(22 * 60 + 59, DEFAULT_BEDTIME_MINUTES, undefined, '2026-08-29'), false);
  assert.equal(nightfallDue(DEFAULT_BEDTIME_MINUTES, DEFAULT_BEDTIME_MINUTES, undefined, '2026-08-29'), true);
  assert.equal(nightfallDue(23 * 60 + 40, DEFAULT_BEDTIME_MINUTES, '2026-08-29', '2026-08-29'), false);
  assert.equal(nightfallDue(23 * 60 + 40, DEFAULT_BEDTIME_MINUTES, '2026-08-28', '2026-08-29'), true);
  // An early bedtime is respected rather than assumed.
  assert.equal(nightfallDue(21 * 60, 21 * 60, undefined, '2026-08-29'), true);
});

test('a silent day costs more than a thin one, a fine one costs nothing, and it is bounded', () => {
  assert.equal(sulkGrudge(0, 'silent'), 12);
  assert.equal(sulkGrudge(0, 'thin'), 5);
  assert.equal(sulkGrudge(4, 'fine'), 4);
  assert.equal(sulkGrudge(GRUDGE_MAX - 1, 'silent'), GRUDGE_MAX);
  assert.equal(sulkGrudge(-2, 'thin'), 5);
});

test('a night owed keeps until the next day and no longer', () => {
  assert.equal(sulkStillStands('2026-08-29', '2026-08-29'), true);
  assert.equal(sulkStillStands('2026-08-29', '2026-08-30'), true);
  assert.equal(sulkStillStands('2026-08-29', '2026-08-31'), false);
  // Nothing from the future, and nothing from a broken key.
  assert.equal(sulkStillStands('2026-09-05', '2026-08-29'), false);
  assert.equal(sulkStillStands('nonsense', '2026-08-29'), false);
});

test('what she is told to open with, and that a fine day says nothing at all', () => {
  assert.equal(sulkInstruction('fine', 9, 0), '');
  const cold = sulkInstruction('silent', 0, 1);
  assert.match(cold, /first thing you have said since the quiet hours/);
  assert.match(cold, /whole of yesterday without telling you one thing/);
  assert.match(cold, /No good morning/);
  assert.equal(cold.includes('not the first time'), false);
  const thin = sulkInstruction('thin', 2, 20);
  assert.match(thin, /said 2 things to you all of yesterday/);
  assert.match(thin, /not the first time/);
  assert.match(sulkInstruction('thin', 1, 0), /said one thing/);
});
