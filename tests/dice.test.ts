// The odds of her decisions, bent by the day she is having — inside limits.

import test from 'node:test';
import assert from 'node:assert/strict';
import { apologyOdds, muteLean, sway } from '../electron/dice';
import { TEMPERAMENTS, type TemperamentKind } from '../electron/temperament';

const KINDS = Object.keys(TEMPERAMENTS) as TemperamentKind[];

test('with nothing going on the odds are what they always were', () => {
  assert.equal(sway('second-thought', 1 / 6), 1 / 6);
  assert.equal(sway('pipe-up', 0.14, { temperament: 'ordinary' }), 0.14);
  assert.equal(sway('comeback', 0.5), 0.5);
  assert.equal(sway('spite', 0.3), 0.3);
  assert.equal(muteLean('ordinary'), 0);
});

test('her mood leans on them the way it should', () => {
  assert.ok(sway('second-thought', 1 / 6, { feelings: { playful: 80 } }) > 1 / 6);
  assert.ok(sway('second-thought', 1 / 6, { feelings: { hurt: 60 } }) < 1 / 6);
  assert.ok(sway('pipe-up', 0.14, { feelings: { boredom: 90, missing: 60 } }) > 0.25);
  assert.ok(sway('pipe-up', 0.14, { temperament: 'flat' }) < 0.14);
  assert.ok(sway('comeback', 0.5, { temperament: 'mischievous', feelings: { playful: 70 } }) > 0.8);
  assert.ok(sway('comeback', 0.5, { feelings: { hurt: 80 } }) < 0.2);
  assert.ok(sway('spite', 0.3, { feelings: { jealousy: 100 } }) > sway('spite', 0.3, { temperament: 'tender' }));
  assert.ok(muteLean('mischievous') < 0 && muteLean('tender') > 0);
});

test('a rare thing stays rare and a likely thing never becomes certain, whatever the state', () => {
  const extremes = [{}, { playful: 100, missing: 100, boredom: 100, jealousy: 100 }, { hurt: 100 }];
  for (const temperament of KINDS) for (const feelings of extremes) {
    const state = { temperament, feelings };
    assert.ok(sway('second-thought', 1 / 6, state) <= 1 / 3 + 1e-9 && sway('second-thought', 1 / 6, state) >= 1 / 12);
    assert.ok(sway('pipe-up', 0.14, state) <= 0.35 + 1e-9 && sway('pipe-up', 0.14, state) > 0.04);
    assert.ok(sway('comeback', 0.5, state) <= 0.85 && sway('comeback', 0.5, state) >= 0.15);
    assert.ok(sway('spite', 0.3, state) <= 0.6 && sway('spite', 0.3, state) >= 0.1);
    assert.ok(apologyOdds({ ...state, grudge: 100 }) >= 0.35 && apologyOdds({ ...state, grudge: 0 }) <= 0.97);
  }
});

test('an apology usually lands, less so when she is hurt or the day is a bad one', () => {
  assert.equal(apologyOdds({}), 0.9);
  assert.ok(apologyOdds({ feelings: { hurt: 80 }, grudge: 73 }) < 0.45);
  assert.ok(apologyOdds({ temperament: 'tender' }) > apologyOdds({ temperament: 'stormy' }));
});
