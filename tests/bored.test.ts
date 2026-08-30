// What she reaches for when she is left alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_FRESH_DAYS, pickToBringUp, REMEMBERED_PICKS } from '../electron/bored';

const memories = [
  { id: 'm1', text: 'Live with girlfriend Emma in student lodgings at Murdoch.', kind: 'relationship', status: 'active', importance: 0.8 },
  { id: 'm2', text: 'Runs a store called The PC Project with Sudin.', kind: 'fact', status: 'active', importance: 0.8 },
  { id: 'm3', text: 'Does not like therapy-style advice.', kind: 'preference', status: 'active', importance: 0.85 },
  { id: 'm4', text: 'Old thing that happened once.', kind: 'fact', status: 'forgotten', importance: 0.6 },
  { id: 'm5', text: 'tiny', kind: 'fact' },
  { id: 'm6', text: 'they are thanking you', kind: 'event', importance: 0.45 },
  { id: 'm7', text: 'Nothing notable', kind: 'event', importance: 0.45 },
  { id: 'm8', text: 'Wants Haru to be less nice when corrected.', kind: 'fact', importance: 0.6 },
  { id: 'm9', text: 'Purchased a 10m HDMI cable for the TV', kind: 'event', importance: 0.45 },
  { id: 'm10', text: 'Does not want therapy-style advice when trying to calm down.', kind: 'fact', importance: 0.4 },
  { id: 'm11', text: 'Wants 6 mailboxes total for The PC Project.', kind: 'fact', importance: 0.8 },
];
const days = [
  { day: '2026-08-27', summary: 'Argued about mailboxes, then bought a keyboard for Scarlett.' },
  { day: '2026-08-01', summary: 'Ancient history.' },
  { day: '2026-08-28', summary: 'Today, which is not over.' },
];

test('she reaches for a real fact or a recent day, never a preference, a forgotten thing, a scrap, an old day, or today', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(pickToBringUp(memories, days, [], '2026-08-28', () => i / 200)!.id);
  assert.deepEqual([...seen].sort(), ['day:2026-08-27', 'm1', 'm11', 'm2', 'm9'], 'nothing about herself, nothing about nothing, nothing about how to treat them');
});

test('what matters comes up more: the girlfriend and the company outdraw the HDMI cable', () => {
  const counts: Record<string, number> = {};
  for (let i = 0; i < 1000; i++) { const id = pickToBringUp(memories, days, [], '2026-08-28', () => (i + 0.5) / 1000)!.id; counts[id] = (counts[id] ?? 0) + 1; }
  assert.ok(counts.m1 > counts.m9 * 1.5 && counts.m2 > counts.m9 * 1.5, JSON.stringify(counts));
});

test('what she brought up last is kept out of the draw, until there is nothing else', () => {
  assert.equal(pickToBringUp(memories, days, ['m1', 'm2', 'm9', 'm11'], '2026-08-28', () => 0)!.id, 'day:2026-08-27');
  assert.equal(pickToBringUp(memories, days, ['m1', 'm2', 'm9', 'm11', 'day:2026-08-27'], '2026-08-28', () => 0)!.id, 'm1', 'everything used: the draw opens again');
  assert.ok(REMEMBERED_PICKS >= 3);
});

test('with nothing to bring up she says nothing', () => {
  assert.equal(pickToBringUp([], [], [], '2026-08-28'), null);
  assert.equal(pickToBringUp([{ id: 'p', text: 'Likes it blunt.', kind: 'preference' }], [], [], '2026-08-28'), null);
});

test('an old event is not on her mind, however important it was', () => {
  const today = '2026-08-30';
  const fresh = { id: 'f', text: 'Is planning to close the store on Monday for cleaning it up', kind: 'event', importance: 0.9, lastSeenAt: '2026-08-29T10:00:00.000Z' };
  const stale = { id: 's', text: 'Is planning to close the store from Monday to Tuesday for cleaning it up', kind: 'event', importance: 0.9, lastSeenAt: '2026-08-23T10:00:00.000Z' };
  const fact = { id: 'x', text: 'Runs a company called The PC Project in Northbridge', kind: 'fact', importance: 0.5, lastSeenAt: '2026-08-01T10:00:00.000Z' };
  const picks = new Set(Array.from({ length: 40 }, (_, i) => pickToBringUp([fresh, stale, fact], [], [], today, () => (i % 10) / 10)?.id));
  assert.equal(picks.has('s'), false, 'a week-old plan is a thing that happened');
  assert.equal(picks.has('f') || picks.has('x'), true);
  assert.ok(EVENT_FRESH_DAYS >= 2);
});
