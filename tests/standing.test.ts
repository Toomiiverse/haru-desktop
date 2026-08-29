// Where you stand with her: the numbers behind the screen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { bondFrom, BOND_LEVELS, daysApart, moodLine, patienceMeter, restingEmotion, standingFrom } from '../electron/standing';
import { DEFAULT_VITALS, type Vitals } from '../electron/vitals';

const vitals = (over: Partial<Vitals> = {}): Vitals => ({ ...DEFAULT_VITALS, ...over });

test('the resting face is read in the order the feelings change her answers', () => {
  // Being ignored-level annoyed beats everything, including being asleep on her feet.
  assert.equal(restingEmotion(vitals({ sleepiness: 0.9, affection: 1 }), 8, 0), 'annoyed');
  // Then tiredness, which outranks mild annoyance.
  assert.equal(restingEmotion(vitals({ sleepiness: 0.8 }), 5, 0), 'sleepy');
  assert.equal(restingEmotion(vitals(), 5, 0), 'annoyed');
  assert.equal(restingEmotion(vitals({ stress: 0.7 }), 0, 0), 'worried');
  assert.equal(restingEmotion(vitals({ stress: 0.7 }), 0, 6), 'worried');
  assert.equal(restingEmotion(vitals(), 0, 6), 'smug');
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
  assert.match(moodLine('happy', 8, 0), /Not speaking to you/);
  assert.match(moodLine('happy', 0, 12), /keeping score/);
  // Being fond of them is not overridden by an old grudge.
  assert.match(moodLine('affectionate', 0, 12), /Warm towards you/);
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
  // Two points off per unanswered message: easier to lose than to win.
  assert.equal(warm.value - bondFrom(vitals({ affection: 1, happiness: 1 }), 5, 30).value, 10);
  // And it never falls off the bottom.
  assert.equal(bondFrom(vitals({ affection: 0, happiness: 0 }), 30, 0).value, 0);
  // Somewhere in the middle reports a real distance to the next band.
  const middling = bondFrom(vitals({ affection: 0.5, happiness: 0.5 }), 0, 5);
  assert.ok(middling.toNext > 0 && middling.level > 0 && middling.level < BOND_LEVELS.length - 1);
});

test('patience is irritation the way a person would want to read it', () => {
  assert.equal(patienceMeter(0).value, 100);
  assert.match(patienceMeter(0).note, /Intact/);
  assert.equal(patienceMeter(9).value, 0);
  assert.match(patienceMeter(8).note, /ignoring you/);
  assert.match(patienceMeter(5).note, /short with you/);
  // Nothing goes negative if irritation is ever pushed past its own maximum.
  assert.equal(patienceMeter(40).value, 0);
});

test('days are whole days, and a bad date is nothing rather than NaN', () => {
  assert.equal(daysApart('2026-08-01', '2026-08-29'), 28);
  assert.equal(daysApart('2026-08-29', '2026-08-29'), 0);
  assert.equal(daysApart('nonsense', '2026-08-29'), 0);
});

test('the whole screen holds together, and says what she is waiting for', () => {
  const screen = standingFrom({
    vitals: vitals({ affection: 0.74, happiness: 0.58 }),
    irritation: 2, ego: 1, grudge: 1, ignoredToday: 1,
    lastMessageAt: '2026-08-29T10:00:00.000Z',
    knownSince: '2026-08-01', daysTalked: 12,
    waiting: ['Get Scarlett a birthday present', 'Rental Inspection', 'a', 'b', 'c', 'd'],
    now: Date.parse('2026-08-29T11:30:00.000Z'), today: '2026-08-29',
  });
  assert.equal(screen.emotion, 'affectionate');
  assert.equal(screen.face, 'love');
  assert.equal(screen.knownDays, 28);
  assert.equal(screen.minutesSinceSpoke, 90);
  assert.equal(screen.meters.length, 7);
  assert.ok(screen.meters.every(meter => meter.value >= 0 && meter.value <= 100 && meter.note));
  assert.equal(screen.patience.value, Math.round(7 / 9 * 100));
  assert.match(screen.grudge.note, /1 of her messages left unanswered.*1 of them today/);
  // Five is enough of a list on a phone.
  assert.equal(screen.waiting.length, 5);
});

test('nothing known yet still renders', () => {
  const screen = standingFrom({
    vitals: DEFAULT_VITALS, irritation: 0, ego: 0, grudge: 0, ignoredToday: 0,
    daysTalked: 0, waiting: [], now: Date.parse('2026-08-29T11:30:00.000Z'), today: '2026-08-29',
  });
  assert.equal(screen.knownDays, 0);
  assert.equal(screen.minutesSinceSpoke, null);
  assert.match(screen.grudge.note, /Nothing held against you/);
});
