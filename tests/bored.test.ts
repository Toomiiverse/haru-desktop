// What she reaches for when she is left alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pickToBringUp, REMEMBERED_PICKS } from '../electron/bored';

const memories = [
  { id: 'm1', text: 'Live with girlfriend Emma in student lodgings at Murdoch.', kind: 'relationship', status: 'active' },
  { id: 'm2', text: 'Runs a store called The PC Project with Sudin.', kind: 'fact', status: 'active' },
  { id: 'm3', text: 'Does not like therapy-style advice.', kind: 'preference', status: 'active' },
  { id: 'm4', text: 'Old thing.', kind: 'fact', status: 'forgotten' },
  { id: 'm5', text: 'tiny', kind: 'fact' },
];
const days = [
  { day: '2026-08-27', summary: 'Argued about mailboxes, then bought a keyboard for Scarlett.' },
  { day: '2026-08-01', summary: 'Ancient history.' },
  { day: '2026-08-28', summary: 'Today, which is not over.' },
];

test('she reaches for a real fact or a recent day, never a preference, a forgotten thing, a scrap, an old day, or today', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(pickToBringUp(memories, days, [], '2026-08-28', () => i / 200)!.id);
  assert.deepEqual([...seen].sort(), ['day:2026-08-27', 'm1', 'm2']);
});

test('what she brought up last is kept out of the draw, until there is nothing else', () => {
  assert.equal(pickToBringUp(memories, days, ['m1', 'm2'], '2026-08-28', () => 0)!.id, 'day:2026-08-27');
  assert.equal(pickToBringUp(memories, days, ['m1', 'm2', 'day:2026-08-27'], '2026-08-28', () => 0)!.id, 'm1', 'everything used: the draw opens again');
  assert.ok(REMEMBERED_PICKS >= 3);
});

test('with nothing to bring up she says nothing', () => {
  assert.equal(pickToBringUp([], [], [], '2026-08-28'), null);
  assert.equal(pickToBringUp([{ id: 'p', text: 'Likes it blunt.', kind: 'preference' }], [], [], '2026-08-28'), null);
});
