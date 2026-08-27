import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDecay, memoryHalfLifeDays, type MemoryRecord } from '../electron/memory';

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

test('decay moves low-importance records dormant → archived → forgotten', () => {
  // importance 0.2 → half-life 45 days → dormant at 90, archived at 180, gone at 270
  const dormant = record({ id: 'd', text: 'Saw a YouTube clip', kind: 'fact', importance: 0.2, lastSeenAt: ISO(95) });
  const archived = record({ id: 'a', text: 'Played a game', kind: 'fact', importance: 0.2, lastSeenAt: ISO(190) });
  const forgotten = record({ id: 'f', text: 'Browsed a site', kind: 'fact', importance: 0.2, lastSeenAt: ISO(300) });
  const result = applyDecay([dormant, archived, forgotten], NOW);
  assert.equal(result.memories.find(m => m.id === 'd')?.status, 'dormant');
  assert.equal(result.memories.find(m => m.id === 'a')?.status, 'archived');
  assert.equal(result.memories.find(m => m.id === 'f'), undefined);
  assert.equal(result.forgotten.length, 1);
  assert.equal(result.forgotten[0].id, 'f');
  assert.equal(result.forgotten[0].reason, 'decay');
  assert.equal(result.transitions.length, 2);
});

test('high-importance records never leave active on their own', () => {
  const important = record({ id: 'i', text: 'Allergic to shellfish', kind: 'fact', importance: 0.9, lastSeenAt: ISO(3000) });
  const result = applyDecay([important], NOW);
  assert.equal(result.memories.length, 1);
  assert.equal(result.memories[0].status, 'active');
  assert.equal(result.transitions.length, 0);
  assert.equal(result.forgotten.length, 0);
});

test('decay leaves superseded and archived records alone', () => {
  const superseded = record({ id: 's', text: 'Uses Ubuntu', kind: 'fact', importance: 0.2, lastSeenAt: ISO(900), supersededBy: 'new' });
  const archived = record({ id: 'a', text: 'Old project', kind: 'fact', importance: 0.2, lastSeenAt: ISO(900), status: 'archived' });
  const result = applyDecay([superseded, archived], NOW);
  assert.equal(result.memories.length, 2);
  assert.equal(result.transitions.length, 0);
  assert.equal(result.forgotten.length, 0);
});

test('decay thresholds follow the importance half-life', () => {
  // importance 0.6 → half-life 180 days → dormant at 360, archived at 720, gone at 1080
  const medium = record({ id: 'm', text: 'Works on a project', kind: 'fact', importance: 0.6, lastSeenAt: ISO(400) });
  const result = applyDecay([medium], NOW);
  assert.equal(result.memories[0].status, 'dormant');
  assert.equal(result.transitions.length, 1);
  // A fresh medium-importance record does not move at all.
  const fresh = record({ id: 'f2', text: 'Works on a project', kind: 'fact', importance: 0.6, lastSeenAt: ISO(10) });
  const freshResult = applyDecay([fresh], NOW);
  assert.equal(freshResult.transitions.length, 0);
});

test('decay is idempotent — a dormant record does not re-transition', () => {
  const dormant = record({ id: 'd', text: 'Saw a YouTube clip', kind: 'fact', importance: 0.2, lastSeenAt: ISO(95), status: 'dormant' });
  const result = applyDecay([dormant], NOW);
  assert.equal(result.memories[0].status, 'dormant');
  assert.equal(result.transitions.length, 0);
});

test('forgotten entries carry text and detail for the log', () => {
  const old = record({ id: 'f', text: 'Browsed a site once', kind: 'fact', importance: 0.2, lastSeenAt: ISO(300) });
  const result = applyDecay([old], NOW);
  assert.equal(result.forgotten[0].text, 'Browsed a site once');
  assert.equal(typeof result.forgotten[0].detail, 'string');
});