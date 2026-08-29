// The list, and whether she can tell what somebody just said about it.
//
// Two jobs. One is arithmetic — what has passed, what is happening now, how
// many days away a thing is — and it is here because she got it wrong out loud:
// handed "Rental Inspection (Thursday)" at 11pm on a Tuesday she said tomorrow,
// then Saturday, and had to be corrected twice.
//
// The other is reading a sentence for whether a task is finished, and every
// case below is one that actually went wrong: "I took my meds" against "Take
// medication", "I picked up Sam" wrongly closing the motherboard, "I paid the
// rent" wrongly closing a rental inspection, "did you eat?" wrongly closing
// lunch with Dad. Ticking off the wrong thing writes to their list, and not
// ticking off the right one has her chasing something already done.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chaseableOverdue,
  doneClause,
  findItem,
  formatAgenda,
  itemStatus,
  missedInstruction,
  putOffUntil,
  readsAsAnswerToHer,
  readsAsBareReport,
  readsAsDone,
  readsAsNotDone,
  whenMismatchInstruction,
  relativeDay,
  relevantItems,
  tickOffInstruction,
  type AgendaItem,
  CHASE_WINDOW_DAYS,
  staleItemNamed,
  inventedTimeFor,
  raisedRecently,
} from '../electron/agenda';

const TODAY = '2026-08-20';
const at = (hour: number, minute = 0) => new Date(2026, 7, 20, hour, minute);

function item(overrides: Partial<AgendaItem> & { title: string }): AgendaItem {
  return { date: TODAY, done: false, ...overrides };
}

// -- what has passed -----------------------------------------------------------

test('a finished item is done whatever the clock says', () => {
  assert.equal(itemStatus(item({ title: 'Bins', done: true, date: '2020-01-01' }), at(12), TODAY), 'done');
});

test('an all-day item today has not been missed until the day is over', () => {
  assert.equal(itemStatus(item({ title: 'Bins' }), at(23, 59), TODAY), 'upcoming');
});

test('a timed item is happening now for half an hour either side', () => {
  const dentist = item({ title: 'Dentist', time: '2:30 PM' });
  assert.equal(itemStatus(dentist, at(14, 0), TODAY), 'now');
  assert.equal(itemStatus(dentist, at(14, 30), TODAY), 'now');
  assert.equal(itemStatus(dentist, at(15, 0), TODAY), 'now');
  assert.equal(itemStatus(dentist, at(13, 59), TODAY), 'upcoming');
  assert.equal(itemStatus(dentist, at(15, 1), TODAY), 'overdue');
});

test('yesterday is overdue and tomorrow is upcoming', () => {
  assert.equal(itemStatus(item({ title: 'Bins', date: '2026-08-19' }), at(12), TODAY), 'overdue');
  assert.equal(itemStatus(item({ title: 'Bins', date: '2026-08-21' }), at(12), TODAY), 'upcoming');
});

test('a missed task does not vanish overnight, but an old one falls away', () => {
  const items = [
    item({ title: 'Recent miss', date: '2026-08-15' }),
    item({ title: 'Ancient miss', date: '2026-07-01' }),
    item({ title: 'Today' }),
  ];
  const kept = relevantItems(items, TODAY).map(entry => entry.title);
  assert.ok(kept.includes('Recent miss'), 'inside the week it is still worth chasing');
  assert.ok(!kept.includes('Ancient miss'));
  assert.ok(kept.includes('Today'));
});

test('a finished item is off the list entirely', () => {
  // Held for a couple of days once, and she opened on it 8 times out of 8.
  const items = [item({ title: 'Bins', done: true }), item({ title: 'Dentist' })];
  assert.deepEqual(relevantItems(items, TODAY).map(entry => entry.title), ['Dentist']);
});

