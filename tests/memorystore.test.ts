// The live memory layer: the gate on what gets written, the cap on how much is
// kept, and the semantic layer's promise that it degrades rather than fails.
//
// memory.ts is already tested as an engine. What could not be reached until
// this became a module of its own is the wiring around it — whether a rejected
// memory really is not written, whether an eviction really does reach the
// forgetting log, and whether an embedder that has gone down costs her the
// sharpness of her recall or the whole of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, MAX_MEMORIES, QUERY_CACHE_MAX, type MemoryStoreDeps } from '../electron/memorystore';
import type { MemoryRecord, SessionSummary, ForgettingEntry, MonthNote } from '../electron/memory';
import type { MemoryBlock } from '../electron/blocks';
import type { Embedder } from '../electron/embeddings';

function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    kind: 'fact',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-19T00:00:00.000Z',
    mentions: 1,
    confidence: 0.9,
    importance: 0.5,
    source: 'conversation',
    status: 'active',
    memoryType: 'semantic',
    ...overrides,
  };
}


function harness(options: Partial<{
  memories: MemoryRecord[];
  sessions: SessionSummary[];
  monthNotes: MonthNote[];
  blocks: MemoryBlock[];
  embedder: Embedder | null;
  sort: MemoryStoreDeps['sort'];
}> = {}) {
  let saved = options.memories ? [...options.memories] : [];
  const forgotten: ForgettingEntry[] = [];
  const broadcasts: { channel: string; payload: unknown }[] = [];
  const embedded: string[] = [];
  let blocks = options.blocks ?? [];

  const embedder = options.embedder === undefined ? null : options.embedder;
  const deps: MemoryStoreDeps = {
    store: {
      getMemories: () => saved,
      setMemories: (records) => { saved = records; },
      getSessions: () => options.sessions ?? [],
      getMonthNotes: () => options.monthNotes ?? [],
      setMonthNotes: (items) => { options.monthNotes = items; },
      getBlocks: () => blocks,
      setBlocks: (next) => { blocks = next; },
      getForgettingLog: () => forgotten,
      appendForgettingLog: (entries) => { forgotten.push(...entries); return entries; },
    },
    broadcast: (channel, payload) => { broadcasts.push({ channel, payload }); },
    embedder: () => {
      if (!embedder) return null;
      return {
        model: embedder.model,
        embed: async (text) => { embedded.push(text); return embedder.embed(text); },
        embedBatch: async (texts) => { embedded.push(...texts); return embedder.embedBatch(texts); },
      };
    },
    character: () => ({ identity: 'Haru', style: 'dry' }),
    profile: () => ({ nickname: 'Tom', occupation: '', about: '' }),
    following: () => [],
    agenda: () => [],
    herOwnLife: () => '',
    ...(options.sort ? { sort: options.sort } : {}),
  };
  const store = createMemoryStore(deps);
  return {
    store,
    deps,
    forgotten,
    broadcasts,
    embedded,
    get saved() { return saved; },
  };
}

const stubEmbedder = (dimension = 4): Embedder => ({
  model: 'stub',
  async embed(text) { return Array.from({ length: dimension }, (_, i) => text.length + i); },
  async embedBatch(texts) { return texts.map(text => Array.from({ length: dimension }, (_, i) => text.length + i)); },
});

test('a memory worth keeping is written and announced', () => {
  const h = harness();
  const result = h.store.addMemory('Allergic to shellfish', 'fact');
  assert.equal(result?.created, true);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].text, 'Allergic to shellfish');
  assert.ok(h.broadcasts.some(entry => entry.channel === 'memory:changed'));
});

test('nothing worth keeping is written, and nothing is announced', () => {
  // The gate lives here rather than in the tool handler so that nothing which
  // can write a memory is able to skip it.
  const h = harness();
  const result = h.store.addMemory('They exist and are a person');
  assert.equal(result?.created, false);
  assert.equal(result?.record, null);
  assert.equal(h.saved.length, 0, 'a rejected memory must not reach the store');
  assert.equal(h.broadcasts.length, 0, 'and must not tell the windows anything changed');
});

test('an empty fact is not a fact', () => {
  const h = harness();
  assert.equal(h.store.addMemory('   '), null);
  assert.equal(h.saved.length, 0);
});

test('at the cap something leaves, and it leaves a record of why', () => {
  // A full store of low-importance memories, all long stale, so the cap has to choose.
  const full = Array.from({ length: MAX_MEMORIES }, (_, index) => record({
    id: `m${index}`,
    text: `Owns a thing numbered ${index}`,
    importance: 0.2,
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  }));
  const h = harness({ memories: full });
  h.store.addMemory('Allergic to shellfish', 'fact');
  assert.ok(h.saved.length <= MAX_MEMORIES, 'the cap must hold');
  assert.ok(h.forgotten.length > 0, 'something left and nobody was told');
  assert.equal(h.forgotten[0].reason, 'prune');
  assert.match(h.forgotten[0].detail ?? '', new RegExp(`${MAX_MEMORIES}-memory cap`));
});

