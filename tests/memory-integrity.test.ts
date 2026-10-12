import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rememberInto, isSameMemory, isInTheirWords, supersede, type MemoryRecord } from '../electron/memory';
import { createMemoryStore } from '../electron/memorystore';
import { defaultMemoryBlocks } from '../electron/blocks';
import { runChatTool, type ToolDeps } from '../electron/tools';
import { mergeMemories, mergeDeletions } from '../electron/memorysync';
import { HaruStore } from '../electron/store';
import { blankSlateInstruction, readSlate, withoutPreSlate } from '../electron/blankslate';

const now = '2026-09-28T20:00:00.000Z';
function record(text: string, id = 'old', source: 'explicit' | 'inferred' = 'explicit'): MemoryRecord {
  return rememberInto([], { text, id, kind: 'fact', category: 'identity', source, now }).record;
}
function fixture(initial: MemoryRecord[] = [], durable = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'haru-memory-integrity-'));
  let rows = initial, blocks = defaultMemoryBlocks();
  const store = durable ? new HaruStore({ cwd: dir, configName: 'config', knowledgeFile: path.join(dir, 'knowledge.json') }) : {
    get: () => undefined, getMemories: () => rows, setMemories: (xs: MemoryRecord[]) => { rows = xs; },
    getSessions: () => [], getMonthNotes: () => [], setMonthNotes() {},
    getBlocks: () => blocks, setBlocks: (xs: typeof blocks) => { blocks = xs; },
    getForgettingLog: () => [], appendForgettingLog() {}, transaction: <T>(fn: () => T) => fn(),
  };
  if (durable) store.setMemories(initial);
  const facade = createMemoryStore({ store, broadcast() {}, embedder: () => null,
    character: () => ({ identity: 'Haru', style: '' }), profile: () => ({ nickname: '', occupation: '', about: '' }),
    following: () => [], agenda: () => [], herOwnLife: () => '' });
  const deps = { store, onWeb: () => false, ...facade } as unknown as ToolDeps;
  const run = async (name: string, args: Record<string, unknown>, latest = '') => JSON.parse(await runChatTool({ function: { name, arguments: args } }, latest, deps));
  return { dir, store, facade, run };
}

for (const [old, corrected] of [
  ['My cat is named Miso.', 'My cat is named Nori.'],
  ['The user owns an RTX 3060 GPU.', 'The user owns an RTX 3070 GPU.'],
  ['The user does not drink coffee.', 'The user drinks coffee.'],
  ['My son is Bo.', 'My son is Al.'],
]) test(`correction preserves history and activates exact new fact: ${corrected}`, async () => {
  assert.equal(isSameMemory(old, corrected), false);
  const f = fixture([record(old)]);
  const reply = await f.run('remember_about_user', { fact: corrected, replaces: old }, corrected);
  assert.equal(reply.saved, true);
  const active = f.facade.getMemories().filter(m => !m.supersededBy && m.status !== 'archived');
  assert.deepEqual(active.map(m => m.text), [corrected]);
  assert.equal(f.facade.getMemories().find(m => m.id === 'old')!.supersededBy, active[0].id);
  assert.equal(reply.text, corrected);
});

for (const [fact, latest] of [
  ['My brother is Alex.', 'The character in my play says, "My brother is Alex."'],
  ['The user likes coffee.', 'I do not like coffee.'],
  ['My cat is Nori.', 'Is my cat Nori?'],
  ['My brother is Alex.', 'Imagine my brother is Alex.'],
  ['The user owns an RTX 3070 GPU.', 'The user owns an RTX 3060 GPU.'],
  ['My brother is Alex.', 'My sister is Alex.'],
  ['The user owns a bicycle.', 'My friend owns a bicycle.'],
  ['My brother is Alex.', "My brother's boss is Alex."],
  ['My cat is Nori.', 'My cat is Miso and my dog is Nori.'],
]) test(`unsupported claim is refused: ${latest}`, async () => {
  const f = fixture();
  const reply = await f.run('remember_about_user', { fact }, latest);
  assert.equal(reply.saved, false);
  assert.equal(f.facade.getMemories().length, 0);
});

