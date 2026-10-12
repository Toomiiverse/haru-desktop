import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HaruStore, SCHEMA_VERSION, MIGRATIONS, normalizeMemoryFile } from '../electron/store';

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

test('an unreadable store answers with defaults and refuses to write over itself', () => {
  const { store, dir, configName } = makeStore();
  store.set('chat.messages', [{ role: 'user', content: 'a real conversation' }]);
  const file = path.join(dir, `${configName}.json`);
  const good = readFileSync(file, 'utf8');

  // What a process killed between an atomic write and its rename leaves behind.
  const torn = '{"chat": {"messages": [{"role": "user",';
  writeFileSync(file, torn);

  // The read answers rather than throwing into the timer that made it.
  assert.deepEqual(store.get('chat.messages', []), []);
  assert.equal(store.healthy, false);

  // And that empty answer never goes back over the transcript it came from.
  store.set('chat.messages', []);
  assert.equal(readFileSync(file, 'utf8'), torn);

  // Once it parses again, reading and writing both resume on their own.
  writeFileSync(file, good);
  assert.equal((store.get('chat.messages') as unknown[]).length, 1);
  assert.equal(store.healthy, true);
  store.set('after', 'the weather cleared');
  assert.equal(store.get('after'), 'the weather cleared');
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
  assert.deepEqual(blocks.map(b => b.label), ['persona', 'human', 'preferences', 'her_standing', 'relationship', 'shared_history', 'current_project', 'working_state', 'her_own']);
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

test('recovery uses the user-data directory and leaves every healthy store untouched', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'haru-recovery-test-'));
  const cwd = path.join(root, 'user-data');
  mkdirSync(cwd);
  const options = { cwd, knowledgeFile: path.join(root, 'custom-knowledge.json') };
  const store = new HaruStore(options);
  store.set('value', 'saved config');
  const healthy = [options.knowledgeFile, ...['archive', 'memories', 'activity', 'graph', 'schedule', 'thoughts'].map(name => path.join(cwd, `${name}.json`))];
  for (const file of healthy) writeFileSync(file, '{"value":"old backup"}');
  store.backup('recovery');
  for (const file of healthy) writeFileSync(file, '{ "value": "new live data" }\n');
  const before = healthy.map(file => ({ contents: readFileSync(file, 'utf8'), modified: statSync(file).mtimeMs }));
  const config = path.join(cwd, 'config.json');
  writeFileSync(config, '{damaged config');

  assert.equal(HaruStore.recoverBackups(options), true);
  assert.equal(new HaruStore(options).get('value'), 'saved config');
  for (const [index, file] of healthy.entries()) {
    assert.equal(readFileSync(file, 'utf8'), before[index].contents, file);
    assert.equal(statSync(file).mtimeMs, before[index].modified, file);
  }
  const damaged = readdirSync(cwd).filter(name => name.startsWith('config.json.corrupt-'));
  assert.equal(damaged.length, 1);
  assert.equal(readFileSync(path.join(cwd, damaged[0]), 'utf8'), '{damaged config');
  assert.equal(HaruStore.recoverBackups(options), false, 'a healthy store needs no recovery');
  assert.ok(!readdirSync(cwd).some(name => name.includes('.recovering-')));
});

test('recovery honors custom paths for all stores, including a nested config name', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'haru-recovery-test-'));
  const custom = path.join(cwd, 'other-data');
  mkdirSync(custom);
  const options = {
    cwd, configName: 'settings/haru',
    knowledgeFile: path.join(custom, 'knowledge-store.json'),
    archiveFile: path.join(custom, 'archive-store.json'),
    memoriesFile: path.join(custom, 'memories-store.json'),
    activityFile: path.join(custom, 'activity-store.json'),
    graphFile: path.join(custom, 'graph-store.json'),
    scheduleFile: path.join(custom, 'schedule-store.json'),
    thoughtsFile: path.join(custom, 'thoughts-store.json'),
  };
  const store = new HaruStore(options);
  store.set('value', 'config');
  const files = [options.knowledgeFile, options.archiveFile, options.memoriesFile, options.activityFile, options.graphFile, options.scheduleFile, options.thoughtsFile];
  for (const file of files) writeFileSync(file, JSON.stringify({ value: path.basename(file) }));
  files.push(path.join(cwd, 'settings', 'haru.json'));
  const saved = files.map(file => readFileSync(file, 'utf8'));
  assert.equal(store.backup('custom-paths').length, 8);
  for (const file of files) writeFileSync(file, '{corrupt');

  assert.equal(HaruStore.recoverBackups(options), true);
  assert.equal(new HaruStore(options).get('value'), 'config');
  for (const [index, file] of files.entries()) assert.equal(readFileSync(file, 'utf8'), saved[index], file);
});

