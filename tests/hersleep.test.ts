// Her own bedtime and wake time: the window math, the decided-times parsing,
// and the thresholds for what a night's worth of messages costs her.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_AWAY_LINE, BEDTIME_MAX, BEDTIME_MIN, WAKE_MAX, WAKE_MIN,
  clockMinutes, clampBedtime, clampWake, dayAfter, daysBetween,
  decideTimesSystem, fallbackSchedule, goodnightDue, herAsleep,
  messagesWhileAsleep, parseDecidedTimes, readHerSleep, readHerSleepState,
  sleepWindowOn, wakeIrritation, wakeNote,
} from '../electron/hersleep';
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

test('readHerSleep defaults and keeps only sane HH:MM fallbacks', () => {
  assert.deepEqual(readHerSleep(undefined), { enabled: true, fallbackBedtime: '23:30', fallbackWake: '08:00' });
  assert.deepEqual(readHerSleep({ enabled: false }), { enabled: false, fallbackBedtime: '23:30', fallbackWake: '08:00' });
  assert.equal(readHerSleep({ fallbackBedtime: 'junk' }).fallbackBedtime, '23:30');
  assert.equal(readHerSleep({ fallbackBedtime: '22:15', fallbackWake: '07:45' }).fallbackBedtime, '22:15');
});

test('readHerSleepState rejects anything without the schedule fields', () => {
  assert.equal(readHerSleepState(null), null);
  assert.equal(readHerSleepState({ day: '2026-09-03' }), null);
  const parsed = readHerSleepState(schedule());
  assert.equal(parsed!.day, '2026-09-03');
  assert.equal(parsed!.announced, false);
});

test('two times come out of her answer, clamped to the sane ranges', () => {
  assert.deepEqual(parseDecidedTimes('23:30 08:00'), { bedtime: 23 * 60 + 30, wake: 8 * 60 });
  // A bedtime before noon is after midnight — 00:30 is 1470 minutes into the day.
  assert.deepEqual(parseDecidedTimes('00:30 08:00'), { bedtime: 24 * 60 + 30, wake: 8 * 60 });
  assert.deepEqual(parseDecidedTimes('bedtime is 23:45 and I will be up at 7:30am'), { bedtime: 23 * 60 + 45, wake: 7 * 60 + 30 });
  assert.equal(parseDecidedTimes('whenever I feel like it'), null);
  assert.equal(parseDecidedTimes('23:30'), null);
});

test('the fallback keeps her times hers-shaped: tired nights are earlier, never out of range', () => {
  const random = () => 0.5; // zero jitter
  assert.deepEqual(fallbackSchedule(readHerSleep(undefined), false, random), { bedtime: 23 * 60 + 30, wake: 8 * 60 });
  assert.equal(fallbackSchedule(readHerSleep(undefined), true, random).bedtime, 23 * 60 + 10);
  assert.equal(fallbackSchedule(readHerSleep({ fallbackBedtime: '23:30', fallbackWake: '08:00' }), false, random).wake, 8 * 60);
  assert.ok(clampBedtime(3 * 60) >= BEDTIME_MIN && clampBedtime(4 * 60) <= BEDTIME_MAX);
  assert.ok(clampWake(2 * 60) >= WAKE_MIN && clampWake(15 * 60) <= WAKE_MAX);
});

test('the sleep window belongs to the night: decision day, the morning after, and then it expires', () => {
  const s = schedule();
  assert.deepEqual(sleepWindowOn(s, '2026-09-03'), { fromMin: 23 * 60 + 30, toMin: 8 * 60 + 1440 });
  assert.deepEqual(sleepWindowOn(s, '2026-09-04'), { fromMin: 23 * 60 + 30 - 1440, toMin: 8 * 60 });
  assert.equal(sleepWindowOn(s, '2026-09-05'), null);
});

test('a bedtime after midnight keeps her up on the decision day and asleep at 00:30 the next', () => {
  const s = schedule({ bedtime: 24 * 60 + 30 });
  assert.equal(sleepWindowOn(s, '2026-09-03'), null, 'nothing of that night lands on the decision day');
  assert.deepEqual(sleepWindowOn(s, '2026-09-04'), { fromMin: 30, toMin: 8 * 60 });
});

