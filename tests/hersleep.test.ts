// Her own bedtime and wake time: the window math, the decided-times parsing,
// and the thresholds for what a night's worth of messages costs her.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_AWAY_LINE, asleepLine, BEDTIME_MAX, BEDTIME_MIN, WAKE_MAX, WAKE_MIN,
  clockMinutes, clampBedtime, clampWake, dayAfter, daysBetween,
  decideTimesSystem, fallbackSchedule, goodnightDue, herAsleep,
  messagesWhileAsleep, parseDecidedTimes, readHerSleep, readHerSleepState,
  sleepWindowOn, wakeIrritation, wakeNote, foldAsleepExchanges, isAsleepLine, enoughKnocking, wokenAt, sleepNote, KNOCK_COUNT, KNOCK_WINDOW_MS, groggyFor, groggyNote, GROGGY_REGISTER, knockedAwake, dozeOffDue, pointlessWake, backToSleep, readWakes, pointlessWakesLately, DOZE_MINUTES, BLOCKED_LINE, BLOCKED_LINES, blockedLine, BLOCK_AFTER_POINTLESS, readsAsGoodnight } from '../electron/hersleep';
import { zonedNow } from '../electron/dates';

const ZONE = 'Australia/Perth';
const at = (day: string, hour: number, minute = 0) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute);
};

function schedule(overrides: Partial<ReturnType<typeof readHerSleepState> extends infer T ? NonNullable<T> : never> = {}) {
  return {
    day: '2026-09-03',
    bedtime: 23 * 60 + 30,
    wake: 8 * 60,
    decidedAt: '2026-09-03T12:00:00.000Z',
    wakeHandled: false,
    announced: false,
    ...overrides,
  };
}

test('the away line is fixed, in her first person, and needs no model', () => {
  assert.match(ASLEEP_AWAY_LINE, /I'm asleep/);
  assert.match(ASLEEP_AWAY_LINE, /when I'm up/);
  assert.doesNotMatch(ASLEEP_AWAY_LINE, /She's/);
});
