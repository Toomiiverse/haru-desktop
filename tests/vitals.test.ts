import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driftVitals,
  applyEvent,
  sleepinessForHour,
  isNight,
  chooseIdleAction,
  DEFAULT_VITALS,
  vitalsInstruction,
  VITAL_CUES_SPOKEN,
  shouldPersistVitals,
  spokenCues,
  cueLog,
  VITALS_SAVE_DELTA,
  VITALS_SAVE_INTERVAL_MS,
  type Vitals,
  type Environment,
} from '../electron/vitals';

// ---- vitalsInstruction: at most two cues, said as behaviour ----

test('vitalsInstruction is silent at the defaults and without vitals', () => {
  assert.equal(vitalsInstruction(DEFAULT_VITALS), '');
  assert.equal(vitalsInstruction(undefined), '');
});

test('drowsy speaks once, and flat energy defers to it', () => {
  const late: Vitals = { ...DEFAULT_VITALS, sleepiness: 0.9, energy: 0.1 };
  const line = vitalsInstruction(late);
  assert.match(line, /drowsy/);
  assert.doesNotMatch(line, /flat and low on energy/);
  const flat: Vitals = { ...DEFAULT_VITALS, sleepiness: 0.2, energy: 0.1 };
  assert.match(vitalsInstruction(flat), /flat and low on energy/);
});

test('only the two strongest cues speak', () => {
  const rough: Vitals = { ...DEFAULT_VITALS, stress: 0.95, happiness: 0.05, affection: 0.1 };
  const line = vitalsInstruction(rough);
  assert.match(line, /on edge/);
  assert.match(line, /foul mood/);
  assert.doesNotMatch(line, /gone cold/);
  assert.equal(VITAL_CUES_SPOKEN, 2);
});

test('the warm cues are withheld once she is annoyed', () => {
  const fond: Vitals = { ...DEFAULT_VITALS, affection: 1, curiosity: 1, happiness: 1 };
  assert.match(vitalsInstruction(fond, 0), /fonder of them/);
  assert.equal(vitalsInstruction(fond, 3), '');
  // A cold or stressed reading still speaks through the annoyance.
  assert.match(vitalsInstruction({ ...DEFAULT_VITALS, stress: 0.9 }, 5), /on edge/);
});

// ---- sleepinessForHour: the day curve ----

test('sleepinessForHour follows the documented day curve', () => {
  assert.equal(sleepinessForHour(0), 0.9);   // dead of night
  assert.equal(sleepinessForHour(4), 0.9);   // flattest around 4am
  assert.equal(sleepinessForHour(6), 0.7);   // early morning
  assert.equal(sleepinessForHour(8), 0.3);   // waking up
  assert.equal(sleepinessForHour(13), 0.15); // daytime, most awake
  assert.equal(sleepinessForHour(19), 0.35); // evening wind-down begins
  assert.equal(sleepinessForHour(22), 0.6);  // later evening
  assert.equal(sleepinessForHour(23), 0.9);  // late night again
});

test('isNight matches the late/early hours used by sleepinessForHour', () => {
  assert.equal(isNight(23), true);
  assert.equal(isNight(0), true);
  assert.equal(isNight(5), true);
  assert.equal(isNight(6), false);
  assert.equal(isNight(13), false);
  assert.equal(isNight(22), false);
});

// ---- driftVitals: pure function of environment + elapsed time, no conversation ----

test('driftVitals moves sleepiness toward the hour-derived target over simulated ticks, with no conversation involved', () => {
  let vitals: Vitals = { ...DEFAULT_VITALS, sleepiness: 0.2 };
  const midnightIdle: Environment = { hour: 0, idleSeconds: 700, onBattery: false, windowFocused: false };
  // sleepinessForHour(0) === 0.9, and idleSeconds > 60 so this is not "active".
  for (let i = 0; i < 50; i++) {
    vitals = driftVitals(vitals, midnightIdle, 20);
  }
  assert.ok(vitals.sleepiness > 0.8, `expected sleepiness to approach 0.9, got ${vitals.sleepiness}`);
});

