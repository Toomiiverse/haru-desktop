// The thing she says a minute later, and when she says nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeAnEcho, parseSecondThought, secondThoughtDelay, secondThoughtNote, wantsSecondThought, SECOND_THOUGHT_MIN_MS, SECOND_THOUGHT_MAX_MS } from '../electron/secondthought';

test('a follow-up is always considered after her subject or a rant, rarely otherwise, never after a grunt', () => {
  assert.ok(wantsSecondThought({ hers: true, ranting: false, replyLength: 200 }, () => 0.99));
  assert.ok(wantsSecondThought({ hers: false, ranting: true, replyLength: 200 }, () => 0.99));
  assert.ok(!wantsSecondThought({ hers: false, ranting: false, replyLength: 200 }, () => 0.99), 'an ordinary turn, most of the time');
  assert.ok(wantsSecondThought({ hers: false, ranting: false, replyLength: 200 }, () => 0.01), 'an ordinary turn, now and then');
  assert.ok(!wantsSecondThought({ hers: true, ranting: true, replyLength: 5 }, () => 0), '"Good." has nothing to add to');
});

test('the delay is a minute or two, and the note says it is not a reply', () => {
  const d = secondThoughtDelay(() => 0.5);
  assert.ok(d >= SECOND_THOUGHT_MIN_MS && d <= SECOND_THOUGHT_MAX_MS);
  assert.match(secondThoughtNote(60), /about a minute ago/);
  assert.match(secondThoughtNote(150), /about 3 minutes ago/);
  assert.match(secondThoughtNote(60), /single dash/);
  assert.match(secondThoughtNote(60), /not a reply to anything/);
});

test('a dash, a "nothing", or a quoted line is read for what it is', () => {
  assert.equal(parseSecondThought('-'), null);
  assert.equal(parseSecondThought('—'), null);
  assert.equal(parseSecondThought('Nothing to add.'), null);
  assert.equal(parseSecondThought('"Also, the Reze movie is out on Crunchyroll. You knew that, right?"'), 'Also, the Reze movie is out on Crunchyroll. You knew that, right?');
  assert.equal(parseSecondThought('One more thing about Denji.\n\nAnd a second message.'), 'One more thing about Denji.', 'one message, not two');
  assert.equal(parseSecondThought('ok'), null, 'too short to be a thought');
});

test('a follow-up that repeats what was just said is not a follow-up', () => {
  const his = 'That’s fair enough - sounds like you’re really enjoying chainsaw man. What chapter are you on up to?';
  const hers = 'I keep your calendar, your memory, your journal if you write one. I look stuff up when you need it — web, your own files, whatever. I can take on interests if something sounds like my thing.';
  const recent = ['Anyways how was your night', 'Night was quiet. Finally finished that re-read of *Chainsaw Man*.', his, hers];
  // His message back, as it went out on 2026-09-06.
  assert.ok(looksLikeAnEcho("That's fair enough - sounds like you're really enjoying chainsaw man. What chapter are you on up to?", recent));
  // A paragraph of her own reply with an asterisk in front, as the second one went out.
  assert.ok(looksLikeAnEcho('*I keep your calendar, your memory, your journal if you write one. I look stuff up when you need it — web, your own files, whatever.', recent));
  // Mostly the same words in a different order is still the same line.
  assert.ok(looksLikeAnEcho('Sounds like you’re really enjoying chainsaw man — what chapter are you up to?', recent));
  // A real second thought passes.
  assert.ok(!looksLikeAnEcho('Also — Part 2 is a different beast. Fujimoto stops holding your hand entirely.', recent));
  assert.ok(!looksLikeAnEcho('ugh, he’s a disaster.', recent));
  // A short line is an echo only when it is the same line; "yeah. that." is hers to say.
  assert.ok(!looksLikeAnEcho('yeah. that.', recent));
  assert.ok(looksLikeAnEcho('yeah. that.', [...recent, 'Yeah. That.']));
  assert.ok(looksLikeAnEcho('', recent), 'nothing is nothing to add');
});

test('the note tells her not to repeat either side', () => {
  assert.match(secondThoughtNote(60), /Never repeat what they said or what you said/);
});
