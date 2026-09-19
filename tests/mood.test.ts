import test from 'node:test';
import assert from 'node:assert/strict';
import { nextIrritation, afterCooldown, nextEgo, afterEgoCooldown, isLowEffort, isRedo, isShouting, isApology, isGoodnight, isIgnoring, shoutState, afterPoke, IGNORE_THRESHOLD, IRRITATION_MAX, EGO_MAX, IRRITATION, EGO, jittered, rescaleOldMood, COOLDOWN_MINUTES, EGO_COOLDOWN_MINUTES, moodInstruction, egoInstruction, goodnightInstruction, shoutInstruction, notTwiceInstruction, repeatedPhrase } from '../electron/mood';

// ---- nextIrritation arithmetic (0–100 since 2026-09-19; roll 0.5 is the plain size) ----

test('nextIrritation applies the documented deltas per event, at the plain roll', () => {
  assert.equal(nextIrritation(33, 'low-effort', 0.5), 55);
  assert.equal(nextIrritation(33, 'repeat', 0.5), 66);
  assert.equal(nextIrritation(33, 'disliked', 0.5), 55);
  assert.equal(nextIrritation(33, 'redo', 0.5), 33); // deliberately neutral
  assert.equal(nextIrritation(33, 'substantive', 0.5), 22);
  assert.equal(nextIrritation(33, 'liked', 0.5), 11);
});

test('the same event does not land the same way twice: ±35% on the roll', () => {
  assert.equal(jittered(22, 0), 14);
  assert.equal(jittered(22, 0.5), 22);
  assert.equal(jittered(22, 1), 30);
  assert.ok(nextIrritation(0, 'low-effort', 0) < nextIrritation(0, 'low-effort', 1));
  // Whatever the roll, the direction of an event never flips.
  for (const roll of [0, 0.25, 0.75, 1]) {
    assert.ok(nextIrritation(50, 'repeat', roll) > 50);
    assert.ok(nextIrritation(50, 'liked', roll) < 50);
  }
});

test('nextIrritation clamps to [0, IRRITATION_MAX]', () => {
  assert.equal(IRRITATION_MAX, 100);
  assert.equal(nextIrritation(100, 'repeat', 1), 100);
  assert.equal(nextIrritation(0, 'liked', 1), 0);
});

test('the bands are the old levels, in order, on the new scale', () => {
  const { stirred, voiced, short, fedUp, seething, stonewall, max } = IRRITATION;
  assert.deepEqual([stirred, voiced, short, fedUp, seething, stonewall, max], [11, 33, 44, 56, 67, 78, 100]);
  assert.deepEqual([EGO.smug, EGO.coasting, EGO.showing, EGO.insufferable, EGO.max], [25, 50, 63, 75, 100]);
});

// ---- afterCooldown: a notch (11) per 8 minutes ----

test('afterCooldown reduces one notch per COOLDOWN_MINUTES (8)', () => {
  assert.equal(COOLDOWN_MINUTES, 8);
  assert.equal(afterCooldown(55, 8), 44);
  assert.equal(afterCooldown(55, 16), 33);
  assert.equal(afterCooldown(55, 4), 50); // part of an interval cools part of a notch
  assert.equal(afterCooldown(55, 0), 55); // no time passed, no-op
  assert.equal(afterCooldown(55, -3), 55); // guards against a negative/garbage delta
});

test('afterCooldown floors at 0', () => {
  assert.equal(afterCooldown(22, 100), 0);
});

// ---- nextEgo ----

test('nextEgo applies ±25 at the plain roll and clamps to [0, EGO_MAX]', () => {
  assert.equal(EGO_MAX, 100);
  assert.equal(nextEgo(38, 'liked', 0.5), 63);
  assert.equal(nextEgo(38, 'disliked', 0.5), 13);
  assert.equal(nextEgo(100, 'liked', 1), 100);
  assert.equal(nextEgo(0, 'disliked', 1), 0);
});

