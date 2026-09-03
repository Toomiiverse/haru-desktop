// Her own life: the anniversaries, the wants ledger, and the daytime pass.
// The milestone math, the want outcomes and the day gating are the parts that
// can be wrong without anyone noticing, so they are pinned down here.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceWant, DAY_END_HOUR, DAY_ODDS, DAY_START_HOUR, dayNote, dayPassDue,
  firstsNote, keepDay, markRecFollowed, noteRecommendation, pickRecommend,
  pickWantToWork, readDays, readRecs, readWants, reconcileWants,
  recDueForFollowUp, wantInstruction, wantOutcome, wantQuery, wantsNote,
  weekKey, weekNote, weekReflectionInstruction, weekSummaryDue,
} from '../electron/ownlife';

const at = (day: string, hour: number, minute = 0) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute);
};

function interest(name: string, since: string, nights: number, wants?: string) {
  return { id: `i-${name}`, kind: 'anime' as const, name, since, nights, lastAt: '', stance: 'fine', ...(wants ? { wants } : {}) };
}

test('firstsNote names a milestone only when it is current', () => {
  const today = '2026-09-30';
  const interests = [
    interest('Chainsaw Man', '2026-08-30', 5),  // 31 days — a month just passed
    interest('Hades', '2026-09-27', 1),          // 3 days — nothing yet
    interest('Lain', '2026-09-15', 2),           // 15 days — two weeks just passed
    interest('Bebop', '2026-09-30', 1),          // today — nothing
  ];
  const note = firstsNote(interests, today);
  assert.match(note, /A month since you took up Chainsaw Man/);
  assert.match(note, /Two weeks since you took up Lain/);
  assert.doesNotMatch(note, /Hades/);
  assert.doesNotMatch(note, /Bebop/);
});

test('firstsNote stays quiet when nothing is current, and skips future dates', () => {
  assert.equal(firstsNote([interest('Bebop', '2026-09-30', 1)], '2026-10-01'), '');
  assert.equal(firstsNote([interest('Bebop', '2026-10-05', 1)], '2026-10-01'), '', 'taken up in the future');
});

test('reconcileWants seeds a want per interest wording and does not duplicate', () => {
  const seeded = reconcileWants([interest('Bebop', '2026-09-30', 1, 'to learn piano')], [], '2026-09-30T00:00:00.000Z');
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].interest, 'Bebop');
  assert.equal(seeded[0].text, 'to learn piano');
  assert.equal(seeded[0].status, 'declared');
  // Same wording again, now with a done record — still no duplicate.
  const done = reconcileWants([interest('Bebop', '2026-09-30', 1, 'to learn piano')], [{ ...seeded[0], status: 'done' as const }], '2026-10-02T00:00:00.000Z');
  assert.equal(done.length, 1);
  assert.equal(done[0].status, 'done');
  // New wording is a new want.
  const again = reconcileWants([interest('Bebop', '2026-09-30', 1, 'to learn bass')], done, '2026-10-02T00:00:00.000Z');
  assert.equal(again.length, 2);
});

test('readWants keeps only well-formed records', () => {
  assert.equal(readWants(null).length, 0);
  assert.equal(readWants([{ id: 'a', text: 'x', since: 'd', nights: 0, status: 'declared' }, { junk: true }]).length, 1);
});

test('pickWantToWork prefers the interest being deepened, and only active wants', () => {
  const wants = [
    { id: '1', interest: 'Bebop', text: 'to learn piano', since: 'd', nights: 0, status: 'declared' as const },
    { id: '2', interest: 'Hades', text: 'to get out of Elysium', since: 'd', nights: 4, status: 'working' as const },
    { id: '3', interest: 'Lain', text: 'to argue', since: 'd', nights: 2, status: 'dropped' as const },
  ];
  assert.equal(pickWantToWork(wants, 'Bebop')!.id, '1');
  assert.equal(pickWantToWork(wants, 'Lain'), null, 'that one was dropped');
  assert.ok(['1', '2'].includes(pickWantToWork(wants, undefined)!.id));
});