test('a query is embedded once however often it is asked', async () => {
  const h = harness({ embedder: stubEmbedder() });
  const first = await h.store.embedQuery('how is the guitar going');
  const second = await h.store.embedQuery('how is the guitar going');
  assert.deepEqual(first, second);
  assert.equal(h.embedded.length, 1, 'the second ask should have been free');
});

test('there is nothing to embed without an embedder, and that is not an error', async () => {
  const h = harness({ embedder: null });
  assert.equal(await h.store.embedQuery('anything'), null);
  assert.equal(await h.store.embedQuery('   '), null);
});

test('an embedder that throws costs the query, not the turn', async () => {
  const broken: Embedder = {
    model: 'broken',
    async embed() { throw new Error('endpoint is down'); },
    async embedBatch() { throw new Error('endpoint is down'); },
  };
  const h = harness({ embedder: broken });
  assert.equal(await h.store.embedQuery('how is the guitar going'), null);
  // And nothing was cached, so it is retried rather than remembered as a failure.
  assert.equal(await h.store.embedQuery('how is the guitar going'), null);
});

test('the query cache does not grow without bound', async () => {
  const h = harness({ embedder: stubEmbedder() });
  for (let index = 0; index <= QUERY_CACHE_MAX; index += 1) {
    await h.store.embedQuery(`question number ${index}`);
  }
  // The oldest was dropped, so asking it again costs another embedding.
  const before = h.embedded.length;
  await h.store.embedQuery('question number 0');
  assert.equal(h.embedded.length, before + 1, 'the oldest entry should have been evicted');
  // The newest is still there and still free.
  await h.store.embedQuery(`question number ${QUERY_CACHE_MAX}`);
  assert.equal(h.embedded.length, before + 1);
});

test('superseded memories are not embedded — they can never be recalled', async () => {
  const h = harness({
    memories: [
      record({ id: 'now', text: 'Lives in Sheffield' }),
      record({ id: 'old', text: 'Lives in Manchester', supersededBy: 'now' }),
    ],
    embedder: stubEmbedder(),
  });
  await h.store.refreshVectors();
  assert.deepEqual(h.embedded, ['Lives in Sheffield']);
  assert.ok(h.store.vectors().has('now'));
  assert.ok(!h.store.vectors().has('old'));
});

test('an embedder that goes down leaves yesterday\'s vectors in place', async () => {
  let working = true;
  const flaky: Embedder = {
    model: 'flaky',
    async embed(text) { return [text.length]; },
    async embedBatch(texts) {
      if (!working) throw new Error('endpoint is down');
      return texts.map(text => [text.length]);
    },
  };
  const h = harness({ memories: [record({ id: 'a', text: 'Has two cats' })], embedder: flaky });
  await h.store.refreshVectors();
  assert.ok(h.store.vectors().has('a'));

  working = false;
  await h.store.refreshVectors();
  // Blunter is better than blind: stale vectors still score above nothing.
  assert.ok(h.store.vectors().has('a'), 'the old vectors should survive a failed refresh');
});

test('with no embedder at all the vectors are simply never built', async () => {
  const h = harness({ memories: [record({ id: 'a', text: 'Has two cats' })], embedder: null });
  await h.store.refreshVectors();
  assert.equal(h.store.vectors().size, 0);
});

test('a decay pass that changes nothing writes nothing', () => {
  const h = harness({ memories: [record({ id: 'a', text: 'Allergic to shellfish', importance: 0.9 })] });
  h.store.decay();
  assert.equal(h.broadcasts.length, 0, 'a quiet night should not wake the windows');
  assert.equal(h.forgotten.length, 0);
});

test('what decay forgets reaches the forgetting log, with decay as the reason', () => {
  // Low importance, untouched for years: past six half-lives it goes entirely.
  const ancient = record({
    id: 'trivia',
    text: 'Watched a clip about beekeeping once',
    importance: 0.2,
    lastSeenAt: '2020-01-01T00:00:00.000Z',
  });
  const h = harness({ memories: [ancient] });
  h.store.decay();
  assert.ok(h.forgotten.length > 0, 'it should have gone');
  assert.equal(h.forgotten[0].reason, 'decay');
  assert.equal(h.forgotten[0].text, 'Watched a clip about beekeeping once');
  assert.ok(h.broadcasts.some(entry => entry.channel === 'memory:changed'));
});

test('the last retrieval is recorded so the inspector can explain itself', () => {
  const h = harness({
    memories: [record({ id: 'guitar', text: 'Learning guitar, about six months in' })],
    blocks: [],
  });
  h.store.profileSummary('how is the guitar going', 'we were talking about music');
  const last = h.store.lastRetrieval();
  assert.ok(last, 'nothing was recorded');
  assert.equal(last?.query, 'we were talking about music how is the guitar going');
  const entry = last?.entries.find(item => item.id === 'guitar');
  assert.ok(entry, 'the memory that was picked should be named');
  assert.ok(typeof entry?.factors.relevance === 'number', 'and why it scored as it did');

  // And it is the last one, not the first. A record that is written once and
  // never replaced is worse than none: the drawer would confidently explain a
  // retrieval from an hour ago as though it were this message.
  h.store.profileSummary('are the cats fed');
  assert.equal(h.store.lastRetrieval()?.query, 'are the cats fed');
});