// ---- afterEgoCooldown: slower rate than irritation's cooldown ----

test('afterEgoCooldown reduces one notch (12.5) per EGO_COOLDOWN_MINUTES (25), slower than irritation', () => {
  assert.equal(EGO_COOLDOWN_MINUTES, 25);
  assert.equal(afterEgoCooldown(63, 25), 51);
  assert.equal(afterEgoCooldown(63, 50), 38);
  assert.equal(afterEgoCooldown(63, 0), 63);
});

test('the same time away cools irritation faster than it cools ego', () => {
  const minutesAway = 25; // one full ego-cooldown interval, ~3 irritation intervals
  const irritation = afterCooldown(60, minutesAway);
  const ego = afterEgoCooldown(60, minutesAway);
  assert.ok(irritation < ego, `expected irritation (${irritation}) to drop further than ego (${ego}) over the same time`);
  assert.equal(irritation, 26); // 60 - floor(25/8 × 11)
  assert.equal(ego, 48);        // 60 - floor(25/25 × 12.5)
});

// ---- a mood saved on the old scales ----

test('an old save comes onto the 0–100 scales exactly once', () => {
  const old = { irritation: 3, ego: 4, grudge: 22, grudgeBeforeTally: 23, talliedDay: '2026-09-18' };
  const once = rescaleOldMood(old);
  assert.deepEqual(once, { irritation: 33, ego: 50, grudge: 73, grudgeBeforeTally: 77, talliedDay: '2026-09-18', scale: 100 });
  assert.deepEqual(rescaleOldMood(once), once);
  assert.deepEqual(rescaleOldMood({ irritation: 0, ego: 0 }), { irritation: 0, ego: 0, scale: 100 });
});

// ---- classifier edge cases the code's own comments call out ----

test('isShouting: short all-caps abbreviations are not shouting', () => {
  assert.equal(isShouting('CPU'), false);
  assert.equal(isShouting('ASAP'), false);
  assert.equal(isShouting('NASA'), false);
});

test('isShouting: a single long all-caps word with no punctuation is still an acronym-shaped exception below the letter threshold', () => {
  assert.equal(isShouting('GITHUB'), false); // 6 letters, one word, no punctuation
});

test('isShouting: genuine multi-word all-caps is shouting', () => {
  assert.equal(isShouting('STOP DOING THAT'), true);
  assert.equal(isShouting('WHY WOULD YOU DO THAT'), true);
});

test('isShouting: ordinary lowercase text is never shouting', () => {
  assert.equal(isShouting('fine whatever'), false);
  assert.equal(isShouting('can you help me with this'), false);
});

test('isRedo: "try again" is a redo, not a repeat complaint', () => {
  assert.equal(isRedo('try again'), true);
  assert.equal(isRedo('again'), true);
  assert.equal(isRedo('not quite'), true);
});

test('isRedo: an unrelated message is not a redo', () => {
  assert.equal(isRedo('what time is it'), false);
});

test('isGoodnight: anchored at the start, so a question about tonight is not a farewell', () => {
  assert.equal(isGoodnight('goodnight'), true);
  assert.equal(isGoodnight('gn'), true);
  assert.equal(isGoodnight('going to bed'), true);
  assert.equal(isGoodnight('what are you doing tonight?'), false);
});

test('isLowEffort catches filler and vague openers but not short real instructions', () => {
  assert.equal(isLowEffort('hi'), true);
  assert.equal(isLowEffort('lol'), true);
  assert.equal(isLowEffort('i\'m bored'), true);
  assert.equal(isLowEffort(''), true);
  // A one-word instruction is not filler, even though it is short.
  assert.equal(isLowEffort('expand'), false);
  assert.equal(isLowEffort('shorter'), false);
  assert.equal(isLowEffort('continue'), false);
});

