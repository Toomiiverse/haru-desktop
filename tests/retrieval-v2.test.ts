import test from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryHalfLifeDays, memoryRecency, retrieveMemories, semanticSimilarities,
  ALWAYS_IMPORTANT, type MemoryRecord,
} from '../electron/memory';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const ISO = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function record(overrides: Partial<MemoryRecord> & { id: string; text: string; kind: MemoryRecord['kind'] }): MemoryRecord {
  return {
    createdAt: ISO(30),
    lastSeenAt: ISO(1),
    mentions: 1,
    confidence: 0.9,
    importance: 0.5,
    source: 'conversation',
    status: 'active',
    memoryType: 'semantic',
    ...overrides,
  };
}

test('memoryHalfLifeDays tiers importance', () => {
  assert.equal(memoryHalfLifeDays(0.9), 10 * 365);
  assert.equal(memoryHalfLifeDays(0.8), 10 * 365);
  assert.equal(memoryHalfLifeDays(0.6), 180);
  assert.equal(memoryHalfLifeDays(0.5), 180);
  assert.equal(memoryHalfLifeDays(0.3), 45);
});

test('memoryRecency decays with the half-life', () => {
  assert.equal(memoryRecency(ISO(0), NOW, 45), 1);
  assert.equal(memoryRecency(ISO(45), NOW, 45), 0.5);
  assert.equal(memoryRecency(ISO(90), NOW, 45), 0.25);
  // An important fact is barely older after a year.
  assert.ok(memoryRecency(ISO(365), NOW, 3650) > 0.93);
});

test('preferences and relationships are always offered', () => {
  const memories = [
    record({ id: 'pref', text: 'Dislikes being nagged', kind: 'preference', lastSeenAt: ISO(60) }),
    record({ id: 'rel', text: 'Lives with Emma', kind: 'relationship', lastSeenAt: ISO(60) }),
    record({ id: 'fact', text: 'Likes cherries', kind: 'fact' }),
  ];
  const result = retrieveMemories(memories, 'how do the servers look today', { now: NOW });
  const ids = result.map(entry => entry.memory.id);
  assert.ok(ids.includes('pref'));
  assert.ok(ids.includes('rel'));
  assert.ok(!ids.includes('fact'));
});

test('high importance keeps a memory present without relevance', () => {
  const memories = [
    record({ id: 'important', text: 'Allergic to shellfish', kind: 'fact', importance: 0.85 }),
    record({ id: 'trivia', text: 'Watched a YouTube clip', kind: 'fact', importance: 0.2 }),
  ];
  const result = retrieveMemories(memories, 'what is the weather', { now: NOW });
  const ids = result.map(entry => entry.memory.id);
  assert.ok(ids.includes('important'));
  assert.ok(!ids.includes('trivia'));
});

test('on-topic trivia can beat off-topic importance', () => {
  const memories = [
    record({ id: 'important', text: 'Allergic to shellfish', kind: 'fact', importance: 0.9, lastSeenAt: ISO(400) }),
    record({ id: 'onTopic', text: 'Watched a YouTube video about rabbits', kind: 'fact', importance: 0.2, lastSeenAt: ISO(1) }),
  ];
  const result = retrieveMemories(memories, 'what was the rabbit video about', { now: NOW });
  assert.equal(result[0].memory.id, 'onTopic');
});

test('recurring memories surface without relevance', () => {
  const memories = [
    record({ id: 'recurring', text: 'Goes to the gym', kind: 'fact', mentions: 4, lastSeenAt: ISO(10) }),
    record({ id: 'once', text: 'Likes cherries', kind: 'fact' }),
  ];
  const result = retrieveMemories(memories, 'anything about fish', { now: NOW });
  const ids = result.map(entry => entry.memory.id);
  assert.ok(ids.includes('recurring'));
  assert.ok(!ids.includes('once'));
});

