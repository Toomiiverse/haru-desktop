// Telling old messages from new ones — in the user's day, not the machine's.
//
// describeGap had no test at all, which is how it kept reading message times
// with the machine's own getters. "The next morning" is a claim about the
// user's day, and the user's day happens somewhere; on a server eight hours
// behind them, a night that ran from eight in the evening to six the next
// morning is one calendar day and ten hours, so she was told an overnight
// silence was an afternoon lull and carried the mood straight across it.
//
// The property is not that the answer is the same everywhere — a gap really
// does fall differently for someone in Perth than for someone in New York, and
// the timeZone argument is how the caller says which of them she is talking to.
// It is that the answer depends on that argument and on nothing else. The
// machine the code runs on must not be able to change it, which is why the
// suite is also run under several TZ values.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeGap, markTimeGaps, sinceLast, GAP_MINUTES, earlierTurns, HISTORY_BUDGET_CHARS } from '../electron/history';

const PERTH = 'Australia/Perth';   // UTC+8
const UTC = 'UTC';
const NEW_YORK = 'America/New_York';  // UTC-4 in September

/** 20:00 and 06:00 the next day, for somebody in Perth. */
const eveningBefore = new Date('2026-09-02T12:00:00.000Z');
const nextMorning = new Date('2026-09-02T22:00:00.000Z');

test('an overnight gap is the next morning for the person who slept through it', () => {
  assert.equal(describeGap(eveningBefore, nextMorning, PERTH), 'the next morning');
});

test('the same ten hours are one afternoon for somebody living in UTC', () => {
  // Not a bug: 12:00 to 22:00 on one day is genuinely the same day there. This
  // is the answer the old code gave everyone, because it read the server's
  // clock instead of being told whose day it was.
  assert.equal(describeGap(eveningBefore, nextMorning, UTC), 'later the same day');
});

test('which part of the day it is, is the user\'s part of the day', () => {
  // 20:00 Perth on the 3rd — a day and a bit after the first message.
  const nextEvening = new Date('2026-09-03T12:00:00.000Z');
  assert.equal(describeGap(eveningBefore, nextEvening, PERTH), 'the next evening');
  // The same instant is 08:00 in New York, which is a morning.
  assert.equal(describeGap(eveningBefore, nextEvening, NEW_YORK), 'the next morning');
});

test('a gap inside one of their days stays inside it', () => {
  // 09:00 and 14:00 Perth, which is 01:00 and 06:00 UTC — one day in both.
  const morning = new Date('2026-09-03T01:00:00.000Z');
  const afternoon = new Date('2026-09-03T06:00:00.000Z');
  for (const zone of [PERTH, UTC]) {
    assert.equal(describeGap(morning, afternoon, zone), 'later the same day', `wrong for ${zone}`);
  }
});

test('a short gap in the same day counts the hours', () => {
  const perth = (hour: number) => new Date(Date.UTC(2026, 8, 3, hour - 8, 0));
  assert.equal(describeGap(perth(9), perth(11), PERTH), 'about 2 hours later, the same day');
  assert.equal(describeGap(perth(9), perth(10), PERTH), 'about 1 hour later, the same day');
});

test('longer gaps are counted, and counting needs no timezone at all', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 8, n, 4, 0));
  for (const zone of [PERTH, UTC, NEW_YORK]) {
    assert.equal(describeGap(day(1), day(4), zone), '3 days later', `wrong for ${zone}`);
    assert.equal(describeGap(day(1), day(15), zone), 'about 2 weeks later', `wrong for ${zone}`);
    assert.equal(describeGap(day(1), day(61), zone), 'a long time later', `wrong for ${zone}`);
  }
});

test('the seam is marked as a system line, and only where there is a gap', () => {
  const messages = [
    { role: 'user', content: 'evening', at: eveningBefore.toISOString() },
    { role: 'assistant', content: 'morning', at: nextMorning.toISOString() },
  ];
  const marked = markTimeGaps(messages, PERTH);
  assert.equal(marked.length, 3, 'expected one note between the two');
  assert.equal(marked[1].role, 'system');
  assert.ok(String(marked[1].content).includes('the next morning'), String(marked[1].content));
});

test('messages close together are passed through untouched', () => {
  const messages = [
    { role: 'user', content: 'one', at: '2026-09-03T01:00:00.000Z' },
    { role: 'assistant', content: 'two', at: '2026-09-03T01:10:00.000Z' },
  ];
  assert.deepEqual(markTimeGaps(messages, PERTH), messages);
});

test('an undated message is left alone rather than guessed at', () => {
  const messages = [
    { role: 'user', content: 'no stamp' },
    { role: 'assistant', content: 'also none' },
  ];
  assert.deepEqual(markTimeGaps(messages, PERTH), messages);
});

