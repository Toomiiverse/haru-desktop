import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMO_OPS } from '../electron/core-policy-sync';
import { currentTurn, runTimedTurn } from '../electron/turn-timing';

test('only pure per-turn getters are memoised', () => {
  assert.deepEqual([...MEMO_OPS].sort(), ['agenda-life.get', 'conversation-program.todaysExamples', 'memory-admin.readSlate', 'memory-tools.normalizeFile', 'mood.normalize']);
});

test('a turn has one identity for its whole run and none outside it', async () => {
  assert.equal(currentTurn(), undefined);
  const seen: unknown[] = [];
  await runTimedTurn('t', async () => { seen.push(currentTurn()); await Promise.resolve(); seen.push(currentTurn()); }, () => {});
  await runTimedTurn('u', async () => { seen.push(currentTurn()); }, () => {});
  assert.ok(seen[0] && seen[0] === seen[1] && seen[2] && seen[2] !== seen[0]);
  assert.equal(currentTurn(), undefined);
});
