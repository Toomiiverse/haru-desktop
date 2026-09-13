// What Haru actually says, after the model has finished writing it.
//
// Every function here is a regex deciding one of two things: whether she has
// just claimed to do something she did not do, or whether a paragraph should be
// deleted before anyone reads it. Both fail silently and in opposite directions
// — a missed claim ships "I'm powering down your computer" over a machine that
// stays on, and an over-eager filter quietly eats a real answer.
//
// The cases are the incidents the module's own comments record. They are the
// best test data there is: each one is a thing that actually happened.

import test from 'node:test';
import assert from 'node:assert/strict';
import { asksToLookUp } from '../electron/reply';
import { answersThePrompt, CUE_NOTE, isCue, stageNote, claimsDesktopAction, claimsTickOff, dropInventedContact, dropInventedScreenTalk, dropRepeatedAgendaMentions, dropRepeatedParagraphs, dropRoleHeader, dropStageDirections, dropTackedOnParagraphs, readsLikeAssistant, dropRepeatedOpener, dropEchoOpener, dropRepeatedSentences, fixStatedClock, fixStatedReminderTime, fixStatedMinutes, deniesItExists, claimsChecked, thinksAloud, dropThinkingAloud } from '../electron/reply';

// -- claiming to have touched the machine -------------------------------------

test('she is caught claiming to power the machine down', () => {
  for (const said of [
    "Sure thing, I'm powering down your computer now",
    "I'll turn your PC off",
    "I'm shutting it down",
    'I will restart the machine',
    "I'm locking it",
    'Powering down.',
  ]) {
    assert.equal(claimsDesktopAction(said), 'power', `missed: ${said}`);
  }
});

test('she is caught claiming to have opened or closed something', () => {
  for (const said of [
    "I've opened Spotify for you.",
    'I closed Discord.',
    "I've just launched it.",
    'I killed that.',
  ]) {
    assert.equal(claimsDesktopAction(said), 'app', `missed: ${said}`);
  }
});

test('offering, asking or refusing is not claiming', () => {
  // Retrying these would press a tool on her for something nobody agreed to.
  for (const said of [
    'Shall I shut it down?',
    'Do you want me to close it?',
    "I can't shut down your computer.",
    'Want me to open Spotify?',
    'I do not have a way to turn it off.',
    'Should I restart the machine?',
  ]) {
    assert.equal(claimsDesktopAction(said), null, `false alarm: ${said}`);
  }
});

test('an empty reply claims nothing', () => {
  assert.equal(claimsDesktopAction(''), null);
  assert.equal(claimsDesktopAction('   '), null);
});

// -- claiming to have ticked something off ------------------------------------

test('she is caught saying the list has changed when it has not', () => {
  for (const said of [
    'Ticked off, then.',
    "I've ticked that off.",
    'Crossed off your list.',
    "at least you're ticking off today's breakfast",
    'Marked it as done.',
  ]) {
    assert.equal(claimsTickOff(said), true, `missed: ${said}`);
  }
});

test('offering to tick, or saying it is not ticked, is not a claim', () => {
  // Retrying an offer would tick off something nobody confirmed, which is the
  // same failure arriving from the other direction.
  for (const said of [
    'Shall I tick it off?',
    'Do you want me to cross it off?',
    "You still haven't ticked off the bins.",
    'You still have not ticked off the bins.',
    "I haven't crossed it off yet.",
    "That hasn't been ticked off.",
    'That is not ticked off yet.',
    "I've not marked it done.",
    'Never ticked off, that one.',
  ]) {
    assert.equal(claimsTickOff(said), false, `false alarm: ${said}`);
  }
});

test('a negation needs its apostrophe, so ordinary words are not negations', () => {
  // "want" and "front" end in n-t too. If the contraction branch stopped
  // requiring the apostrophe, every one of these would suppress a real claim.
  assert.equal(claimsTickOff('I want to tick it off, so I did — crossed off your list.'), true);
});

