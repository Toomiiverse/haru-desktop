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
import {
  claimsDesktopAction, claimsTickOff, dropInventedContact, dropInventedScreenTalk,
  dropRepeatedAgendaMentions, dropRepeatedParagraphs, dropRoleHeader,
  dropStageDirections, dropTackedOnParagraphs,
} from '../electron/reply';

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