test('driftVitals keeps values clamped to [0, 1] even over many extreme ticks', () => {
  let vitals: Vitals = { ...DEFAULT_VITALS };
  const extreme: Environment = { hour: 3, idleSeconds: 0, onBattery: true, windowFocused: true };
  for (let i = 0; i < 200; i++) {
    vitals = driftVitals(vitals, extreme, 999);
  }
  for (const key of Object.keys(vitals) as (keyof Vitals)[]) {
    assert.ok(vitals[key] >= 0 && vitals[key] <= 1, `${key} out of range: ${vitals[key]}`);
  }
});

test('driftVitals: being actively used keeps sleepiness lower than sitting idle at the same hour', () => {
  const nightHour: Environment = { hour: 1, idleSeconds: 0, onBattery: false, windowFocused: false }; // active (idle < 60)
  const nightIdle: Environment = { hour: 1, idleSeconds: 700, onBattery: false, windowFocused: false }; // not active

  let active: Vitals = { ...DEFAULT_VITALS, sleepiness: 0.2 };
  let idle: Vitals = { ...DEFAULT_VITALS, sleepiness: 0.2 };
  for (let i = 0; i < 100; i++) {
    active = driftVitals(active, nightHour, 20);
    idle = driftVitals(idle, nightIdle, 20);
  }
  assert.ok(active.sleepiness < idle.sleepiness, `expected active (${active.sleepiness}) < idle (${idle.sleepiness})`);
});

test('driftVitals does not move anything on a zero-second tick', () => {
  const vitals: Vitals = { ...DEFAULT_VITALS };
  const env: Environment = { hour: 10, idleSeconds: 0, onBattery: false, windowFocused: true };
  const next = driftVitals(vitals, env, 0);
  for (const key of Object.keys(vitals) as (keyof Vitals)[]) {
    assert.ok(Math.abs(next[key] - vitals[key]) < 1e-9, `${key} moved on a zero-second tick`);
  }
});

// ---- applyEvent: discrete nudges ----

test('applyEvent: praised raises happiness, affection and energy', () => {
  const base: Vitals = { ...DEFAULT_VITALS, happiness: 0.5, affection: 0.5, energy: 0.5 };
  const next = applyEvent(base, 'praised');
  assert.ok(next.happiness > base.happiness);
  assert.ok(next.affection > base.affection);
  assert.ok(next.energy > base.energy);
});

test('applyEvent: criticised lowers happiness and raises stress', () => {
  const base: Vitals = { ...DEFAULT_VITALS, happiness: 0.5, stress: 0.2 };
  const next = applyEvent(base, 'criticised');
  assert.ok(next.happiness < base.happiness);
  assert.ok(next.stress > base.stress);
});

test('applyEvent clamps at the top of the range', () => {
  const base: Vitals = { ...DEFAULT_VITALS, happiness: 0.95, affection: 0.95, energy: 0.95 };
  const next = applyEvent(base, 'praised');
  assert.ok(next.happiness <= 1 && next.affection <= 1 && next.energy <= 1);
});

test('applyEvent clamps at the bottom of the range', () => {
  const base: Vitals = { ...DEFAULT_VITALS, happiness: 0.05, stress: 0.02 };
  const next = applyEvent(base, 'criticised');
  assert.ok(next.happiness >= 0);
});

// ---- chooseIdleAction: weighted random, deterministic via injected rng ----

test('chooseIdleAction returns "blink" when the random roll lands at the very start', () => {
  const env: Environment = { hour: 12, idleSeconds: 0, onBattery: false, windowFocused: true };
  const action = chooseIdleAction(DEFAULT_VITALS, env, () => 0);
  assert.equal(action, 'blink');
});

test('chooseIdleAction returns null ("nothing") when the random roll lands in the tail, since stillness dominates', () => {
  const env: Environment = { hour: 12, idleSeconds: 0, onBattery: false, windowFocused: true };
  const action = chooseIdleAction(DEFAULT_VITALS, env, () => 0.999999);
  assert.equal(action, null);
});