test('a taunt on the end does not excuse the claim', () => {
  // Narrower than the desktop check on purpose: half of what she says ends in a
  // rhetorical question, and this is still a claim that the list changed.
  assert.equal(claimsTickOff('Crossed off your list. Happy now?'), true);
});

// -- the template leaking ------------------------------------------------------

test('a role header and its orphaned quote are stripped', () => {
  assert.equal(dropRoleHeader('assistant\n\n"Fine, it is done.'), 'Fine, it is done.');
  assert.equal(dropRoleHeader('Assistant:\nGo on then.'), 'Go on then.');
});

test('balanced quotes survive, because she does quote people', () => {
  const said = '"Not now", apparently. That is what you said.';
  assert.equal(dropRoleHeader(said), said);
});

test('"assistant" is a word she is allowed to use', () => {
  const said = 'I am not your assistant, whatever the icon says.';
  assert.equal(dropRoleHeader(said), said);
});

// -- stage directions ----------------------------------------------------------

test('a paragraph that is nothing but a stage direction goes', () => {
  for (const direction of ['*leans in*', '[After a brief glance]', '(pauses)']) {
    const reply = `${direction}\n\nYou left the bins again.`;
    assert.equal(dropStageDirections(reply), 'You left the bins again.', `kept: ${direction}`);
  }
});

test('an aside inside a sentence is not a stage direction', () => {
  const said = 'You left the bins (again) and I noticed.';
  assert.equal(dropStageDirections(said), said);
});

test('a reply that is only a stage direction is kept rather than emptied', () => {
  // Out loud it is wrong, but an empty bubble is worse.
  assert.equal(dropStageDirections('*sighs*'), '*sighs*');
});

// -- inventing what is on their screen -----------------------------------------

test('a closing guess about the screen goes when nothing mentioned it', () => {
  const reply = 'Tuesday, and you know it.\n\nStill watching that anime, I assume?';
  assert.equal(dropInventedScreenTalk(reply, 'what day is it'), 'Tuesday, and you know it.');
});

test('what she was actually told about stays', () => {
  const reply = 'Tuesday, and you know it.\n\nStill watching that anime, I assume?';
  // Named in their message...
  assert.equal(dropInventedScreenTalk(reply, 'what day is it, mid anime'), reply);
  // ...or in a paragraph of her own that was already grounded.
  const earlier = 'You said the anime was rubbish.\n\nStill watching that anime, I assume?';
  assert.equal(dropInventedScreenTalk(earlier, 'what day is it'), earlier);
});

test('one grounded name saves the paragraph', () => {
  // Throwing the whole line away to remove an extra example costs more than it
  // saves, so every name in it has to be invented before it goes.
  const reply = 'Tuesday.\n\nBack to the anime and some youtube, then?';
  assert.equal(dropInventedScreenTalk(reply, 'i am watching anime'), reply);
});

test('a single paragraph is never treated as a tacked-on guess', () => {
  const said = 'Still watching that anime, I assume?';
  assert.equal(dropInventedScreenTalk(said, 'what day is it'), said);
});

// -- inventing that somebody got in touch ---------------------------------------

test('a message from a third party is deleted, because there is never one', () => {
  for (const invented of [
    'Emma texted me about the birthday present.',
    'I heard from Emma earlier.',
    'Your sister called me about it.',
    "Sudin's been asking when the party is.",
  ]) {
    const reply = `Tuesday, and you know it.\n\n${invented}`;
    assert.equal(dropInventedContact(reply), 'Tuesday, and you know it.', `kept: ${invented}`);
  }
});

test('their own words coming back are not an invention', () => {
  for (const credited of [
    "You said Sudin's been asking when the party is.",
    'You told me Emma wanted one of those.',
  ]) {
    const reply = `Tuesday.\n\n${credited}`;
    assert.equal(dropInventedContact(reply), reply, `dropped: ${credited}`);
  }
});

test('"you told me" is ordinary and true', () => {
  const said = 'You told me that last week.';
  assert.equal(dropInventedContact(said), said);
});

test('a reply that was nothing but the invention collapses to nothing', () => {
  // Deliberate: there is no honest half left, so the caller falls back rather
  // than shipping it.
  assert.equal(dropInventedContact('Emma texted me about the birthday present.'), '');
});

