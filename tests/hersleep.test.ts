// Her own bedtime and wake time: the window math, the decided-times parsing,
// and the thresholds for what a night's worth of messages costs her.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_AWAY_LINE, asleepLine, BEDTIME_MAX, BEDTIME_MIN, WAKE_MAX, WAKE_MIN,
  clockMinutes, clampBedtime, clampWake, dayAfter, daysBetween,
  decideTimesSystem, fallbackSchedule, goodnightDue, herAsleep,
  messagesWhileAsleep, parseDecidedTimes, readHerSleep, readHerSleepState,
  sleepWindowOn, wakeIrritation, wakeNote, foldAsleepExchanges, isAsleepLine, enoughKnocking, wokenAt, sleepNote, KNOCK_COUNT, KNOCK_WINDOW_MS, groggyFor, groggyNote, GROGGY_REGISTER, knockedAwake, dozeOffDue, pointlessWake, backToSleep, readWakes, pointlessWakesLately, DOZE_MINUTES, BLOCKED_LINE, BLOCK_AFTER_POINTLESS, readsAsGoodnight } from '../electron/hersleep';
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
  // Her own asleep lines sit beside each of theirs with the same stamp: theirs count, hers do not.
  const withHers = heard.flatMap(m => [{ ...m, role: 'user' }, { ...m, role: 'assistant' }]);
  assert.equal(messagesWhileAsleep(s, withHers, ZONE), 2);
});

