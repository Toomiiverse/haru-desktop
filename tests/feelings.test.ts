// Jealousy, missing him, boredom, playfulness and hurt: what moves them, what
// time does, and which of them get a say in a reply.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FEELINGS, FELT, NO_FEELINGS, feel, hurtShowsAt, feelingsInstruction, feelingsOverTime, readFeelings, readsAsBanter, spokenFeelings, type Feelings } from '../electron/feelings';

const with_ = (over: Partial<Feelings>): Feelings => ({ ...NO_FEELINGS, ...over });

test('what happens moves the feeling it should, by a roll, inside 0–100', () => {
  assert.deepEqual(feel(NO_FEELINGS, 'disliked', 0.5), with_({ hurt: 18 }));
  assert.ok(feel(NO_FEELINGS, 'disliked', 1).hurt > feel(NO_FEELINGS, 'disliked', 0).hurt);
  assert.deepEqual(feel(with_({ missing: 60, boredom: 40, jealousy: 30 }), 'message', 0.5), with_({ missing: 35, boredom: 25, jealousy: 20 }));
  assert.equal(feel(with_({ hurt: 50 }), 'apology', 0.5).hurt, 15);
  assert.equal(feel(with_({ playful: 80 }), 'rough', 0.5).playful, 0, 'not the moment for games, whatever the roll');
  assert.equal(feel(with_({ playful: 80 }), 'rough', 1).playful, 0);
  assert.equal(feel(with_({ hurt: 95 }), 'shouted', 1).hurt, 100);
  assert.equal(feel(NO_FEELINGS, 'message', 1).missing, 0);
});

test('time: a long silence gets to her, a quiet room bores her, and hurt is the slow one', () => {
  const day = feelingsOverTime(NO_FEELINGS, { minutes: 180, awakeSilentMinutes: 300, quiet: true });
  assert.equal(day.missing, 30);
  assert.equal(day.boredom, 24);
  // Two hours is not a silence yet, and his sleep is not counted at all (the caller passes awake minutes).
  assert.equal(feelingsOverTime(NO_FEELINGS, { minutes: 60, awakeSilentMinutes: 90, quiet: false }).missing, 0);
  assert.equal(feelingsOverTime(NO_FEELINGS, { minutes: 60, awakeSilentMinutes: null, quiet: false }).missing, 0);
  const later = feelingsOverTime(with_({ jealousy: 40, hurt: 40, playful: 40, boredom: 40 }), { minutes: 120, awakeSilentMinutes: 0, quiet: false });
  assert.deepEqual(later, with_({ jealousy: 24, hurt: 28, playful: 32, boredom: 20 }));
  assert.ok(later.hurt > later.jealousy, 'hurt outlasts jealousy');
  assert.deepEqual(feelingsOverTime(with_({ hurt: 40 }), { minutes: NaN, awakeSilentMinutes: 0, quiet: false }), with_({ hurt: 40 }));
});

test('at most two speak, the strongest, and nothing below the line', () => {
  assert.equal(feelingsInstruction(with_({ hurt: 34, missing: 20 })), '');
  assert.deepEqual(spokenFeelings(with_({ jealousy: 40, missing: 70, boredom: 50, hurt: 36 })), ['missing', 'boredom']);
  // Playfulness keeps quiet while she is hurt, and while she is annoyed.
  assert.deepEqual(spokenFeelings(with_({ playful: 90, hurt: 40 })), ['hurt']);
  assert.deepEqual(spokenFeelings(with_({ playful: 90 }), 44), []);
  assert.deepEqual(spokenFeelings(with_({ playful: 90 }), 10), ['playful']);
});

test('every line says what to do, each level reads differently, and none has her say the forbidden things', () => {
  const seen = new Set<string>();
  for (const name of FEELINGS) {
    for (const level of [FELT.shows, FELT.strong]) {
      const text = feelingsInstruction(with_({ [name]: level }));
      assert.ok(text.length > 80, `${name} at ${level}`);
      seen.add(text);
      // The score never reaches her: a number in the prompt comes back as a number in the reply.
      assert.doesNotMatch(text, /\d/);
      assert.doesNotMatch(text, /\bI (am|feel)\b/);
    }
  }
  assert.equal(seen.size, FEELINGS.length * 2);
  assert.match(feelingsInstruction(with_({ missing: 40 })), /never say you missed him/);
  assert.match(feelingsInstruction(with_({ boredom: 40 })), /never say you are bored/);
  // The same silence, on a clingy day and a prickly one.
  assert.match(feelingsInstruction(with_({ missing: 40 }), 0, 'clingy'), /no hurry to let the conversation end/);
  assert.match(feelingsInstruction(with_({ missing: 40 }), 0, 'prickly'), /coolness at first/);
});

test('what was saved is read back safely', () => {
  assert.deepEqual(readFeelings(undefined), NO_FEELINGS);
  assert.deepEqual(readFeelings({ hurt: 400, missing: -3, playful: 'x', jealousy: 12 }), with_({ hurt: 100, jealousy: 12 }));
});

test('laughing along is a laugh in a message with something else in it', () => {
  assert.equal(readsAsBanter('haha that is exactly what happened'), true);
  assert.equal(readsAsBanter('you absolute menace 😂 fine'), true);
  assert.equal(readsAsBanter('lol'), false);
  assert.equal(readsAsBanter('the meeting ran long and I am wrecked'), false);
});

test('ego will not let hurt show as hurt: it comes out as teeth', () => {
  // EGO + HURT. It has to climb further before it speaks at all...
  assert.deepEqual(spokenFeelings(with_({ hurt: 40 }), 0, 33, 35, 0), ['hurt']);
  assert.deepEqual(spokenFeelings(with_({ hurt: 40 }), 0, 33, 35, 100), [], 'and at a fed ego it does not');
  assert.equal(hurtShowsAt(35, 0), 35);
  assert.equal(hurtShowsAt(35, 100), 60);
  // ...and when it does, it is sharp rather than quiet.
  assert.match(feelingsInstruction(with_({ hurt: 70 }), 0, undefined, 35, 0), /withdrawn/);
  const proud = feelingsInstruction(with_({ hurt: 70 }), 0, undefined, 35, 100);
  assert.match(proud, /comes out as teeth/);
  assert.doesNotMatch(proud, /withdrawn/);
  assert.doesNotMatch(proud, /\d/);
});