test('with nothing to say she says nothing, rather than an empty heading', () => {
  const h = harness({ memories: [], blocks: [] });
  assert.equal(h.store.profileSummary('anything at all'), '');
});

test('blocks are written and every window is told', () => {
  const h = harness();
  h.store.setBlocks([{ id: 'block-human', label: 'human', description: 'them', limit: 500, read_only: false }]);
  assert.ok(h.broadcasts.some(entry => entry.channel === 'blocks:changed'));
});

// ---- sorting ------------------------------------------------------------------

test('unsorted records are sent to be sorted and come back with a category and a day', async () => {
  const asked: string[][] = [];
  const h = harness({
    memories: [
      record({ id: 'psych', text: 'Rescheduled the psychologist to next Friday', kind: 'event', createdAt: '2026-09-14T02:00:00.000Z' }),
      record({ id: 'done', text: 'Likes lo-fi music while working', kind: 'preference', category: 'preference' }),
      record({ id: 'hers', text: "I don't get up for this any more", kind: 'preference', subject: 'haru' }),
      record({ id: 'gone', text: 'Uses Ubuntu', supersededBy: 'x' }),
    ],
    sort: async notes => {
      asked.push(notes.map(note => note.id));
      return new Map([['psych', { category: 'plan' as const, when: '2026-09-18' }]]);
    },
  });
  assert.equal(await h.store.sortPending(), 1);
  assert.deepEqual(asked, [['psych']], 'not what is sorted, hers, or replaced');
  const psych = h.saved.find(memory => memory.id === 'psych');
  assert.equal(psych?.category, 'plan');
  assert.equal(psych?.when, '2026-09-18');
  assert.equal(psych?.kind, 'event', 'the kind the older code reads is left as it was');
  assert.ok(h.broadcasts.some(entry => entry.channel === 'memory:changed'));
  assert.equal(h.embedded.length, 0, 'the text did not change, so nothing is re-embedded');
});

test('something raised on three separate days is not filed as passing on one read of it', async () => {
  const days = ['2026-09-01', '2026-09-02', '2026-09-03'].map(day => ({ at: `${day}T08:00:00.000Z`, kind: 'repeat' as const, source: 'explicit' as const }));
  const h = harness({
    memories: [
      record({ id: 'page', text: 'Check up on Tommy in the mornings', kind: 'preference', source: 'explicit', evidence: days }),
      record({ id: 'once', text: 'You asked about the new voice I use', kind: 'fact', source: 'explicit' }),
    ],
    sort: async () => new Map([['page', { category: 'passing' as const }], ['once', { category: 'passing' as const }]]),
  });
  await h.store.sortPending();
  assert.equal(h.saved.find(memory => memory.id === 'page')?.category, 'instruction');
  assert.equal(h.saved.find(memory => memory.id === 'once')?.category, 'passing');
});

test('a record the model did not answer for is skipped next time, and one rewritten meanwhile is left for later', async () => {
  let calls = 0;
  const h = harness({
    memories: [record({ id: 'a', text: 'Works at the cinema' }), record({ id: 'b', text: 'Saving for a house' })],
    sort: async notes => {
      calls += 1;
      if (calls === 1) {
        // Rewritten while the model was thinking.
        h.store.setMemories(h.saved.map(memory => memory.id === 'b' ? { ...memory, text: 'Saving for a house deposit' } : memory));
        return new Map([['b', { category: 'ongoing' as const }]]);
      }
      return new Map(notes.map(note => [note.id, { category: 'identity' as const }]));
    },
  });
  assert.equal(await h.store.sortPending(), 0);
  assert.equal(h.saved.find(memory => memory.id === 'b')?.category, undefined, 'its text changed, so the answer was for something else');
  await h.store.sortPending();
  assert.equal(h.saved.find(memory => memory.id === 'a')?.category, undefined, 'a was not answered the first time, so it is not asked again this run');
  assert.equal(h.saved.find(memory => memory.id === 'b')?.category, 'identity');
});

test('a model that cannot be reached costs nothing but the batch', async () => {
  const h = harness({ memories: [record({ id: 'a', text: 'Works at the cinema' })], sort: async () => { throw new Error('connection refused'); } });
  assert.equal(await h.store.sortPending(), 0);
  assert.equal(h.saved[0].category, undefined);
});

test('a page line synced again is a resighting, not another mention', () => {
  const h = harness();
  h.store.addMemory('Allergic to shellfish', 'fact', undefined, { source: 'explicit' });
  const again = h.store.addMemory('Allergic to shellfish', 'fact', undefined, { source: 'explicit', resighting: true });
  assert.equal(again?.created, false);
  assert.equal(h.saved[0].mentions, 1);
  assert.equal(h.saved[0].evidence?.length, 1);
});
