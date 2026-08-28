// A heads up, an hour out and a quarter of an hour out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { markMentioned, upcomingToMention } from '../electron/upcoming';

const TODAY = '2026-08-28';
const at = (h: number, m: number) => new Date(2026, 7, 28, h, m);
const items = [
  { id: 'dentist', title: 'Dentist', date: TODAY, time: '3:00 PM', kind: 'event' },
  { id: 'bins', title: 'Put the bins out', date: TODAY, time: '19:30', kind: 'task' },
  { id: 'done', title: 'Already done', date: TODAY, time: '15:05', kind: 'task', done: true },
  { id: 'tomorrow', title: 'Tomorrow', date: '2026-08-29', time: '15:00', kind: 'event' },
  { id: 'someday', title: 'No time', date: TODAY, kind: 'task' },
];

test('an hour out, then a quarter of an hour out, once each; the soonest first', () => {
  const hour = upcomingToMention(items, at(14, 5), TODAY, {})!;
  assert.deepEqual([hour.item.id, hour.inMinutes, hour.lead], ['dentist', 55, 60]);
  const marked = markMentioned({}, 'dentist', 60, ['dentist', 'bins']);
  assert.equal(upcomingToMention(items, at(14, 8), TODAY, marked), null, 'the hour was said');
  const quarter = upcomingToMention(items, at(14, 48), TODAY, marked)!;
  assert.deepEqual([quarter.item.id, quarter.inMinutes, quarter.lead], ['dentist', 12, 15]);
  assert.equal(upcomingToMention(items, at(14, 30), TODAY, marked), null, 'between the two leads');
  const evening = upcomingToMention(items, at(18, 35), TODAY, {})!;
  assert.equal(evening.item.id, 'bins');
});

test('the marks keep only what is still on the calendar', () => {
  const marked = markMentioned({ old: [60, 15], dentist: [60] }, 'dentist', 15, ['dentist']);
  assert.deepEqual(marked, { dentist: [60, 15] });
});
