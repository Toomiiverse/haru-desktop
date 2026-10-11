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

test('migrations registry carries the v2 and v3 steps', () => {
  assert.equal(MIGRATIONS.length >= 2, true);
  assert.equal(MIGRATIONS[0].version, 2);
  assert.equal(MIGRATIONS[1].version, 3);
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

test('a missing live store is not resurrected from an old backup', () => {
  const { dir, configName, knowledgeFile } = makeStore();
  writeFileSync(`${knowledgeFile}.before-old`, '{"documents":[],"chunks":[]}');
  assert.equal(HaruStore.recoverBackups({ cwd: dir, configName, knowledgeFile }), false);
  assert.equal(existsSync(knowledgeFile), false);
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

test('the archive is backed up and verified alongside the other store files', () => {
  const { store, dir } = makeStore();
  store.setArchive({ '2026-08-29': ['kept'] });
  const made = store.backup('a-reason');
  assert.equal(made.some(file => file.includes('archive.json.before-a-reason-')), true);
  assert.equal(store.verify(), true);
  writeFileSync(path.join(dir, 'archive.json'), 'not json at all');
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
