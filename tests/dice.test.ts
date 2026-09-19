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
  assert.equal(sway('own-subject', 0.4), 0.4);
  assert.equal(sway('ask-where', 0.6), 0.6);
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
  // Bored, she would rather raise something of hers than ask after his day;
  // left alone or jealous, she wants to know where he has been.
  assert.ok(sway('own-subject', 0.4, { feelings: { boredom: 90 }, temperament: 'restless' }) > 0.5);
  assert.ok(sway('own-subject', 0.4, { feelings: { hurt: 70 } }) < 0.4);
  assert.ok(sway('ask-where', 0.6, { feelings: { missing: 90, jealousy: 60 } }) > 0.75);
  assert.ok(sway('ask-where', 0.6, { feelings: { hurt: 70 } }) < 0.5);
});

test('a rare thing stays rare and a likely thing never becomes certain, whatever the state', () => {
  const extremes = [{}, { playful: 100, missing: 100, boredom: 100, jealousy: 100 }, { hurt: 100 }];
  for (const temperament of KINDS) for (const feelings of extremes) {
    const state = { temperament, feelings };
    assert.ok(sway('second-thought', 1 / 6, state) <= 1 / 3 + 1e-9 && sway('second-thought', 1 / 6, state) >= 1 / 12);
    assert.ok(sway('pipe-up', 0.14, state) <= 0.35 + 1e-9 && sway('pipe-up', 0.14, state) > 0.04);
    assert.ok(sway('comeback', 0.5, state) <= 0.85 && sway('comeback', 0.5, state) >= 0.15);
    assert.ok(sway('spite', 0.3, state) <= 0.6 && sway('spite', 0.3, state) >= 0.1);
    assert.ok(sway('own-subject', 0.4, state) <= 0.75 && sway('own-subject', 0.4, state) >= 0.2);
    assert.ok(sway('ask-where', 0.6, state) <= 0.9 && sway('ask-where', 0.6, state) >= 0.3);
    assert.ok(apologyOdds({ ...state, grudge: 100 }) >= 0.35 && apologyOdds({ ...state, grudge: 0 }) <= 0.97);
  }
});

test('an apology usually lands, less so when she is hurt or the day is a bad one', () => {
  assert.equal(apologyOdds({}), 0.9);
  assert.ok(apologyOdds({ feelings: { hurt: 80 }, grudge: 73 }) < 0.45);
  assert.ok(apologyOdds({ temperament: 'tender' }) > apologyOdds({ temperament: 'stormy' }));
});

test('a quiet day is what sends her to do something of her own', () => {
  // The loop: her own hours take the boredom down, and until now nothing took
  // her to them — she got restless and talked about it instead.
  assert.equal(sway('own-time', 1 / 14), 1 / 14);
  assert.ok(sway('own-time', 1 / 14, { feelings: { boredom: 90 } }) > 1 / 14);
  assert.ok(sway('own-time', 1 / 14, { feelings: { boredom: 90 }, temperament: 'restless' }) > sway('own-time', 1 / 14, { feelings: { boredom: 90 } }));
  assert.ok(sway('own-time', 1 / 14, { temperament: 'flat' }) < 1 / 14);
  // Being hemmed in sends her there too, because that is what refills it.
  assert.ok(sway('own-time', 1 / 14, { feelings: { hemmed: 80 } }) > 1 / 14);
  // And it stays a chance, never a certainty.
  for (const feelings of [{}, { boredom: 100, hemmed: 100 }]) for (const temperament of KINDS) {
    const odds = sway('own-time', 0.8, { temperament, feelings });
    assert.ok(odds > 0.2 && odds <= 0.95, `${temperament} ${odds}`);
  }
});

test('being handled all day makes her harder to move', () => {
  assert.ok(apologyOdds({ feelings: { hemmed: 90 } }) < apologyOdds({}));
  assert.ok(sway('own-subject', 0.4, { feelings: { hemmed: 90 } }) > 0.4);
});