test('doze is only reachable at night, high sleepiness, and alone', () => {
  const daytimeAlone: Environment = { hour: 14, idleSeconds: 1000, onBattery: false, windowFocused: false };
  const sleepyVitals: Vitals = { ...DEFAULT_VITALS, sleepiness: 0.95 };
  // Even maximally sleepy, doze cannot fire during the day.
  // Sample many rolls across the space and confirm 'doze' never comes back.
  for (let i = 0; i < 20; i++) {
    const roll = i / 20;
    const action = chooseIdleAction(sleepyVitals, daytimeAlone, () => roll);
    assert.notEqual(action, 'doze');
  }
});

test('vitals are not written to disk on every tick', () => {
  const saved = { ...DEFAULT_VITALS };
  // A tick of ordinary drift, seconds after the last save: nothing worth a
  // rewrite of the whole store.
  const drifted = { ...saved, sleepiness: saved.sleepiness + 0.004, energy: saved.energy - 0.003 };
  assert.equal(shouldPersistVitals(drifted, saved, 20_000), false);
});

test('a real change of state is written immediately', () => {
  const saved = { ...DEFAULT_VITALS };
  // Just over and just under the threshold. Not exactly on it: 0.2 + 0.05 - 0.2
  // is 0.049999999999999996 in binary, and a test that turns on that is a test
  // about floating point rather than about her.
  assert.equal(shouldPersistVitals({ ...saved, stress: saved.stress + VITALS_SAVE_DELTA * 1.2 }, saved, 1_000), true);
  assert.equal(shouldPersistVitals({ ...saved, stress: saved.stress + VITALS_SAVE_DELTA * 0.8 }, saved, 1_000), false);
  assert.equal(shouldPersistVitals({ ...saved, happiness: saved.happiness - 0.4 }, saved, 1_000), true);
});

test('and so is a long quiet stretch, so the saved copy cannot drift far behind', () => {
  const saved = { ...DEFAULT_VITALS };
  assert.equal(shouldPersistVitals(saved, saved, VITALS_SAVE_INTERVAL_MS), true);
  assert.equal(shouldPersistVitals(saved, saved, VITALS_SAVE_INTERVAL_MS - 1), false);
});

test('with nothing saved yet, the first write always happens', () => {
  assert.equal(shouldPersistVitals(DEFAULT_VITALS, null, 0), true);
});

test('the log names which cues spoke, how strongly, and the state behind them', () => {
  const sleepy = { ...DEFAULT_VITALS, sleepiness: 0.9, stress: 0.8 };
  const line = cueLog(sleepy, 0);
  assert.match(line, /drowsy 0\.\d\d/);
  assert.match(line, /on edge 0\.\d\d/);
  assert.match(line, /sleepiness 0\.90/);
  // Every vital is in the line, or a threshold cannot be tuned from it.
  for (const key of Object.keys(DEFAULT_VITALS)) assert.match(line, new RegExp(key));
});

test('the log says when the warm cues were held back, and when nothing spoke', () => {
  const fond = { ...DEFAULT_VITALS, affection: 0.95 };
  assert.match(cueLog(fond, 0), /^fond /);
  const annoyed = cueLog(fond, 5);
  assert.match(annoyed, /^none, warm cues withheld/);
  assert.equal(cueLog(undefined), 'none — no vitals');
});

test('spokenCues and vitalsInstruction cannot drift apart', () => {
  const state = { ...DEFAULT_VITALS, sleepiness: 0.8, happiness: 0.05, stress: 0.9 };
  const spoke = spokenCues(state, 0);
  assert.ok(spoke.length <= VITAL_CUES_SPOKEN);
  assert.equal(vitalsInstruction(state, 0), spoke.map(entry => entry.cue.line).join(' '));
  // Strongest first, so the log's order is the order she was told them in.
  assert.deepEqual([...spoke].sort((a, b) => b.strength - a.strength), spoke);
});
