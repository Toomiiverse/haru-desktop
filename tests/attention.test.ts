import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { AttentionExperiment, newAttentionState, stepAttention, type AttentionInput } from '../electron/attention';
import { DEFAULT_VITALS } from '../electron/vitals';

const input = (overrides: Partial<AttentionInput> = {}): AttentionInput => ({
  now: 1_000_000, vitals: { ...DEFAULT_VITALS, energy: 1, curiosity: 1, sleepiness: 0, stress: 0, focus: 0 },
  environment: { hour: 12, idleSeconds: 0, onBattery: false, windowFocused: false },
  activity: 'working', sinceInteractionMs: 600_000, baselineReady: false, blocked: false, ...overrides,
});

test('replay: novelty habituates, direct contact wins, gates and cooldown suppress speech', () => {
  let state = stepAttention(newAttentionState(), input());
  assert.equal(state.action, 'speak');
  state = stepAttention(state, input({ now: 1_020_000, activity: 'gaming' }));
  assert.equal(state.novelty, 1);
  assert.notEqual(state.action, 'speak');
  const repeated = stepAttention(state, input({ now: 1_110_000, activity: 'gaming' }));
  assert.ok(repeated.novelty < 0.4);
  assert.equal(stepAttention(state, input({ now: 1_040_000, sinceInteractionMs: 0 })).action, 'attend');
  const blocked = stepAttention(newAttentionState(), input({ blocked: true }));
  assert.notEqual(blocked.action, 'speak');
  assert.equal(blocked.scores.speak, 0);
  const asleep = stepAttention(newAttentionState(), input({
    vitals: { ...DEFAULT_VITALS, energy: 0, sleepiness: 1 },
    environment: { hour: 3, idleSeconds: 3600, onBattery: false, windowFocused: false },
  }));
  assert.equal(asleep.action, 'rest');
});

test('elapsed-time integration is stable across tick rates, malformed readings and clock rollback', () => {
  const seed = { ...newAttentionState(), at: 1_000_000, activity: 'working' };
  const blocked = input({ blocked: true });
  const one = stepAttention(seed, { ...blocked, now: 1_060_000 });
  const half = stepAttention(seed, { ...blocked, now: 1_030_000 });
  const two = stepAttention(half, { ...blocked, now: 1_060_000 });
  for (const key of Object.keys(one.scores) as (keyof typeof one.scores)[]) assert.ok(Math.abs(one.scores[key] - two.scores[key]) < 1e-10);
  const bad = stepAttention(one, input({ now: 0, vitals: { ...DEFAULT_VITALS, energy: NaN, curiosity: Infinity } }));
  assert.equal(bad.at, one.at);
  assert.ok(Object.values(bad.scores).every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  assert.equal(seed.action, 'rest'); // Input state was not mutated.
});

test('shadow output records baseline comparisons, rotates, disables cleanly, and tolerates IO failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haru-attention-'));
  try {
    const file = join(dir, 'attention.jsonl');
    const experiment = new AttentionExperiment(() => file, true, 1600);
    for (let i = 0; i < 10; i++) experiment.observe(input({ now: 1_000_000 + i * 20_000 }));
    experiment.event('feedback', { id: 'reply-1', reaction: 'up', source: 'desktop' });
    assert.deepEqual(readdirSync(dir).sort(), ['attention.jsonl', 'attention.jsonl.1']);
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(rows.every(row => row.mode === 'shadow'));
    assert.equal(rows.at(-1).reaction, 'up');
    assert.equal(rows.find(row => row.kind === 'sample').baselineEligible, false);
    const report = JSON.parse(execFileSync(process.execPath, [join(__dirname, '../../scripts/attention-report.cjs'), file], { encoding: 'utf8' }));
    assert.ok(report.samples > 0);
    assert.equal(report.feedback.up, 1);
    assert.equal(report.baselineEligible, 0);
    assert.equal(report.malformed, 0);
    const before = readFileSync(file, 'utf8');
    new AttentionExperiment(() => file, false).observe(input());
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.doesNotThrow(() => new AttentionExperiment(() => join(dir, 'missing', 'log')).observe(input()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
