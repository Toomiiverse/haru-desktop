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

test('an emoji in three of her last four replies is named back to her, with the others offered', () => {
  const stuck = ['Fine. 🙄', 'Whatever. 🙄', 'Go on then.', 'Told you. 🙄'];
  const note = emojiRut(stuck);
  assert.match(note, /You have put 🙄 in 3 of your last 4 replies/);
  assert.match(note, /Do not use 🙄 in this reply at all/);
  assert.doesNotMatch(note.split('use one of')[1] ?? '', /🙄/, 'the others are offered, not the one she is stuck on');
  assert.equal(emojiRut(['Fine. 🙄', 'Sure.', 'Right. 😏', 'Hm. 👀']), '', 'no habit, nothing said');
  assert.equal(emojiRut(['Fine. 🙄', 'Yes. 🙄']), '', 'too few replies to call it a habit');
});

test('a tic that skips every other reply is still a tic, and four replies was too short a memory to see it', () => {
  // Exactly what she did: 😒, nothing, 😒, nothing, 😒 — never three in four,
  // and so never once named back to her across a whole afternoon.
  const alternating = ['Fine. 😒', 'Sure.', 'Right. 😒', 'Go on.', 'Told you. 😒', 'Hm.'];
  assert.equal(emojiRut(alternating.slice(-4)), '', 'the old window saw nothing wrong with it');
  assert.match(emojiRut(alternating), /You have put 😒 in 3 of your last 6 replies/);
  assert.match(emojiRut(alternating), /Do not use 😒 in this reply at all/);
  assert.equal(emojiRut(['a 😒', 'b', 'c', 'd 😒', 'e', 'f']), '', 'twice in six is use, not habit');
});

test('she is told not to reach for one she has used lately, not merely the one she used last', () => {
  assert.match(LAST_WORD, /not one you have used in your last few replies/);
  assert.doesNotMatch(LAST_WORD, /not the one you used last time/, 'a one-reply memory is what she alternated against');
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

test('the backstop also catches the one she reaches for every other reply', () => {
  const alternating = ['Fine. 😒', 'Sure.', 'Right. 😒', 'Go on.'];
  assert.equal(dropOverusedEmoji('Told you. 😒', alternating, HER_EMOJI), 'Told you.', 'twice in the last four is enough');
  assert.equal(dropOverusedEmoji('Told you. 😏', alternating, HER_EMOJI), 'Told you. 😏', 'one she has not worn out is hers');
  assert.equal(dropOverusedEmoji('Told you. 😒', ['a 😒', 'b', 'c', 'd'], HER_EMOJI), 'Told you. 😒', 'once in four is not a habit');
  assert.equal(dropOverusedEmoji('😒', alternating, HER_EMOJI), '😒', 'never left with nothing, however worn out');
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
  const withEmoji = "It's brutal and quiet.\n\nNow stop asking me and go to sleep. You have a website to build tomorrow. 😤";
  assert.match(dropClosingOrder(withEmoji), /It's brutal and quiet\./);
  assert.doesNotMatch(dropClosingOrder(withEmoji), /website|go to sleep/, 'a trailing emoji must not shield the order in front of it');
  assert.equal(dropClosingOrder('Reze is better written. 😏'), 'Reze is better written. 😏', 'and her emoji survives when there is no order');
  const curly = "It's the only real moment.\n\nNow stop asking me and go to sleep. You\u2019re tired, you\u2019re scrolling, and you have work tomorrow. 😒";
  assert.match(dropClosingOrder(curly), /the only real moment/);
  assert.doesNotMatch(dropClosingOrder(curly), /tired|go to sleep/, 'a typographic apostrophe is still an apostrophe');
  const threat = "That's real character growth. Not your press X to cry nonsense.\n\nNow go to bed. You\u2019re tired, and you have a website to build tomorrow. Don\u2019t make me come over there and unplug your router.";
  assert.match(dropClosingOrder(threat), /real character growth/);
  assert.doesNotMatch(dropClosingOrder(threat), /router|go to bed/, 'a closing paragraph that is nothing but him goes whole');
  const mixed = "Himeno's final stand. She burns out to give Denji a chance.\n\nDetroit? Everyone gets a hug and a monologue. Boring.";
  assert.equal(dropClosingOrder(mixed), mixed, 'a closing paragraph still about her subject stays');
});

test('when they name her thing themselves she takes the room without a roll, and sooner', () => {
  const flat = { energy: 0.2, curiosity: 0.2, irritation: 0, ego: 0, subject: 'Chainsaw Man', sinceLastMs: null, roll: 0.99, latest: 'I watched some Chainsaw Man earlier' };
  assert.equal(roomToRant(flat), '', 'a bad roll and nothing in her: no room');
  assert.match(roomToRant({ ...flat, mentioned: true }), /You have been on Chainsaw Man/, 'they brought it up, so the roll does not decide');
  assert.equal(roomToRant({ ...flat, mentioned: true, sinceLastMs: MENTION_COOLDOWN_MS - 1 }), '', 'not twice in a quarter of an hour');
  assert.match(roomToRant({ ...flat, mentioned: true, sinceLastMs: MENTION_COOLDOWN_MS + 1 }), /Chainsaw Man/, 'and free again after');
  assert.equal(roomToRant({ ...flat, sinceLastMs: RANT_COOLDOWN_MS - 1, roll: 0.01, energy: 0.9, curiosity: 0.9 }), '', 'unmentioned still waits the full ninety minutes');
});


test('"just wanted to talk to you" is taken at face value, not seen through', () => {
  for (const said of ['Nothing - just wanting to talk to you', 'nothing much, i just wanted to chat', 'just checking in', 'I only wanted to talk to you', 'missed you', 'no reason, just felt like talking']) {
    assert.ok(justTalking(said), said);
  }
  for (const said of ['I just want to finish this build', 'talk to the customer for me', 'just wanting the 9060 xt', 'nothing']) {
    assert.ok(!justTalking(said), said);
  }
  assert.match(JUST_TALKING_NOTE, /not an excuse/);
  assert.match(JUST_TALKING_NOTE, /Do not ask what they really want/);
  assert.match(JUST_TALKING_NOTE, /do not put a clock on it/);
});

test('a reply about her cannot end by handing the subject back as a question', () => {
  const said = "It's fine. 😒 Part 2's got better art but the plot's meandering. Denji's still a mess, and that's the point, but the pacing's been killing me. You're not actually interested—you're just avoiding the mop. So out with it. What do you actually want?";
  const out = dropClosingOrder(said);
  assert.match(out, /pacing's been killing me\.$/);
  assert.doesNotMatch(out, /out with it|actually want|avoiding the mop/);
  assert.equal(dropClosingOrder('Reze is the better written one. What did you make of her?'), 'Reze is the better written one. What did you make of her?', 'asking what they thought of it is the subject, not a pivot');
  assert.equal(dropClosingOrder("We're going in circles. I answered that. If you want to talk, say something new. Otherwise go finish cleaning."), "We're going in circles. I answered that. If you want to talk, say something new.", '"otherwise go finish" is an order');
  assert.match(herSubjectNote('Chainsaw Man'), /^They are asking you about Chainsaw Man — about you, not about them\. First and most of all: this reply ends on the subject/);
  assert.match(herSubjectNote('Chainsaw Man'), /not one order, not even at the end/i);
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
