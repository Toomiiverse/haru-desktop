// Two machines, one memory.
//
// The merge has to converge whichever side runs it and in whatever order the
// syncs happen, because both machines run it and neither tells the other what
// it decided. Every test here is really that one property, asked a different
// way — and the last of them is the one that would have bitten: consolidation
// runs on the desk alone, so the server's untidied copy must not be able to
// undo a supersede on its way back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMerge, mergeMemories } from '../electron/memorysync';
import type { MemoryRecord } from '../electron/memory';

const NOW = '2026-08-29T12:00:00.000Z';

function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    kind: 'fact',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
    mentions: 1,
    ...overrides,
  };
}

test('a memory the other machine has and this one does not is taken', () => {
  const mine = [record({ id: 'a', text: 'likes tea' })];
  const theirs = [record({ id: 'b', text: 'the cat is called Momo' })];
  const merged = mergeMemories(mine, theirs, NOW);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 0);
  assert.deepEqual(merged.memories.map(memory => memory.id).sort(), ['a', 'b']);
});

test('the same memory arriving twice is one memory', () => {
  const mine = [record({ id: 'a', text: 'likes tea' })];
  const merged = mergeMemories(mine, [record({ id: 'a', text: 'likes tea' })], NOW);
  assert.equal(merged.memories.length, 1);
  assert.equal(merged.added, 0);
  assert.equal(merged.updated, 0, 'an unchanged copy is not a change');
});

test('the newer sighting wins, and mentions are the larger count', () => {
  const mine = [record({ id: 'a', text: 'likes tea', lastSeenAt: '2026-08-02T00:00:00.000Z', mentions: 5 })];
  const theirs = [record({ id: 'a', text: 'likes tea with milk', lastSeenAt: '2026-08-03T00:00:00.000Z', mentions: 2 })];
  const merged = mergeMemories(mine, theirs, NOW);
  assert.equal(merged.updated, 1);
  assert.equal(merged.memories[0].text, 'likes tea with milk');
  assert.equal(merged.memories[0].mentions, 5, 'both machines counted real mentions');
});

test('a memory keeps the earliest birthday either machine has for it', () => {
  const mine = [record({ id: 'a', text: 'likes tea', createdAt: '2026-08-05T00:00:00.000Z', lastSeenAt: '2026-08-09T00:00:00.000Z' })];
  const theirs = [record({ id: 'a', text: 'likes tea', createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-02T00:00:00.000Z' })];
  assert.equal(mergeMemories(mine, theirs, NOW).memories[0].createdAt, '2026-08-01T00:00:00.000Z');
});

test('the evidence behind a memory is pooled, not replaced', () => {
  const mine = [record({
    id: 'a', text: 'likes tea', lastSeenAt: '2026-08-09T00:00:00.000Z',
    evidence: [{ at: '2026-08-01T00:00:00.000Z', kind: 'statement', source: 'conversation' }],
  })];
  const theirs = [record({
    id: 'a', text: 'likes tea', lastSeenAt: '2026-08-02T00:00:00.000Z',
    evidence: [{ at: '2026-08-02T00:00:00.000Z', kind: 'repeat', source: 'conversation' }],
  })];
  const merged = mergeMemories(mine, theirs, NOW);
  assert.equal(merged.memories[0].evidence?.length, 2);
  assert.deepEqual(merged.memories[0].evidence?.map(entry => entry.kind), ['statement', 'repeat']);
});

test('the same moment seen from both machines is kept once', () => {
  const moment = { at: '2026-08-01T00:00:00.000Z', kind: 'statement' as const, source: 'conversation' as const };
  const mine = [record({ id: 'a', text: 'likes tea', evidence: [moment] })];
  const merged = mergeMemories(mine, [record({ id: 'a', text: 'likes tea', evidence: [moment] })], NOW);
  assert.equal(merged.memories[0].evidence?.length, 1);
});

test('a supersede made by the desk survives the untidied copy coming back', () => {
  // The desk consolidated: "lives in Manchester" was replaced by "lives in
  // Sheffield". The server never saw that and still holds the old record as
  // current. Letting its copy win here is how the resurrection bug returns.
  const mine = [record({ id: 'a', text: 'lives in Manchester', lastSeenAt: '2026-08-02T00:00:00.000Z', supersededBy: 'b' })];
  const theirs = [record({ id: 'a', text: 'lives in Manchester', lastSeenAt: '2026-08-09T00:00:00.000Z' })];
  const merged = mergeMemories(mine, theirs, NOW);
  assert.equal(merged.memories[0].supersededBy, 'b', 'the newer copy must not undo a tidy it never saw');
});

test('consolidation provenance travels to the machine that did not do it', () => {
  const mine = [record({ id: 'a', text: 'likes tea' })];
  const theirs = [record({ id: 'a', text: 'likes tea', mergedFrom: ['x', 'y'], conflictsWith: ['z'] })];
  const merged = mergeMemories(mine, theirs, NOW);
  assert.deepEqual(merged.memories[0].mergedFrom, ['x', 'y']);
  assert.deepEqual(merged.memories[0].conflictsWith, ['z']);
});

test('both machines reach the same answer from the same pair', () => {
  const desk = record({ id: 'a', text: 'likes tea', lastSeenAt: '2026-08-09T00:00:00.000Z', mentions: 4, supersededBy: 'b' });
  const server = record({ id: 'a', text: 'likes coffee', lastSeenAt: '2026-08-03T00:00:00.000Z', mentions: 7 });
  const atTheDesk = mergeMemories([desk], [server], NOW).memories[0];
  const atTheServer = mergeMemories([server], [desk], NOW).memories[0];
  assert.deepEqual(atTheDesk, atTheServer);
});

test('a second sync that changes nothing reports nothing', () => {
  const mine = [record({ id: 'a', text: 'likes tea', mentions: 3 })];
  const theirs = [record({ id: 'a', text: 'likes tea', mentions: 9 })];
  const once = mergeMemories(mine, theirs, NOW);
  const twice = mergeMemories(once.memories, theirs, NOW);
  assert.equal(twice.added, 0);
  assert.equal(twice.updated, 0, 'the merge has to settle, or every sync re-embeds everything');
});

test('rubbish off the network is dropped rather than stored', () => {
  const mine = [record({ id: 'a', text: 'likes tea' })];
  const merged = mergeMemories(mine, [null, 42, 'nope', {}, { text: '   ' }, { text: 'real', id: 'b' }], NOW);
  assert.equal(merged.memories.length, 2);
  assert.equal(merged.added, 1);
});

test('a payload that is not a list at all changes nothing', () => {
  const mine = [record({ id: 'a', text: 'likes tea' })];
  for (const payload of [null, undefined, {}, 'memories', 7]) {
    const merged = mergeMemories(mine, payload, NOW);
    assert.equal(merged.added, 0);
    assert.equal(merged.memories.length, 1);
  }
});

test('describeMerge says nothing when nothing happened', () => {
  assert.equal(describeMerge({ memories: [], added: 0, updated: 0 }), '');
  assert.equal(describeMerge({ memories: [], added: 1, updated: 0 }), '1 new memory');
  assert.equal(describeMerge({ memories: [], added: 2, updated: 3 }), '2 new memories, 3 updated');
});
