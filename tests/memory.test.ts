import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWorthRemembering,
  isAboutTheConversation,
  scoreImportance,
  ALWAYS_IMPORTANT,
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
  daysRaised,
  isRecurring,
  calibrateSimilarity,
  semanticSimilarities,
  retrieveMemories,
  SEMANTIC_FLOOR,
  type MemoryRecord,
} from '../electron/memory';

const fixture = (overrides: Partial<MemoryRecord> & { id: string; text: string; kind: MemoryRecord['kind'] }): MemoryRecord => ({
  createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-28T00:00:00.000Z', mentions: 1,
  confidence: 0.8, importance: 0.5, source: 'conversation', status: 'active', memoryType: 'semantic',
  ...overrides,
});

// ---- importance: lasting topics are permanent, the work itself is not ----

test('scoreImportance keeps health, dates, contact details and identity at the permanent tier', () => {
  for (const line of [
    'Allergic to shellfish',
    'Takes medication for ADHD every morning',
    'Has been diagnosed with ADHD, and sees a psychologist regularly once a month named Sam.',
    'Their anniversary is 18 June',
    'Address is Unit 2, 62 Fitzgerald Street, Northbridge',
    'Is the founder of a company called The PC Project',
    'Acts as the Creative Director of the company',
  ]) assert.ok(scoreImportance('fact', line) >= ALWAYS_IMPORTANT, line);
});

test('scoreImportance puts the work itself one tier down, so it is offered when relevant and fades when over', () => {
  for (const line of [
    'Wants 6 mailboxes total for The PC Project.',
    'Has a deadline on the marketing plan next Friday',
    'The company is looking for a second unit',
    'Rent went up this year',
  ]) assert.equal(scoreImportance('fact', line), 0.6, line);
  assert.equal(scoreImportance('fact', 'Watched a YouTube clip'), 0.2);
  assert.equal(scoreImportance('fact', 'Has a dog called Miso'), 0.6);
  assert.equal(scoreImportance('fact', 'is usually up late'), 0.4);
});

// ---- recurrence is counted in days, not mentions ----

test('daysRaised counts distinct evidence days and falls back to mentions without a log', () => {
  const sameDay = fixture({ id: 'a', text: 'Closing the store', kind: 'event', mentions: 8,
    evidence: Array.from({ length: 8 }, (_, i) => ({ at: `2026-08-27T0${i}:00:00.000Z`, kind: 'repeat' as const, source: 'conversation' as const })) });
  assert.equal(daysRaised(sameDay), 1);
  const spread = fixture({ id: 'b', text: 'Working on the PC Project', kind: 'fact', mentions: 3,
    evidence: ['2026-08-10', '2026-08-15', '2026-08-22'].map(day => ({ at: `${day}T10:00:00.000Z`, kind: 'statement' as const, source: 'conversation' as const })) });
  assert.equal(daysRaised(spread), 3);
  assert.equal(daysRaised(fixture({ id: 'c', text: 'legacy', kind: 'fact', mentions: 5 })), 5);
});

test('a merge-inflated one-day event is not recurring; three days is', () => {
  const inflated = fixture({ id: 'a', text: 'Closing the store', kind: 'event', mentions: 8,
    evidence: Array.from({ length: 8 }, (_, i) => ({ at: `2026-08-27T0${i}:00:00.000Z`, kind: 'repeat' as const, source: 'conversation' as const })) });
  assert.equal(isRecurring(inflated), false);
  const spread = fixture({ id: 'b', text: 'Working on the PC Project', kind: 'fact', mentions: 3,
    evidence: ['2026-08-10', '2026-08-15', '2026-08-22'].map(day => ({ at: `${day}T10:00:00.000Z`, kind: 'statement' as const, source: 'conversation' as const })) });
  assert.equal(isRecurring(spread), true);
  assert.deepEqual(recurringMemories([inflated, spread]).map(m => m.id), ['b']);
});

// ---- semantic similarity is calibrated: unrelated is zero ----

test('calibrateSimilarity floors the nomic baseline at zero and rescales above it', () => {
  assert.equal(calibrateSimilarity(0.40), 0);
  assert.equal(calibrateSimilarity(SEMANTIC_FLOOR), 0);
  assert.equal(calibrateSimilarity(1), 1);
  assert.ok(Math.abs(calibrateSimilarity(0.725) - 0.5) < 1e-9);
});

test('semanticSimilarities reports zero for a memory at the unrelated baseline', () => {
  const memories = [fixture({ id: 'same', text: 'x', kind: 'fact' }), fixture({ id: 'baseline', text: 'y', kind: 'fact' }), fixture({ id: 'none', text: 'z', kind: 'fact' })];
  const vectors = new Map<string, number[]>([
    ['same', [1, 0]],
    ['baseline', [0.40, Math.sqrt(1 - 0.16)]],   // cosine 0.40 against [1, 0]
  ]);
  const out = semanticSimilarities(memories, [1, 0], vectors);
  assert.equal(out.get('same'), 1);
  assert.equal(out.get('baseline'), 0);
  assert.equal(out.has('none'), false);
});

// ---- only preferences and relationships are guaranteed a slot ----

