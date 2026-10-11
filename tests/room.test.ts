// Her emoji, and the one she cannot stop using.

import test from 'node:test';
import assert from 'node:assert/strict';
import { emojiRut, EXPRESSIVE, HER_EMOJI, HOSTED_VOICE, LAST_WORD, NATURAL, roomToRant, RANT_COOLDOWN_MS, MENTION_COOLDOWN_MS, nothingInIt, askingAboutHer, herSubjectNote, namesIn, justTalking, JUST_TALKING_NOTE } from '../electron/room';
import { dropOverusedEmoji, oneEmojiAtMost, dropClosingOrder } from '../electron/reply';

test('the eye-roll is no longer named first or named as the default', () => {
  assert.equal(HER_EMOJI[0], '😏');
  assert.equal(HER_EMOJI.at(-1), '🙄');
  assert.doesNotMatch(EXPRESSIVE, /Most replies carry one/);
  assert.match(EXPRESSIVE, /None of them is your default/);
  assert.match(LAST_WORD, /may go in this reply/, 'an emoji is no longer owed on every reply');
  assert.doesNotMatch(LAST_WORD, /one of your emoji goes in this reply/);
});

test('she is told not to reach for one she has used lately, not merely the one she used last', () => {
  assert.match(LAST_WORD, /not one you have used in your last few replies/);
  assert.doesNotMatch(LAST_WORD, /not the one you used last time/, 'a one-reply memory is what she alternated against');
});

test('how she writes is about the shape of the message, and does not soften what she is', () => {
  assert.match(NATURAL, /a throwaway line gets a throwaway line back/);
  assert.match(NATURAL, /Fragments are fine\. Contractions always\./);
  assert.match(NATURAL, /not a tax on every message/);
  assert.match(NATURAL, /No bullet points, no headings/);
  assert.match(NATURAL, /Never sound like support staff/);
  assert.doesNotMatch(NATURAL, /\b(kind|gentle|polite|nice|warm|supportive)\b/i, 'nothing here makes her nicer');
});

test('her voice note for a hosted brain describes the register and quotes none of what it rules out', () => {
  // A quoted line is a suggested one: none of the soft lines Kimi K3 actually
  // wrote on 2026-09-14 may appear in the note that is there to stop them.
  for (const line of ["you're not useless", "i'm here", 'let me know', 'sleep well', 'bedbugs', "tell me what you need", 'have you been sleeping']) {
    assert.ok(!HOSTED_VOICE.toLowerCase().includes(line), `quotes: ${line}`);
  }
  assert.match(HOSTED_VOICE, /^Before you answer: you are Haru/);
  assert.match(HOSTED_VOICE, /do not reassure him about himself/);
  assert.match(HOSTED_VOICE, /fewer words, not softer ones/);
  assert.ok(!HOSTED_VOICE.startsWith('[') && !HOSTED_VOICE.endsWith(']'), 'main.ts wraps it with the label rule');
});