test('the day is read back on the clock, not on the label', () => {
  // "8:00 AM" against "11:30 AM" as text puts the afternoon first.
  const items = [
    item({ title: 'Late', time: '11:30 AM' }),
    item({ title: 'Early', time: '8:00 AM' }),
    item({ title: 'All day' }),
  ];
  assert.deepEqual(relevantItems(items, TODAY).map(entry => entry.title), ['All day', 'Early', 'Late']);
});

// -- which task they meant -----------------------------------------------------

const LIST: AgendaItem[] = [
  item({ title: 'Take medication' }),
  item({ title: 'Pick up motherboard from Umart Belmont' }),
  item({ title: 'Rental inspection' }),
  item({ title: 'Eat lunch with Dad' }),
  item({ title: 'Get TV power connector' }),
];

const found = (said: string) => findItem(LIST, said)?.title ?? null;

test('nobody says a reminder back the way they wrote it', () => {
  // "Take medication" against these shares not one whole word.
  assert.equal(found('meds taken'), 'Take medication');
  assert.equal(found('I took my medication'), 'Take medication');
  assert.equal(found('I have taken my medication'), 'Take medication');
});

test('known gap: an irregular past tense plus a shortened noun falls short', () => {
  // "I took my meds" is the case the three-letter rule was written for, and it
  // does not land: "took" shares no root with "take", so only the noun agrees
  // and only by its stub — 0.5 of a word out of two, under the half-title bar.
  //
  // Left as it is on purpose. The same weight is what stops "I paid the rent"
  // closing out a rental inspection, and of the two failures only one writes to
  // their list. See the ponytail note in agenda.ts. If this ever starts passing,
  // that is a decision somebody made — update this test rather than reverting it.
  assert.equal(found('I took my meds'), null);
  assert.equal(found('I paid the rent'), null, 'the reason the above is left alone');
});

test('a typo is forgiven in a word long enough to have one', () => {
  assert.equal(found('got the motehrboard'), 'Pick up motherboard from Umart Belmont');
});

test('the shop is not the task', () => {
  // Scored against the whole title "picked up the motherboard" is 0.40 and
  // fails; scored against the part that names the thing, it lands.
  assert.equal(found('picked up the motherboard'), 'Pick up motherboard from Umart Belmont');
});

test('one long uncommon word said in full carries it alone', () => {
  assert.equal(found('I bought the connector'), 'Get TV power connector');
});

test('a stub shared with another task settles nothing', () => {
  // Both of these closed the wrong task on a single three-letter root.
  assert.notEqual(found('I picked up Sam'), 'Pick up motherboard from Umart Belmont');
  assert.notEqual(found('I paid the rent'), 'Rental inspection');
});

test('a word two tasks share settles neither', () => {
  // One word is enough only when that word belongs to this task and no other.
  // "book" names half of both, and half a two-word title is exactly the bar —
  // so the bar alone would let it through and the distinctiveness rule is what
  // actually stops it.
  const shared = [item({ title: 'Book dentist' }), item({ title: 'Book flights' })];
  assert.equal(findItem(shared, 'I have the book'), null);
  // Naming the other half settles it immediately.
  assert.equal(findItem(shared, 'I booked the dentist')?.title, 'Book dentist');
});

test('a question is not a report', () => {
  // "did you eat?" closed "Eat lunch with Dad" on one shared word, because the
  // unfinished bonus was lifting a weak match over the bar.
  assert.equal(found('did you eat?'), null);
});

test('nothing said matches nothing', () => {
  assert.equal(findItem(LIST, ''), null);
  assert.equal(findItem([], 'anything at all'), null);
});

test('the unfinished one wins a tie', () => {
  // Confirming something usually means the one still outstanding. Two words have
  // to land here: with the same title twice, neither word tells them apart any
  // more, and a single shared word is deliberately not enough on its own.
  const both = [
    item({ title: 'Take medication', done: true }),
    item({ title: 'Take medication', done: false }),
  ];
  assert.equal(findItem(both, 'I have taken my medication')?.done, false);
});

// -- saying it is done ---------------------------------------------------------

