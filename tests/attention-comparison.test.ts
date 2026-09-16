import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DEFAULT_VITALS } from '../electron/vitals';
const { compareObserved } = require(join(__dirname, '../../research/fruitfly/compare-observed.cjs'));

function samples(kind: 'active' | 'unknown' | 'conversation' | 'blocked', duration = 3600) {
  return Array.from({ length: duration / 20 + 1 }, (_, index) => ({
    version: 1, policy: 3, mode: 'shadow', session: 'test', sequence: index + 1, kind: 'sample',
    at: new Date(1_000_000 + index * 20_000).toISOString(), blocked: kind === 'blocked', activity: 'working',
    inputs: { vitals: { ...DEFAULT_VITALS, energy: 1, curiosity: 1, sleepiness: 0, stress: 0, focus: 0 },
      environment: { hour: 12, idleSeconds: kind === 'unknown' ? null : 0, windowFocused: null, onBattery: null },
      sinceInteractionMs: kind === 'conversation' ? index % 3 * 20_000 : null },
    observation: { availability: kind === 'unknown' ? 'unknown' : 'recent-input', source: kind === 'unknown' ? null : 'desktop',
      idleSeconds: kind === 'unknown' ? null : 0 },
  }));
}

test('same-input comparison preserves unknown, conversation, blocking and startup grace for every arm', () => {
  for (const kind of ['unknown', 'conversation', 'blocked'] as const) {
    const rows = samples(kind), before = JSON.stringify(rows);
    const result = compareObserved(rows);
    assert.ok(Object.values(result.sessions[0].proposals).every((arm: any) => arm.max === 0), kind);
    assert.equal(JSON.stringify(rows), before, 'analysis must not alter recorded evidence');
  }
  const early = compareObserved(samples('active', 580)).sessions[0];
  assert.ok(Object.values(early.proposals).every((arm: any) => arm.max === 0));
  const active = compareObserved(samples('active')).sessions[0];
  assert.ok(active.proposals.baseline.mean > 0);
  assert.ok(active.proposals.simple.mean > 0);
  assert.ok(active.proposals.fly.mean > 0);
  assert.equal(active.coverage.afterWarmupUnblockedRecentInput, 151);
  assert.deepEqual(compareObserved(samples('active')), compareObserved(samples('active')), 'fixed seeds reproduce exactly');
});

test('comparison skips partial sessions and rejects invalid clocks or invented presence', () => {
  const partial = compareObserved(samples('active').slice(1));
  assert.equal(partial.skippedPartialSessions, 1);
  assert.equal(partial.sessions.length, 0);
  for (const corrupt of [
    (row: any) => { row.observation.source = null; },
    (row: any) => { row.inputs.vitals.energy = NaN; },
    (row: any) => { row.inputs.sinceInteractionMs = -1; },
    (row: any) => { row.at = new Date(0).toISOString(); },
  ]) {
    const rows = samples('active', 40); corrupt(rows[1]);
    assert.throws(() => compareObserved(rows), /Invalid observed sample/);
  }
});