test('sinceLast says how long it has been, in their day', () => {
  const messages = [{ role: 'user', content: 'last thing', at: eveningBefore.toISOString() }];
  assert.ok(sinceLast(messages, nextMorning, PERTH).includes('the next morning'));
});

test('sinceLast is silent while the conversation is still warm', () => {
  const at = new Date('2026-09-03T01:00:00.000Z');
  const soon = new Date(at.getTime() + (GAP_MINUTES - 1) * 60_000);
  assert.equal(sinceLast([{ role: 'user', content: 'x', at: at.toISOString() }], soon, PERTH), '');
});

test('the days before today come through newest last, trimmed from the oldest end, whole days only', () => {
  const turn = (role: string, content: string) => ({ role, content, at: '2026-08-30T10:00:00.000Z' });
  const archive = {
    '2026-08-29': [turn('user', 'oldest'), turn('assistant', 'a')],
    '2026-08-30': [turn('user', 'middle'), turn('assistant', 'b')],
    '2026-08-31': [turn('user', 'newest'), turn('assistant', 'c')],
    '2026-09-01': [turn('user', 'today is not archived yet'), turn('assistant', 'd')],
  };
  assert.deepEqual(earlierTurns(archive, '2026-09-01', 3, 10_000).map(t => t.content),
    ['oldest', 'a', 'middle', 'b', 'newest', 'c'], 'the three finished days, oldest of them first, today left out');
  assert.deepEqual(earlierTurns(archive, '2026-09-01', 1, 10_000).map(t => t.content), ['newest', 'c'], 'one day means the day before');
  assert.deepEqual(earlierTurns(archive, '2026-09-02', 3, 30).map(t => t.content), ['today is not archived yet', 'd'],
    'the budget drops whole days from the oldest end, never half of one');
  assert.deepEqual(earlierTurns({}, '2026-09-01'), []);
  assert.ok(HISTORY_BUDGET_CHARS >= 10_000, 'room for a few real days');
});

test('a small budget keeps the evening of the last day, from a message of theirs', () => {
  const turn = (role: string, content: string) => ({ role, content, at: '2026-08-30T10:00:00.000Z' });
  const archive = {
    '2026-08-31': [turn('user', 'morning, long enough to blow the budget'), turn('assistant', 'a'), turn('user', 'afternoon'), turn('assistant', 'b'), turn('user', 'evening'), turn('assistant', 'c')],
  };
  assert.deepEqual(earlierTurns(archive, '2026-09-01', 3, 24).map(t => t.content), ['afternoon', 'b', 'evening', 'c'], 'the tail that fits, opening on their turn');
  assert.deepEqual(earlierTurns(archive, '2026-09-01', 3, 3).map(t => t.content), [], 'nothing fits, nothing goes');
});

// ---- the finished days, from her own notes ----

import { earlierDayNotes, earlierDaysContext } from '../electron/history';

test('earlierDayNotes lists finished days newest last', () => {
  const notes = earlierDayNotes([
    { day: '2026-08-29', summary: 'quiet day' },
    { day: '2026-08-30', summary: 'the store crashed' },
    { day: '2026-08-31', summary: 'fixed the store' },
  ], '2026-09-01', 7);
  assert.deepEqual(notes.map(note => note.day), ['2026-08-29', '2026-08-30', '2026-08-31']);
  assert.ok(notes.every(note => note.day < '2026-09-01'), 'today is never a note');
});

test('earlierDaysContext uses notes where they exist and raw turns where they do not', () => {
  const turn = (role: string, content: string) => ({ role, content, at: '2026-08-30T10:00:00.000Z' });
  const archive = {
    '2026-08-29': [turn('user', 'old day raw')],
    '2026-08-30': [turn('user', 'yesterday, never distilled'), turn('assistant', 'y')],
    '2026-08-31': [turn('user', 'today, not finished yet')],
  };
  const sessions = [{ day: '2026-08-29', summary: 'a distilled day', createdAt: '2026-09-01T00:00:00.000Z' }];
  const { notes, turns } = earlierDaysContext(sessions, archive, '2026-08-31', { days: 7 });
  assert.deepEqual(notes, ['[Day 2026-08-29] a distilled day']);
  assert.deepEqual(turns.map(turn => turn.content), ['yesterday, never distilled', 'y'], 'the undistilled day falls back to raw turns');
  const empty = earlierDaysContext([], archive, '2026-08-31', { days: 7 });
  assert.deepEqual(empty.notes, []);
  assert.ok(empty.turns.length >= 2, 'no sessions at all means the raw path as before');
});