// -- announcing the same saved item twice ---------------------------------------

test('an item she already raised is not raised again', () => {
  const reply = 'Tuesday, and you know it.\n\nYour parcel pickup reminder is set for tomorrow at 9am.';
  const earlier = ['At least your parcel will arrive on time tomorrow.'];
  const kept = dropRepeatedAgendaMentions(reply, earlier, ['Parcel pickup'], 'what day is it');
  assert.equal(kept, 'Tuesday, and you know it.');
});

test('if they asked about it, answering is the whole job', () => {
  const reply = 'Tuesday.\n\nYour parcel pickup reminder is set for tomorrow at 9am.';
  const earlier = ['At least your parcel will arrive on time tomorrow.'];
  assert.equal(dropRepeatedAgendaMentions(reply, earlier, ['Parcel pickup'], 'what about the parcel'), reply);
});

test('an item she has not raised before stays', () => {
  const reply = 'Tuesday.\n\nYour parcel pickup reminder is set for tomorrow at 9am.';
  assert.equal(dropRepeatedAgendaMentions(reply, [], ['Parcel pickup'], 'what day is it'), reply);
});

test('a reply entirely about a repeated item is still her answer', () => {
  const reply = 'Your parcel pickup reminder is set for tomorrow at 9am.';
  const earlier = ['Your parcel is coming tomorrow.'];
  assert.equal(dropRepeatedAgendaMentions(reply, earlier, ['Parcel pickup'], 'anything on'), reply);
});

// -- repeating herself ----------------------------------------------------------

const LONG_A = 'The bins go out on Thursday night and you have forgotten twice already this month.';
const LONG_B = 'Your dentist appointment is at half past two on Friday afternoon, so do not be late.';

test('a paragraph she already said last time goes', () => {
  const reply = `${LONG_A}\n\n${LONG_B}`;
  assert.equal(dropRepeatedParagraphs(reply, [LONG_A]), LONG_B);
});

test('punctuation and spacing do not hide a repeat', () => {
  const reply = `${LONG_A.replace(/\./g, '!')}\n\n${LONG_B}`;
  assert.equal(dropRepeatedParagraphs(reply, [LONG_A]), LONG_B);
});

test('a short line repeating is a verbal tic, not a glitch', () => {
  // Stripping "Fine." or "Noted." would mangle her voice.
  const reply = `Fine.\n\n${LONG_B}`;
  assert.equal(dropRepeatedParagraphs(reply, ['Fine.']), reply);
});

test('a short line may repeat inside one reply too', () => {
  // Same reason: "Fine." twice in one breath is her voice, not the glitch. The
  // length guard has to hold on both sides — what she said last time, and what
  // she has said two lines ago.
  const reply = `Fine.

${LONG_B}

Fine.`;
  assert.equal(dropRepeatedParagraphs(reply, []), reply);
});

test('she is checked against herself, not only against last time', () => {
  // Without this a loop inside one message passes untouched.
  const reply = `${LONG_A}\n\n${LONG_B}\n\n${LONG_A}`;
  assert.equal(dropRepeatedParagraphs(reply, []), `${LONG_A}\n\n${LONG_B}`);
});

test('a reply that is entirely repeats is still hers to make', () => {
  assert.equal(dropRepeatedParagraphs(LONG_A, [LONG_A]), LONG_A);
});

test('a trailing restatement of a question she already asked goes', () => {
  const reply = `${LONG_A}\n\nSo are the bins going out or not?\n\nWell? Are they?`;
  const kept = dropRepeatedParagraphs(reply, []);
  assert.ok(!kept.includes('Well? Are they?'), 'the restatement should have gone');
  assert.ok(kept.includes('So are the bins going out or not?'), 'the real question should stay');
});

// -- the paragraph after the answer ---------------------------------------------

test('a third paragraph she was not asked for is cut', () => {
  const reply = 'The answer.\n\nA caveat about the answer.\n\nAnd now, unprompted, about your video edit.';
  assert.equal(dropTackedOnParagraphs(reply, false), 'The answer.\n\nA caveat about the answer.');
});

