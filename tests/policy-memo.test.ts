import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMO_OPS } from '../electron/core-policy-sync';
import { currentTurn, runTimedTurn } from '../electron/turn-timing';

test('only pure per-turn getters are memoised', () => {
  assert.deepEqual([...MEMO_OPS].sort(), ['agenda-life.get', 'anime-downloads.config', 'conversation-program.todaysExamples', 'credit-guard.conversationRoute', 'final-search.config', 'final-system.config', 'manga-fetch.config', 'memory-admin.known', 'memory-admin.readSlate', 'memory-tools.normalizeFile', 'mood.normalize', 'natural-policy.contextDefault', 'route-admission.local', 'self.explicitModeOn']);
});

test('a turn has one identity for its whole run and none outside it', async () => {
  assert.equal(currentTurn(), undefined);
  const seen: unknown[] = [];
  await runTimedTurn('t', async () => { seen.push(currentTurn()); await Promise.resolve(); seen.push(currentTurn()); }, () => {});
  await runTimedTurn('u', async () => { seen.push(currentTurn()); }, () => {});
  assert.ok(seen[0] && seen[0] === seen[1] && seen[2] && seen[2] !== seen[0]);
  assert.equal(currentTurn(), undefined);
});

test('span lines are held until the turn ends; other stages go out at once', async () => {
  const { timingFor } = await import('../electron/turn-timing');
  const out: string[] = [];
  const mark = timingFor('t', e => out.push(e.stage + (e.operation ? ':' + e.operation : '')));
  mark('runner_start'); mark('policy_span', { operation: 'a.b', durationMs: 1 }); mark('storage_span', { step: 'commit', durationMs: 2 }); mark('dispatch');
  assert.deepEqual(out, ['runner_start', 'dispatch']);
  mark('runner_end', { status: 'ok', durationMs: 3 });
  assert.deepEqual(out, ['runner_start', 'dispatch', 'runner_end', 'policy_span:a.b', 'storage_span']);
  mark('storage_span', { step: 'behind', durationMs: 1 });
  assert.equal(out.length, 6);
});
