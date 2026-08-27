import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWorthRemembering,
  bansATopic,
  isSameMemory,
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
  type MemoryRecord,
} from '../electron/memory';

// ---- isWorthRemembering: reject each category, accept concrete facts ----

test('isWorthRemembering rejects empty / no-keyword text', () => {
  assert.equal(isWorthRemembering(''), false);
  assert.equal(isWorthRemembering('   '), false);
});

test('isWorthRemembering rejects a ban on mentioning a topic', () => {
  assert.equal(isWorthRemembering("Don't mention the jellyfish PC"), false);
  assert.equal(isWorthRemembering('Stop mentioning the jellyfish PC'), false);
  assert.equal(bansATopic("Don't mention the jellyfish PC"), true);
});

test('isWorthRemembering rejects UNIVERSAL statements true of anyone', () => {
  assert.equal(isWorthRemembering('Is a person'), false);
  assert.equal(isWorthRemembering('They are your user and they exist'), false);
});

test('isWorthRemembering rejects NOWHERE_IN_PARTICULAR places', () => {
  assert.equal(isWorthRemembering('Lives in a city'), false);
});

test('isWorthRemembering rejects TRANSIENT statements with nothing named', () => {
  assert.equal(isWorthRemembering('Is currently doing something'), false);
});

test('isWorthRemembering keeps a TRANSIENT statement that names something (escape hatch)', () => {
  // This is the exact example the code's own comment cites for namesSomething().
  assert.equal(isWorthRemembering('Currently reading Oyasumi Punpun Ch. 1'), true);
});

test('isWorthRemembering accepts short but concrete facts', () => {
  assert.equal(isWorthRemembering('Allergic to shellfish'), true);
  assert.equal(isWorthRemembering('Vegetarian'), true);
});

// ---- rememberInto: dedupe via isSameMemory, bump mentions, keep longer text ----

test('isSameMemory treats reworded phrasings above the 0.6 overlap bar as the same', () => {
  assert.equal(isSameMemory('Has a dog called Rex', 'has a dog named Rex'), true);
});

test('isSameMemory keeps genuinely different facts apart', () => {
  assert.equal(isSameMemory('a dog called Rex', 'a cat called Mabel'), false);
});