test('mixed fiction retains separate real assertion', () => {
  const said = 'In my novel my brother is Alex. In real life my brother is Ben.';
  assert.equal(isInTheirWords('My brother is Alex.', said), false);
  assert.equal(isInTheirWords('My brother is Ben.', said), true);
});

test('repeated model guesses never become independent confirmation', () => {
  let rows: MemoryRecord[] = [];
  for (let i = 0; i < 20; i++) rows = rememberInto(rows, { text: 'Owns a bicycle called Comet', id: String(i), kind: 'fact', source: 'inferred', now }).memories;
  assert.equal(rows.length, 1); assert.equal(rows[0].confidence, 0.55); assert.equal(rows[0].mentions, 1);
  const confirmed = rememberInto(rows, { text: rows[0].text, id: 'confirmed', kind: 'fact', source: 'explicit', evidenceDetail: 'My bicycle is called Comet', now });
  assert.equal(confirmed.record.source, 'explicit'); assert.equal(confirmed.record.confidence, 0.9);
  const replay = rememberInto(confirmed.memories, { text: rows[0].text, id: 'replay', kind: 'fact', source: 'explicit', evidenceDetail: 'My bicycle is called Comet', now });
  assert.equal(replay.record.mentions, confirmed.record.mentions);
});

test('empty replacement really removes the fact from rendered memory', async () => {
  const f = fixture([record('My cat is named Miso.')]);
  const reply = await f.run('core_memory_replace', { label: 'human', old_substring: 'My cat is named Miso.', new_substring: '' }, 'Forget my cat name');
  assert.equal(reply.saved, true); assert.equal(reply.archived, 1);
  assert.equal(f.facade.getMemories()[0].status, 'archived');
  assert.ok(!f.facade.profileSummary('my cat').includes('Miso'));
});

test('substring replacement stores the whole corrected fact', async () => {
  const f = fixture([record('My cat is named Miso.')]);
  const reply = await f.run('core_memory_replace', { label: 'human', old_substring: 'Miso', new_substring: 'Nori' }, 'My cat is named Nori.');
  assert.equal(reply.saved, true);
  assert.equal(reply.text, 'My cat is named Nori.');
  assert.deepEqual(f.facade.getMemories().filter(m => !m.supersededBy).map(m => m.text), ['My cat is named Nori.']);
});

test('same-value rewrite remains visible and never supersedes itself', async () => {
  const text = 'My cat is named Miso.', f = fixture([record(text)]);
  const reply = await f.run('core_memory_rethink', { label: 'human', new_value: text }, 'Rewrite it');
  assert.equal(reply.saved, true); assert.equal(reply.superseded, 0);
  assert.equal(f.facade.getMemories().length, 1);
  assert.ok(!f.facade.getMemories()[0].supersededBy);
  assert.ok(f.facade.profileSummary('my cat').includes(text));
});

test('unsupported replacement leaves every record unchanged', async () => {
  const f = fixture([record('My cat is named Miso.')]);
  const before = f.facade.getMemories();
  const reply = await f.run('core_memory_replace', { label: 'human', old_substring: 'Miso', new_substring: 'Nori' }, 'My cat is named Sushi.');
  assert.equal(reply.saved, false); assert.deepEqual(f.facade.getMemories(), before);
});

test('supersession refuses self links and cycles', () => {
  const rows = [record('My cat is Miso.', 'a'), record('My cat is Nori.', 'b')];
  assert.deepEqual(supersede(rows, 'a', 'a'), rows);
  const next = supersede(rows, 'a', 'b', now);
  assert.deepEqual(supersede(next, 'b', 'a', now), next);
});

test('deleted memory cannot return from legacy array sync', () => {
  const old = record('My bicycle is called Comet.'), f = fixture([old]);
  f.facade.setMemories([]);
  const result = f.facade.mergeIn([old]);
  assert.equal(result.added, 0); assert.equal(f.facade.getMemories().length, 0);
  assert.equal(f.facade.getDeletions()[0].id, old.id);
});