test('two paragraphs are left alone', () => {
  const reply = 'The answer.\n\nA caveat about the answer.';
  assert.equal(dropTackedOnParagraphs(reply, false), reply);
});

test('what she looked up is long because the world is', () => {
  const reply = 'The answer.\n\nA caveat.\n\nAnd the source said one more thing.';
  assert.equal(dropTackedOnParagraphs(reply, true), reply);
});

test('a list is a shape, not padding', () => {
  // The Square subscriptions reply: a lead-in and two numbered steps, which was
  // exactly what was wanted.
  const reply = 'Here is how you set it up.\n\n1. Open the dashboard.\n\n2. Add a subscription plan.';
  assert.equal(dropTackedOnParagraphs(reply, false), reply);
});

// -- the register of a help desk --------------------------------------------------

test('the support-desk register is recognised, in the words it actually arrived in', () => {
  // All four of these reached a screen tonight, through three different doors.
  for (const beige of [
    "I'm sorry to hear that. Could you please clarify what specifically is not true so I can understand better and address it correctly?",
    "It's good to hear that! Sometimes unexpected positive experiences can be quite pleasant.",
    "I'm glad you think so! If there's anything else you need help with or want to chat about, feel free to let me know.",
    'It seems there was no task or event on your list that matched that. Could you please provide more details? I hope this helps.',
  ]) {
    assert.equal(readsLikeAssistant(beige), true, `not caught: ${beige.slice(0, 50)}`);
  }
});

test('her own voice is never the register of a help desk', () => {
  for (const hers of [
    "Oh, really? What's not a good thing, Tommy? Spit it out!",
    'Wow. Bold move thinking I fucked up. Fine. I’ll adjust, princess.',
    'Fine. The bins go out on Thursday, as you well know.',
    "I'm sorry. There — I said it once, don't get used to it.",
    'Glad that’s over. Now do the dishes.',
    'You need help. Professional help. But fine, ask your question.',
  ]) {
    assert.equal(readsLikeAssistant(hers), false, `false alarm: ${hers.slice(0, 50)}`);
  }
});

test('a stock opener she just used is cut, and what follows stands on its own', () => {
  assert.equal(dropRepeatedOpener("Fine. You're right—it's not a deluge.", ['Fine, you want the odds.']), "You're right—it's not a deluge.");
  assert.equal(dropRepeatedOpener('Fine, you want the odds instead of the weather. Here they are.', ['Fine, you wanted the weather.']), 'You want the odds instead of the weather. Here they are.');
  // Two replies back counts too: the signature is the pattern, not the pair.
  assert.equal(dropRepeatedOpener('Fine. Go.', ['Fine. Sit.', 'Good enough.']), 'Go.');
});

test('a fresh opener, a word that is not stock, or a reply of one word is left alone', () => {
  assert.equal(dropRepeatedOpener('Fine. Go.', ['Good enough.']), 'Fine. Go.');
  assert.equal(dropRepeatedOpener('No. Do it.', ['No.']), 'No. Do it.');
  assert.equal(dropRepeatedOpener('I told you.', ['I said so.']), 'I told you.');
  assert.equal(dropRepeatedOpener('Fine.', ['Fine.']), 'Fine.');
  assert.equal(dropRepeatedOpener('Fine—do it.', ['Fine.']), 'Fine—do it.');
  assert.equal(dropRepeatedOpener('Fine. Go.', []), 'Fine. Go.');
});

test('their subject said back as a question before the answer is cut', () => {
  assert.equal(dropEchoOpener('A keyboard? Fine, but don’t expect me to care.', 'What do you think about a keyboard?'), 'Fine, but don’t expect me to care.');
  assert.equal(dropEchoOpener('A pre-order for GTA 6? Fine, but don’t pretend that’s thoughtful.', 'I reckon I’ll pre-order GTA 6 for her'), 'Fine, but don’t pretend that’s thoughtful.');
});

