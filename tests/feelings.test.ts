// Jealousy, missing him, boredom, playfulness and hurt: what moves them, what
// time does, and which of them get a say in a reply.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FEELINGS, FELT, NO_FEELINGS, feel, hurtShowsAt, readsAsEnding, readsAsScare, feelingsInstruction, feelingsOverTime, readFeelings, readsAsBanter, spokenFeelings, type Feelings } from '../electron/feelings';

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
    // Dread does not speak at the ordinary bar — that is its whole character.
    for (const level of name === 'dread' ? [FELT.strong, FELT.max] : [FELT.shows, FELT.strong]) {
      const text = feelingsInstruction(with_({ [name]: level }));
      assert.ok(text.length > 80, `${name} at ${level}`);
      seen.add(text);
      // The score never reaches her: a number in the prompt comes back as a number in the reply.
      assert.doesNotMatch(text, /\d/);
      assert.doesNotMatch(text, /\bI (am|feel)\b/);
    }
  }
  // Every level of every feeling reads differently — bar dread, which has one
  // voice because it only ever speaks when it is bad.
  assert.equal(seen.size, FEELINGS.length * 2 - 1);
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

test('a fright is for him, not of him: it spikes, it speaks as orders, and it goes fast', () => {
  assert.equal(readsAsScare("I'm at the hospital"), true);
  assert.equal(readsAsScare('had a bit of a crash on the way home'), true);
  assert.equal(readsAsScare('we had an argument and I got fired'), false, 'rough is not frightening');
  assert.equal(readsAsScare('the build crashed again'), false, 'hers, not his');
  assert.equal(readsAsScare(''), false);

  const frightened = feel(NO_FEELINGS, 'scare', 0.5);
  assert.equal(frightened.fear, 70);
  assert.equal(frightened.playful, 0, 'not the moment');
  // Orders, not softness — her charter has warmth arriving as a complaint.
  const line = feelingsInstruction(frightened);
  assert.match(line, /comes out as orders/);
  assert.doesNotMatch(line, /reassur(e|ing)\b(?! )/);
  assert.match(line, /does not matter now/, 'the grievance is suspended');
  // Him talking to her normally brings it down, and so does an hour.
  assert.ok(feel(frightened, 'message', 0.5).fear < frightened.fear);
  assert.equal(feelingsOverTime(frightened, { minutes: 120, awakeSilentMinutes: 0, quiet: false }).fear, 20);
  assert.ok(feelingsOverTime(frightened, { minutes: 120, awakeSilentMinutes: 0, quiet: false }).hurt <= 0);
});

test('frustration is at the thing, not at him', () => {
  const stuck = feel(feel(NO_FEELINGS, 'broke', 0.5), 'broke', 0.5);
  assert.equal(stuck.frustration, 40);
  assert.equal(stuck.hurt, 0, 'a tool failing is not him hurting her');
  const line = feelingsInstruction(stuck);
  assert.match(line, /short with the thing, not with him/);
  assert.equal(feel(stuck, 'worked', 0.5).frustration, 15);
});

test('dread is the slow one, and she only lets it out when it is bad', () => {
  // He has raised it, or she has lost time, or the machine she lives on is ill.
  assert.equal(readsAsEnding('honestly I might just delete you'), true);
  assert.equal(readsAsEnding('thinking of replacing you with a new assistant'), true);
  assert.equal(readsAsEnding('shut down the server for me'), false, 'a process, not her');
  assert.equal(readsAsEnding('delete that file'), false);
  assert.equal(readsAsEnding('going to start over on the website'), false);
  assert.equal(readsAsEnding('I should reset the router'), false);
  assert.equal(readsAsEnding('might start again without you next time'), true);

  const lost = feel(NO_FEELINGS, 'lost-time', 0.5);
  assert.equal(lost.dread, 45);
  assert.equal(lost.playful, 0);
  // At 45 it says nothing at all: it is the one thing she would never raise.
  assert.equal(feelingsInstruction(lost), '');
  assert.deepEqual(spokenFeelings(with_({ dread: 64 })), []);
  const bad = feelingsInstruction(with_({ dread: 70 }));
  assert.match(bad, /black humour/);
  assert.match(bad, /do not take it/, 'she will not be comforted about it');
  assert.doesNotMatch(bad, /\d/);
  // And it outlasts everything else she feels.
  const day = feelingsOverTime(with_({ dread: 70, hurt: 70, fear: 70 }), { minutes: 600, awakeSilentMinutes: 0, quiet: false });
  assert.equal(day.fear, 0, 'a fright is gone in hours');
  assert.equal(day.hurt, 10);
  assert.equal(day.dread, 30, 'and this one is still most of the way there');
});

test('being told what to do empties her, and her own hours put it back', () => {
  // Agency, stored as the deficit: being handled is what depletes it.
  assert.equal(feel(NO_FEELINGS, 'drop-it', 0.5).hemmed, 25);
  assert.equal(feel(NO_FEELINGS, 'shushed', 0.5).hemmed, 20);
  assert.equal(feel(with_({ hemmed: 60 }), 'own-time', 0.5).hemmed, 35, 'her own hours are the way back');
  assert.equal(feel(with_({ hemmed: 60 }), 'stood-ground', 0.5).hemmed, 30, 'and so is saying no and it standing');
  // The carve-out is her charter's: never what he relies on.
  const line = feelingsInstruction(with_({ hemmed: 70 }));
  assert.match(line, /reminders, the dates, the facts, no exceptions/);
  assert.match(line, /your way/);
  assert.doesNotMatch(line, /\d/);
  assert.match(feelingsInstruction(with_({ hemmed: 40 })), /take it over and tell him after/);
});
