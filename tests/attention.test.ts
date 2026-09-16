import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { AttentionExperiment, newAttentionState, stepAttention, type AttentionInput } from '../electron/attention';
import { DEFAULT_VITALS, driftVitals, applyEvent } from '../electron/vitals';
import { shouldPipeUp } from '../electron/opening';

const input = (overrides: Partial<AttentionInput> = {}): AttentionInput => ({
  now: 1_000_000, vitals: { ...DEFAULT_VITALS, energy: 1, curiosity: 1, sleepiness: 0, stress: 0, focus: 0 },
  environment: { hour: 12, idleSeconds: 0, onBattery: false, windowFocused: false },
  activity: 'working', sinceInteractionMs: 3_600_000, baselineReady: false, blocked: false, ...overrides,
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
    const experiment = new AttentionExperiment(() => file, true, 4000);
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
    assert.equal(report.policy, 2);
    assert.ok(rows.filter(row => row.kind === 'sample').every(row => row.inputs.vitals && row.policy === 2));
    appendFileSync(file, JSON.stringify({ version: 1, mode: 'shadow', session: 'old-session', at: new Date().toISOString(), kind: 'sample', action: 'speak', baselineEligible: true, computeMs: 0 }) + '\n');
    const mixed = JSON.parse(execFileSync(process.execPath, [join(__dirname, '../../scripts/attention-report.cjs'), file], { encoding: 'utf8' }));
    assert.equal(mixed.samples, report.samples);
    const old = JSON.parse(execFileSync(process.execPath, [join(__dirname, '../../scripts/attention-report.cjs'), file, '1'], { encoding: 'utf8' }));
    assert.equal(old.samples, 1);
    const before = readFileSync(file, 'utf8');
    new AttentionExperiment(() => file, false).observe(input());
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.doesNotThrow(() => new AttentionExperiment(() => join(dir, 'missing', 'log')).observe(input()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('frequent conversation never triggers idle speech, across normal tick rates', () => {
  for (const tick of [5, 20, 60]) {
    let state = newAttentionState();
    for (let seconds = 0; seconds < 3600; seconds += tick) {
      state = stepAttention(state, input({ now: 1_000_000 + seconds * 1000, sinceInteractionMs: seconds % 300 * 1000 }));
      assert.notEqual(state.action, 'speak', 'interrupt at ' + seconds + 's, tick ' + tick);
    }
  }
});

test('a persistently stronger state eventually wins regardless of initial contact', () => {
  let cold = newAttentionState(), warm = newAttentionState();
  for (let seconds = 0; seconds <= 600; seconds += 20) {
    const reading = input({ now: 1_000_000 + seconds * 1000, vitals: DEFAULT_VITALS, sinceInteractionMs: Infinity });
    cold = stepAttention(cold, reading);
    warm = stepAttention(warm, { ...reading, sinceInteractionMs: seconds < 180 ? seconds * 1000 : Infinity });
  }
  assert.equal(cold.action, 'attend');
  assert.equal(warm.action, cold.action);
});

test('shadow speech preserves the existing patience rule and its own minimum spacing', () => {
  for (const tick of [5, 20, 60]) {
    let state = newAttentionState(), last = -Infinity, proposals = 0;
    for (let seconds = 0; seconds < 3600; seconds += tick) {
      state = stepAttention(state, input({ now: 1_000_000 + seconds * 1000, sinceInteractionMs: seconds * 1000 }));
      if (state.action === 'speak') {
        assert.ok(seconds >= 900, 'must wait the baseline 15 minutes');
        assert.ok(seconds - last >= 600, 'minimum ten minutes between proposals');
        last = seconds; proposals++;
      }
    }
    assert.ok(proposals > 0, 'must still speak when eligible');
  }
});

test('small alternating score advantages do not cause action flicker', () => {
  let state = { ...newAttentionState(), at: 1_000_000, activity: 'working', action: 'attend' as const,
    scores: { attend: 0.45, rest: 0.4, investigate: 0, speak: 0 } };
  let action = state.action;
  for (let seconds = 20; seconds <= 600; seconds += 20) {
    const next = stepAttention(state, input({ now: 1_000_000 + seconds * 1000, sinceInteractionMs: Infinity,
      vitals: { ...DEFAULT_VITALS, energy: seconds % 40 ? 0.50 : 0.60 }, blocked: true }));
    assert.equal(next.action, action);
    state = { ...next, action: 'attend' };
  }
});

test('a week of drifting vitals, feedback, sleep and irregular ticks respects speech gates', () => {
  let state = newAttentionState(), vitals = { ...DEFAULT_VITALS }, lastContact = 0, lastProposal = -Infinity;
  const actions = new Set<string>();
  let seconds = 0, tick = 0;
  while (seconds < 7 * 86400) {
    const delta = [7, 23, 61][tick++ % 3];
    seconds += delta;
    const hour = Math.floor(seconds / 3600) % 24;
    const active = hour >= 8 && hour < 22;
    const environment = { hour, idleSeconds: active ? 0 : 3600, onBattery: hour >= 19, windowFocused: active && seconds % 1800 < 300 };
    if (active && Math.floor(seconds / 900) !== Math.floor((seconds - delta) / 900)) {
      lastContact = seconds;
      vitals = applyEvent(vitals, tick % 2 ? 'praised' : 'criticised');
    }
    vitals = driftVitals(vitals, environment, delta);
    const blocked = active && hour === 18;
    const reading = input({
      now: 1_000_000 + seconds * 1000, vitals, environment, blocked,
      activity: !active ? 'other' : hour < 17 ? 'coding' : 'watching',
      sinceInteractionMs: (seconds - lastContact) * 1000,
    });
    state = stepAttention(state, reading);
    actions.add(state.action);
    assert.ok(Object.values(state.scores).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    if (state.action === 'speak') {
      assert.equal(blocked, false);
      assert.equal(shouldPipeUp({
        minutesSinceUserSpoke: (seconds - lastContact) / 60,
        minutesSinceSheSpoke: (seconds - lastProposal) / 60,
        machineIdleSeconds: environment.idleSeconds, curiosity: vitals.curiosity, sleepiness: vitals.sleepiness,
      }, () => 0), true);
      assert.ok(seconds - lastProposal >= 600);
      lastProposal = seconds;
    }
    if (!active) assert.notEqual(state.action, 'speak');
  }
  assert.ok(actions.has('attend') && actions.has('rest'));
});

test('invalid clocks and silence cannot crash diagnostics or bypass patience', () => {
  for (const silence of [NaN, -1, -Infinity]) {
    assert.notEqual(stepAttention(newAttentionState(), input({ sinceInteractionMs: silence })).action, 'speak');
  }
  for (const now of [NaN, Infinity, -1, 1e25]) {
    const state = stepAttention(newAttentionState(), input({ now }));
    assert.doesNotThrow(() => new Date(state.at).toISOString());
  }
  const away = stepAttention(newAttentionState(), input({
    environment: { hour: 12, idleSeconds: 301, onBattery: false, windowFocused: false },
  }));
  assert.notEqual(away.action, 'speak');
});

test('long silence cannot override exhaustion or maximum stress', () => {
  for (const vitals of [
    { ...DEFAULT_VITALS, energy: 0, curiosity: 1 },
    { ...DEFAULT_VITALS, stress: 1, energy: 1, curiosity: 1, sleepiness: 0 },
  ]) {
    let state = newAttentionState();
    for (let seconds = 0; seconds <= 3600; seconds += 20) {
      state = stepAttention(state, input({ now: 1_000_000 + seconds * 1000, vitals, sinceInteractionMs: Infinity }));
      assert.notEqual(state.action, 'speak');
    }
  }
});

test('reports separate silence agreement, proposals and missing client activity evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haru-attention-report-'));
  try {
    const file = join(dir, 'attention.jsonl');
    const experiment = new AttentionExperiment(() => file);
    experiment.observe(input({ sinceInteractionMs: 0, environment: { hour: 12, idleSeconds: 86400, onBattery: false, windowFocused: true } }));
    experiment.observe(input({ now: 1_020_000, baselineReady: true, blocked: true }));
    // Report fixtures cover all four decisions; overlap is descriptive, not accuracy.
    const sample = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0]);
    for (const [action, baselineEligible] of [['speak', true], ['rest', true], ['speak', false]] as const) {
      appendFileSync(file, JSON.stringify({ ...sample, action, baselineEligible, inputs: undefined }) + '\n');
    }
    const report = JSON.parse(execFileSync(process.execPath, [join(__dirname, '../../scripts/attention-report.cjs'), file], { encoding: 'utf8' }));
    assert.deepEqual(report.speechDecisions, { bothPropose: 1, baselineOnly: 1, shadowOnly: 1, bothSilent: 2 });
    assert.equal(report.baselineProposalOverlap, 0.5);
    assert.equal(report.shadowProposalOverlap, 0.5);
    assert.deepEqual(report.inputCoverage, { measured: 2, hostActive: 1, hostIdleOverFiveMinutes: 1,
      hostWindowFocused: 1, recentDirectContact: 1, recentContactWhileHostIdle: 1, unblockedHostActive: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('input sensitivity replays history before the reporting window and rejects corrupted results', () => {
  const { audit, moodProbe } = require(join(__dirname, '../../research/fruitfly/attention-input-audit.cjs'));
  const dir = mkdtempSync(join(tmpdir(), 'haru-attention-audit-'));
  try {
    const file = join(dir, 'attention.jsonl');
    const experiment = new AttentionExperiment(() => file);
    // Conversation every minute: correction cannot circumvent speech patience.
    for (let seconds = 0; seconds <= 1200; seconds += 20) {
      experiment.observe(input({ now: 1_000_000 + seconds * 1000, sinceInteractionMs: (seconds % 60) * 1000,
        environment: { hour: 12, idleSeconds: 86400, onBattery: false, windowFocused: true } }));
    }
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const result = audit(rows, 1_600_000);
    assert.equal(result.replayed, 61);
    assert.equal(result.samples, 31);
    assert.equal(result.recentContactWhileHostIdle, 31);
    assert.equal(result.changedIdleReadings, 31);
    assert.equal(result.contactAwareSpeech, 0);
    assert.equal(result.changedActions, 0);
    assert.equal(audit(rows.slice(1)).skippedPartialSessions, 1);
    assert.equal(audit(rows.slice(1)).replayed, 0);
    assert.throws(() => audit([{ ...rows[0], action: 'speak' }]), /replay mismatch/);
    assert.throws(() => audit([{ ...rows[0], scores: { ...rows[0].scores, rest: 0.999 } }]), /replay mismatch/);
    assert.throws(() => audit([{ ...rows[0], inputs: { ...rows[0].inputs, sinceInteractionMs: -1 } }]), /Invalid sample/);
    const unknown = new AttentionExperiment(() => join(dir, 'unknown.jsonl'));
    unknown.observe(input({ sinceInteractionMs: Infinity }));
    const unknownRow = JSON.parse(readFileSync(join(dir, 'unknown.jsonl'), 'utf8'));
    assert.equal(audit([unknownRow]).changedIdleReadings, 0);
    const report = JSON.parse(execFileSync(process.execPath, [join(__dirname, '../../scripts/attention-report.cjs'), file], { encoding: 'utf8' }));
    assert.equal(report.baselineProposalOverlap, null);
    assert.equal(report.shadowProposalOverlap, null);
    const probe = moodProbe().arms;
    assert.ok(probe.contactIdleOnly.curiosity > probe.hostReadings.curiosity + 0.5);
    assert.ok(probe.contactIdleWithoutHostFocus.focus < probe.contactIdleOnly.focus - 0.4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('web input expires to unknown, preserves cooldown across gaps and never changes the host policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haru-web-input-'));
  try {
    const file = join(dir, 'attention.jsonl');
    const experiment = new AttentionExperiment(() => file);
    let original = newAttentionState();
    const observe = (seconds: number) => {
      const reading = input({ now: 1_000_000 + seconds * 1000,
        environment: { hour: 12, idleSeconds: 86400, onBattery: false, windowFocused: true } });
      original = stepAttention(original, reading);
      experiment.observe(reading);
      const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const row = rows.at(-1);
      assert.equal(row.action, original.action);
      assert.deepEqual(row.scores, original.scores);
      return row;
    };
    assert.equal(observe(0).webShadow, null);
    experiment.webInput(1_020_000);
    assert.equal(observe(20).webShadow.action, 'speak');
    assert.deepEqual(observe(320).webInput, { status: 'recent-input', ageMs: 300_000 });
    const expired = observe(321);
    assert.deepEqual(expired.webInput, { status: 'unknown', ageMs: null });
    assert.equal(expired.webShadow, null);
    experiment.webInput(1_400_000);
    assert.notEqual(observe(400).webShadow.action, 'speak', 'unknown gap must not reset speech cooldown');
    for (const invalid of [NaN, Infinity, -1, 1e25, 1_000_000]) experiment.webInput(invalid);
    assert.equal(observe(401).webInput.ageMs, 1000, 'invalid or out-of-order receipt must not replace the latest');
    experiment.webInput(1_700_000);
    assert.equal(observe(700).webShadow.action, 'speak');
    const replayPath = join(dir, 'replay.json');
    const replayScript = join(__dirname, '../../research/fruitfly/replay-shadow.cjs');
    execFileSync(process.execPath, [replayScript, file, replayPath]);
    const replay = JSON.parse(readFileSync(replayPath, 'utf8'));
    assert.equal(replay.webReplayed, 7);
    assert.equal(replay.webActionMismatches + replay.webNumericMismatches + replay.actionMismatches, 0);
    const report = JSON.parse(execFileSync(process.execPath, [join(__dirname, '../../scripts/attention-report.cjs'), file], { encoding: 'utf8' }));
    assert.equal(report.webInputComparison.recentInput, 5);
    assert.equal(report.webInputComparison.unknown, 2);
    assert.equal(report.webInputComparison.webPolicySpeech, 2);
    assert.equal(report.webInputComparison.hostPolicySpeechOnKnownInput, 0);
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    rows.at(-1).webShadow.scores.speak = 0.123;
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.throws(() => execFileSync(process.execPath, [replayScript, file, replayPath], { stdio: 'pipe' }));
    const disabled = new AttentionExperiment(() => join(dir, 'disabled'), false);
    disabled.webInput(); disabled.observe(input());
    assert.ok(!readdirSync(dir).includes('disabled'));
    const restart = new AttentionExperiment(() => join(dir, 'restart'));
    restart.observe(input());
    assert.equal(JSON.parse(readFileSync(join(dir, 'restart'), 'utf8')).webShadow, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