test('the ordinary ways of saying something is finished', () => {
  for (const said of [
    "I've taken them",
    'I picked up the motherboard yes',
    'ive picked it up',
    'yes, picked up!',
    'yeah did that',
    "I've already found the power connector",
    'all done',
    "it's sorted",
  ]) {
    assert.equal(readsAsDone(said), true, `missed: ${said}`);
  }
});

test('a message is rarely all one thing', () => {
  // The failure at the front hid the report behind it, and the task stayed open.
  const both = "I couldn't find it in store! I did however pick up the motherboard";
  assert.equal(readsAsDone(both), true);
  const clause = doneClause(both);
  assert.ok(clause?.includes('motherboard'), 'the reporting half is what gets handed back');
  assert.ok(!clause?.includes('find it in store'), 'and never the half that failed');
});

test('a denial does not lend the report half its pronoun', () => {
  // "it" belongs to the half that failed. Read as one message that "it" stood in
  // for the half that succeeded and ticked off the wrong task entirely, so only
  // the reporting clause is handed back — and this one names nothing, which is
  // what makes it safe: there is no noun in it for findItem to resolve.
  const clause = doneClause("I haven't got it but I did try");
  assert.equal(clause, 'I did try');
  assert.ok(!clause?.includes('got it'), 'the failed half must not travel with it');
  assert.equal(findItem(LIST, clause ?? ''), null, 'and it can close nothing on its own');
});

test('the ways of saying something is NOT finished', () => {
  for (const said of [
    'I never did get the milk',
    "haven't found it",
    "didn't manage to pick it up",
    'I have not been able to sort it',
    'still need to do that',
    'forgot to call them',
    'no time to book it',
    'not done',
  ]) {
    assert.equal(readsAsNotDone(said), true, `missed: ${said}`);
  }
});

test('every verb that can report a finish can also be denied', () => {
  // The two halves have drifted apart every single time: "found" was added to
  // the done list and not to the denial list, so "I've found it" and "I haven't
  // found it yet" both read as a report.
  const verbs = [
    'did', 'done', 'took', 'taken', 'finished', 'sorted', 'handled', 'posted', 'sent',
    'paid', 'booked', 'called', 'rang', 'emailed', 'texted', 'got', 'picked', 'collected',
    'grabbed', 'bought', 'fetched', 'returned', 'completed', 'dropped', 'met', 'went',
    'found', 'sourced', 'nabbed', 'snagged',
  ];
  for (const verb of verbs) {
    assert.equal(readsAsNotDone(`I haven't ${verb} it yet`), true, `denial missed for "${verb}"`);
  }
});

test('a denial is skipped even when it reads as a report word for word', () => {
  // "picked it up" is one of the shapes that means finished, and this sentence
  // contains it exactly. The denial has to be asked first or the task gets
  // ticked off by the very message saying it has not been done.
  for (const said of ["I haven't picked it up", "I haven't picked it up yet", 'I have not picked it up']) {
    assert.equal(readsAsNotDone(said), true, `not read as a denial: ${said}`);
    assert.equal(doneClause(said), null, `read as a report: ${said}`);
  }
});

test('a denial beats the report words it is made of', () => {
  for (const said of ["I haven't found it yet", 'I never did get it', "I didn't pick it up"]) {
    assert.equal(readsAsDone(said), false, `read as a report: ${said}`);
  }
});

// -- answers that name nothing --------------------------------------------------

test('an answer with no sentence around it still counts', () => {
  assert.equal(readsAsBareReport('yes, picked up!'), true);
  assert.equal(readsAsBareReport('yep, done'), true);
});

test('a bare report is anchored, so it cannot fire mid-sentence', () => {
  // The loose reading belongs in the prompt, where a model with the whole
  // conversation decides — not in code acting on its own.
  assert.equal(readsAsBareReport('I need to get it picked up'), false);
});

test('"yes I did" is an answer to her own question', () => {
  for (const said of ['yes I did', 'yeah, I did', "I've done", 'I did']) {
    assert.equal(readsAsAnswerToHer(said), true, `missed: ${said}`);
  }
});