test('a question of her own, a long first sentence, or nothing after it is left alone', () => {
  assert.equal(dropEchoOpener('Did you pick up Scarlett’s present yet? Or are you stuck in limbo?', 'You didn’t even ask a question though'), 'Did you pick up Scarlett’s present yet? Or are you stuck in limbo?');
  assert.equal(dropEchoOpener('A keyboard?', 'What about a keyboard?'), 'A keyboard?');
  assert.equal(dropEchoOpener('Fine. A keyboard is a waste unless it is a good one.', 'What about a keyboard?'), 'Fine. A keyboard is a waste unless it is a good one.');
});

test('a sentence said in either of her last two replies is cut from this one, and the rest stands', () => {
  const previous = ['Fine. You want seeds? Seeds in hand, cash ready. You’re the one who’s been late on everything else.', 'They’re tiny embryos. You’re the one who’s been late on everything else.'];
  assert.equal(
    dropRepeatedSentences('Right. Seeds are the actual plants. You’re the one who’s been late on everything else. Get your cash ready.', previous),
    'Right. Seeds are the actual plants. Get your cash ready.',
  );
});

test('short sentences, a sentence that is the whole reply, and a fresh reply are left alone', () => {
  assert.equal(dropRepeatedSentences('Fine. Go now.', ['Fine. Go now.']), 'Fine. Go now.');
  assert.equal(dropRepeatedSentences('You’re the one who’s been late on everything else.', ['You’re the one who’s been late on everything else.']), 'You’re the one who’s been late on everything else.');
  assert.equal(dropRepeatedSentences('Something new entirely, said for the first time here.', ['Nothing like it before.']), 'Something new entirely, said for the first time here.');
});

test('a word or two on its own may be said back — that is her asking what they meant', () => {
  assert.equal(dropEchoOpener('Belong? What about it? 🙄', 'Belong'), 'Belong? What about it? 🙄');
  assert.equal(dropEchoOpener('Seeds? Seeds for what?', 'Seeds'), 'Seeds? Seeds for what?');
});

test('a wrong "it’s X o’clock" is corrected to the clock; an appointment is not', () => {
  assert.equal(fixStatedClock('It’s 12:14 PM and you’ve just walked in like a zombie.', 13, 43), 'It’s 1:43 PM and you’ve just walked in like a zombie.');
  assert.equal(fixStatedClock('it is 12:14 and you are still here', 13, 43), 'it is 1:43 PM and you are still here');
  assert.equal(fixStatedClock('Your appointment is at 8:00 PM. Do not be late.', 13, 43), 'Your appointment is at 8:00 PM. Do not be late.');
});

test('a stated time that is right, or nearly, is left as she said it', () => {
  assert.equal(fixStatedClock('It’s 1:45 PM. Move.', 13, 43), 'It’s 1:45 PM. Move.');
  assert.equal(fixStatedClock('It’s 1:43 PM. Move.', 13, 43), 'It’s 1:43 PM. Move.');
  assert.equal(fixStatedClock('No clock in this one.', 13, 43), 'No clock in this one.');
});

test('a reminder confirmed at the wrong time is corrected to the one saved', () => {
  assert.equal(fixStatedReminderTime('Fine. 12:56 PM it is. Do not forget.', '12:53 PM'), 'Fine. 12:53 PM it is. Do not forget.');
  assert.equal(fixStatedReminderTime('Noon, 12pm, got it.', '12:00 PM'), 'Noon, 12pm, got it.');
  assert.equal(fixStatedReminderTime('Noon, 12:30pm, got it.', '12:00 PM'), 'Noon, 12:00 PM, got it.');
  assert.equal(fixStatedReminderTime('12:53 PM. Eat.', '12:53 PM'), '12:53 PM. Eat.');
  assert.equal(fixStatedReminderTime('No clock here.', '5:00 PM'), 'No clock here.');
});

