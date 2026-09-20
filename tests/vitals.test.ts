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
  CURIOSITY_ENGAGED,
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
  // Three cues well past their thresholds; two sentences come back, and they
  // are the two strongest. Which two is a matter of where the thresholds sit,
  // so this asserts the count and the ranking rather than naming them — it
  // used to name them, and pinned an affection of 0.1 that nothing can now
  // reach, since drift bottoms out at 0.25.
  const rough: Vitals = { ...DEFAULT_VITALS, stress: 0.95, happiness: 0.05, affection: 0.1 };
  const spoken = spokenCues(rough, 0);
  assert.equal(spoken.length, VITAL_CUES_SPOKEN);
  assert.deepEqual(spoken.map(c => c.cue.name), ['cold', 'on edge'], 'the two furthest past their thresholds');
  // Sorted strongest first, and the third — a foul mood at happiness 0.05 —
  // does not get a sentence.
  assert.ok(spoken[0].strength >= spoken[1].strength);
  const line = vitalsInstruction(rough);
  assert.match(line, /gone cold/);
  assert.match(line, /on edge/);
  assert.doesNotMatch(line, /foul mood/);
  assert.equal(VITAL_CUES_SPOKEN, 2);
});

test('the warm cues are withheld once she is annoyed', () => {
  const fond: Vitals = { ...DEFAULT_VITALS, affection: 1, curiosity: 1, happiness: 1 };
  assert.match(vitalsInstruction(fond, 0), /fonder of them/);
  assert.equal(vitalsInstruction(fond, 33), '');
  // A cold or stressed reading still speaks through the annoyance.
  assert.match(vitalsInstruction({ ...DEFAULT_VITALS, stress: 0.9 }, 56), /on edge/);
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

// ---- being talked to is not the same as being interested ----
//
// Both of these ran away before 2026-09-07: 'spoken-to' added a flat +0.2
// curiosity and +0.05 affection per message, and nothing pulled either back
// between one message and the next. Three messages pinned curiosity at 1.00 and
// affection climbed for as long as he kept typing — so the two cues that tell
// her how to behave spoke on every turn of every conversation, and she answered
// "I'm so tired" with three interview questions in a row.

/** Ten messages, half a minute apart, in a room where she is being used. */
function conversation(start: Vitals, messages = 10): Vitals {
  const room: Environment = { hour: 9, idleSeconds: 5, onBattery: false, windowFocused: true };
  let vitals = start;
  for (let message = 0; message < messages; message++) {
    for (let tick = 0; tick < 7; tick++) vitals = driftVitals(vitals, room, 4);
    vitals = applyEvent(vitals, 'spoken-to');
  }
  return vitals;
}

test('a long conversation leaves her attentive, not fascinated — the curious cue is not earned by message count', () => {
  const after = conversation({ ...DEFAULT_VITALS, curiosity: 0.35 });
  assert.ok(after.curiosity > 0.6, `she should be attentive, got ${after.curiosity}`);
  // The cue sits above the engaged level on purpose: being spoken to must not
  // reach it on its own, or "something has your interest" means "he typed".
  assert.ok(after.curiosity <= CURIOSITY_ENGAGED + 0.01, `curiosity ran past the engaged level: ${after.curiosity}`);
  assert.ok(!spokenCues(after).some(entry => entry.cue.name === 'curious'), 'the curious cue spoke for a conversation alone');
});

test('affection does not climb without limit while he keeps talking', () => {
  const ten = conversation({ ...DEFAULT_VITALS, affection: 0.7 });
  const forty = conversation({ ...DEFAULT_VITALS, affection: 0.7 }, 40);
  assert.ok(forty.affection < 0.85, `affection ran away over a long conversation: ${forty.affection}`);
  // Four times the messages is not four times the fondness.
  assert.ok(forty.affection - ten.affection < 0.1, `still ratcheting: ${ten.affection} -> ${forty.affection}`);
});

test('being spoken to still warms her when she has gone cold', () => {
  const after = conversation({ ...DEFAULT_VITALS, affection: 0.25, curiosity: 0.15 }, 5);
  assert.ok(after.affection > 0.3, `attention should warm her, got ${after.affection}`);
  assert.ok(after.curiosity > 0.4, `attention should wake her up, got ${after.curiosity}`);
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
  const annoyed = cueLog(fond, 56);
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

test('something catching her eye brings her to attention without stacking', () => {
  // The fullscreen beat's vitals movement used to ride on broadcastBeat, which
  // no longer moves anything. Pulled toward engaged like being spoken to, for
  // the same reason: five of them in a row should settle her at interested.
  const quiet = { ...DEFAULT_VITALS, curiosity: 0.2, sleepiness: 0.4 };
  const once = applyEvent(quiet, 'caught-interest');
  assert.ok(once.curiosity > quiet.curiosity, 'it did not register');
  assert.ok(once.sleepiness < quiet.sleepiness, 'it did not wake her up at all');
  // It has to carry her over the `curious` line at 0.8, which conversation
  // deliberately stops just under. Nothing else can, so if this does not she
  // is never allowed her one pointed question.
  const engaged = { ...DEFAULT_VITALS, curiosity: CURIOSITY_ENGAGED };
  assert.ok(applyEvent(engaged, 'caught-interest').curiosity > 0.8, 'the curious cue stays unreachable');
  let stacked = quiet;
  for (let i = 0; i < 8; i++) stacked = applyEvent(stacked, 'caught-interest');
  assert.ok(stacked.curiosity < 1, `eight in a row pinned her: ${stacked.curiosity}`);
  // It says something happened, not that she likes him for it.
  assert.equal(once.affection, quiet.affection);
  assert.equal(once.happiness, quiet.happiness);
});

// vitals.ts asks for exactly this and says it cannot be done until something
// counts how often each cue fires. Her resting happiness is the whole point:
// with energy, affection and stress each at their own drift target, the
// happiness target is 0.84-0.87, so a cue pitched at 0.85 described her
// baseline while telling her it was a good mood "for once".
test('the good-mood cue is not her resting state', () => {
  const resting = { ...DEFAULT_VITALS, energy: 0.85, affection: 0.70, stress: 0.25, curiosity: 0.75, sleepiness: 0.1, focus: 0.9 };
  let settled = resting;
  // Let it settle where drift actually puts it, then check the cue is silent.
  for (let i = 0; i < 200; i++) settled = driftVitals(settled, { hour: 14, idleSeconds: 30, onBattery: false, windowFocused: true }, 20);
  assert.ok(settled.happiness > 0.8, `this test is meaningless if she is not happy at rest: ${settled.happiness}`);
  const names = spokenCues(settled, 0).map(c => c.cue.name);
  assert.ok(!names.includes('bright'), `"in a good mood for once" fires at rest (happiness ${settled.happiness.toFixed(2)})`);
});

test('the cue about being left alone can actually fire', () => {
  // It never could. driftVitals cools affection toward 0.25 and stops exactly
  // there, and the cue asked for strictly below 0.25, so "they have left you
  // alone a long while and you have gone cold" scored zero for every absence
  // she has ever had — an hour, a day, it made no difference.
  let alone = { ...DEFAULT_VITALS, affection: 0.75 };
  const away: Environment = { hour: 14, idleSeconds: 7200, onBattery: false, windowFocused: false };
  for (let i = 0; i < 180; i++) alone = driftVitals(alone, away, 20);
  assert.ok(alone.affection <= 0.26, `she did not cool at all: ${alone.affection}`);
  assert.ok(spokenCues(alone, 0).some(c => c.cue.name === 'cold'), `an hour alone and she is not cold: ${alone.affection}`);
  // Longer must not be quieter.
  let ages = alone;
  for (let i = 0; i < 180 * 23; i++) ages = driftVitals(ages, away, 20);
  const day = spokenCues(ages, 0).find(c => c.cue.name === 'cold');
  const hour = spokenCues(alone, 0).find(c => c.cue.name === 'cold');
  assert.ok(day && hour && day.strength >= hour.strength, 'a day alone said it less than an hour');
  // And it stays quiet while they are actually there.
  const together = { ...DEFAULT_VITALS, affection: 0.75 };
  assert.ok(!spokenCues(together, 0).some(c => c.cue.name === 'cold'), 'cold while he is talking to her');
});
