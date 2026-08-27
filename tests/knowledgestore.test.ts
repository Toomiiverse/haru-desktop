// The live knowledge layer: the queue, the save debounce, and the guards on
// what happens when there is no embedder, no vault, or no such document.
//
// The queue is the reason this file matters most. Ingesting a document embeds
// every chunk of it against the same endpoint the chat is using, so the jobs
// run one at a time — and an hourly vault sync landing mid-conversation must
// cost latency, never a turn. None of that could be reached while it lived in
// main.ts behind an Electron import.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeStore, SAVE_DEBOUNCE_MS, type KnowledgeStoreDeps } from '../electron/knowledgestore';
import type { KnowledgeStore } from '../electron/knowledge';
import { chunkRecord, documentRecord, storeWith } from './helpers';

function harness(options: Partial<{ knowledge: KnowledgeStore; config: Record<string, unknown> }> = {}) {
  const settings = new Map<string, unknown>(Object.entries(options.config ?? {}));
  let knowledge = options.knowledge ?? storeWith([]);
  const saves: KnowledgeStore[] = [];

  const deps: KnowledgeStoreDeps = {
    store: {
      get: (key) => settings.get(key),
      set: (key, value) => { settings.set(key, value); },
      getKnowledge: () => knowledge,
      setKnowledge: (next) => { saves.push(next); knowledge = next; },
    },
    fetch: async () => new Response(''),
    apiKeyFor: () => 'key',
  };
  return { live: createKnowledgeStore(deps), saves, settings, get knowledge() { return knowledge; } };
}