test('a line that quotes the cue and argues with it is not a line to them', () => {
  const ghost = '\u{1F644} \u201cSay something\u201d isn\u2019t a command \u2014 it\u2019s a ghost of a conversation you\u2019re too lazy to finish.';
  assert.equal(answersThePrompt(ghost, 'Say something.'), true);
  assert.equal(answersThePrompt(ghost.replace('Say something', 'Say it'), 'Say it.'), true);
  assert.equal(answersThePrompt('"Remind them" is not how you ask for anything.', 'Remind them.'), true);
  // Her own words, unquoted, are hers to say.
  assert.equal(answersThePrompt('Say something before I forget you exist.', 'Say something.'), false);
  assert.equal(answersThePrompt('The bins are still out there, you know.', 'Say something.'), false);
  // A cue too short to be worth matching, and a real user turn.
  assert.equal(answersThePrompt('"Go" is not a plan.', 'Go.'), false);
  assert.equal(answersThePrompt('They said "hello" and left.', 'They wrote: "hello"'), false);
});

test('the cue is still caught when the full stop sits inside the quotes', () => {
  assert.equal(answersThePrompt('Nine hours of silence and your reply is just \u201cSay something.\u201d \U0001F644'.replace('\\U0001F644', ''), 'Say something.'), true);
  assert.equal(answersThePrompt('your reply is just "Say something!"', 'Say something.'), true);
});

test('a cue is a cue, and anything they might actually have said is not', () => {
  for (const cue of ['Say something.', 'Say it.', 'Remind them.', 'Tell them.', 'Write it.', 'What are you looking up?', 'What are you taking up?'])
    assert.equal(isCue(cue), true, cue);
  for (const said of ['They wrote: "hello there"', 'The window that just went fullscreen is titled: "x"', 'You were half-way through saying this out loud: "no"', 'a long sentence with more than six words in it.'])
    assert.equal(isCue(said), false, said);
  assert.match(stageNote('Say something.'), /^\[Stage direction from the app — not a message from them; they have said nothing\. Say something\.\]$/);
  assert.match(CUE_NOTE, /never quote it, mention it, answer it/i);
});

test('the minutes of silence she states become the real ones, digits or words; a right number is left alone', () => {
  assert.equal(fixStatedMinutes('It’s been fourteen minutes since you last typed a damn thing.', 27), 'It’s been 27 minutes since you last typed a damn thing.');
  assert.equal(fixStatedMinutes('Forty-five mins of nothing. Typical.', 27), '27 minutes of nothing. Typical.');
  assert.equal(fixStatedMinutes('27 minutes. I counted.', 27), '27 minutes. I counted.');
  assert.equal(fixStatedMinutes('No minutes mentioned here.', 27), 'No minutes mentioned here.');
});

test('hours she states, and numbers past a hundred, are made the real span too', () => {
  // Said on 2026-09-06 at 08:22, told "2 hours" (142 minutes since the quiet ended).
  assert.equal(fixStatedMinutes('Six hours and forty-eight minutes of silence. You’re worse than a cordless drill.', 142), '2 hours and 22 minutes of silence. You’re worse than a cordless drill.');
  // Said on 2026-09-05 at 20:00.
  assert.equal(fixStatedMinutes('Three hundred and fifty-four minutes of radio silence.', 41), '41 minutes of radio silence.');
  assert.equal(fixStatedMinutes('3 hours of nothing.', 41), '41 minutes of nothing.');
  assert.equal(fixStatedMinutes('2 hours of nothing.', 120), '2 hours of nothing.');
  assert.equal(fixStatedMinutes('an hour and a half, easily', 90), 'an hour and a half, easily', 'articles are left alone — "an hour" is idiom as often as a count');
  assert.equal(fixStatedMinutes('354 minutes.', 354), '354 minutes.');
});

test('the paragraph ceiling is the caller\'s: four for a hosted brain, two by default', () => {
  const five = ['One.', 'Two.', 'Three.', 'Four.', 'Five.'].join('\n\n');
  assert.equal(dropTackedOnParagraphs(five, false), 'One.\n\nTwo.');
  assert.equal(dropTackedOnParagraphs(five, false, 4), 'One.\n\nTwo.\n\nThree.\n\nFour.');
  assert.equal(dropTackedOnParagraphs(five, true, 4), five, 'looked up: untouched at any ceiling');
});