test('a verb with an object of its own is not an answer to her question', () => {
  // If "the shopping" is on the list findItem will match it; if it is not, she
  // must not tick off whatever she happened to be chasing instead.
  for (const said of ['I did the shopping', 'I did my homework', 'I did all of it']) {
    assert.equal(readsAsAnswerToHer(said), false, `false alarm: ${said}`);
  }
});

test('a denial is never an answer that something is done', () => {
  assert.equal(readsAsAnswerToHer("no I didn't"), false);
  assert.equal(readsAsBareReport("I haven't got it"), false);
});

// -- telling her it is her job too ----------------------------------------------

test('nothing open means nothing to say', () => {
  assert.equal(tickOffInstruction('I got the milk', false), '');
});

test('a denial is never a nudge to tick something off', () => {
  assert.equal(tickOffInstruction("I haven't got the milk", true), '');
});

test('naming one of their open tasks is enough on its own', () => {
  const said = tickOffInstruction('what about the motherboard', true, 'Pick up motherboard');
  assert.ok(said.includes('"Pick up motherboard"'));
  assert.ok(said.includes('complete_kept_item'));
});

test('report words alone are enough, without naming anything', () => {
  assert.ok(tickOffInstruction('yeah got it', true).includes('complete_kept_item'));
});

test('a message that is neither is left alone', () => {
  assert.equal(tickOffInstruction('what is the weather like', true), '');
});

test('asking her to do something is not telling her it is done', () => {
  // "remind me about the power connector tomorrow" names an open task while
  // plainly meaning the opposite.
  assert.equal(tickOffInstruction('remind me about the power connector tomorrow', true, 'Get TV power connector'), '');
  // ...but only when the message is nothing but a request.
  assert.ok(tickOffInstruction('I got the milk, and remind me about the dentist', true).includes('complete_kept_item'));
});

test('an admission gets a lecture, and nothing else does', () => {
  assert.equal(missedInstruction('I got the milk'), '');
  const said = missedInstruction("I didn't get round to it");
  assert.ok(said.includes('Lecture them'));
  // The turn at the end is the half a model drops first, so it is asked for.
  assert.ok(said.includes('expect better next time'));
  assert.ok(said.includes('never at who they are'), 'aimed at the act, not the person');
});

// -- putting it off --------------------------------------------------------------

test('a new date offered in passing is read as one', () => {
  assert.equal(putOffUntil('I am home now so I have to check tomorrow'), 'tomorrow');
  assert.equal(putOffUntil('Move the task to tomorrow'), 'tomorrow');
  assert.equal(putOffUntil("I'll do it on friday"), 'on friday');
});

test('a completion beats a date', () => {
  // "I did it tomorrow" is not a sentence anyone says.
  assert.equal(putOffUntil('I did it, tomorrow I will do the other one'), null);
});

test('a day needs naming before anything counts', () => {
  assert.equal(putOffUntil("I'll get to it"), null);
});

test('"I sat down" is not a reschedule', () => {
  // "sat" and "sun" are ordinary English unless a word makes them a date.
  assert.equal(putOffUntil('I have to sit down for a minute'), null);
  assert.equal(putOffUntil('I sat down and could not be bothered'), null);
});

// -- how far away it is ----------------------------------------------------------

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

test('today, tomorrow and yesterday already say it in a word', () => {
  assert.equal(relativeDay(TODAY, TODAY, WEEKDAY), 'today');
  assert.equal(relativeDay('2026-08-21', TODAY, WEEKDAY), 'tomorrow');
  assert.equal(relativeDay('2026-08-19', TODAY, WEEKDAY), 'yesterday');
});

test('anything else inside the fortnight spells the distance out', () => {
  // The Thursday she announced as tomorrow, then as Saturday.
  assert.equal(relativeDay('2026-08-27', TODAY, WEEKDAY), 'Thursday, 7 days from now');
  assert.equal(relativeDay('2026-08-13', TODAY, WEEKDAY), 'last Thursday, 7 days ago');
});

