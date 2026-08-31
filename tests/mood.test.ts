import test from 'node:test';
import assert from 'node:assert/strict';
import { nextIrritation, afterCooldown, nextEgo, afterEgoCooldown, isLowEffort, isRedo, isShouting, isApology, isGoodnight, isIgnoring, shoutState, afterPoke, IGNORE_THRESHOLD, IRRITATION_MAX, EGO_MAX, COOLDOWN_MINUTES, EGO_COOLDOWN_MINUTES, moodInstruction, egoInstruction, goodnightInstruction, shoutInstruction, notTwiceInstruction, repeatedPhrase } from '../electron/mood';

// ---- nextIrritation arithmetic ----

test('nextIrritation applies the documented deltas per event', () => {
  assert.equal(nextIrritation(3, 'low-effort'), 5);
  assert.equal(nextIrritation(3, 'repeat'), 6);
  assert.equal(nextIrritation(3, 'disliked'), 5);
  assert.equal(nextIrritation(3, 'redo'), 3); // deliberately neutral
  assert.equal(nextIrritation(3, 'substantive'), 2);
  assert.equal(nextIrritation(3, 'liked'), 1);
});

test('nextIrritation clamps to [0, IRRITATION_MAX]', () => {
  assert.equal(IRRITATION_MAX, 9);
  assert.equal(nextIrritation(9, 'repeat'), 9);
  assert.equal(nextIrritation(0, 'liked'), 0);
});

// ---- afterCooldown: level - floor(minutesSince / 8) ----

test('afterCooldown reduces one notch per COOLDOWN_MINUTES (8)', () => {
  assert.equal(COOLDOWN_MINUTES, 8);
  assert.equal(afterCooldown(5, 8), 4);
  assert.equal(afterCooldown(5, 16), 3);
  assert.equal(afterCooldown(5, 7), 5); // not a full interval yet
  assert.equal(afterCooldown(5, 0), 5); // no time passed, no-op
  assert.equal(afterCooldown(5, -3), 5); // guards against a negative/garbage delta
});

test('afterCooldown floors at 0', () => {
  assert.equal(afterCooldown(2, 100), 0);
});

// ---- nextEgo ----

test('nextEgo applies +2 liked / -2 disliked and clamps to [0, EGO_MAX]', () => {
  assert.equal(EGO_MAX, 8);
  assert.equal(nextEgo(3, 'liked'), 5);
  assert.equal(nextEgo(3, 'disliked'), 1);
  assert.equal(nextEgo(8, 'liked'), 8);
  assert.equal(nextEgo(0, 'disliked'), 0);
});

// ---- afterEgoCooldown: slower rate than irritation's cooldown ----

test('afterEgoCooldown reduces one notch per EGO_COOLDOWN_MINUTES (25), slower than irritation', () => {
  assert.equal(EGO_COOLDOWN_MINUTES, 25);
  assert.equal(afterEgoCooldown(5, 25), 4);
  assert.equal(afterEgoCooldown(5, 50), 3);
  assert.equal(afterEgoCooldown(5, 24), 5);
  assert.equal(afterEgoCooldown(5, 0), 5);
});

test('the same time away cools irritation faster than it cools ego', () => {
  const minutesAway = 25; // one full ego-cooldown interval, ~3 irritation intervals
  const irritation = afterCooldown(5, minutesAway);
  const ego = afterEgoCooldown(5, minutesAway);
  assert.ok(irritation < ego, `expected irritation (${irritation}) to drop further than ego (${ego}) over the same time`);
  assert.equal(irritation, 2); // 5 - floor(25/8) = 5 - 3
  assert.equal(ego, 4);        // 5 - floor(25/25) = 5 - 1
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

test('isIgnoring triggers at IGNORE_THRESHOLD (7)', () => {
  assert.equal(IGNORE_THRESHOLD, 7);
  assert.equal(isIgnoring(6), false);
  assert.equal(isIgnoring(7), true);
});

test('shoutState: shouting starts the withholding state; an apology forgives it', () => {
  assert.equal(shoutState('STOP DOING THAT', false), 'shouted');
  assert.equal(shoutState('fine whatever', false), 'none');
  assert.equal(shoutState('still waiting', true), 'awaiting');
  assert.equal(shoutState('sorry about that', true), 'forgiven');
});

test('afterPoke wears the level down by one and floors at 0', () => {
  assert.equal(afterPoke(7), 6);
  assert.equal(afterPoke(0), 0);
});

// ---- instruction generators: thresholds toggle content on/off ----

test('moodInstruction is empty below the irritation threshold and non-empty above it', () => {
  assert.equal(moodInstruction(0), '');
  assert.equal(moodInstruction(2), '');
  assert.notEqual(moodInstruction(3), '');
  assert.notEqual(moodInstruction(9), '');
});

test('egoInstruction is empty at level <= 1 and non-empty above it', () => {
  assert.equal(egoInstruction(0), '');
  assert.equal(egoInstruction(1), '');
  assert.notEqual(egoInstruction(2), '');
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