test('herAsleep follows the window across the boundary', () => {
  const s = schedule();
  assert.equal(herAsleep(s, at('2026-09-03', 22, 0)), false, 'before bedtime, still up');
  assert.equal(herAsleep(s, at('2026-09-03', 23, 45)), true, 'after bedtime, asleep');
  assert.equal(herAsleep(s, at('2026-09-04', 1, 0)), true, 'the small hours');
  assert.equal(herAsleep(s, at('2026-09-04', 7, 59)), true, 'just before wake');
  assert.equal(herAsleep(s, at('2026-09-04', 8, 1)), false, 'just after wake');
  assert.equal(herAsleep(s, at('2026-09-05', 1, 0)), false, 'the night after, stale');
  assert.equal(herAsleep(null, at('2026-09-04', 1, 0)), false, 'no schedule, no sleep');
});

test('messagesWhileAsleep counts both sides of midnight, nothing else', () => {
  const s = schedule();
  const heard = [
    { at: '2026-09-03T12:00:00.000Z' }, // 20:00 AWST — evening, awake
    { at: '2026-09-03T15:45:00.000Z' }, // 23:45 AWST — after bedtime
    { at: '2026-09-03T16:10:00.000Z' }, // 00:10 AWST — small hours
    { at: '2026-09-04T00:00:00.000Z' }, // 08:00 AWST — exactly wake, not asleep
    { at: '2026-09-04T10:00:00.000Z' }, // 18:00 AWST — awake, the next evening
  ];
  assert.equal(messagesWhileAsleep(s, heard, ZONE), 2);
  assert.equal(messagesWhileAsleep(s, [], ZONE), 0);
});

test('the wake note and its cost follow the agreed thresholds', () => {
  assert.equal(wakeNote(0, '08:00'), '');
  assert.equal(wakeNote(1, '08:00'), '');
  assert.match(wakeNote(2, '08:00'), /texted you 2 times/);
  assert.match(wakeNote(3, '08:00'), /Be annoyed/);
  assert.match(wakeNote(4, '08:00'), /properly annoyed/);
  assert.equal(wakeIrritation(0), 0);
  assert.equal(wakeIrritation(1), 0);
  assert.equal(wakeIrritation(2), 1);
  assert.equal(wakeIrritation(3), 1);
  assert.equal(wakeIrritation(4), 2);
});

test('goodnightDue is only in the run-up to her bedtime, and never once she is asleep', () => {
  const s = schedule();
  assert.equal(goodnightDue(s, at('2026-09-03', 21, 30)), false, 'too early');
  assert.equal(goodnightDue(s, at('2026-09-03', 22, 45)), true, 'half an hour out');
  assert.equal(goodnightDue(s, at('2026-09-03', 23, 15)), true, 'fifteen minutes out');
  assert.equal(goodnightDue(s, at('2026-09-03', 23, 25)), false, 'too close, about to go');
  assert.equal(goodnightDue(s, at('2026-09-03', 23, 45)), false, 'already asleep');
  assert.equal(goodnightDue(s, at('2026-09-04', 22, 45)), false, 'the next evening, schedule stale');
});

test('day helpers are stable across months', () => {
  assert.equal(dayAfter('2026-09-03'), '2026-09-04');
  assert.equal(dayAfter('2026-12-31'), '2027-01-01');
  assert.equal(daysBetween('2026-09-03', '2026-09-04'), 1);
  assert.equal(daysBetween('2026-09-03', '2026-09-03'), 0);
  assert.equal(daysBetween('2026-09-03', '2026-09-05'), 2);
});

test('the deciding prompt asks for exactly two times', () => {
  const system = decideTimesSystem(at('2026-09-03', 19, 30));
  assert.match(system, /two 24-hour times/);
  assert.match(system, /tonight's bedtime first/);
});

test('clockMinutes wraps an after-midnight bedtime into a clock you can read', () => {
  assert.equal(clockMinutes(23 * 60 + 30), '23:30');
  assert.equal(clockMinutes(24 * 60 + 30), '00:30');
  assert.equal(clockMinutes(8 * 60), '08:00');
});