test('beyond the fortnight the name is enough', () => {
  assert.ok(!relativeDay('2026-09-30', TODAY, WEEKDAY).includes('days from now'));
  assert.ok(relativeDay('2026-06-01', TODAY, WEEKDAY).startsWith('last '));
});

// -- how long she keeps asking -----------------------------------------------------

test('she stops demanding an account after a couple of days', () => {
  const items = [
    item({ title: 'Yesterday', date: '2026-08-19' }),
    item({ title: 'Last week', date: '2026-08-13' }),
  ];
  assert.equal(chaseableOverdue(items, at(12), TODAY), 1);
});

test('being told already ends it, whatever the window says', () => {
  const items = [item({ title: 'The party', date: '2026-08-19', heardAbout: '2026-08-19' })];
  assert.equal(chaseableOverdue(items, at(12), TODAY), 0);
});

// -- the block she reads -------------------------------------------------------------

test('an empty list says so plainly', () => {
  assert.equal(formatAgenda([], at(12), TODAY), 'The user has nothing saved from today onward.');
});

test('a recent miss is marked as never accounted for', () => {
  const block = formatAgenda([item({ title: 'Bins', date: '2026-08-19' })], at(12), TODAY);
  assert.ok(block.includes('TIME HAS PASSED'));
  assert.ok(block.includes('be openly put out'));
});

test('an old miss is marked as already chased, and she is told to leave it', () => {
  const block = formatAgenda([item({ title: 'Bins', date: '2026-08-14' })], at(12), TODAY);
  assert.ok(block.includes('you have already asked about this one'));
  assert.ok(block.includes('Do not open with it'));
  assert.ok(!block.includes('TIME HAS PASSED'));
});

test('something she was told about is marked as settled, not as ignored', () => {
  // She asked how the party went, was told all about it, then opened the next
  // conversation asking how the party went.
  const block = formatAgenda(
    [item({ title: 'The party', date: '2026-08-19', heardAbout: '2026-08-19' })],
    at(12), TODAY,
  );
  assert.ok(block.includes('already told you how it went'));
  assert.ok(!block.includes('TIME HAS PASSED'));
});

test('something happening about now is marked as such', () => {
  const block = formatAgenda([item({ title: 'Dentist', time: '2:30 PM' })], at(14, 30), TODAY);
  assert.ok(block.includes('[happening about now]'));
});

test('a clock time is a reschedule too', () => {
  // The live case: told "Its not till later today @5pm" she had a day word to
  // catch, by luck. "I'll get to it at 5pm" had nothing until times counted.
  assert.equal(putOffUntil("I'll get to it at 5pm"), 'at 5pm');
  assert.equal(putOffUntil("I can't do it until 7:30pm"), '7:30pm');
  assert.equal(putOffUntil('Its not till later today @5pm'), 'later');
});

test('a time with no intent around it is not a reschedule', () => {
  assert.equal(putOffUntil('I sat down at 5pm'), null);
  assert.equal(putOffUntil('the meeting was at 5pm'), null);
});

test('a named item at a day the list disagrees with is challenged, not accepted', () => {
  // The live script this exists for: list says tomorrow, user says tonight @5pm.
  const items = [item({ title: 'Scarlett Birthday Party', date: '2026-08-21' })];
  const said = whenMismatchInstruction('Oh no my bad the party is tonight @5pm', items, at(12), TODAY);
  assert.ok(said.includes('"Scarlett Birthday Party"'), 'the item has to be named');
  assert.ok(said.includes('tomorrow'), 'what the list says rides along');
  assert.ok(said.includes('ask which is right'), 'the disagreement is the subject');
  assert.ok(said.includes('Never move it before they answer'), 'ask first, move second');
  assert.ok(said.includes('update_kept_item'), 'and the move has a named path');
});