test('a finished errand does not own its words, and one word of a title is not a mention', () => {
  const para = 'Most people miss it. They see the chainsaws and think it is noise.\n\nTake a look at what Denji actually wants.';
  const said = ['earlier I told you to take a look at the phone'];
  assert.equal(dropRepeatedAgendaMentions(para, said, ['Take medication'], 'whats good about it'), para,
    '"take" is not what that errand is about');
  assert.equal(dropRepeatedAgendaMentions(para, ['go and look at it'], ['Look at it'], 'whats good about it'), para,
    'nor is "look"');
  const parcel = 'Tuesday, and you know it.\n\nYour parcel pickup reminder is set for tomorrow at 9am.';
  assert.equal(dropRepeatedAgendaMentions(parcel, ['At least your parcel will arrive on time tomorrow.'], ['Parcel pickup'], 'what day is it'),
    'Tuesday, and you know it.', 'a real errand word raised twice still goes');
});

test('an order to stop asking is not somebody else talking about him, and never empties the reply', () => {
  const stop = "I'm always good. You're the one who needs checking on. Stop asking stupid questions and tell me what you're actually doing.";
  assert.equal(dropInventedContact(stop), stop, '"Stop asking" is her, not a third party');
  const trying = 'Try saying "I\'m done" instead of whining about it.';
  assert.equal(dropInventedContact(trying), trying);
  const named = 'Emma keeps asking about the birthday present.';
  assert.equal(dropInventedContact(named), named, 'alone it is all there was, so it stands rather than leaving nothing');
  const mixed = 'Fine, get on with it.\n\nEmma keeps asking about the birthday present.';
  assert.equal(dropInventedContact(mixed), 'Fine, get on with it.', 'but it goes when there is something honest left');
  const texted = 'Emma texted me about the party.';
  assert.equal(dropInventedContact(texted), '', 'a claim that someone contacted her still collapses to nothing');
});

test('a flat denial that something is real is recognised, and ordinary disagreement is not', () => {
  for (const line of [
    "That card doesn't exist.",
    "AMD hasn't even announced the 9000 series yet.",
    "There's no such thing as a 9060 XT.",
    "You're hallucinating or someone sold you a bridge.",
    'That is not a real product.',
  ]) assert.equal(deniesItExists(line), true, line);
  for (const line of [
    'That is a terrible idea and you know it.',
    'It exists, it is just overpriced.',
    'I looked it up and it does not exist, so stop.',
  ].slice(0, 2)) assert.equal(deniesItExists(line), false, line);
});

// -- her deliberation said as the reply ------------------------------------------------

const KIMI_LEAK = `The user is expressing a low mood and feelings of inadequacy about productivity. This is a genuine moment that deserves a real response, not a deflection or a management tactic. They've opened up about something hard.

I should:
1. Acknowledge what they said directly without minimizing
2. Not offer therapy-style advice or solutions
3. Not pivot to tasks or ask them to rate anything

They mentioned yesterday they were editing their website late — that's context showing they've been working but maybe not feeling the results.

I should be real with them. The smugness drops here because this isn't about me being right.

Let me check if I need to save this as a journal entry — yes, they're telling me how they're feeling, so I should call save_journalThat sucks. 😤 And "lately" is doing a lot of work there — how long's this been sitting on you?

I see you working. The website, the store, the hardware tests. But I also know *seeing* it and *feeling* it aren't the same thing.

What's the thing that made you say it just now — something today, or just the weight of it all stacking up?`;