test('wantOutcome is weighted and respects the early-night floors', () => {
  assert.equal(wantOutcome(0.1, 0).kind, 'slog');
  assert.equal(wantOutcome(0.1, 3).kind, 'slog');
  // The clicked and gave-up windows re-roll to slog on the first attempts.
  assert.equal(wantOutcome(0.55, 0).kind, 'slog', 'clicked, but too early');
  assert.equal(wantOutcome(0.55, 2).kind, 'clicked');
  assert.equal(wantOutcome(0.70, 0).kind, 'slog', 'gave up, but too early');
  assert.equal(wantOutcome(0.70, 1).kind, 'gave_up');
  assert.equal(wantOutcome(0.90, 0).kind, 'nothing');
});

test('advanceWant moves status and counts the night', () => {
  const want = { id: '1', interest: 'Bebop', text: 'to learn piano', since: 'd', nights: 0, status: 'declared' as const };
  assert.equal(advanceWant(want, { kind: 'slog' }, 'still bad').status, 'working');
  assert.equal(advanceWant(want, { kind: 'slog' }, 'still bad').nights, 1);
  assert.equal(advanceWant(want, { kind: 'clicked' }, 'it clicked').status, 'done');
  assert.equal(advanceWant(want, { kind: 'gave_up' }, 'not worth it').status, 'dropped');
  assert.equal(advanceWant(want, { kind: 'nothing' }, '').nights, 1);
});

test('wantsNote shows only the declared and working ones, with progress', () => {
  const note = wantsNote([
    { id: '1', interest: 'Bebop', text: 'to learn piano', since: 'd', nights: 2, status: 'working' as const, note: 'the piano is the problem' },
    { id: '2', interest: 'Lain', text: 'to argue about Lain', since: 'd', nights: 1, status: 'dropped' as const },
  ]);
  assert.match(note, /Things you are trying to do/);
  assert.match(note, /Bebop: learn piano/);
  assert.match(note, /the piano is the problem/);
  assert.doesNotMatch(note, /argue about Lain/);
});

test('wantQuery turns the want into a search and the instruction names the attempt', () => {
  assert.equal(wantQuery({ id: '1', interest: 'Bebop', text: 'to learn piano just to play The Real Folk Blues badly', since: 'd', nights: 0, status: 'declared' }), 'how to learn piano just to play The Real Folk Blues badly');
  const instruction = wantInstruction({ id: '1', interest: 'Bebop', text: 'to learn piano', since: 'd', nights: 1, status: 'working' }, { kind: 'slog' }, 'the reading');
  assert.match(instruction, /2nd night/);
  assert.match(instruction, /only thing you did/);
});

test('the daytime pass runs in the day, once a day, and mostly', () => {
  assert.equal(dayPassDue(at('2026-09-04', 9, 59), '2026-09-04', false, 0.1), false, 'before ten');
  assert.equal(dayPassDue(at('2026-09-04', 10, 0), '2026-09-04', false, 0.1), true);
  assert.equal(dayPassDue(at('2026-09-04', 16, 59), '2026-09-04', false, 0.1), true);
  assert.equal(dayPassDue(at('2026-09-04', 17, 0), '2026-09-04', false, 0.1), false, 'past five');
  assert.equal(dayPassDue(at('2026-09-04', 12, 0), '2026-09-04', true, 0.1), false, 'already done today');
  assert.equal(dayPassDue(at('2026-09-04', 12, 0), '2026-09-04', false, DAY_ODDS + 0.01), false, 'the roll missed');
  assert.ok(DAY_START_HOUR < DAY_END_HOUR);
});

test('readDays and keepDay keep a bounded recent history', () => {
  assert.equal(readDays('nonsense').length, 0);
  const days = Array.from({ length: 40 }, (_, i) => ({ day: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, at: '', about: `about ${i}`, note: `note ${i}`, sources: [] }));
  assert.equal(keepDay([], days[0]).length, 1);
  assert.equal(keepDay(readDays(days), days[0]).length, 30);
});

