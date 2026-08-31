// Her emoji, and the one she cannot stop using.

import test from 'node:test';
import assert from 'node:assert/strict';
import { emojiRut, EXPRESSIVE, HER_EMOJI, LAST_WORD, NATURAL } from '../electron/room';
import { dropOverusedEmoji, oneEmojiAtMost } from '../electron/reply';

test('the eye-roll is no longer named first or named as the default', () => {
  assert.equal(HER_EMOJI[0], '😏');
  assert.equal(HER_EMOJI.at(-1), '🙄');
  assert.doesNotMatch(EXPRESSIVE, /Most replies carry one/);
  assert.match(EXPRESSIVE, /None of them is your default/);
  assert.match(LAST_WORD, /may go in this reply/, 'an emoji is no longer owed on every reply');
  assert.doesNotMatch(LAST_WORD, /one of your emoji goes in this reply/);
});

test('an emoji in three of her last four replies is named back to her, with the others offered', () => {
  const stuck = ['Fine. 🙄', 'Whatever. 🙄', 'Go on then.', 'Told you. 🙄'];
  const note = emojiRut(stuck);
  assert.match(note, /You have put 🙄 in 3 of your last 4 replies/);
  assert.match(note, /Do not use 🙄 in this reply at all/);
  assert.doesNotMatch(note.split('use one of')[1] ?? '', /🙄/, 'the others are offered, not the one she is stuck on');
  assert.equal(emojiRut(['Fine. 🙄', 'Sure.', 'Right. 😏', 'Hm. 👀']), '', 'no habit, nothing said');
  assert.equal(emojiRut(['Fine. 🙄', 'Yes. 🙄']), '', 'too few replies to call it a habit');
});

test('the backstop takes the stuck emoji out, so the same one twice running is not something she can do', () => {
  const two = ['a 🙄', 'b 🙄'];
  assert.equal(dropOverusedEmoji('Get on with it. 🙄', two, HER_EMOJI), 'Get on with it.');
  assert.equal(dropOverusedEmoji('Fine 🙄, whatever.', two, HER_EMOJI), 'Fine, whatever.');
  assert.equal(dropOverusedEmoji('Get on with it. 😏', two, HER_EMOJI), 'Get on with it. 😏', 'a different one is hers to use');
  assert.equal(dropOverusedEmoji('🙄', two, HER_EMOJI), '🙄', 'never left with nothing');
  assert.equal(dropOverusedEmoji('Fine. 🙄', ['a 🙄', 'b'], HER_EMOJI), 'Fine. 🙄', 'only the one both of them had');
  assert.equal(dropOverusedEmoji('Fine. 🙄', ['a 🙄'], HER_EMOJI), 'Fine.', 'the one she used last time is gone from this one');
  assert.equal(dropOverusedEmoji('Fine. 🙄', ['a 😏'], HER_EMOJI), 'Fine. 🙄', 'a different one last time leaves this one alone');
  assert.equal(dropOverusedEmoji('Fine. 🙄', [], HER_EMOJI), 'Fine. 🙄', 'nothing to compare with');
});

test('how she writes is about the shape of the message, and does not soften what she is', () => {
  assert.match(NATURAL, /a throwaway line gets a throwaway line back/);
  assert.match(NATURAL, /Fragments are fine\. Contractions always\./);
  assert.match(NATURAL, /not a tax on every message/);
  assert.match(NATURAL, /No bullet points, no headings/);
  assert.match(NATURAL, /Never sound like support staff/);
  assert.doesNotMatch(NATURAL, /\b(kind|gentle|polite|nice|warm|supportive)\b/i, 'nothing here makes her nicer');
});

test('one emoji at most, whichever came first', () => {
  assert.equal(oneEmojiAtMost('Good. 😏 Now go to bed. 🙄', HER_EMOJI), 'Good. 😏 Now go to bed.');
  assert.equal(oneEmojiAtMost('Fine. 🙄', HER_EMOJI), 'Fine. 🙄');
  assert.equal(oneEmojiAtMost('Sure.', HER_EMOJI), 'Sure.');
  assert.equal(oneEmojiAtMost('🙄 😏', HER_EMOJI), '🙄 😏', 'never left with nothing');
});

