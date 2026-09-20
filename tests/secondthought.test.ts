// The thing she says a minute later, and when she says nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { answersHerOwnQuestion, looksLikeAnEcho, parseSecondThought, readsAsTheirAnswer, secondThoughtDelay, secondThoughtNote, wantsSecondThought, SECOND_THOUGHT_MIN_MS, SECOND_THOUGHT_MAX_MS, addsNothing} from '../electron/secondthought';

test('their answer, written by her, is not a second thought', () => {
  // 2026-09-12: "done that already. cleared cmos, single stick tested…" went out as hers.
  assert.ok(readsAsTheirAnswer('done that already. cleared cmos, single stick tested, even swapped slots.'));
  assert.ok(readsAsTheirAnswer("I've cleared it twice and it still won't post"));
  assert.ok(readsAsTheirAnswer('Did that, still orange.'));
  assert.ok(!readsAsTheirAnswer('yeah. that.'), 'a bare yes is hers');
  assert.ok(!readsAsTheirAnswer("850W minimum, 1000W+ if you're not running it solo."));
  assert.ok(!readsAsTheirAnswer('I already told you: clear the CMOS first.'));
  assert.match(secondThoughtNote(60), /not yours to write/);
});

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

// ---- "nothing to add", said the long way round ----

test('the meta-remark she actually sent is treated as having nothing to add', () => {
  // 2026-09-08 04:50:24. Thirteen seconds later she answered "How to bios
  // flash" with a near-copy of it, because it was the last thing she had said.
  assert.equal(parseSecondThought("tch, okay so i already said this — but you're right to push on it. 🫡"), null);
  assert.equal(addsNothing("tch, okay so i already said this — but you're right to push on it. 🫡"), true);
});

test('other ways of saying nothing are caught too', () => {
  for (const said of [
    'Well, like I said. 🙄',
    "Fair enough, you're right.",
    'Actually — as I mentioned already.',
    'Good question. But still.',
  ]) assert.equal(parseSecondThought(said), null, `let through: ${said}`);
});

test('a meta-remark that carries a real point survives', () => {
  // The whole risk of this guard: the point often follows the throat-clearing.
  for (const said of [
    'Like I said, clear the CMOS first — do that before you touch anything else.',
    "hm, actually — wait. 15 to C5 to A6, and A6 is BIOS entry, so it is posting.",
    "850W minimum, 1000W+ if you're not running it solo. More if you overclock.",
    "You're right to push, but the stick is dead — swap it before you flash anything.",
  ]) assert.equal(parseSecondThought(said), said, `wrongly dropped: ${said}`);
});

test('her own question, answered in his voice a beat later, is not hers to send', () => {
  // 2026-09-16: she asked what he had eaten, then sent his answer — invented — as hers.
  const asked = 'You think? It\'s 8pm. That\'s not "beyond lunch," that\'s "you forgot to eat entirely." 💢\n\nWhat\'d you have, a coffee and a sense of accomplishment? Go feed yourself.';
  assert.ok(answersHerOwnQuestion('Fine, I had toast at 10am. But the day got away from me, alright? Emma wanted to walk the whole trail.', asked));
  assert.ok(answersHerOwnQuestion('We went to the blossoms and then stopped for coffee.', 'How was your day?'));
  assert.ok(answersHerOwnQuestion("Nah, I've been flat out at the shop.", 'Did you eat?'));
  assert.ok(!answersHerOwnQuestion('Also — the Reze arc still has the best ending in the whole thing.', asked), 'her own point is hers');
  assert.ok(!answersHerOwnQuestion('I had toast at 10am.', 'Go feed yourself.'), 'no question asked, nothing answered');
  assert.ok(!answersHerOwnQuestion('And eat something green for once.', asked));
});