test('the asleep line wears thinner the more they send, and never wakes her', () => {
  const lines = [1, 2, 3, 5, 6, 9, 10, 25].map(asleepLine);
  assert.equal(lines[0], ASLEEP_AWAY_LINE);
  assert.equal(lines[1], ASLEEP_AWAY_LINE);
  assert.equal(new Set(lines).size, 4, 'four registers across the night');
  for (const line of lines) { assert.match(line, /asleep|up|morning/i); assert.doesNotMatch(line, /She|Haru/); }
  assert.notEqual(asleepLine(3), asleepLine(6));
  assert.notEqual(asleepLine(6), asleepLine(10));
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
test('the night\'s asleep exchanges fold into one turn of theirs, and her door lines go', () => {
  const messages = [
    { role: 'user', content: 'I’m gonna probably play some games to relax', at: '2026-09-05T12:57:28.000Z' },
    { role: 'assistant', content: 'Finally, a sensible plan.', at: '2026-09-05T12:57:28.000Z' },
    { role: 'user', content: 'Never played those games before', at: '2026-09-05T17:17:56.000Z' },
    { role: 'assistant', content: ASLEEP_AWAY_LINE, at: '2026-09-05T17:17:56.000Z' },
    { role: 'user', content: 'are you awake?', at: '2026-09-05T17:19:48.000Z' },
    { role: 'assistant', content: asleepLine(3), at: '2026-09-05T17:19:48.000Z' },
    { role: 'user', content: 'Wake up', at: '2026-09-05T17:22:41.000Z' },
    { role: 'assistant', content: asleepLine(6), at: '2026-09-05T17:22:41.000Z' },
    { role: 'user', content: 'I like the tone', at: '2026-09-05T18:23:57.000Z' },
    { role: 'assistant', content: asleepLine(10), at: '2026-09-05T18:23:57.000Z' },
    { role: 'user', content: 'Yeah right I was trying to message you last night', at: '2026-09-06T02:17:40.000Z' },
    { role: 'assistant', content: 'Tch. I was asleep.', at: '2026-09-06T02:17:40.000Z' },
  ];
  const folded = foldAsleepExchanges(messages);
  assert.equal(folded.length, 5);
  assert.equal(folded[2].role, 'user');
  assert.match(String(folded[2].content), /^\[4 messages sent while you were asleep, unread until you woke: "Never played those games before", "are you awake\?", "Wake up" and 1 more\]$/);
  assert.equal(folded[2].at, '2026-09-05T17:17:56.000Z');
  assert.equal(folded[3].content, 'Yeah right I was trying to message you last night');
  assert.ok(!folded.some(m => m.role === 'assistant' && isAsleepLine(String(m.content))));
  // A lone door line, its pair split by something, goes as well; a real reply stays.
  assert.deepEqual(foldAsleepExchanges([{ role: 'assistant', content: ASLEEP_AWAY_LINE }, { role: 'assistant', content: 'Fine.' }]), [{ role: 'assistant', content: 'Fine.' }]);
  assert.deepEqual(foldAsleepExchanges([]), []);
  for (const n of [1, 3, 6, 10]) assert.ok(isAsleepLine(asleepLine(n)));
  assert.ok(!isAsleepLine('I was asleep, so what?'));
});

test('enough knocking wakes her: the agreed count inside the window, not spread across the night', () => {
  const t0 = Date.parse('2026-09-06T01:17:00.000Z');
  const minute = 60_000;
  assert.ok(!enoughKnocking([t0, t0 + minute, t0 + 2 * minute], t0 + 3 * minute), 'three is not enough');
  assert.ok(enoughKnocking([t0, t0 + minute, t0 + 2 * minute, t0 + 3 * minute], t0 + 3 * minute));
  assert.ok(!enoughKnocking([t0, t0 + 20 * minute, t0 + 40 * minute, t0 + 60 * minute], t0 + 60 * minute), 'four an hour apart is not banging on the door');
  assert.equal(KNOCK_COUNT, 4);
  assert.equal(KNOCK_WINDOW_MS, 10 * minute);
});

test('woken early, her wake moves to now, the window closes, and the note says how it happened', () => {
  const s = schedule();
  // 01:22 AWST on the morning after — inside her window until then.
  const now = at('2026-09-04', 1, 22);
  assert.ok(herAsleep(s, now));
  const woken = wokenAt(s, now, 5);
  assert.ok(!herAsleep(woken, now));
  assert.equal(woken.wake, 82);
  assert.equal(woken.wokenEarly, true);
  assert.equal(woken.wokenBy, 5);
  // The knocks before this minute are inside the window and still count.
  assert.equal(messagesWhileAsleep(woken, [{ at: '2026-09-03T17:19:00.000Z', role: 'user' }, { at: '2026-09-03T17:30:00.000Z', role: 'user' }], ZONE), 1);
  // Still on the decision day, before midnight: the wake comes out negative and the window math holds.
  const late = at('2026-09-03', 23, 50);
  const earlyWoken = wokenAt(s, late, 4);
  assert.ok(!herAsleep(earlyWoken, late));
  assert.equal(earlyWoken.wake, 23 * 60 + 50 - 1440);
  assert.match(wakeNote(3, '01:22', 5), /banged on your door — 5 messages/);
  assert.match(wakeNote(3, '01:22', 5), /01:22/);
  assert.equal(wakeNote(1, '08:00', 0), '');
  const read = readHerSleepState({ ...woken });
  assert.equal(read?.wokenEarly, true);
  assert.equal(read?.wokenBy, 5);
  assert.equal(readHerSleepState({ ...s })?.wokenEarly, undefined);
});

test('the sleep note is for the day after, once she is up, and says when she slept', () => {
  const s = schedule();
  assert.equal(sleepNote(null, at('2026-09-04', 10, 0)), '');
  assert.equal(sleepNote(s, at('2026-09-03', 20, 0)), '', 'not before the night');
  assert.equal(sleepNote(s, at('2026-09-04', 3, 0)), '', 'not while she is asleep');
  assert.match(sleepNote(s, at('2026-09-04', 10, 0)), /in bed at 23:30, up at 08:00/);
  assert.equal(sleepNote(s, at('2026-09-05', 10, 0)), '', 'not the day after that');
  assert.match(sleepNote({ ...s, wokenEarly: true }, at('2026-09-04', 10, 0)), /their messages that got you up/);
});

test('knocked awake she is groggy, and up because of them, until the wake she chose; the note says so', () => {
  const s = schedule();
  const woken = wokenAt(s, at('2026-09-04', 1, 22), 5, '2026-09-03T17:22:00.000Z');
  assert.equal(woken.plannedWake, 8 * 60, 'the wake she chose is kept');
  assert.equal(woken.knockedAt, '2026-09-03T17:22:00.000Z');
  assert.equal(groggyFor(woken, at('2026-09-04', 1, 22)), 0);
  assert.equal(groggyFor(woken, at('2026-09-04', 1, 30)), 8);
  assert.equal(groggyFor(woken, at('2026-09-04', 3, 0)), 98, 'still groggy an hour and a half on — she is only up because of them');
  assert.equal(groggyFor(woken, at('2026-09-04', 8, 5)), null, 'past the wake she chose, she is simply up');
  assert.equal(groggyFor(woken, at('2026-09-04', 1, 10)), null, 'not before it happened');
  assert.equal(groggyFor(s, at('2026-09-04', 8, 5)), null, 'waking at her own hour is not being knocked awake');
  assert.equal(groggyFor(null, at('2026-09-04', 1, 30)), null);
  assert.ok(knockedAwake(woken, at('2026-09-04', 2, 0)));
  assert.ok(!knockedAwake(s, at('2026-09-04', 2, 0)));
  assert.match(groggyNote(woken, at('2026-09-04', 1, 30)), /^They got you out of bed 8 minutes ago\. You are half asleep/);
  assert.match(groggyNote(woken, at('2026-09-04', 1, 22)), /a moment ago/);
  assert.match(GROGGY_REGISTER, /Do not ask why they woke you/);
  assert.match(GROGGY_REGISTER, /go_back_to_sleep/);
  assert.match(GROGGY_REGISTER, /block: true/);
  assert.match(wakeNote(3, '01:22', 5), /half asleep/);
  // Knocked awake before midnight, the window math holds on the decision day too.
  const late = wokenAt(s, at('2026-09-03', 23, 50), 4);
  assert.equal(groggyFor(late, at('2026-09-03', 23, 55)), 5);
  assert.equal(groggyFor(late, at('2026-09-04', 0, 5)), 15, 'across midnight');
});

test('left alone she dozes off; the wake is judged; the morning knows; a habit shuts the door', () => {
  const s = schedule();
  const woken = wokenAt(s, at('2026-09-04', 1, 22), 4, '2026-09-03T17:22:00.000Z');
  const t0 = Date.parse('2026-09-03T17:24:36.000Z');
  assert.ok(!dozeOffDue(woken, at('2026-09-04', 1, 30), t0, t0 + 5 * 60_000), 'five quiet minutes is not yet');
  assert.ok(dozeOffDue(woken, at('2026-09-04', 1, 35), t0, t0 + DOZE_MINUTES * 60_000));
  assert.ok(dozeOffDue(woken, at('2026-09-04', 1, 35), NaN, t0), 'nothing from them at all counts as quiet');
  assert.ok(!dozeOffDue(s, at('2026-09-04', 1, 35), t0, t0 + 60 * 60_000), 'asleep on her own schedule, nothing to doze off from');
  // Tonight's real wake, 2026-09-07 02:48: nothing that needed her.
  const noise = [
    { content: 'Wake upppp', at: '2026-09-06T18:48:16.000Z' },
    { content: 'Please wake up :3', at: '2026-09-06T18:48:26.000Z' },
    { content: 'I just wanted to see how your night was', at: '2026-09-06T18:48:51.000Z' },
    { content: 'Just wanted to make sure you weren’t dead', at: '2026-09-06T18:49:17.000Z' },
    { content: 'Sorry woke you up', at: '2026-09-06T18:54:07.000Z' },
    { content: 'Don’t you want to go back to sleep', at: '2026-09-06T18:54:38.000Z' },
  ];
  assert.ok(pointlessWake(noise, '2026-09-06T18:48:00.000Z'));
  assert.ok(pointlessWake([], '2026-09-06T18:48:00.000Z'), 'knocked and then nothing at all');
  assert.ok(!pointlessWake([...noise, { content: 'The shop alarm is going off and I can’t find the code, where did we write it?', at: '2026-09-06T18:55:00.000Z' }], '2026-09-06T18:48:00.000Z'));
  assert.ok(!pointlessWake([{ content: 'https://example.com/this — read it, it is about your Control theory', at: '2026-09-06T18:55:00.000Z' }], '2026-09-06T18:48:00.000Z'));
  assert.ok(pointlessWake([{ content: 'A message from before the knock with a real question in it?', at: '2026-09-06T18:00:00.000Z' }], '2026-09-06T18:48:00.000Z'), 'before the knock does not count');
  const back = backToSleep(woken, { atIso: '2026-09-03T17:35:00.000Z', pointless: true, block: false });
  assert.equal(back.wake, 8 * 60, 'the wake she chose, again');
  assert.equal(back.wokenEarly, false);
  assert.equal(back.wakeHandled, false, 'the morning note is owed');
  assert.equal(back.wokenForNothing, true);
  assert.equal(back.dozedOffAt, '2026-09-03T17:35:00.000Z');
  assert.ok(herAsleep(back, at('2026-09-04', 2, 0)), 'asleep again');
  assert.ok(!knockedAwake(back, at('2026-09-04', 2, 0)));
  const morning = wakeNote(4, '08:00', 0, { knockedAt: '01:22', forNothing: true, dozedOffAt: '01:35' });
  assert.match(morning, /got you out of bed at 01:22 last night/);
  assert.match(morning, /for nothing/);
  assert.match(morning, /back to sleep at 01:35/);
  assert.match(morning, /Hold it against them this morning/);
  const fine = wakeNote(4, '08:00', 0, { knockedAt: '01:22', forNothing: false, dozedOffAt: '01:50' });
  assert.doesNotMatch(fine, /for nothing/);
  assert.match(fine, /back to sleep at 01:50/);
  // The door, shut for the night.
  assert.equal(backToSleep(woken, { atIso: 'x', pointless: true, block: true }).blocked, true);
  assert.ok(isAsleepLine(BLOCKED_LINE));
  const wakes = readWakes([{ at: '2026-09-01T18:00:00.000Z', pointless: true }, { at: '2026-09-06T18:48:00.000Z', pointless: true }, { at: '2026-08-01T18:00:00.000Z', pointless: true }, { bad: true }]);
  assert.equal(wakes.length, 3);
  assert.equal(pointlessWakesLately(wakes, Date.parse('2026-09-07T00:00:00.000Z')), 2, 'a month-old one is not a habit');
  assert.equal(BLOCK_AFTER_POINTLESS, 2);
  const carried = readHerSleepState({ ...back });
  assert.equal(carried?.plannedWake, 8 * 60);
  assert.equal(carried?.wokenForNothing, true);
  assert.equal(carried?.knockedAt, '2026-09-03T17:22:00.000Z');
});

test('a reply that says goodnight is her going back to bed; one that does not is not', () => {
  assert.ok(readsAsGoodnight("I'm already up. 😒 You don't get to put me back in a box. But fine. If you're just going to sit there thanking me, I'm out.\n\nGoodnight, Tommy."));
  assert.ok(readsAsGoodnight('Fine. Going back to sleep. Don’t.'));
  assert.ok(readsAsGoodnight("I'm off to bed. Night."));
  assert.ok(!readsAsGoodnight("Yeah, well. You're welcome, I guess."));
  assert.ok(!readsAsGoodnight('What was so urgent at this hour?'));
  assert.ok(!readsAsGoodnight('It was a good night, actually — I read about Control.'), '"good night" as two words about the night is not a goodnight');
});