test('dayNote surfaces only today’s own reading', () => {
  const days = [{ day: '2026-09-04', at: '', about: 'quantum espresso machines', note: 'apparently real', sources: [] }];
  assert.match(dayNote(days, '2026-09-04'), /quantum espresso machines/);
  assert.equal(dayNote(days, '2026-09-05'), '');
});

test('recDueForFollowUp waits three days and asks only once', () => {
  const now = Date.parse('2026-09-10T00:00:00.000Z');
  const rec = { id: '1', interest: 'Chainsaw Man', at: '2026-09-04T00:00:00.000Z', followed: false };
  assert.equal(recDueForFollowUp([{ ...rec, at: '2026-09-09T00:00:00.000Z' }], now), null, 'too soon');
  const due = recDueForFollowUp([rec], now);
  assert.equal(due!.interest, 'Chainsaw Man');
  assert.equal(recDueForFollowUp([{ ...rec, followed: true }], now), null, 'already asked');
});

test('pickRecommend skips what she pushed recently and rolls', () => {
  const interests = [
    { name: 'Bebop', stance: 'rated' },
    { name: 'Hades', stance: 'rated' },
    { name: 'Lain', stance: '' },
  ];
  const now = Date.parse('2026-09-10T00:00:00.000Z');
  const oldRec = { id: '1', interest: 'Hades', at: '2026-08-01T00:00:00.000Z', followed: true };
  const freshRec = { id: '2', interest: 'Bebop', at: '2026-09-09T00:00:00.000Z', followed: false };
  assert.equal(pickRecommend(interests, [freshRec], now, () => 0.1), 'Hades', 'only Hades is fresh and un-pushed');
  assert.equal(pickRecommend(interests, [freshRec, oldRec], now, () => 0.1), 'Hades');
  assert.equal(pickRecommend(interests, [oldRec], now, () => 0.9), null, 'the roll missed');
  assert.equal(pickRecommend([{ name: 'Lain', stance: '' }], [], now, () => 0.1), null, 'no stance, nothing to recommend');
});

test('noteRecommendation and markRecFollowed keep the ledger straight', () => {
  const at = '2026-09-10T00:00:00.000Z';
  const withOne = noteRecommendation([], 'Bebop', at);
  assert.equal(withOne.length, 1);
  assert.equal(withOne[0].followed, false);
  const followed = markRecFollowed(withOne, withOne[0].id);
  assert.equal(followed[0].followed, true);
});

test('weekKey lands on the most recent Sunday', () => {
  assert.equal(weekKey('2026-09-06'), '2026-09-06', 'Sunday is itself');
  assert.equal(weekKey('2026-09-07'), '2026-09-06', 'Monday');
  assert.equal(weekKey('2026-09-12'), '2026-09-06', 'Saturday');
  assert.equal(weekKey('2026-10-05'), '2026-10-04');
});

test('the week summary is written Sunday evening, once, and shown all week', () => {
  const sun = at('2026-09-06', 20, 0);
  assert.equal(weekSummaryDue(sun, null), true, 'Sunday night, none yet');
  assert.equal(weekSummaryDue(at('2026-09-06', 17, 0), null), false, 'too early');
  assert.equal(weekSummaryDue(sun, { day: '2026-09-06', summary: 'done' }), false, 'already written');
  assert.equal(weekSummaryDue(at('2026-09-07', 20, 0), { day: '2026-09-06', summary: 'done' }), false, 'the week moved on');
  assert.equal(weekNote({ day: '2026-09-06', summary: 'quiet, mostly' }, '2026-09-08'), '- Your week, just past: quiet, mostly');
  assert.equal(weekNote({ day: '2026-09-06', summary: 'old' }, '2026-09-14'), '', 'a week later it is gone');
});

test('the reflection asks for her own voice, first person, no list', () => {
  const instruction = weekReflectionInstruction('Read: …');
  assert.match(instruction, /Sum it up in your own voice/);
  assert.match(instruction, /no questions, no list/);
});