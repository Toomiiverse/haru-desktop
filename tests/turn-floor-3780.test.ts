// 3780: the write-timing line names what a commit changed; the memory read starts early on every turn; the life tick is one commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changedKeys } from '../electron/core-store';

test('a commit is described by its documents and changed config keys, never values', () => {
  const before = { config: { vitals: { energy: .5 }, her: { weather: { wander: 1 }, lastAliveAt: 'a', slate: { at: 's' } }, profile: { nickname: 'Ada' } }, memories: { memories: [] } };
  const patch = { config: { ...before.config, vitals: { energy: .4 }, her: { ...before.config.her, weather: { wander: 2 }, lastAliveAt: 'b' } } };
  assert.equal(changedKeys(patch, before), 'config:vitals her.weather her.lastAliveAt');
  assert.equal(changedKeys({ memories: { memories: [1] }, config: { ...before.config, profile: { nickname: 'Bo' } } }, before), 'memories config:profile');
  assert.equal(changedKeys(undefined, before), '');
  assert.ok(!changedKeys(patch, before).includes('Ada') && !changedKeys(patch, before).includes('0.4'));
});

test('main.ts starts the memory read on every turn and writes the life tick in one transaction', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(src.includes('const earlyMemory = startCallMemory(latest, recentUserContext);'));
  const i = src.indexOf('function persistVitals(force = false) {'); const body = src.slice(i, src.indexOf('\n}', i));
  assert.ok(body.includes('store.transaction(() => {') && body.split('store.set(').length - 1 === 3);
});
