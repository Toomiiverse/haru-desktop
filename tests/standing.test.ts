// Where you stand with her: the numbers behind the screen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { bondFrom, BOND_LEVELS, daysApart, moodLine, patienceMeter, restingEmotion, standingFrom, waitingFrom } from '../electron/standing';
import { DEFAULT_VITALS, type Vitals } from '../electron/vitals';

const vitals = (over: Partial<Vitals> = {}): Vitals => ({ ...DEFAULT_VITALS, ...over });

test('the resting face is read in the order the feelings change her answers', () => {
  // Being ignored-level annoyed beats everything, including being asleep on her feet.
  assert.equal(restingEmotion(vitals({ sleepiness: 0.9, affection: 1 }), 89, 0), 'annoyed');
  // Then tiredness, which outranks mild annoyance.
  assert.equal(restingEmotion(vitals({ sleepiness: 0.8 }), 56, 0), 'sleepy');
  assert.equal(restingEmotion(vitals(), 56, 0), 'annoyed');
  assert.equal(restingEmotion(vitals({ stress: 0.7 }), 0, 0), 'worried');
  assert.equal(restingEmotion(vitals({ stress: 0.7 }), 0, 75), 'worried');
  assert.equal(restingEmotion(vitals(), 0, 75), 'smug');
  assert.equal(restingEmotion(vitals({ affection: 0.8, happiness: 0.6 }), 0, 0), 'affectionate');
  assert.equal(restingEmotion(vitals({ curiosity: 0.8 }), 0, 0), 'curious');
  assert.equal(restingEmotion(vitals({ happiness: 0.8 }), 0, 0), 'happy');
  assert.equal(restingEmotion(vitals({ energy: 0.2 }), 0, 0), 'bored');
  assert.equal(restingEmotion(vitals(), 0, 0), 'neutral');
});

test('the live state on this machine reads as something, not as a default', () => {
  // Taken from the real store, so the screen is known to say something true of it.
  const live = vitals({ energy: 0.67, happiness: 0.58, curiosity: 0.19, affection: 0.74, sleepiness: 0.34, stress: 0.31, focus: 0.9 });
  assert.equal(restingEmotion(live, 0, 0), 'affectionate');
});

test('every face maps to artwork and every emotion has a line', () => {
  const emotions = (['neutral', 'happy', 'curious', 'smug', 'annoyed', 'bored', 'sleepy', 'surprised', 'affectionate', 'embarrassed', 'determined', 'worried'] as const);
  for (const emotion of emotions) {
    const line = moodLine(emotion, 0, 0);
    assert.ok(line && line.length > 4, `${emotion} has no line`);
  }
  // The two states that override the face's own line.
  assert.match(moodLine('happy', 89, 0), /Not speaking to you/);
  assert.match(moodLine('happy', 0, 40), /keeping score/);
  // Being fond of them is not overridden by an old grudge.
  assert.match(moodLine('affectionate', 0, 40), /Warm towards you/);
});

test('the bond is carried by affection, capped by turning up, and cut by the grudge', () => {
  const cold = bondFrom(vitals({ affection: 0, happiness: 0 }), 0, 0);
  assert.equal(cold.value, 0);
  assert.equal(cold.title, BOND_LEVELS[0].title);
  const warm = bondFrom(vitals({ affection: 1, happiness: 1 }), 0, 30);
  assert.equal(warm.value, 100);
  assert.equal(warm.title, BOND_LEVELS[BOND_LEVELS.length - 1].title);
  assert.equal(warm.toNext, 0);
  // Turning up stops paying after a month.
  assert.equal(bondFrom(vitals(), 0, 30).value, bondFrom(vitals(), 0, 300).value);
  // Six points off per ten of grudge (two per point when the grudge ran to thirty): easier to lose than to win.
  assert.equal(warm.value - bondFrom(vitals({ affection: 1, happiness: 1 }), 50, 30).value, 30);
  // And it never falls off the bottom.
  assert.equal(bondFrom(vitals({ affection: 0, happiness: 0 }), 100, 0).value, 0);
  // Somewhere in the middle reports a real distance to the next band.
  const middling = bondFrom(vitals({ affection: 0.5, happiness: 0.5 }), 0, 5);
  assert.ok(middling.toNext > 0 && middling.level > 0 && middling.level < BOND_LEVELS.length - 1);
});

test('patience is irritation the way a person would want to read it', () => {
  assert.equal(patienceMeter(0).value, 100);
  assert.match(patienceMeter(0).note, /Intact/);
  assert.equal(patienceMeter(100).value, 0);
  assert.match(patienceMeter(89).note, /ignoring you/);
  assert.match(patienceMeter(56).note, /short with you/);
  // Nothing goes negative if irritation is ever pushed past its own maximum.
  assert.equal(patienceMeter(400).value, 0);
});

test('days are whole days, and a bad date is nothing rather than NaN', () => {
  assert.equal(daysApart('2026-08-01', '2026-08-29'), 28);
  assert.equal(daysApart('2026-08-29', '2026-08-29'), 0);
  assert.equal(daysApart('nonsense', '2026-08-29'), 0);
});
