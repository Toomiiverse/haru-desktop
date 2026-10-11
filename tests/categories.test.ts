// What a memory is, and what follows from it.
//
// The sorting itself is a model call and is measured elsewhere (the hand-labelled
// set of 2026-09-17); what is tested here is everything around it — reading the
// answer strictly, the guess an unsorted record gets, a plan turning into an
// event when its day goes, and each category reaching the block it belongs in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CATEGORY_MEANING, categoryOf, guessCategory, isCategory, isDay, LEGACY_KIND, namesSomeoneElse, readSorting, sortInput, sortPrompt, UNDATED_PLAN_DAYS, type SortNote } from '../electron/categories';
import { formationPrompt, formationWindows, importanceOf, MEMORIES_PER_DAY, migrateMemories, pruneMemories, readFormation, rememberInto, retrieveMemories, tidyEvidence, type MemoryRecord } from '../electron/memory';
import { defaultMemoryBlocks, formatMemoryBlocks, withoutRestatements } from '../electron/blocks';
import { mergeMemories } from '../electron/memorysync';
import { memoriesNote } from '../electron/vault';

const NOW = new Date('2026-09-17T02:00:00.000Z');

function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    kind: 'fact',
    createdAt: '2026-09-10T00:00:00.000Z',
    lastSeenAt: '2026-09-10T00:00:00.000Z',
    mentions: 1,
    confidence: 0.8,
    importance: 0.45,
    source: 'conversation',
    status: 'active',
    ...overrides,
  };
}

const notes: SortNote[] = [
  { id: 'a', text: 'Their car registration is due on 6 October', kind: 'event', createdAt: '2026-09-12T03:00:00.000Z' },
  { id: 'b', text: 'Prefers dark mode', kind: 'preference', createdAt: '2026-09-12T03:00:00.000Z' },
  { id: 'c', text: 'Opened Discord', kind: 'event', createdAt: '2026-09-12T03:00:00.000Z' },
];

test('the vault page shows what a record was sorted as, and leaves out what is passing', () => {
  const note = memoriesNote([
    record({ id: 'a', text: 'Works at Happytel on Sundays', category: 'identity', subject: 'Work' }),
    record({ id: 'b', text: 'Opened Discord', category: 'passing' }),
  ]);
  assert.match(note.text, /- Works at Happytel on Sundays \*\(identity, 2026-09-10\)\*/);
  assert.doesNotMatch(note.text, /Discord/);
  assert.match(note.text, /count: 1/);
});
