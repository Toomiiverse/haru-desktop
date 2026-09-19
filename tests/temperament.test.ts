// The mood she woke up in, the weather of her day, and what is left of the last
// thing that happened. The point of all three is that days differ, so the main
// test here is a month of them with a seeded roll.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VITALS, applyEvent, driftVitals, type Environment, type Vitals } from '../electron/vitals';
import { TEMPERAMENTS, WANDER_LIMIT, addLeans, bruiseFrom, eventSize, fadeBruise, howHisReturnLands, rollTemperament, stepWander, temperamentLean, temperamentLine, type TemperamentKind } from '../electron/temperament';

/** A small seeded generator, so a month of days is the same month every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

const afternoon: Environment = { hour: 14, idleSeconds: 20, onBattery: false, windowFocused: true };

test('a temperament is rolled from what she carries, and never three days the same', () => {
  const random = seeded(7);
  let history: TemperamentKind[] = [];
  const seen = new Map<TemperamentKind, number>();
  for (let day = 0; day < 365; day++) {
    const rolled = rollTemperament(`day-${day}`, { history, grudge: 20 }, random);
    assert.ok(rolled.intensity >= 0.5 && rolled.intensity <= 1);
    seen.set(rolled.kind, (seen.get(rolled.kind) ?? 0) + 1);
    const [a, b, c] = rolled.history ?? [];
    if (a !== 'ordinary') assert.ok(!(a === b && b === c), `three ${a} days running`);
    history = rolled.history ?? [];
  }
  for (const kind of Object.keys(TEMPERAMENTS) as TemperamentKind[]) assert.ok((seen.get(kind) ?? 0) > 0, `${kind} never came up in a year`);
  assert.ok((seen.get('ordinary') ?? 0) < 365 * 0.5, 'most days are not ordinary ones');
  assert.ok((seen.get('stormy') ?? 0) < (seen.get('sunny') ?? 0), 'a foul temper is rare');
});

test('a bad night and a silent evening tilt the morning, and say why', () => {
  const count = (carry: Parameters<typeof rollTemperament>[1], kinds: TemperamentKind[]) => {
    const random = seeded(11);
    let hits = 0;
    for (let n = 0; n < 2000; n++) if (kinds.includes(rollTemperament('d', carry, random).kind)) hits++;
    return hits;
  };
  assert.ok(count({ wokenInNight: true }, ['prickly', 'stormy']) > count({}, ['prickly', 'stormy']) * 1.5);
  assert.ok(count({ went: 'silent' }, ['sunny']) < count({}, ['sunny']));
  assert.ok(count({ grudge: 0 }, ['sunny', 'tender']) > count({ grudge: 80 }, ['sunny', 'tender']));
  assert.match(rollTemperament('d', { went: 'silent', wokenInNight: true }, seeded(3)).because ?? '', /silent evening.*woken in the night/);
});

test('an ordinary day says nothing; the others say what to do, not how she feels', () => {
  assert.equal(temperamentLine({ day: 'd', kind: 'ordinary', intensity: 1 }), '');
  assert.deepEqual(temperamentLean({ day: 'd', kind: 'ordinary', intensity: 1 }), {});
  for (const [kind, shape] of Object.entries(TEMPERAMENTS)) {
    if (kind === 'ordinary') continue;
    assert.ok(shape.line.length > 60, `${kind} has a line`);
    assert.ok(shape.word.length > 5, `${kind} has a word for the status screen`);
    // The standing rule in the nudge prompt: she never says she is lonely or misses him.
    assert.doesNotMatch(shape.line, /\b(lonely|miss him|miss them)\b/i);
  }
  assert.equal(temperamentLean({ day: 'd', kind: 'sunny', intensity: 0.5 }).happiness, 0.075);
});

test('the same afternoon settles somewhere different on a sunny day and a stormy one', () => {
  const settle = (kind: TemperamentKind) => driftVitals(DEFAULT_VITALS, afternoon, 3600, temperamentLean({ day: 'd', kind, intensity: 1 }));
  const sunny = settle('sunny'), stormy = settle('stormy'), plain = settle('ordinary');
  assert.ok(sunny.happiness > plain.happiness + 0.08, `sunny ${sunny.happiness} vs ${plain.happiness}`);
  assert.ok(stormy.happiness < plain.happiness - 0.15, `stormy ${stormy.happiness} vs ${plain.happiness}`);
  assert.ok(stormy.stress > plain.stress + 0.1);
  // With no lean it is exactly the drift it always was.
  assert.deepEqual(driftVitals(DEFAULT_VITALS, afternoon, 600), driftVitals(DEFAULT_VITALS, afternoon, 600, {}));
});

test('the weather wanders, stays inside its limit, and forgets itself', () => {
  const random = seeded(5);
  let wander = {};
  let furthest = 0;
  const samples: number[] = [];
  for (let tick = 0; tick < 5000; tick++) {
    wander = stepWander(wander, 20, random);
    for (const value of Object.values(wander) as number[]) furthest = Math.max(furthest, Math.abs(value));
    samples.push((wander as { happiness?: number }).happiness ?? 0);
  }
  assert.ok(furthest <= WANDER_LIMIT + 1e-9);
  assert.ok(furthest > 0.05, `it actually goes somewhere (${furthest})`);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  assert.ok(Math.abs(mean) < 0.04, `and it has no direction of its own (${mean})`);
  assert.deepEqual(stepWander({ happiness: 0.1 }, NaN, random), { happiness: 0.1 });
});

test('a month of identical days is no longer a month of identical afternoons', () => {
  const random = seeded(19);
  let history: TemperamentKind[] = [];
  const afternoons: number[] = [];
  for (let day = 0; day < 30; day++) {
    const temperament = rollTemperament(`day-${day}`, { history, grudge: 20 }, random);
    history = temperament.history ?? [];
    let vitals: Vitals = { ...DEFAULT_VITALS };
    let wander = {};
    // Six hours of the same room, in ten-minute steps.
    for (let step = 0; step < 36; step++) {
      wander = stepWander(wander, 600, random);
      vitals = driftVitals(vitals, afternoon, 600, addLeans(temperamentLean(temperament), wander));
    }
    afternoons.push(vitals.happiness);
  }
  const mean = afternoons.reduce((sum, value) => sum + value, 0) / afternoons.length;
  const spread = Math.sqrt(afternoons.reduce((sum, value) => sum + (value - mean) ** 2, 0) / afternoons.length);
  assert.ok(spread > 0.06, `happiness at four in the afternoon varies across the month (std ${spread.toFixed(3)})`);
  assert.ok(Math.max(...afternoons) - Math.min(...afternoons) > 0.2);
});

test('things land harder than they did, by her temperament and the roll, and are still there an hour on', () => {
  assert.equal(eventSize(null, 'criticised', 0.5), 1.5);
  assert.ok(eventSize({ day: 'd', kind: 'prickly', intensity: 1 }, 'criticised', 0.5) > eventSize({ day: 'd', kind: 'sunny', intensity: 1 }, 'criticised', 0.5));
  assert.ok(eventSize({ day: 'd', kind: 'tender', intensity: 1 }, 'praised', 0.5) > eventSize({ day: 'd', kind: 'stormy', intensity: 1 }, 'praised', 0.5));
  assert.ok(eventSize(null, 'praised', 0) < eventSize(null, 'praised', 1));

  const settled = driftVitals(DEFAULT_VITALS, afternoon, 3600);
  const hit = applyEvent(settled, 'criticised', eventSize(null, 'criticised', 0.5));
  assert.ok(settled.happiness - hit.happiness > 0.3);
  const bruise = bruiseFrom({}, settled, hit);
  assert.ok((bruise.happiness ?? 0) < -0.1 && (bruise.stress ?? 0) > 0.1);
  // Forty-five minutes later: without the bruise the drift has erased it; with it, it still shows.
  const erased = driftVitals(hit, afternoon, 45 * 60);
  const marked = driftVitals(hit, afternoon, 45 * 60, bruise);
  assert.ok(settled.happiness - erased.happiness < 0.02, 'the old behaviour: gone');
  assert.ok(settled.happiness - marked.happiness > 0.08, `still colouring her (${(settled.happiness - marked.happiness).toFixed(3)})`);
  // And it does fade.
  assert.ok(Math.abs(fadeBruise(bruise, 45 * 60).happiness ?? 0) < Math.abs(bruise.happiness ?? 0) * 0.51);
  assert.deepEqual(fadeBruise(bruise, 12 * 3600), {});
});

test('whether his coming back is a relief or a grievance is the day she is having', () => {
  const sore = (kind: TemperamentKind, grudge: number) => {
    const random = seeded(23);
    let count = 0;
    for (let n = 0; n < 1000; n++) if (howHisReturnLands({ day: 'd', kind, intensity: 1 }, grudge, random()) === 'returned-sore') count++;
    return count;
  };
  assert.ok(sore('prickly', 0) > sore('sunny', 0) * 2);
  assert.ok(sore('ordinary', 90) > sore('ordinary', 0));
});