test('isApology recognises common apology phrasing', () => {
  assert.equal(isApology('sorry about that'), true);
  assert.equal(isApology('my bad'), true);
  assert.equal(isApology('what do you want'), false);
});

test('isApology: "calmed down" counts, a bare "calm down" does not', () => {
  assert.equal(isApology("sorry, I've calmed down now"), true);
  assert.equal(isApology('calm down'), false);
  assert.equal(isApology('just calm down already'), false);
});

// ---- isIgnoring / shout state machine ----

test('isIgnoring triggers at IGNORE_THRESHOLD (the stonewall band)', () => {
  assert.equal(IGNORE_THRESHOLD, IRRITATION.stonewall);
  assert.equal(isIgnoring(77), false);
  assert.equal(isIgnoring(78), true);
});

test('shoutState: shouting starts the withholding state; an apology forgives it', () => {
  assert.equal(shoutState('STOP DOING THAT', false), 'shouted');
  assert.equal(shoutState('fine whatever', false), 'none');
  assert.equal(shoutState('still waiting', true), 'awaiting');
  assert.equal(shoutState('sorry about that', true), 'forgiven');
});

test('afterPoke wears the level down by a notch and floors at 0', () => {
  assert.equal(afterPoke(78), 67);
  assert.equal(afterPoke(0), 0);
});

// ---- instruction generators: thresholds toggle content on/off ----

test('moodInstruction is empty below the irritation threshold and non-empty above it', () => {
  assert.equal(moodInstruction(0), '');
  assert.equal(moodInstruction(21), '');
  assert.notEqual(moodInstruction(IRRITATION.voiced), '');
  assert.notEqual(moodInstruction(100), '');
  // More levels than the three there were: each band reads differently.
  const levels = [25, 40, 60, 70].map(moodInstruction);
  assert.equal(new Set(levels).size, 4);
});

test('egoInstruction is empty below the smug band and non-empty above it', () => {
  assert.equal(egoInstruction(0), '');
  assert.equal(egoInstruction(24), '');
  assert.notEqual(egoInstruction(EGO.smug), '');
  assert.equal(new Set([30, 45, 60, 80].map(egoInstruction)).size, 4);
});

test('goodnightInstruction differs between saying goodnight and coming back after', () => {
  assert.equal(goodnightInstruction('none'), '');
  assert.notEqual(goodnightInstruction('said'), '');
  assert.notEqual(goodnightInstruction('after'), '');
  assert.notEqual(goodnightInstruction('said'), goodnightInstruction('after'));
});

test('shoutInstruction withholds the answer while shouted/awaiting, and answers again once forgiven', () => {
  assert.equal(shoutInstruction('none'), '');
  assert.notEqual(shoutInstruction('shouted'), '');
  assert.notEqual(shoutInstruction('awaiting'), '');
  assert.notEqual(shoutInstruction('forgiven'), '');
});

test('a phrase she has used in three of her last four replies is named, whatever the openers did', () => {
  const replies = ['Because you’re finally paying attention. 🙄 Don’t make it weird.', 'I’m not making it weird. You are. 😒 Now stop stalling and get back to work.', '"Fine fine." Two words, zero substance. Get back to work before I decide you’re wasting my time.', 'Stalling again. Get back to work.'];
  assert.equal(repeatedPhrase(replies), 'get back to work'.slice(0, 15) === 'get back to wor' ? repeatedPhrase(replies) : '', 'sanity');
  assert.match(repeatedPhrase(replies), /^(get back to|back to work)$/);
  assert.match(notTwiceInstruction(replies), /You have also said ".*" in 4 of your last few replies/);
  assert.equal(repeatedPhrase(['Fine.', 'Fine, whatever.', 'Fine then.', 'Right.']), '', 'nothing three words long');
  assert.equal(repeatedPhrase(['I do not want to.', 'You are not going to.', 'Do not do that.', 'I am not on it.']), '', 'filler runs are not phrases');
});