test('one distinctive word is enough to name an item here', () => {
  // Looser than findItem on purpose: this gates a sentence, not a write.
  const items = [item({ title: 'Scarlett Birthday Party', date: '2026-08-21' })];
  assert.ok(whenMismatchInstruction('the party is tonight', items, at(12), TODAY) !== '');
});

test('agreement is not a disagreement', () => {
  const items = [item({ title: 'Scarlett Birthday Party', date: '2026-08-21' })];
  assert.equal(whenMismatchInstruction('the party is tomorrow', items, at(12), TODAY), '');
});

test('a when with no named item is left to the put-off reading', () => {
  const items = [item({ title: 'Scarlett Birthday Party', date: '2026-08-21' })];
  assert.equal(whenMismatchInstruction('Its not till later today @5pm', items, at(12), TODAY), '');
});

test('a day with no named item is not about anything on the list', () => {
  // "later" bails on the day before the name gate is even asked, so this needs
  // a day that resolves — the gate is the only thing standing.
  const items = [item({ title: 'Scarlett Birthday Party', date: '2026-08-25' })];
  assert.equal(whenMismatchInstruction('might go to the shops tomorrow', items, at(12), TODAY), '');
});

test('a when she cannot place on a day says nothing', () => {
  // "later" and "next week" name no comparable day.
  const items = [item({ title: 'Scarlett Birthday Party', date: '2026-08-21' })];
  assert.equal(whenMismatchInstruction('the party is later', items, at(12), TODAY), '');
});

test('a finished item is nobody’s disagreement', () => {
  const items = [item({ title: 'Scarlett Birthday Party', date: '2026-08-21', done: true })];
  assert.equal(whenMismatchInstruction('the party is tonight', items, at(12), TODAY), '');
});

test('an event more than a couple of days gone is not on the list at all; a task still is', () => {
  const items = [
    { title: 'Ammie’s Birthday Party', date: '2026-08-08', time: '8:00 PM', kind: 'event', done: false },
    { title: 'Verge collection', date: '2026-08-27', kind: 'event', done: false },
    { title: 'Buy the mailboxes', date: '2026-08-24', kind: 'task', done: false },
  ];
  const listed = relevantItems(items, '2026-08-28').map(item => item.title);
  assert.ok(!listed.includes('Ammie’s Birthday Party'), 'a three-week-old party is history');
  assert.ok(listed.includes('Verge collection'), `an event ${CHASE_WINDOW_DAYS} day(s) back is still worth asking about`);
  assert.ok(listed.includes('Buy the mailboxes'), 'a task can still be done, days later');
});

test('an unprompted line that names a party three weeks gone, or a thing already done, is caught', () => {
  const items = [
    { title: 'Ammie’s Birthday Party', date: '2026-08-08', time: '8:00 PM', kind: 'event', done: false },
    { title: 'Store cleaning', date: '2026-08-25', kind: 'task', done: true },
    { title: 'Get Scarlett a birthday present', date: '2026-08-29', kind: 'task', done: false },
  ];
  assert.equal(staleItemNamed('Did you sleep through Ammie’s party, or are you just slow?', items, '2026-08-28')?.title, 'Ammie’s Birthday Party');
  assert.equal(staleItemNamed('The store cleaning is still waiting on you.', items, '2026-08-28')?.title, 'Store cleaning');
  assert.equal(staleItemNamed('Scarlett’s present. Still nothing?', items, '2026-08-28'), null, 'a live item may be chased');
  assert.equal(staleItemNamed('It is 1:43 PM and you look like a zombie.', items, '2026-08-28'), null, 'a line that names nothing passes');
  // One ordinary word that happens to belong to somebody's old errand is not
  // naming it. Every evening tally was dropped for "message", which is the
  // whole subject of the tally and also the first word of "Message Connor".
  const errands = [item({ title: 'Message Connor', done: true }), item({ title: 'Pick up Hanyas PC screen', done: true }), item({ title: 'Bins', done: true })];
  assert.equal(staleItemNamed('Three of my messages today and not one answer.', errands, '2026-08-28'), null);
  assert.equal(staleItemNamed('You were staring at a screen all evening.', errands, '2026-08-28'), null);
  // Named properly, it is still caught.
  assert.equal(staleItemNamed('Did you ever message Connor?', errands, '2026-08-28')?.title, 'Message Connor');
  // And a one-word title has only the one word to name, so it still counts.
  assert.equal(staleItemNamed('The bins are still out there.', errands, '2026-08-28')?.title, 'Bins');
});