test('rememberInto creates a new record when nothing matches', () => {
  const { memories, created, record } = rememberInto([], {
    text: 'Has a dog called Rex', kind: 'fact', id: 'a1', now: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(created, true);
  assert.equal(memories.length, 1);
  assert.equal(record.mentions, 1);
  assert.equal(record.text, 'Has a dog called Rex');
});

test('rememberInto dedupes a reworded repeat and bumps mentions instead of creating a new record', () => {
  const existing: MemoryRecord[] = [{
    id: 'a1', text: 'Has a dog called Rex', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const { memories, created, record } = rememberInto(existing, {
    text: 'has a dog named Rex', kind: 'fact', id: 'a2', now: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(created, false);
  assert.equal(memories.length, 1);
  assert.equal(record.mentions, 2);
  assert.equal(record.id, 'a1');
});

test('rememberInto keeps whichever phrasing is longer', () => {
  // existing text is longer than the incoming rewording -> stays as-is.
  const longer: MemoryRecord[] = [{
    id: 'a1', text: 'Has a dog called Rex', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const stillLonger = rememberInto(longer, {
    text: 'has a dog named Rex', kind: 'fact', id: 'a2', now: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(stillLonger.record.text, 'Has a dog called Rex');

  // incoming text is longer than the existing one -> the new phrasing wins.
  const shorter: MemoryRecord[] = [{
    id: 'b1', text: 'has a dog named Rex', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const nowLonger = rememberInto(shorter, {
    text: 'Has a dog called Rex, a rescue from the shelter', kind: 'fact', id: 'b2', now: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(nowLonger.record.text, 'Has a dog called Rex, a rescue from the shelter');
});

// ---- recurringMemories / RECURRING_THRESHOLD ----

test('RECURRING_THRESHOLD is exactly 3', () => {
  assert.equal(RECURRING_THRESHOLD, 3);
});

test('recurringMemories keeps only mentions >= 3, sorted by mentions descending', () => {
  const base = { kind: 'fact' as const, createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' };
  const memories: MemoryRecord[] = [
    { ...base, id: '1', text: 'one', mentions: 1 },
    { ...base, id: '2', text: 'two', mentions: 2 },
    { ...base, id: '3', text: 'three', mentions: 3 },
    { ...base, id: '4', text: 'four', mentions: 5 },
  ];
  const recurring = recurringMemories(memories);
  assert.deepEqual(recurring.map(m => m.id), ['4', '3']);
});

// ---- selectMemories: recurring bypasses relevance, one-off needs it ----

test('selectMemories lets a recurring-but-irrelevant memory through', () => {
  const memories: MemoryRecord[] = [{
    id: 'r1', text: 'Learning to play guitar', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: RECURRING_THRESHOLD,
  }];
  const selected = selectMemories(memories, 'what should I have for dinner tonight');
  assert.equal(selected.some(m => m.id === 'r1'), true);
});

test('selectMemories filters out a one-off memory with nothing in common with the message', () => {
  const memories: MemoryRecord[] = [{
    id: 'o1', text: 'Learning to play guitar', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const selected = selectMemories(memories, 'what should I have for dinner tonight');
  assert.equal(selected.some(m => m.id === 'o1'), false);
});

test('selectMemories lets a one-off memory through when it is actually relevant', () => {
  const memories: MemoryRecord[] = [{
    id: 'rel1', text: 'Learning to play guitar', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const selected = selectMemories(memories, "how's the guitar practice going");
  assert.equal(selected.some(m => m.id === 'rel1'), true);
});

test('selectMemories always includes preference/relationship kinds regardless of relevance', () => {
  const memories: MemoryRecord[] = [{
    id: 'p1', text: 'Prefers short, direct answers', kind: 'preference',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const selected = selectMemories(memories, 'totally unrelated message about the weather');
  assert.equal(selected.some(m => m.id === 'p1'), true);
});

// ---- pruneMemories ----

test('pruneMemories keeps the highest-scored records: mentions dominate, always-included kinds get a bonus, recency is a tie-breaker', () => {
  const memories: MemoryRecord[] = [
    { id: 'low-old', text: 'a', kind: 'fact', createdAt: '2020-01-01T00:00:00.000Z', lastSeenAt: '2020-01-01T00:00:00.000Z', mentions: 1 },
    { id: 'high-old', text: 'b', kind: 'fact', createdAt: '2020-01-01T00:00:00.000Z', lastSeenAt: '2020-01-01T00:00:00.000Z', mentions: 5 },
    { id: 'pref-very-old', text: 'c', kind: 'preference', createdAt: '2015-01-01T00:00:00.000Z', lastSeenAt: '2015-01-01T00:00:00.000Z', mentions: 1 },
    { id: 'low-recent', text: 'd', kind: 'fact', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1 },
    { id: 'mid-recent', text: 'e', kind: 'fact', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 2 },
  ];
  const pruned = pruneMemories(memories, 3);
  assert.deepEqual(pruned.map(m => m.id), ['high-old', 'pref-very-old', 'mid-recent']);
});

test('pruneMemories is a no-op under the limit', () => {
  const memories: MemoryRecord[] = [{
    id: 'x', text: 'x', kind: 'fact', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  assert.equal(pruneMemories(memories, 10), memories);
});

// ---- supersession ----

test('findSuperseded matches an active memory that actually contains the hinted word', () => {
  const memories: MemoryRecord[] = [{
    id: 'os1', text: 'Uses Ubuntu on the server', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const found = findSuperseded(memories, 'Ubuntu');
  assert.equal(found?.id, 'os1');
});

test('findSuperseded rejects a vague paraphrase that names nothing actually in the text', () => {
  const memories: MemoryRecord[] = [{
    id: 'os1', text: 'Uses Ubuntu on the server', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  // "Ubuntu" is nowhere in "the old server OS" as words — this is deliberately
  // not enough, on the theory that a hint which cannot name the old fact
  // should not get to guess at replacing it.
  assert.equal(findSuperseded(memories, 'the old server configuration'), null);
});

test('findSuperseded ignores a memory already superseded', () => {
  const memories: MemoryRecord[] = [{
    id: 'os1', text: 'Uses Ubuntu on the server', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
    supersededBy: 'os2',
  }];
  assert.equal(findSuperseded(memories, 'Ubuntu'), null);
});

test('findSuperseded returns null when no active memory contains the hinted word', () => {
  const memories: MemoryRecord[] = [{
    id: 'x1', text: 'Learning to play guitar', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  assert.equal(findSuperseded(memories, 'Ubuntu'), null);
});

test('findSuperseded prefers the tighter match when the hint fits more than one record', () => {
  const memories: MemoryRecord[] = [{
    id: 'looser', text: 'Uses Ubuntu as the primary server operating system for everything', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }, {
    id: 'tighter', text: 'Uses Ubuntu', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  // Both records contain "Ubuntu" — the one with fewer leftover words wins.
  const found = findSuperseded(memories, 'Ubuntu');
  assert.equal(found?.id, 'tighter');
});

test('supersede marks the old record without removing it', () => {
  const memories: MemoryRecord[] = [{
    id: 'os1', text: 'Uses Ubuntu on the server', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const updated = supersede(memories, 'os1', 'os2');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].supersededBy, 'os2');
});

test('selectMemories never surfaces a superseded record, even a recurring one', () => {
  const memories: MemoryRecord[] = [{
    id: 'os1', text: 'Uses Ubuntu on the server', kind: 'fact',
    createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z',
    mentions: RECURRING_THRESHOLD, supersededBy: 'os2',
  }, {
    id: 'os2', text: 'Switched the server to Debian', kind: 'fact',
    createdAt: '2026-02-01T00:00:00.000Z', lastSeenAt: '2026-02-01T00:00:00.000Z', mentions: 1,
  }];
  const selected = selectMemories(memories, 'what OS is the server running');
  assert.equal(selected.some(m => m.id === 'os1'), false);
  assert.equal(selected.some(m => m.id === 'os2'), true);
});

// ---- explicit recall ----

test('isExplicitRecall recognises a reach-back phrase', () => {
  assert.equal(isExplicitRecall('do you remember when we set up the server'), true);
  assert.equal(isExplicitRecall('what did I say about the GPU'), true);
  assert.equal(isExplicitRecall("what's for dinner"), false);
});

test('DEEP_RECALL_LIMIT is wider than the default selectMemories limit', () => {
  assert.equal(DEEP_RECALL_LIMIT > 14, true);
});

// ---- misc small pure helpers ----

test('isWorthKeeping rejects the "nothing notable" sentinel and rejects empty summaries', () => {
  assert.equal(isWorthKeeping('nothing notable'), false);
  assert.equal(isWorthKeeping('Nothing notable.'), false);
  assert.equal(isWorthKeeping(''), false);
  assert.equal(isWorthKeeping('Spent the afternoon debugging the audio driver.'), true);
});