test('semantic similarity rescues a query with no words in common', () => {
  const memories = [
    record({ id: 'm1', text: 'Has a dog called Rex', kind: 'fact' }),
    record({ id: 'm2', text: 'Writes code in TypeScript', kind: 'fact' }),
  ];
  const semantic = new Map([['m1', 0.9], ['m2', 0.1]]);
  const result = retrieveMemories(memories, 'what is the puppy called', { now: NOW, semantic });
  assert.equal(result[0].memory.id, 'm1');
});

test('archived and superseded memories never surface', () => {
  const memories = [
    record({ id: 'archived', text: 'Likes cherries', kind: 'fact', status: 'archived' }),
    record({ id: 'superseded', text: 'Likes peaches', kind: 'fact', supersededBy: 'new-id' }),
    record({ id: 'live', text: 'Likes apricots', kind: 'fact' }),
  ];
  const result = retrieveMemories(memories, 'which fruit, apricots or peaches', { now: NOW });
  const ids = result.map(entry => entry.memory.id);
  assert.ok(ids.includes('live'));
  assert.ok(!ids.includes('archived'));
  assert.ok(!ids.includes('superseded'));
});

test('dormant memories only return when clearly on-topic', () => {
  const memories = [
    record({ id: 'dormant', text: 'Uses Ubuntu on the server', kind: 'fact', status: 'dormant', lastSeenAt: ISO(200) }),
    record({ id: 'active', text: 'Likes apricots', kind: 'fact' }),
  ];
  const offTopic = retrieveMemories(memories, 'how is your day going', { now: NOW });
  assert.ok(!offTopic.some(entry => entry.memory.id === 'dormant'));
  const onTopic = retrieveMemories(memories, 'which distro does the server run', { now: NOW });
  assert.ok(onTopic.some(entry => entry.memory.id === 'dormant'));
});

test('confidence dampens a weakly-held memory', () => {
  const memories = [
    record({ id: 'shaky', text: 'Prefers green tea', kind: 'fact', confidence: 0.4, mentions: 1 }),
    record({ id: 'solid', text: 'Prefers black tea', kind: 'fact', confidence: 0.98, mentions: 1 }),
  ];
  const result = retrieveMemories(memories, 'what tea does he like', { now: NOW });
  assert.equal(result[0].memory.id, 'solid');
});

test('results carry explainable factors and honour the limit', () => {
  const memories = [
    record({ id: 'a', text: 'Has a dog called Rex', kind: 'fact' }),
    record({ id: 'b', text: 'Has a cat called Mabel', kind: 'fact' }),
    record({ id: 'c', text: 'Has a bird called Pip', kind: 'fact' }),
  ];
  const result = retrieveMemories(memories, 'the dog rex and the cat', { now: NOW, limit: 2 });
  assert.equal(result.length, 2);
  const top = result[0];
  assert.equal(typeof top.score, 'number');
  assert.ok(top.score > 0);
  assert.equal(typeof top.factors.relevance, 'number');
  assert.equal(typeof top.factors.importance, 'number');
  assert.equal(typeof top.factors.confidence, 'number');
  assert.equal(typeof top.factors.recency, 'number');
  assert.equal(typeof top.factors.keyword, 'number');
  assert.ok(top.factors.importance > 0 && top.factors.importance <= 1);
  assert.ok(top.factors.confidence > 0 && top.factors.confidence <= 1);
});

test('semanticSimilarities maps ids to cosine scores', () => {
  const memories = [record({ id: 'm1', text: 'Has a dog', kind: 'fact' }), record({ id: 'm2', text: 'Has a cat', kind: 'fact' })];
  const vectors = new Map([
    ['m1', [1, 0, 0, 0]],
    ['m2', [0, 1, 0, 0]],
  ]);
  const query = [0.8, 0, 0.6, 0];
  const out = semanticSimilarities(memories, query, vectors);
  assert.ok(out.get('m1')! > out.get('m2')!);
  assert.ok(out.get('m1')! > 0.5);
  assert.equal(out.get('m2')!, 0);
});

test('ALWAYS_IMPORTANT is exported for the UI', () => {
  assert.equal(ALWAYS_IMPORTANT, 0.8);
});