import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWorthRemembering,
  isAboutTheConversation,
  scoreImportance,
  ALWAYS_IMPORTANT,
  bansATopic,
  isSameMemory,
  isInTheirWords,
  rememberInto,
  pruneMemories,
  recurringMemories,
  selectMemories,
  RECURRING_THRESHOLD,
  isWorthKeeping,
  findSuperseded,
  supersede,
  isExplicitRecall,
  DEEP_RECALL_LIMIT,
  daysRaised,
  isRecurring,
  calibrateSimilarity,
  semanticSimilarities,
  retrieveMemories,
  SEMANTIC_FLOOR,
  readsAsSecondPerson,
  migrateMemories,
  EVIDENCE_KINDS,
  closesEvent,
  closeEvents,
  summaryPrompt,
  eventsPrompt,
  isWorthAnEvent,
  type MemoryRecord,
  entityTerms,
  entityScore,
  monthFoldPrompt,
  readsAsHerNagging,
} from '../electron/memory';

const fixture = (overrides: Partial<MemoryRecord> & { id: string; text: string; kind: MemoryRecord['kind'] }): MemoryRecord => ({
  createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-28T00:00:00.000Z', mentions: 1,
  confidence: 0.8, importance: 0.5, source: 'conversation', status: 'active', memoryType: 'semantic',
  ...overrides,
});

// ---- recurringMemories / RECURRING_THRESHOLD ----

test('RECURRING_THRESHOLD is exactly 3', () => {
  assert.equal(RECURRING_THRESHOLD, 3);
});

test('DEEP_RECALL_LIMIT is wider than the default selectMemories limit', () => {
  assert.equal(DEEP_RECALL_LIMIT > 14, true);
});

// ---- emotion tags: what a memory was written in, and how retrieval reads it ----

function emoRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? 'e1',
    text: overrides.text ?? 'They run the shop together',
    kind: 'fact',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    mentions: 1,
    source: 'explicit',
    ...overrides,
  };
}