/** A promise somebody else decides the fate of. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('queued jobs run one at a time, in the order they were added', async () => {
  const h = harness();
  const order: string[] = [];
  const gate = deferred();

  const first = h.live.enqueue(async () => { order.push('first-in'); await gate.promise; order.push('first-out'); return 1; });
  const second = h.live.enqueue(async () => { order.push('second-in'); return 2; });

  // The second must not have started while the first is still going.
  await new Promise(done => setImmediate(done));
  assert.deepEqual(order, ['first-in'], 'the second job started before the first finished');

  gate.resolve();
  assert.equal(await first, 1);
  assert.equal(await second, 2);
  assert.deepEqual(order, ['first-in', 'first-out', 'second-in']);
});

test('a job that fails rejects its own caller and the queue carries on', async () => {
  // One unreadable note must not stop a vault sync, and a failed ingest must
  // not wedge every later one behind it.
  const h = harness();
  const failing = h.live.enqueue(async () => { throw new Error('unreadable'); });
  const after = h.live.enqueue(async () => 'still ran');

  await assert.rejects(failing, /unreadable/);
  assert.equal(await after, 'still ran', 'the queue stopped at the first failure');
});

test('jobs added while the queue is draining still get their turn', async () => {
  const h = harness();
  const done: number[] = [];
  const first = h.live.enqueue(async () => { done.push(1); });
  // Added from inside the first job's own continuation, which is when a vault
  // sync queues its follow-up work.
  const later = first.then(() => h.live.enqueue(async () => { done.push(2); }));
  await later;
  assert.deepEqual(done, [1, 2]);
});

test('there is nothing to embed with without a model, and ingest says so', async () => {
  const h = harness();
  await assert.rejects(h.live.ingest({ file: 'notes.md' }), /no model is set up/);
  assert.equal(h.live.embedder(), null);
});

test('an endpoint without a model is not an embedder either', () => {
  assert.equal(harness({ config: { 'ai.config': { endpoint: 'http://localhost:11434' } } }).live.embedder(), null);
  assert.equal(harness({ config: { 'ai.config': { model: 'llama3' } } }).live.embedder(), null);
  assert.ok(harness({ config: { 'ai.config': { endpoint: 'http://localhost:11434', model: 'llama3' } } }).live.embedder());
});

test('using a chunk marks it, and saves — once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({
    knowledge: storeWith([
      chunkRecord({ id: 'c1', content: 'the server lives in the cupboard' }),
      chunkRecord({ id: 'c2', content: 'the printer is on the landing' }),
    ]),
  });
  h.live.load();
  h.live.touch(['c1']);
  h.live.touch(['c1']);
  h.live.touch(['c2']);
  assert.equal(h.saves.length, 0, 'nothing should be written before the debounce elapses');

  t.mock.timers.tick(SAVE_DEBOUNCE_MS);
  assert.equal(h.saves.length, 1, 'three touches should cost one save');
  assert.ok(h.knowledge.chunks.find(chunk => chunk.id === 'c1')?.lastAccessedAt);
  assert.ok(h.knowledge.chunks.find(chunk => chunk.id === 'c2')?.lastAccessedAt);
});

test('touching nothing writes nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ knowledge: storeWith([chunkRecord({ id: 'c1', content: 'anything' })]) });
  h.live.load();
  h.live.touch(['not-a-chunk']);
  t.mock.timers.tick(SAVE_DEBOUNCE_MS);
  assert.equal(h.saves.length, 0, 'an unchanged store should not be rewritten');
});

test('a document nobody has is not deleted, and nothing is written', () => {
  const h = harness({ knowledge: storeWith([]) });
  h.live.load();
  assert.deepEqual(h.live.removeSource('nothing.md'), { deleted: false, removedChunks: 0 });
  assert.equal(h.saves.length, 0);
});

test('deleting a document counts what actually went', () => {
  const knowledge = storeWith(
    [
      chunkRecord({ id: 'c1', documentId: 'd1', content: 'first half', source: 'notes.md' }),
      chunkRecord({ id: 'c2', documentId: 'd1', content: 'second half', source: 'notes.md' }),
      chunkRecord({ id: 'c3', documentId: 'd2', content: 'a different note', source: 'other.md' }),
    ],
    [
      documentRecord({ id: 'd1', source: 'notes.md', chunkIds: ['c1', 'c2'] }),
      documentRecord({ id: 'd2', source: 'other.md', chunkIds: ['c3'] }),
    ],
  );
  const h = harness({ knowledge });
  h.live.load();
  const result = h.live.removeSource('notes.md');
  assert.deepEqual(result, { deleted: true, removedChunks: 2 });
  assert.equal(h.saves.length, 1, 'a deletion is written straight away, not debounced');
  // The other document is untouched.
  assert.ok(h.live.current().documents.find(doc => doc.source === 'other.md' && doc.status === 'active'));
});

test('a vault path is remembered, trimmed, and empty until one is set', () => {
  const h = harness();
  assert.equal(h.live.vaultPath(), '');
  h.live.saveVaultPath('  /home/tom/vault  ');
  assert.equal(h.live.vaultPath(), '/home/tom/vault');
});

test('syncing something that is not a directory is refused by name', async () => {
  const h = harness();
  await assert.rejects(h.live.syncVault('/definitely/not/here'), /no such vault/);
});

test('an auto-sync with no vault configured does nothing quietly', async () => {
  const h = harness();
  await h.live.autoSyncVault();
  assert.equal(h.saves.length, 0);
});

test('an auto-sync whose vault has gone is logged, not thrown', async () => {
  // A missing drive should not surface as an error in the middle of a chat.
  const h = harness();
  h.live.saveVaultPath('/definitely/not/here');
  await h.live.autoSyncVault();
});

test('reindexing counts what worked and steps over what did not', async () => {
  const knowledge = storeWith(
    [chunkRecord({ id: 'c1', documentId: 'd1', content: 'x', source: 'gone.md' })],
    [documentRecord({ id: 'd1', source: 'gone.md', chunkIds: ['c1'] })],
  );
  const h = harness({ knowledge });
  h.live.load();
  // No embedder, so every reindex fails — the point is that it returns rather
  // than throwing, and reports nothing done.
  assert.equal(await h.live.reindex(), 0);
});

test('what is loaded is what is handed out', () => {
  const knowledge = storeWith([chunkRecord({ id: 'c1', content: 'the server lives in the cupboard' })]);
  const h = harness({ knowledge });
  assert.equal(h.live.current().chunks.length, 0, 'nothing is read until the app is ready');
  h.live.load();
  assert.equal(h.live.current().chunks.length, 1);
});
