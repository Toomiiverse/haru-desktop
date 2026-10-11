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

test('ALWAYS_IMPORTANT is exported for the UI', () => {
  assert.equal(ALWAYS_IMPORTANT, 0.8);
});