test('retrieveMemories offers a high-importance fact but does not let it displace what the message is about', () => {
  const memories = [
    fixture({ id: 'pref', text: 'Dislikes being nagged', kind: 'preference', importance: 0.85 }),
    fixture({ id: 'founder', text: 'Founded a company that sells computers', kind: 'fact', importance: 0.8 }),
    fixture({ id: 'closure', text: 'Closing the store for cleaning on Monday', kind: 'event', importance: 0.45 }),
  ];
  const picked = retrieveMemories(memories, 'what about the store cleaning', { limit: 2 }).map(entry => entry.memory.id);
  assert.deepEqual(picked.sort(), ['closure', 'pref']);
});

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

test('isWorthRemembering rejects records about the conversation or about her, not about them', () => {
  // The fourteen that were in the store on 2026-08-29 and had to be deleted by hand.
  const junk = [
    'The PC Project comes up often, 3 times.',
    'they are thanking you',
    'They occasionally say you are helpful, and sometimes it brings up a good mood.',
    'Might be low, but they can talk',
    'Nothing notable',
    'Discord opened and closed',
    'Procrastination noted',
    'Don\u2019t be late for the motherboard pickup',
    'Make sure to pick up the motherboard from Umart',
    'Pick up the motherboard from Umart in Belmont',
    'Details not shared',
  ];
  for (const line of junk) assert.equal(isWorthRemembering(line), false, line);
  assert.equal(isAboutTheConversation('Nothing notable'), true);
});

test('isWorthRemembering still keeps the real records, including the ones that name her', () => {
  const kept = [
    'Wants Haru to be less nice and more in-character when tested or corrected on personality.',
    'Does not like Haru repeating the line \u201cUgh this is getting boring as hell already!\u201d.',
    'does not like to be corrected on tasks or reminders without being told how to improve',
    'Prefer not to be constantly nagged and reminded of tasks when not asked',
    'Does not want therapy-style advice when trying to calm down.',
    'Rental inspection went well, no issues found',
    'Rental inspection went well, no issues found Also: Rental inspection completed. Also: Rental inspection completed, but details not shared.',
    'Calls his mother every Sunday',
    // A shrug folded onto an event keeps the event: the pattern is anchored
    // so only "details not shared" as the whole record is refused.
    'Rental inspection completed, but details not shared.',
    'Wants 6 mailboxes total for The PC Project.',
    'Decided to buy MacBook Air M2 instead of Pro',
    'Picked up Hanya\u2019s PC screen',
    'Has a dog called Miso',
  ];
  for (const line of kept) assert.equal(isWorthRemembering(line), true, line);
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

test('pruneMemories keeps the highest-scored records and reports what it took', () => {
  const memories: MemoryRecord[] = [
    { id: 'pref', text: 'c', kind: 'preference', createdAt: '2015-01-01T00:00:00.000Z', lastSeenAt: '2015-01-01T00:00:00.000Z', mentions: 1, importance: 0.85, confidence: 0.9 },
    { id: 'high', text: 'b', kind: 'fact', createdAt: '2020-01-01T00:00:00.000Z', lastSeenAt: '2026-06-01T00:00:00.000Z', mentions: 5, importance: 0.5, confidence: 0.9 },
    { id: 'low-old', text: 'a', kind: 'fact', createdAt: '2020-01-01T00:00:00.000Z', lastSeenAt: '2020-01-01T00:00:00.000Z', mentions: 1, importance: 0.2, confidence: 0.4 },
    { id: 'low-recent', text: 'd', kind: 'fact', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1, importance: 0.2, confidence: 0.4 },
    { id: 'mid-recent', text: 'e', kind: 'fact', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 2, importance: 0.4, confidence: 0.8 },
  ];
  const result = pruneMemories(memories, 3);
  const ids = result.memories.map(m => m.id);
  // The preference is untouchable; the well-mentioned recent fact survives, and
  // the two weakest — old and low-importance — go before anything fresher.
  assert.ok(ids.includes('pref'));
  assert.ok(ids.includes('high'));
  assert.ok(ids.includes('mid-recent'));
  assert.ok(!ids.includes('low-old'));
  assert.ok(!ids.includes('low-recent'));
  assert.equal(result.evicted.length, 2);
  assert.deepEqual(result.evicted.map(m => m.id).sort(), ['low-old', 'low-recent']);
});

test('pruneMemories never evicts archived records', () => {
  const memories: MemoryRecord[] = [
    { id: 'archived', text: 'a', kind: 'fact', createdAt: '2020-01-01T00:00:00.000Z', lastSeenAt: '2020-01-01T00:00:00.000Z', mentions: 1, status: 'archived' },
    { id: 'low', text: 'b', kind: 'fact', createdAt: '2020-01-01T00:00:00.000Z', lastSeenAt: '2020-01-01T00:00:00.000Z', mentions: 1, importance: 0.2, confidence: 0.4 },
  ];
  const result = pruneMemories(memories, 1);
  assert.deepEqual(result.memories.map(m => m.id), ['archived']);
  assert.deepEqual(result.evicted.map(m => m.id), ['low']);
});

test('pruneMemories is a no-op under the limit', () => {
  const memories: MemoryRecord[] = [{
    id: 'x', text: 'x', kind: 'fact', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', mentions: 1,
  }];
  const result = pruneMemories(memories, 10);
  assert.deepEqual(result.memories, memories);
  assert.deepEqual(result.evicted, []);
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
