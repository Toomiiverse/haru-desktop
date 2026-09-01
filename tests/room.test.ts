// Her emoji, and the one she cannot stop using.

import test from 'node:test';
import assert from 'node:assert/strict';
import { emojiRut, EXPRESSIVE, HER_EMOJI, LAST_WORD, NATURAL, roomToRant, RANT_COOLDOWN_MS, nothingInIt, askingAboutHer, herSubjectNote, namesIn } from '../electron/room';
import { dropOverusedEmoji, oneEmojiAtMost, dropClosingOrder } from '../electron/reply';

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

test('room to go on about something comes from her evening and her mood, not from the size of his message', () => {
  const wound = { energy: 0.9, curiosity: 0.8, irritation: 5, ego: 5, subject: 'Chainsaw Man', sinceLastMs: null, roll: 0.01 };
  const room = roomToRant(wound);
  assert.match(room, /You have been on Chainsaw Man, you have things to say about it/);
  assert.match(room, /the rule about matching the length of their message does not apply/);
  assert.match(room, /Several sentences at the least, more if you have it, however little they typed/);
  assert.match(room, /Do not apologise for the length, do not announce that you are about to go on/);
  assert.doesNotMatch(room, /bullet|summar/i, 'a rant is not a structured answer either');
  assert.equal(roomToRant({ ...wound, roll: 0.99 }), '', 'a chance, not a rule');
  assert.equal(roomToRant({ ...wound, sinceLastMs: RANT_COOLDOWN_MS - 1 }), '', 'not twice in ninety minutes');
  assert.equal(roomToRant({ ...wound, sinceLastMs: RANT_COOLDOWN_MS + 1, roll: 0.01 }), room, 'and free again after');
  const flat = { energy: 0.2, curiosity: 0.2, irritation: 0, ego: 0, sinceLastMs: null, roll: 0.2 };
  assert.equal(roomToRant(flat), '', 'nothing in her, nothing to say');
  assert.match(roomToRant({ ...flat, irritation: 6, roll: 0.01 }), /something you actually want to get off your chest/, 'fed up is its own reason, with no subject');
});

test('a plain greeting gets no five-line opinion about last night', () => {
  for (const line of ['Morning Haru', 'hey', 'yo', 'lol', 'ok', 'night', 'whats up', 'you there', 'sup!', 'Alright 🙄']) {
    assert.equal(nothingInIt(line), true, line);
  }
  for (const line of ['morning, what did you watch last night', 'ok so what do you reckon', 'hey can you remind me at 6', 'right, im off to work']) {
    assert.equal(nothingInIt(line), false, line);
  }
  const wound = { energy: 0.9, curiosity: 0.8, irritation: 5, ego: 5, subject: 'Chainsaw Man', sinceLastMs: null, roll: 0.01 };
  assert.equal(roomToRant({ ...wound, latest: 'Morning Haru' }), '', 'nothing in the message, nothing to launch at');
  assert.match(roomToRant({ ...wound, latest: 'morning, what did you get up to last night' }), /You have been on Chainsaw Man/);
  assert.match(roomToRant(wound), /You have been on Chainsaw Man/, 'no message given, unchanged');
});

test('a question about one of her things, or about what she makes of something, is about her', () => {
  const subjects = ['Chainsaw Man', 'Cyberpunk Edgerunners'];
  assert.equal(askingAboutHer('Oh the Reze arc? I think I finished Chainsaw Man awhile ago', subjects), 'Chainsaw Man');
  assert.equal(askingAboutHer('what part are you up to?', subjects), 'what you are into');
  assert.equal(askingAboutHer('what did you think of it', subjects), 'what you are into');
  assert.equal(askingAboutHer('have you seen the new one', subjects), 'what you are into');
  assert.equal(askingAboutHer('you there?', subjects), '', 'being available is his subject, not hers');
  assert.equal(askingAboutHer('remind me at 6', subjects), '');
  assert.equal(askingAboutHer('', subjects), '');
  const note = herSubjectNote('Chainsaw Man');
  assert.match(note, /Stay on it/);
  assert.match(note, /No telling them to go to bed/);
  assert.match(note, /not one order, not even at the end/);
  assert.match(note, /about you, not about them/);
});

test('the names inside her own notes count as her subject, and so does asking what is good about one', () => {
  const notes = ['Power. Obviously. Reze is the better written one though, and Denji never learns.'];
  const found = namesIn(notes);
  assert.ok(found.includes('Reze') && found.includes('Denji'), found.join(','));
  assert.ok(found.includes('Power'), 'a name that opens a sentence is still a name — Power is a character');
  assert.ok(!found.includes('Obviously') && !found.includes('This'), 'ordinary sentence openers are not names');
  assert.equal(askingAboutHer('so whats good about the Reze arc then', ['Chainsaw Man', ...found]), 'Reze');
  assert.equal(askingAboutHer("what's so good about it", ['Chainsaw Man']), 'what you are into');
  assert.equal(askingAboutHer('why do you rate it over Detroit', ['Chainsaw Man']), 'what you are into');
});

test('the order she signs a conversation about herself off with is cut, and the rest stands', () => {
  const said = "Himeno's final stand. She burns herself out to give Denji a chance.\n\nIt's brutal and quiet. Now stop asking me to explain art to you and go to sleep.";
  const out = dropClosingOrder(said);
  assert.match(out, /It's brutal and quiet\./);
  assert.doesNotMatch(out, /go to sleep/);
  assert.equal(dropClosingOrder('Go to bed.'), 'Go to bed.', 'never left with nothing');
  assert.equal(dropClosingOrder('Reze is better written. Denji never learns.'), 'Reze is better written. Denji never learns.', 'nothing to cut');
  assert.doesNotMatch(dropClosingOrder('One is a lecture, the other is a story.\n\nNow stop nitpicking and go to bed.'), /nitpicking/);
  assert.match(dropClosingOrder('One is a lecture, the other is a story.\n\nNow stop nitpicking and go to bed.'), /lecture/);
});

