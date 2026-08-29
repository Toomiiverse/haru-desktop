import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HaruStore, SCHEMA_VERSION, MIGRATIONS } from '../electron/store';

function makeStore(extra: { maxBackups?: number } = {}): { store: HaruStore; dir: string; configName: string; knowledgeFile: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'haru-store-test-'));
  const configName = 'haru-config-test';
  const knowledgeFile = path.join(dir, 'knowledge.json');
  const store = new HaruStore({ cwd: dir, configName, knowledgeFile, maxBackups: extra.maxBackups ?? 3 });
  return { store, dir, configName, knowledgeFile };
}

test('get/set/delete round-trip through the facade', () => {
  const { store } = makeStore();
  store.set('some.key', { nested: true });
  assert.deepEqual(store.get('some.key'), { nested: true });
  store.set('another', 7);
  assert.equal(store.get('another'), 7);
  assert.equal(store.get('missing', 'fallback'), 'fallback');
  store.delete('some.key');
  assert.equal(store.get('some.key'), undefined);
});

test('typed memory accessors read and write', () => {
  const { store } = makeStore();
  assert.deepEqual(store.getMemories(), []);
  assert.deepEqual(store.getSessions(), []);
  const memories = [{ id: 'm1', text: 'Allergic to shellfish', kind: 'fact' as const, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-01T00:00:00.000Z', mentions: 1 }];
  store.setMemories(memories);
  assert.deepEqual(store.getMemories(), memories);
  const sessions = [{ day: '2026-08-01', summary: 'nothing happened', createdAt: '2026-08-01T00:00:00.000Z' }];
  store.setSessions(sessions);
  assert.deepEqual(store.getSessions(), sessions);
});

test('knowledge file is written and read back through the facade', () => {
  const { store, knowledgeFile } = makeStore();
  assert.deepEqual(store.getKnowledge(), { documents: [], chunks: [] });
  const value = { documents: [{ id: 'd1', source: 'note.md', sourceType: 'markdown', category: 'personal', hash: 'abc', version: 1, metadata: {}, status: 'active', chunkIds: ['c1'], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }], chunks: [] };
  store.setKnowledge(value as never);
  assert.equal(existsSync(knowledgeFile), true);
  assert.deepEqual(store.getKnowledge(), value);
});

test('transaction rolls back on throw and commits on success', () => {
  const { store } = makeStore();
  store.set('before', 1);
  assert.throws(() => {
    store.transaction(() => {
      store.set('before', 2);
      store.set('touched', true);
      throw new Error('boom');
    });
  });
  assert.equal(store.get('before'), 1);
  assert.equal(store.get('touched'), undefined);
  store.transaction(() => {
    store.set('before', 3);
    store.set('touched', true);
  });
  assert.equal(store.get('before'), 3);
  assert.equal(store.get('touched'), true);
});

test('backup copies both files and rotation keeps only maxBackups', () => {
  const { store, dir, configName } = makeStore({ maxBackups: 2 });
  store.set('value', 'one');
  store.backup('test-reason');
  store.backup('test-reason');
  store.backup('test-reason');
  const backups = readdirSync(dir).filter(name => name.startsWith(`${configName}.json.before-test-reason-`));
  assert.equal(backups.length, 2);
  assert.equal(existsSync(path.join(dir, backups[0])), true);
});

test('migrate is idempotent after the first run', () => {
  const { store } = makeStore();
  store.migrate();
  const again = store.migrate();
  assert.equal(again.steps.length, 0);
  assert.equal(again.to, SCHEMA_VERSION);
});

test('migrate runs the registered steps and enriches legacy memories', () => {
  const { store } = makeStore();
  store.set('memories', [
    { id: 'old1', text: 'Dislikes being nagged', createdAt: '2026-07-01T00:00:00.000Z', mentions: 3 },
  ]);
  const report = store.migrate();
  assert.equal(report.from, 0);
  assert.equal(report.to, SCHEMA_VERSION);
  assert.equal(report.steps.length, MIGRATIONS.length);
  assert.equal(store.get('schema.version'), SCHEMA_VERSION);
  const migrated = store.getMemories();
  assert.equal(migrated.length, 1);
  assert.equal(typeof migrated[0].confidence, 'number');
  assert.equal(typeof migrated[0].importance, 'number');
  assert.equal(migrated[0].source, 'conversation');
  assert.equal(migrated[0].status, 'active');
});

test('migrations registry carries the v2 and v3 steps', () => {
  assert.equal(MIGRATIONS.length >= 2, true);
  assert.equal(MIGRATIONS[0].version, 2);
  assert.equal(MIGRATIONS[1].version, 3);
});

test('migration v3 creates memory blocks without touching existing memory', () => {
  const { store } = makeStore();
  store.set('memories', [
    { id: 'old1', text: 'Dislikes being nagged', kind: 'preference', createdAt: '2026-07-01T00:00:00.000Z', mentions: 3 },
  ]);
  store.set('memory.sessions', [{ day: '2026-08-01', summary: 'a day', createdAt: '2026-08-01T00:00:00.000Z' }]);
  const report = store.migrate();
  assert.equal(report.to, SCHEMA_VERSION);
  const blocks = store.getBlocks();
  assert.deepEqual(blocks.map(b => b.label), ['persona', 'human', 'preferences', 'relationship', 'current_project', 'working_state']);
  assert.equal(blocks.find(b => b.label === 'persona')!.read_only, true);
  assert.equal(store.getMemories()[0].text, 'Dislikes being nagged');
  assert.equal(store.getSessions().length, 1);
});

test('verify detects a corrupt config file', () => {
  const { store, dir, configName } = makeStore();
  assert.equal(store.verify(), true);
  writeFileSync(path.join(dir, `${configName}.json`), '{not json', 'utf8');
  assert.equal(store.verify(), false);
});

test('recoverBackups restores the newest backup over a corrupt file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'haru-store-test-'));
  const configName = 'haru-config-test';
  const knowledgeFile = path.join(dir, 'knowledge.json');
  const good = new HaruStore({ cwd: dir, configName, knowledgeFile });
  good.set('value', 'precious');
  good.backup('recovery-test');
  writeFileSync(path.join(dir, `${configName}.json`), '{corrupt', 'utf8');
  const restored = HaruStore.recoverBackups({ cwd: dir, configName, knowledgeFile });
  assert.equal(restored, true);
  const reopened = new HaruStore({ cwd: dir, configName, knowledgeFile });
  assert.equal(reopened.get('value'), 'precious');
});
test('the forgetting log is bounded, so the record of what she forgot cannot grow forever', () => {
  const { store } = makeStore();
  assert.deepEqual(store.getForgettingLog(), []);
  const entry = (index: number) => ({ id: `m${index}`, text: `something ${index}`, at: '2026-08-20T00:00:00.000Z', reason: 'decay' as const });
  const combined = store.appendForgettingLog(Array.from({ length: 250 }, (_, index) => entry(index)));
  assert.equal(combined.length, 250, 'the caller is handed everything it just wrote');
  const kept = store.getForgettingLog();
  assert.equal(kept.length, 200, 'but only the last two hundred survive on disk');
  assert.equal(kept.at(-1)?.id, 'm249', 'and it is the newest that survive');
  assert.equal(kept[0].id, 'm50');
});

test('appending nothing changes nothing', () => {
  const { store } = makeStore();
  store.appendForgettingLog([{ id: 'm1', text: 'gone', at: '2026-08-20T00:00:00.000Z', reason: 'decay' }]);
  assert.deepEqual(store.appendForgettingLog([]).map(entry => entry.id), ['m1']);
  assert.equal(store.getForgettingLog().length, 1);
});

test('a half-written forgetting entry is skipped rather than handed back', () => {
  // It is read straight out of a file somebody could have edited, and every
  // caller expects an id and a timestamp to be there.
  const { store } = makeStore();
  store.set('memory.forgettingLog', [
    { id: 'good', text: 'gone', at: '2026-08-20T00:00:00.000Z', reason: 'decay' },
    { text: 'no id', at: '2026-08-20T00:00:00.000Z' },
    { id: 'no timestamp', text: 'gone' },
    null,
    'not even an object',
  ]);
  assert.deepEqual(store.getForgettingLog().map(entry => entry.id), ['good']);
});

test('blocks come back with the standard set filled in, and keep what was saved', () => {
  const { store } = makeStore();
  const labels = store.getBlocks().map(block => block.label);
  for (const label of ['persona', 'human', 'preferences', 'relationship', 'current_project', 'working_state']) {
    assert.ok(labels.includes(label), `${label} is missing from a fresh store`);
  }
  assert.equal(store.getBlocks().find(block => block.label === 'persona')?.read_only, true,
    'the persona is the one block a memory tool may never edit');

  const edited = store.getBlocks().map(block => block.label === 'human' ? { ...block, value: 'They are called Tom.' } : block);
  store.setBlocks(edited);
  assert.equal(store.getBlocks().find(block => block.label === 'human')?.value, 'They are called Tom.');
  assert.equal(store.getBlocks().length, edited.length, 'the defaults should not be merged in twice');
});

test('has answers for a key that was never set', () => {
  const { store } = makeStore();
  assert.equal(store.has('journal.config'), false);
  store.set('journal.config', { enabled: true });
  assert.equal(store.has('journal.config'), true);
  store.delete('journal.config');
  assert.equal(store.has('journal.config'), false);
});

test('several keys can be written at once', () => {
  const { store } = makeStore();
  store.set({ 'ai.config': { model: 'llama3' }, 'chat.dayKey': '2026-08-20' });
  assert.deepEqual(store.get('ai.config'), { model: 'llama3' });
  assert.equal(store.get('chat.dayKey'), '2026-08-20');
});

test('a knowledge file that is not there is an empty store, not a crash', () => {
  // The comment above getKnowledge promises this: a store that cannot be read
  // is an empty one, and she starts with no documents rather than not starting.
  const { store } = makeStore();
  const empty = store.getKnowledge();
  assert.deepEqual(empty.chunks, []);
  assert.deepEqual(empty.documents, []);
});

test('a corrupt knowledge file is an empty store, not a crash', () => {
  const { store, knowledgeFile } = makeStore();
  writeFileSync(knowledgeFile, '{ this is not json');
  assert.deepEqual(store.getKnowledge().chunks, []);
});

test('a knowledge file of the wrong shape comes back clean, whoever cleans it', () => {
  // Parseable json, but nothing in it is a document or a chunk. The guarantee is
  // that callers get a well-formed store whatever is on disk; where that is
  // enforced is an implementation detail, so this asserts the result rather than
  // the route to it.
  const { store, knowledgeFile } = makeStore();
  writeFileSync(knowledgeFile, JSON.stringify({
    documents: [{ nonsense: true }, null, 'a string'],
    chunks: [{ also: 'nonsense' }, 42],
    somethingElse: 'ignored',
  }));
  const loaded = store.getKnowledge();
  assert.deepEqual(loaded.documents, []);
  assert.deepEqual(loaded.chunks, []);
  assert.deepEqual(Object.keys(loaded).sort(), ['chunks', 'documents'], 'nothing extra should survive');
});

test('a knowledge file that is a list, or a number, is not a store', () => {
  const { store, knowledgeFile } = makeStore();
  for (const junk of ['[]', '42', '"a string"', 'null']) {
    writeFileSync(knowledgeFile, junk);
    assert.deepEqual(store.getKnowledge(), { documents: [], chunks: [] }, `${junk} was not refused`);
  }
});

test('the archive is read and written through its own file, not config.json', () => {
  const { store, dir } = makeStore();
  assert.deepEqual(store.getArchive(), {});
  store.set('marker', 'still in config');
  store.setArchive({ '2026-08-29': [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(store.getArchive(), { '2026-08-29': [{ role: 'user', content: 'hi' }] });
  assert.equal(existsSync(path.join(dir, 'archive.json')), true);
  // The point of the exercise: the transcripts are not in the file that is
  // rewritten every time anything else changes.
  const config = readFileSync(path.join(dir, 'haru-config-test.json'), 'utf8');
  assert.equal(config.includes('still in config'), true);
  assert.equal(config.includes('"hi"'), false);
});

test('a caller that deletes a day it was only reading cannot delete it for everyone', () => {
  const { store } = makeStore();
  store.setArchive({ '2026-08-28': ['a'], '2026-08-29': ['b'] });
  const reading = store.getArchive();
  delete reading['2026-08-28'];
  assert.deepEqual(Object.keys(store.getArchive()).sort(), ['2026-08-28', '2026-08-29']);
});

test('migration v4 moves an existing archive out of config.json and drops the key', () => {
  const { store, dir } = makeStore();
  store.set('chat.archive', { '2026-08-01': ['old'], '2026-08-02': ['older'] });
  store.set('schema.version', 3);
  const report = store.migrate();
  assert.equal(report.to, SCHEMA_VERSION);
  assert.ok(report.steps.some(step => step.includes('archive.json')));
  assert.equal(store.get('chat.archive'), undefined);
  assert.deepEqual(store.getArchive(), { '2026-08-01': ['old'], '2026-08-02': ['older'] });
  assert.equal(existsSync(path.join(dir, 'archive.json')), true);
});

test('migrating with no archive to move leaves an empty one and no key', () => {
  const { store } = makeStore();
  store.set('schema.version', 3);
  store.migrate();
  assert.equal(store.has('chat.archive'), false);
  assert.deepEqual(store.getArchive(), {});
});

test('the archive is backed up and verified alongside the other store files', () => {
  const { store, dir } = makeStore();
  store.setArchive({ '2026-08-29': ['kept'] });
  const made = store.backup('a-reason');
  assert.equal(made.some(file => file.includes('archive.json.before-a-reason-')), true);
  assert.equal(store.verify(), true);
  writeFileSync(path.join(dir, 'archive.json'), 'not json at all');
  assert.equal(store.verify(), false);
});