test('recovery skips newer damaged backups and selects the newest usable object', () => {
  const { dir, configName, knowledgeFile } = makeStore();
  const config = path.join(dir, `${configName}.json`);
  const versions = ['{"value":"old"}', '{"value":"newest usable"}', '{broken', 'null', '[]'];
  for (const [index, contents] of versions.entries()) {
    const backup = `${config}.before-recovery-${index}`;
    writeFileSync(backup, contents);
    utimesSync(backup, 1000 + index, 1000 + index);
  }
  mkdirSync(`${config}.before-recovery-directory`);
  writeFileSync(config, '{broken live data');

  assert.equal(HaruStore.recoverBackups({ cwd: dir, configName, knowledgeFile }), true);
  assert.equal(new HaruStore({ cwd: dir, configName, knowledgeFile }).get('value'), 'newest usable');
});

test('recovery leaves damaged data intact when no valid backup exists', () => {
  const { dir, configName, knowledgeFile } = makeStore();
  const config = path.join(dir, `${configName}.json`);
  writeFileSync(config, '{original damage');
  writeFileSync(`${config}.before-invalid`, '{also damaged');
  const before = readdirSync(dir).sort();

  assert.equal(HaruStore.recoverBackups({ cwd: dir, configName, knowledgeFile }), false);
  assert.equal(readFileSync(config, 'utf8'), '{original damage');
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test('a partial recovery cannot report success while config is still damaged', () => {
  const { dir, configName, knowledgeFile } = makeStore();
  const config = path.join(dir, `${configName}.json`);
  writeFileSync(config, '{unrecoverable');
  writeFileSync(knowledgeFile, '{recoverable');
  writeFileSync(`${knowledgeFile}.before-valid`, '{"documents":[],"chunks":[]}');

  assert.equal(HaruStore.recoverBackups({ cwd: dir, configName, knowledgeFile }), false);
  assert.equal(readFileSync(config, 'utf8'), '{unrecoverable');
  assert.deepEqual(JSON.parse(readFileSync(knowledgeFile, 'utf8')), { documents: [], chunks: [] });
});

test('a recovered config is enough to boot when a side file is damaged with no backup', () => {
  // A 0-byte thoughts.json from a crashed write must not keep her from
  // starting once config.json itself has been repaired: its own reader warns
  // and starts empty, and the damaged bytes stay where they were.
  const { dir, configName, knowledgeFile } = makeStore();
  const config = path.join(dir, `${configName}.json`);
  const options = { cwd: dir, configName, knowledgeFile };
  const good = new HaruStore(options);
  good.set('value', 'precious');
  good.backup('side-file');
  writeFileSync(config, '{corrupt');
  const thoughts = path.join(dir, 'thoughts.json');
  writeFileSync(thoughts, '');

  assert.equal(HaruStore.recoverBackups(options), true);
  assert.equal(new HaruStore(options).get('value'), 'precious');
  assert.equal(readFileSync(thoughts, 'utf8'), '');
  assert.doesNotThrow(() => new HaruStore(options).getThoughts(), 'the damaged side file reads as empty rather than throwing');
});

test('a missing live store is not resurrected from an old backup', () => {
  const { dir, configName, knowledgeFile } = makeStore();
  writeFileSync(`${knowledgeFile}.before-old`, '{"documents":[],"chunks":[]}');
  assert.equal(HaruStore.recoverBackups({ cwd: dir, configName, knowledgeFile }), false);
  assert.equal(existsSync(knowledgeFile), false);
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
  store.writeMemoryFile({
    memories: [],
    sessions: [],
    monthNotes: [],
    forgettingLog: [
      { id: 'good', text: 'gone', at: '2026-08-20T00:00:00.000Z', reason: 'decay' },
      { text: 'no id', at: '2026-08-20T00:00:00.000Z' },
      { id: 'no timestamp', text: 'gone' },
      null,
      'not even an object',
    ] as never,
  });
  assert.deepEqual(store.getForgettingLog().map(entry => entry.id), ['good']);
});

test('blocks come back with the standard set filled in, and keep what was saved', () => {
  const { store } = makeStore();
  const labels = store.getBlocks().map(block => block.label);
  for (const label of ['persona', 'human', 'preferences', 'her_standing', 'relationship', 'shared_history', 'current_project', 'working_state', 'her_own']) {
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

// -- memories.json ---------------------------------------------------------------

test('migration v5 moves memories, sessions and the forgetting log out of config.json', () => {
  const { store, dir } = makeStore();
  store.set('memories', [{ id: 'm1', text: 'Allergic to shellfish', kind: 'fact', createdAt: '2026-07-01T00:00:00.000Z', mentions: 2 }]);
  store.set('memory.sessions', [{ day: '2026-08-01', summary: 'a day', createdAt: '2026-08-01T00:00:00.000Z' }]);
  store.set('memory.forgettingLog', [{ id: 'gone', text: 'forgotten', at: '2026-08-20T00:00:00.000Z', reason: 'decay' }]);
  store.set('schema.version', 4);

  const report = store.migrate();
  assert.equal(report.to, SCHEMA_VERSION);
  assert.ok(report.steps.some(step => step.includes('memories.json')));

  for (const key of ['memories', 'memory.sessions', 'memory.forgettingLog']) {
    assert.equal(store.has(key), false, `${key} was left behind in config.json`);
  }
  assert.equal(existsSync(path.join(dir, 'memories.json')), true);
  assert.equal(store.getMemories()[0].text, 'Allergic to shellfish');
  assert.equal(store.getSessions().length, 1);
  assert.deepEqual(store.getForgettingLog().map(entry => entry.id), ['gone']);
});

test('a store coming up from before v2 is enriched on the way into its own file', () => {
  // v2 derives confidence and importance, and it reads through getMemories -
  // which points at a file v5 has not written yet. v5 runs the same derivation
  // on what it moves, or a legacy record would land in memories.json raw.
  const { store } = makeStore();
  store.set('memories', [{ id: 'old1', text: 'Dislikes being nagged', createdAt: '2026-07-01T00:00:00.000Z', mentions: 3 }]);
  store.migrate();
  const [moved] = store.getMemories();
  assert.equal(typeof moved.confidence, 'number');
  assert.equal(typeof moved.importance, 'number');
  assert.equal(moved.status, 'active');
});

test('migrating with nothing to move leaves an empty file and no keys', () => {
  const { store } = makeStore();
  store.set('schema.version', 4);
  store.migrate();
  assert.equal(store.has('memories'), false);
  assert.deepEqual(store.getMemories(), []);
  assert.deepEqual(store.getSessions(), []);
});

test('memories are backed up, verified and hardened alongside the other store files', () => {
  const { store, dir } = makeStore();
  store.setMemories([{ id: 'm1', text: 'Allergic to shellfish', kind: 'fact', createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-01T00:00:00.000Z', mentions: 1 }]);
  const made = store.backup('a-reason');
  assert.equal(made.some(file => file.includes('memories.json.before-a-reason-')), true);
  assert.equal(store.verify(), true);
  writeFileSync(path.join(dir, 'memories.json'), 'not json at all');
  assert.equal(store.verify(), false);
});

test('a memories file that is missing, corrupt or the wrong shape is empty, not a crash', () => {
  const { store, dir } = makeStore();
  assert.deepEqual(store.getMemories(), []);
  for (const written of ['{not json', '[1,2,3]', '"a string"', '{"memories":"not a list"}']) {
    const fresh = new HaruStore({ cwd: dir, configName: `c-${written.length}-${written.charCodeAt(1)}`, knowledgeFile: path.join(dir, 'k.json'), memoriesFile: path.join(dir, 'broken.json') });
    writeFileSync(path.join(dir, 'broken.json'), written);
    assert.deepEqual(fresh.getMemories(), [], `${written} should read as no memories`);
    assert.deepEqual(fresh.getSessions(), []);
  }
});

test('a transaction that throws rolls the memories back, not just the config', () => {
  // replace_in_block supersedes a memory and edits a block as one unit. The
  // memories used to live inside electron-store, so restoring its snapshot
  // covered both; now they do not, and a rollback that forgot them would leave
  // the supersede applied and the block edit undone.
  const { store } = makeStore();
  const before = [{ id: 'm1', text: 'lives in Manchester', kind: 'fact' as const, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-01T00:00:00.000Z', mentions: 1 }];
  store.setMemories(before);
  store.set('a.block', 'before');

  assert.throws(() => store.transaction(() => {
    store.setMemories([...before, { id: 'm2', text: 'lives in Sheffield', kind: 'fact', createdAt: '2026-08-02T00:00:00.000Z', lastSeenAt: '2026-08-02T00:00:00.000Z', mentions: 1 }]);
    store.set('a.block', 'after');
    throw new Error('half way through');
  }), /half way through/);

  assert.deepEqual(store.getMemories(), before, 'the memory written inside the transaction survived the rollback');
  assert.equal(store.get('a.block'), 'before');
});

test('a transaction that succeeds keeps what it wrote', () => {
  const { store } = makeStore();
  const memories = [{ id: 'm1', text: 'Allergic to shellfish', kind: 'fact' as const, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-01T00:00:00.000Z', mentions: 1 }];
  store.transaction(() => { store.setMemories(memories); });
  assert.deepEqual(store.getMemories(), memories);
});

test('normalizeMemoryFile carries monthNotes when present and defaults when not', () => {
  const withNotes = normalizeMemoryFile({ memories: [], sessions: [], monthNotes: [{ month: '2026-08', summary: 'the fold' }], forgettingLog: [] });
  assert.deepEqual(withNotes.monthNotes, [{ month: '2026-08', summary: 'the fold' }]);
  const legacy = normalizeMemoryFile({ memories: [], sessions: [], forgettingLog: [] });
  assert.deepEqual(legacy.monthNotes, [], 'a file from before monthNotes existed still loads');
});
