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

test('migrations registry carries the v2 step', () => {
  assert.equal(MIGRATIONS.length >= 1, true);
  assert.equal(MIGRATIONS[0].version, 2);
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

test('migrations registry carries the v2 step', () => {
  assert.equal(MIGRATIONS.length >= 1, true);
  assert.equal(MIGRATIONS[0].version, 2);
});