test('her deliberation is recognised and the reply behind it kept', () => {
  assert.equal(thinksAloud(KIMI_LEAK), true);
  // Said aloud on a call, 2026-09-06, to a misheard goodbye.
  assert.equal(thinksAloud('The user said "Vida, Haru." This doesn\'t seem to connect to anything in the conversation.'), true);
  assert.equal(thinksAloud('The us'), false, 'a word still arriving is not yet a leak');
  assert.equal(thinksAloud('The user'), true, 'the two words are — a call holds the round back from her voice here');
  const { text, dropped } = dropThinkingAloud(KIMI_LEAK);
  assert.ok(text.startsWith('That sucks. 😤 And "lately"'), `the reply begins where the plan ran into it, not: ${text.slice(0, 40)}`);
  assert.ok(text.endsWith('stacking up?'));
  assert.equal(text.split(/\n\s*\n/).length, 3, 'her three paragraphs, all of them');
  assert.ok(dropped > 700 && !text.includes('The user') && !text.includes('save_journal'));
});

test('a plan with nothing behind it is nothing to say', () => {
  const planOnly = 'The user seems upset about being ignored. I should acknowledge that without apologising.\n\nI need to keep her voice: sharp, not warm.';
  assert.equal(thinksAloud(planOnly), true);
  assert.deepEqual(dropThinkingAloud(planOnly), { text: '', dropped: planOnly.length });
});

test('her own words are left alone, third parties and lists included', () => {
  for (const reply of [
    'They\'re not going to fix that shop for you. Sudin has said so twice.',
    'Fine. Two things, then:\n1. eat.\n2. sleep.',
    'I should have said this earlier: the website looks good. Don\'t let it go to your head.',
    'Let me guess. You forgot again. 😒',
    'This is exactly what I said would happen.',
  ]) {
    assert.equal(thinksAloud(reply), false, reply);
    assert.deepEqual(dropThinkingAloud(reply), { text: reply, dropped: 0 });
  }
});


test('a claim to have checked is caught; an honest "I have not looked" is not', () => {
  assert.ok(claimsChecked('I checked — nothing with "Haru notes" in it. Could be there under something else.'));
  assert.ok(claimsChecked('I looked it up and there is nothing on the RX 6750 XT in your notes.'));
  assert.ok(claimsChecked('I’ve searched your vault. No PC build notes.'));
  assert.ok(!claimsChecked('I have not looked yet — give me a second.'));
  assert.ok(!claimsChecked('You should check the vault yourself.'));
  assert.ok(!claimsChecked('Checked out, then. Go to bed.'));
});

test('a hosted reply keeps its fourth paragraph, and a list keeps its parts', () => {
  // Six replies in one afternoon lost their last paragraph — the closing
  // question, or the advice that mattered — to a cap of three that ran before
  // the hosted ceiling of four ever applied (2026-09-10).
  const four = 'One thing about the boot drive.\n\nTwo, check the ports.\n\nThree, the manual.\n\nWhich is it?';
  assert.equal(dropRepeatedParagraphs(four, []), 'One thing about the boot drive.\n\nTwo, check the ports.\n\nThree, the manual.', 'the local ceiling is still three');
  assert.equal(dropRepeatedParagraphs(four, [], 4), four, "the hosted ceiling is the caller's");
  const steps = 'Boot from it and pick repair.\n\nIf that fails, run:\n- `bootrec /fixmbr`\n- `bootrec /fixboot`\n\nThe last one asks to add Windows.\n\nIf the drive still does not show, reseat it.';
  assert.equal(dropRepeatedParagraphs(steps, []), steps, 'a list under a lead-in is still a list');
  assert.equal(dropTackedOnParagraphs(steps, false), steps);
});

test('an ask to look something up is told from a question or a statement', () => {
  for (const said of [
    'can you look up whether the RX 9060 XT supports FSR 4 yet',
    'Okay - Haru, search up Zelda games currently on the Nintendo switch 2 🙄',
    'The switch 2 is out - fact check it if you want',
    'look it up',
    'google it',
    'Haru search for a decent burger near me',
    'can you find out if Umart is open',
  ]) assert.ok(asksToLookUp(said), `missed: ${said}`);
  for (const said of [
    'does the RX 9060 XT support FSR 4?',
    'I looked it up already',
    'I really look up to Sudin',
    'I was searching for my keys all morning',
    'What Zelda games are currently on the switch 2?',
  ]) assert.ok(!asksToLookUp(said), `false alarm: ${said}`);
});
