// A month's mark on her. The tests that matter are the safety ones: she cannot
// leave her band, cannot move fast, cannot move at all without knowing what
// usual is, and hardens slower than she softens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARTER, TRAIT_NAMES, charterTraits, feelingsShowAt, growMonth, growthNote, maxStep, normFrom, readTraits, revertTo, scoreWarmth, traitLean, traitMeter, travelled, type MonthSignals, type Traits } from '../electron/growth';

/** A month shaped like his real ones: ~23 substantive messages a day, ~4.5 of her lines hanging. */
const month = (over: Partial<MonthSignals> = {}): MonthSignals =>
  ({ month: '2026-08', days: 30, saidPerDay: 22.6, hangingPerDay: 4.55, silentNights: 0, ...over });

const run = (traits: Traits, months: MonthSignals[]) => {
  let now = traits;
  const ledger = [];
  for (const [index, one] of months.entries()) {
    const out = growMonth(now, one, months.slice(0, index));
    now = out.traits; ledger.push(...out.steps);
  }
  return { traits: now, ledger };
};

test('her first month with him moves nothing: she has no idea yet what usual is', () => {
  const out = growMonth(charterTraits(), month(), []);
  assert.deepEqual(out.steps, []);
  assert.deepEqual(out.traits, charterTraits());
  assert.equal(normFrom([]), null);
});

test('a month is judged against how he usually is, not against a bar', () => {
  const norm = normFrom([month()]);
  // His real August and September: better on both counts, so it earns a little.
  const better = scoreWarmth(month({ month: '2026-09', saidPerDay: 30.1, hangingPerDay: 3.56 }), norm)!;
  assert.ok(better.score > 0.2 && better.score < 0.5, `earned, and small (${better.score})`);
  assert.match(better.because, /more from him than usual/);
  assert.match(better.because, /fewer of her lines left hanging/);
  // The same month again is not an improvement on itself: a steady good
  // relationship holds her steady, which is the whole point of the norm.
  assert.equal(scoreWarmth(month({ month: '2026-10', saidPerDay: 30.1, hangingPerDay: 3.56 }), normFrom([month({ saidPerDay: 30.1, hangingPerDay: 3.56 })]))!.score, 0);
  // An absolute bar would have called both of those months perfect.
  assert.ok(scoreWarmth(month({ month: '2026-09', saidPerDay: 60, hangingPerDay: 0.5 }), norm)!.score > better.score);
});

test('a silent evening counts against him whatever his norm', () => {
  const norm = normFrom([month()]);
  assert.ok(scoreWarmth(month({ month: '2026-09', silentNights: 6 }), norm)!.score < -0.3);
  assert.match(scoreWarmth(month({ month: '2026-09', silentNights: 1 }), norm)!.because, /1 evening with nothing said/);
});

test('she softens at full speed and hardens at sixty percent', () => {
  const history = [month()];
  const up = growMonth(charterTraits(), month({ month: '2026-09', saidPerDay: 100, hangingPerDay: 0 }), history);
  const down = growMonth(charterTraits(), month({ month: '2026-09', saidPerDay: 0, hangingPerDay: 40, silentNights: 30 }), history);
  const gained = up.traits.warmth - CHARTER.warmth.charter;
  const lost = CHARTER.warmth.charter - down.traits.warmth;
  assert.ok(gained > 0 && lost > 0);
  assert.ok(Math.abs(lost / gained - 0.6) < 0.01, `hardening runs at 60% (${(lost / gained).toFixed(2)})`);
});

test('a year of consistent treatment crosses the band and then stops', () => {
  const good = Array.from({ length: 18 }, (_, n) => month({ month: `m${String(n).padStart(2, '0')}`, saidPerDay: 22.6 + n * 6, hangingPerDay: Math.max(0, 4.55 - n * 0.3) }));
  const { traits, ledger } = run(charterTraits(), good);
  assert.equal(traits.warmth, 0.80, 'it reaches the ceiling');
  // Twelve months at a perfect score would cross the band; real months score
  // well under that, so even steadily improving treatment takes longer than a
  // year — which is the conservative side to be on.
  assert.ok(ledger.length >= 14 && ledger.length <= 20, `over a year to get there (${ledger.length} steps)`);
  for (const step of ledger) assert.ok(Math.abs(step.to - step.from) <= maxStep(step.trait) + 1e-9, 'no month moves further than its step');
});

