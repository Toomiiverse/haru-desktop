// The quiet ending is not an alarm clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { awakeHoursSince, quietEndedAt, theyAreUp, upByAt } from '../electron/awake';

const prefs = { quietFrom: '23:00', quietTo: '06:00', upBy: '09:00' };
const at = (h: number, m = 0, d = 30) => new Date(2026, 7, d, h, m, 0, 0);
const iso = (h: number, m = 0, d = 30) => at(h, m, d).toISOString();

test('when the quiet most recently ended', () => {
  assert.equal(quietEndedAt(prefs, at(7))?.getHours(), 6);
  assert.equal(quietEndedAt(prefs, at(7))?.getDate(), 30);
  // Before six, the most recent end was yesterday's.
  assert.equal(quietEndedAt(prefs, at(3))?.getDate(), 29);
  assert.equal(quietEndedAt({ quietFrom: '08:00', quietTo: '08:00' }, at(7)), null);
  assert.equal(upByAt(prefs, at(7))?.getHours(), 9);
  assert.equal(upByAt({ upBy: '' }, at(7)), null);
});

test('a sign of life since the quiet ended means up; the night itself does not', () => {
  // Nothing since six: not up at 06:02, however long the floor has run.
  assert.equal(theyAreUp({ lastMessageAt: iso(23, 30, 29) }, prefs, at(6, 2)), false);
  assert.equal(theyAreUp({}, prefs, at(7, 28)), false);
  // A message, the page opened, or the desk in use: up.
  assert.equal(theyAreUp({ lastMessageAt: iso(6, 40) }, prefs, at(7)), true);
  assert.equal(theyAreUp({ lastOpenedAt: iso(6, 5) }, prefs, at(7)), true);
  assert.equal(theyAreUp({ lastActivityAt: iso(6, 50) }, prefs, at(7)), true);
  // A sign from yesterday is not a sign from this morning.
  assert.equal(theyAreUp({ lastOpenedAt: iso(22, 0, 29) }, prefs, at(7)), false);
});

test('with no sign, the hour they are up by decides — and only on that morning', () => {
  assert.equal(theyAreUp({}, prefs, at(8, 59)), false);
  assert.equal(theyAreUp({}, prefs, at(9, 0)), true);
  assert.equal(theyAreUp({}, prefs, at(14)), true);
  // Late evening before the quiet: past nine, but that nine was before this night — still "up" from the day, which is right.
  assert.equal(theyAreUp({}, prefs, at(22)), true);
  // No deadline set and no sign: not up.
  assert.equal(theyAreUp({}, { ...prefs, upBy: '' }, at(14)), false);
  // No quiet hours at all: nothing to have slept through.
  assert.equal(theyAreUp({}, { quietFrom: '08:00', quietTo: '08:00', upBy: '' }, at(3)), true);
});

test('hours of silence do not include the hours they were asleep', () => {
  // Last word at half eleven, now half seven: one and a half hours since six, not eight.
  assert.equal(awakeHoursSince(iso(23, 30, 29), prefs, at(7, 30)), 1);
  assert.equal(awakeHoursSince(iso(23, 30, 29), prefs, at(9, 5)), 3);
  // Spoke this morning: counted from then.
  assert.equal(awakeHoursSince(iso(6, 40), prefs, at(9, 50)), 3);
  assert.equal(awakeHoursSince(undefined, prefs, at(9)), null);
});