test('deletion is durable and travels in both directions', () => {
  const old = record('My bicycle is called Comet.'), f = fixture([old], true);
  f.facade.setMemories([]);
  const disk = new HaruStore({ cwd: f.dir, configName: 'config', knowledgeFile: path.join(f.dir, 'knowledge.json') });
  assert.equal(disk.getMemoryDeletions()[0].id, old.id);
  assert.deepEqual(disk.getMemories(), []);
  const other = fixture([old]);
  other.facade.mergeIn({ memories: [], deletions: disk.getMemoryDeletions() });
  assert.deepEqual(other.facade.getMemories(), []);
  other.facade.mergeIn([old]);
  assert.deepEqual(other.facade.getMemories(), []);
  for (let i = 0; i < 230; i++) disk.appendForgettingLog([{ id: 'irrelevant-' + i, at: now, text: 'Synthetic item', reason: 'prune' }]);
  assert.equal(disk.getMemoryDeletions()[0].id, old.id);
});

test('same-timestamp sync has deterministic fields, evidence, and links', () => {
  const a = { ...record('My cat is Miso.'), mergedFrom: ['a'], conflictsWith: ['x'], supersededBy: 'c' };
  const b = { ...a, text: 'My cat is Nori.', mergedFrom: ['b'], conflictsWith: ['y'], supersededBy: 'd' };
  const ab = mergeMemories([a], [b], now).memories;
  const ba = mergeMemories([b], [a], now).memories;
  assert.deepEqual(ab, ba);
  assert.deepEqual(mergeMemories(ab, ba, now).memories, ab);
  assert.deepEqual(ab[0].mergedFrom, ['a', 'b']);
});

test('archive revision wins over a stale active copy', () => {
  const a = record('My cat is Miso.');
  const b = { ...a, status: 'archived' as const, updatedAt: '2026-09-28T21:00:00.000Z' };
  assert.equal(mergeMemories([b], [a], now).memories[0].status, 'archived');
});

test('settling blank slate permits standing memory without reopening pre-reset data', () => {
  const slate = readSlate({ slate: { at: '2026-09-21T00:00:00.000Z', settledAt: now } })!;
  assert.equal(blankSlateInstruction(slate, 0, Date.parse(now)), '');
  const data = withoutPreSlate({ memories: [{ createdAt: '2026-09-20T00:00:00Z' }, { createdAt: now }], deletions: [{ id: 'old', at: now }] }, slate) as { memories: unknown[]; deletions: unknown[] };
  assert.equal(data.memories.length, 1); assert.equal(data.deletions.length, 1);
  assert.ok(blankSlateInstruction({ at: now }, 0, Date.parse(now)));
});

test('failed disk write does not update the memory cache', () => {
  const f = fixture([record('My cat is Miso.')], true);
  const store = f.store as HaruStore;
  const file = path.join(f.dir, 'memories.json');
  rmSync(file); mkdirSync(file);
  assert.throws(() => store.setMemories([]));
  assert.equal(store.getMemories().length, 1);
  assert.equal(store.getMemoryDeletions().length, 0);
});

test('a forgotten vault bullet cannot be recreated by the next scan', () => {
  const f = fixture();
  const text = 'Prefers detailed explanations without emoji';
  const saved = f.facade.addMemory(text, 'preference', undefined, { id: 'vault-bullet', source: 'explicit', resighting: true });
  assert.equal(saved?.record?.id, 'vault-bullet');
  f.facade.setMemories([]);
  assert.equal(f.facade.addMemory(text, 'preference', undefined, { id: 'vault-bullet', source: 'explicit', resighting: true }), null);
  assert.equal(f.facade.getMemories().length, 0);
});


test('named relative copulas may reverse without borrowing a fictional name', () => {
  const said = 'In my novel my brother is Alex. In real life my brother is Ben.';
  assert.equal(isInTheirWords('Ben is their brother', said), true);
  assert.equal(isInTheirWords('Alex is their brother', said), false);
});