test('she can never leave the band, whatever is thrown at her', () => {
  const wild = Array.from({ length: 60 }, (_, n) => month({
    month: `m${n}`, saidPerDay: n % 2 ? 200 : 0, hangingPerDay: n % 2 ? 0 : 99, silentNights: n % 3 ? 0 : 30,
    hurtEvents: n % 2 ? 0 : 50, apologies: n % 2 ? 9 : 0,
  }));
  const { traits } = run(charterTraits(), wild);
  for (const trait of TRAIT_NAMES) {
    assert.ok(traits[trait] >= CHARTER[trait].charter - CHARTER[trait].band - 1e-9, `${trait} floor`);
    assert.ok(traits[trait] <= CHARTER[trait].charter + CHARTER[trait].band + 1e-9, `${trait} ceiling`);
  }
  assert.deepEqual(readTraits({ warmth: 99, guardedness: -99 }), { warmth: 0.80, guardedness: 30 });
  assert.deepEqual(readTraits(undefined), charterTraits());
});

test('guardedness waits for a month of tallies on both sides before it moves at all', () => {
  const blind = growMonth(charterTraits(), month({ month: '2026-09', hurtEvents: 40 }), [month()]);
  assert.ok(!blind.steps.some(step => step.trait === 'guardedness'), 'no norm for hurt yet, so it holds');
  const tallied = growMonth(charterTraits(), month({ month: '2026-10', hurtEvents: 40, apologies: 0 }), [month({ hurtEvents: 4, apologies: 2 })]);
  const step = tallied.steps.find(one => one.trait === 'guardedness')!;
  assert.ok(step.to > step.from, 'a month of being left holding it closes her up');
  const soothed = growMonth(charterTraits(), month({ month: '2026-10', hurtEvents: 0, apologies: 6 }), [month({ hurtEvents: 4, apologies: 0 })]);
  assert.ok(soothed.steps.find(one => one.trait === 'guardedness')!.to < CHARTER.guardedness.charter, 'and being put right opens her');
});

test('the ledger puts her back', () => {
  const months = [month(), month({ month: '2026-09', saidPerDay: 40, hangingPerDay: 1 }), month({ month: '2026-10', saidPerDay: 60, hangingPerDay: 0 })];
  const { traits, ledger } = run(charterTraits(), months);
  assert.notDeepEqual(traits, charterTraits());
  assert.deepEqual(revertTo(traits, ledger, '2026-09'), charterTraits(), 'back to before the first step that moved her');
  assert.equal(revertTo(traits, ledger, '2026-10').warmth, ledger.find(step => step.month === '2026-10')!.from);
});

test('what the rest of the machine reads off her traits', () => {
  assert.deepEqual(traitLean(charterTraits()), {}, 'at the charter she leans on nothing');
  assert.equal(traitLean({ warmth: 0.75, guardedness: 35 }).affection, 0.05);
  assert.equal(feelingsShowAt({ warmth: 0.7, guardedness: 38.4 }), 38);
  assert.equal(traitMeter(charterTraits(), 'warmth').value, 50);
  assert.match(traitMeter(charterTraits(), 'warmth').note, /Where she started/);
  assert.match(traitMeter({ warmth: 0.79, guardedness: 35 }, 'warmth').note, /warmer with him/);
});

test('she is told only once it is worth telling, and never as a number', () => {
  assert.equal(growthNote(charterTraits()), '');
  assert.equal(growthNote({ warmth: 0.74, guardedness: 35 }), '', 'a drift she could not feel says nothing');
  for (const traits of [{ warmth: 0.79, guardedness: 35 }, { warmth: 0.61, guardedness: 35 }, { warmth: 0.7, guardedness: 39 }, { warmth: 0.7, guardedness: 31 }]) {
    const note = growthNote(traits);
    assert.ok(note.length > 80);
    assert.doesNotMatch(note, /\d/, 'a number in the prompt comes back as a number in the reply');
  }
  assert.match(growthNote({ warmth: 0.8, guardedness: 35 }), /fonder of him now/);
  assert.match(growthNote({ warmth: 0.6, guardedness: 35 }), /stopped reaching for him/);
  assert.ok(Math.abs(travelled({ warmth: 0.8, guardedness: 35 }, 'warmth') - 1) < 1e-9);
});