// ---- what an unprompted line may not do to the list ----

test('inventedTimeFor catches a time stated for an item saved without one', () => {
  const items = [item({ title: 'Scarlett Birthday Party', date: TODAY, kind: 'event' }), item({ title: 'Dentist', date: TODAY, time: '2:30 PM' })];
  assert.equal(inventedTimeFor('Scarlett’s party at 7:30. You better have a present.', items)?.title, 'Scarlett Birthday Party');
  assert.equal(inventedTimeFor('Scarlett’s party is 7pm, move it.', items)?.title, 'Scarlett Birthday Party');
  // A time for an item that has one is not invented; a line with no time invents nothing.
  assert.equal(inventedTimeFor('Dentist at 2:30, do not be late', items), null);
  assert.equal(inventedTimeFor('Scarlett’s party is today. Present?', items), null);
  // Nothing untimed to give a time to.
  assert.equal(inventedTimeFor('Party at 7:30', [item({ title: 'Dentist', date: TODAY, time: '2:30 PM' })]), null);
});

test('raisedRecently reads the items she has already brought up out of her own lines', () => {
  const party = item({ title: 'Scarlett Birthday Party', date: TODAY, kind: 'event' });
  const present = item({ title: 'Get Scarlett a birthday present', date: TODAY });
  const bins = item({ title: 'Bins', date: TODAY });
  const raised = raisedRecently([
    'Scarlett’s birthday party is today, and you still have no plan.',
    'Nothing to do with the list at all.',
    'Get Scarlett a present or do not bother turning up.',
  ], [party, present, bins]);
  assert.deepEqual(raised.map(entry => entry.title).sort(), ['Get Scarlett a birthday present', 'Scarlett Birthday Party']);
  assert.deepEqual(raisedRecently([], [party]), []);
});

test('formatAgenda says an all-day item has no time, and only when there is one', () => {
  const untimed = formatAgenda([item({ title: 'Scarlett Birthday Party', date: TODAY, kind: 'event' })], at(12), TODAY);
  assert.match(untimed, /all day - Scarlett Birthday Party/);
  assert.match(untimed, /Never state, guess or invent a time/);
  const timed = formatAgenda([item({ title: 'Dentist', date: TODAY, time: '2:30 PM' })], at(12), TODAY);
  assert.doesNotMatch(timed, /Never state, guess or invent a time/);
});

test('an ordinary word in her own line does not name a task she never mentioned', () => {
  // The shape the tally hit: "message" belongs to exactly one old title, so a
  // single distinctive word matched every line that used the word in earnest.
  const items = [
    { id: '1', title: 'Message Connor', date: '2026-08-05', done: true },
    { id: '2', title: 'Pick up the motherboard from Umart', date: '2026-08-29', done: false },
  ];
  assert.deepEqual(raisedRecently(['You never answer a single message I send you.'], items), []);
  assert.equal(inventedTimeFor('Send me a message at 7:30 if you are still up.', items), null);
});

test('but a line that really does name the task still counts', () => {
  const items = [
    { id: '1', title: 'Message Connor', date: '2026-08-29', done: false },
    { id: '2', title: 'Pick up the motherboard from Umart', date: '2026-08-29', done: false },
  ];
  assert.deepEqual(raisedRecently(['Have you messaged Connor yet or not?'], items).map(item => item.id), ['1']);
  const invented = inventedTimeFor('The motherboard pickup from Umart is at 7:30.', items);
  assert.equal(invented?.id, '2');
});
