import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consolidateMemories, isContradictory, mergeText, overlapScore, polarity,
} from '../electron/consolidation';
import type { MemoryRecord } from '../electron/memory';

const NOW = '2026-08-20T00:00:00.000Z';

function record(overrides: Partial<MemoryRecord> & { id: string; text: string; kind: MemoryRecord['kind'] }): MemoryRecord {
  return {
    createdAt: NOW,
    lastSeenAt: NOW,
    mentions: 1,
    confidence: 0.9,
    importance: 0.5,
    source: 'conversation',
    status: 'active',
    memoryType: 'semantic',
    ...overrides,
  };
}

test('polarity reads claims correctly', () => {
  assert.equal(polarity('Dislikes being nagged'), 'negative');
  assert.equal(polarity('Likes being nagged'), 'positive');
  assert.equal(polarity('Prefers not to be reminded'), 'negative');
  assert.equal(polarity('Has a dog called Rex'), 'positive');
  assert.equal(polarity('Uses Ubuntu on the server'), 'positive');
});

test('isContradictory needs shared words and opposite polarity', () => {
  const likes = record({ id: 'a', text: 'Likes being nagged', kind: 'preference' });
  const dislikes = record({ id: 'b', text: 'Dislikes being nagged', kind: 'preference' });
  assert.equal(isContradictory(likes, dislikes), true);
  const unrelated = record({ id: 'c', text: 'Dislikes being late', kind: 'preference' });
  assert.equal(isContradictory(likes, unrelated), false);
});

test('overlapScore shares content words', () => {
  const a = record({ id: 'a', text: 'Has a dog called Rex', kind: 'fact' });
  const b = record({ id: 'b', text: 'Has a dog called Mabel', kind: 'fact' });
  assert.ok(overlapScore(a, b) > 0.5);
  assert.equal(overlapScore(a, record({ id: 'c', text: 'Plays the piano', kind: 'fact' })), 0);
});

test('mergeText folds distinct words in and keeps the longer alone', () => {
  assert.equal(mergeText('Has a dog called Rex', 'Has a dog called Rex'), 'Has a dog called Rex');
  assert.equal(mergeText('Likes green tea', 'Likes green tea and prefers it cold'), 'Likes green tea and prefers it cold');
  const merged = mergeText('Dislikes being corrected', 'Dislikes being nagged');
  assert.ok(merged.includes('corrected'));
  assert.ok(merged.includes('nagged'));
});

test('consolidateMemories merges rewording of the same fact', () => {
  const a = record({ id: 'a', text: 'Has a dog called Rex', kind: 'fact', mentions: 3 });
  const b = record({ id: 'b', text: 'has a dog named Rex', kind: 'fact', mentions: 1 });
  const { memories, changes } = consolidateMemories([a, b], { now: NOW });
  assert.equal(memories.length, 1);
  assert.equal(memories[0].id, 'a');
  assert.equal(memories[0].mentions, 4);
  assert.deepEqual(memories[0].mergedFrom, ['b']);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'merged');
});

test('consolidateMemories merges near-duplicates via semantic similarity', () => {
  const a = record({ id: 'a', text: 'Does not like to be corrected on tasks or reminders without being told how to improve', kind: 'preference', mentions: 2 });
  const b = record({ id: 'b', text: 'Prefer not to be constantly nagged and reminded of tasks when not asked', kind: 'preference', mentions: 1 });
  const similarity = () => 0.9;
  const { memories, changes } = consolidateMemories([a, b], { now: NOW, similarity });
  assert.equal(memories.length, 1);
  assert.equal(memories[0].kind, 'preference');
  assert.ok(memories[0].text.includes('corrected'));
  assert.ok(memories[0].text.includes('nagged'));
  assert.deepEqual(memories[0].mergedFrom, ['b']);
  assert.equal(changes.length, 1);
});

test('consolidateMemories flags contradictions and drops confidence of the older', () => {
  const likes = record({ id: 'a', text: 'Likes being nagged', kind: 'preference', createdAt: '2026-07-01T00:00:00.000Z', confidence: 0.85 });
  const dislikes = record({ id: 'b', text: 'Dislikes being nagged', kind: 'preference', createdAt: '2026-08-01T00:00:00.000Z', confidence: 0.85 });
  const { memories, changes } = consolidateMemories([likes, dislikes], { now: NOW });
  assert.equal(memories.length, 2);
  const older = memories.find(memory => memory.id === 'a')!;
  const younger = memories.find(memory => memory.id === 'b')!;
  assert.ok(older.confidence! < 0.85);
  assert.equal(older.confidence, 0.55);
  assert.equal(younger.confidence, 0.85);
  assert.deepEqual(older.conflictsWith, ['b']);
  assert.deepEqual(younger.conflictsWith, ['a']);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'conflict');
});

test('consolidateMemories leaves unrelated memories alone', () => {
  const a = record({ id: 'a', text: 'Has a dog called Rex', kind: 'fact' });
  const b = record({ id: 'b', text: 'Plays the piano', kind: 'fact' });
  const { memories, changes } = consolidateMemories([a, b], { now: NOW });
  assert.equal(memories.length, 2);
  assert.equal(changes.length, 0);
});

test('consolidateMemories never touches superseded or archived records', () => {
  const a = record({ id: 'a', text: 'Has a dog called Rex', kind: 'fact' });
  const superseded = record({ id: 's', text: 'has a dog named Rex', kind: 'fact', supersededBy: 'x' });
  const archived = record({ id: 'ar', text: 'has a dog called Rex', kind: 'fact', status: 'archived' });
  const { memories, changes } = consolidateMemories([a, superseded, archived], { now: NOW });
  assert.equal(memories.length, 3);
  assert.equal(changes.length, 0);
});

test('consolidateMemories is stable once merged', () => {
  const a = record({ id: 'a', text: 'Has a dog called Rex', kind: 'fact', mentions: 2 });
  const b = record({ id: 'b', text: 'has a dog named Rex', kind: 'fact' });
  const first = consolidateMemories([a, b], { now: NOW });
  const second = consolidateMemories(first.memories, { now: NOW });
  assert.deepEqual(second.memories, first.memories);
  assert.equal(second.changes.length, 0);
});