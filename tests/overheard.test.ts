import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopback, Overheard, readPlans, keepable, asKept, factsFor, overheardPrompt, overheardInput, type Plan, type Kept } from '../electron/overheard';

const TODAY = '2026-09-19';
const plan = (extra: Partial<Plan> = {}): Plan => ({ title: 'Dinner with Sam', date: '2026-09-21', ...extra });

test('only this machine may read other people\'s messages', () => {
  // The promise this whole tier rests on: his contacts never agreed to be read
  // by anything, let alone something hosted.
  assert.equal(isLoopback('http://127.0.0.1:11436'), true);
  assert.equal(isLoopback('http://localhost:11436'), true);
  assert.equal(isLoopback('http://127.0.0.53:11436'), true);
  assert.equal(isLoopback('https://api.venice.ai/api/v1'), false);
  // This machine's own tailnet address is still a network hop, and a tailnet is
  // not one host. Refused on purpose.
  assert.equal(isLoopback('http://100.123.135.10:11434'), false);
  assert.equal(isLoopback('not a url'), false);
  assert.equal(isLoopback(''), false);
});

test('the window is bounded per chat and drains once', () => {
  const held = new Overheard(3, 2);
  for (let i = 0; i < 5; i += 1) held.note({ chat: 'a', chatName: 'A', who: 'Sam', text: `line ${i}`, at: TODAY });
  assert.equal(held.lines, 3, 'one busy chat cannot grow without limit');
  held.note({ chat: 'b', chatName: 'B', who: 'Ryan', text: 'hi', at: TODAY });
  held.note({ chat: 'c', chatName: 'C', who: 'Emma', text: 'hi', at: TODAY });
  // Two chats held, and the one dropped is the one quiet longest -- noting a
  // line moves its chat to the back of the queue.
  assert.equal(held.lines, 2);
  const drained = held.drain();
  assert.equal(drained.length, 2);
  assert.deepEqual(drained.map(lines => lines[0]!.chat), ['b', 'c'], 'a is gone, not b');
  assert.equal(held.lines, 0, 'a line is read once');
  assert.deepEqual(held.drain(), []);
  held.note({ chat: 'a', chatName: 'A', who: 'Sam', text: '   ', at: TODAY });
  assert.equal(held.lines, 0, 'nothing in it, nothing held');
});

test('plans are read out of whatever the model wrapped them in', () => {
  assert.equal(readPlans('{"plans":[{"title":"Dinner","date":"2026-09-21"}]}')[0]?.title, 'Dinner');
  assert.equal(readPlans('Here you go:\n```json\n{"plans":[{"title":"Dinner","date":"2026-09-21"}]}\n```')[0]?.date, '2026-09-21');
  assert.deepEqual(readPlans('not json at all'), []);
  assert.deepEqual(readPlans('{"plans":"nope"}'), []);
  assert.deepEqual(readPlans('{}'), []);
  const read = readPlans('{"plans":[{"title":" D ","date":"2026-09-21","time":"  ","who":"Sam","said":"moved it"}]}')[0]!;
  assert.equal(read.title, 'D');
  assert.equal(read.time, undefined, 'a blank time is no time, never an invented one');
  assert.equal(read.who, 'Sam');
});

test('keepable refuses every shape this has gone wrong in', () => {
  const open: Kept[] = [{ id: '1', title: 'Dinner with Sam', date: '2026-09-21', kind: 'event', done: false }];
  const { keep, refused } = keepable([
    plan(),                                             // already on his list
    plan({ title: 'Pick up the car', date: 'Friday' }), // not a date
    plan({ title: 'Coffee', date: '2026-09-01' }),      // already past
    plan({ title: 'Wedding', date: '2031-01-01' }),     // too far out
    plan({ title: 'x', date: '2026-09-22' }),           // no title worth keeping
    plan({ title: 'Pick up the CPU', date: '2026-09-22' }),
  ], open, TODAY);
  assert.deepEqual(keep.map(p => p.title), ['Pick up the CPU']);
  assert.deepEqual(refused.map(r => r.why), [
    'already on his list', '"Friday" is not a date', 'already past', 'too far out to have been meant', 'no title worth keeping',
  ]);
});

test('a duplicate is caught through a different wording', () => {
  const open: Kept[] = [{ id: '1', title: 'Dinner with Sam!', date: '2026-09-21', kind: 'event', done: false }];
  assert.equal(keepable([plan({ title: 'dinner with sam' })], open, TODAY).keep.length, 0);
  // A done item does not block the same thing being arranged again.
  const done: Kept[] = [{ id: '1', title: 'Dinner with Sam', date: '2026-09-21', kind: 'event', done: true }];
  assert.equal(keepable([plan()], done, TODAY).keep.length, 1);
  // Two of the same in one pass: the second is caught by the first.
  assert.equal(keepable([plan(), plan()], [], TODAY).keep.length, 1);
});

test('a digit still tells two entries apart', () => {
  // Dropping short words made "Episode 5" and "Episode 6" one entry, and the
  // second was refused as a duplicate of the first.
  const open: Kept[] = [{ id: '1', title: 'Episode 5', date: '2026-09-22', kind: 'event', done: false }];
  assert.equal(keepable([plan({ title: 'Episode 6', date: '2026-09-22' })], open, TODAY).keep.length, 1);
  assert.equal(keepable([plan({ title: 'Episode 5', date: '2026-09-22' })], open, TODAY).keep.length, 0);
});

test('one pass cannot fill his week', () => {
  const many = Array.from({ length: 9 }, (_, i) => plan({ title: `Thing ${i}`, date: '2026-09-22' }));
  const { keep, refused } = keepable(many, [], TODAY);
  assert.equal(keep.length, 5);
  assert.ok(refused.every(r => r.why === 'more than one pass should add'));
});

test('an item he did not add says where it came from', () => {
  // An entry appearing from nowhere that he cannot account for is worse than
  // no entry at all.
  const kept = asKept(plan({ who: 'Sam', said: 'can we push dinner to 8' }), 'Sam');
  assert.equal(kept.kind, 'event');
  assert.match(kept.heardAbout!, /^Sam on WhatsApp: "can we push dinner to 8"$/);
  assert.equal(asKept(plan(), 'the group').heardAbout, 'WhatsApp (the group)');
  assert.equal(asKept(plan({ time: '8:00 PM' }), 'Sam').time, '8:00 PM');
  assert.equal(asKept(plan(), 'Sam').time, undefined);
  assert.equal(asKept(plan({ title: 'x'.repeat(200) }), 'Sam').title.length, 120);
});

test('nothing overheard ends a fact', () => {
  // Somebody saying "Ryan does not work there any more" in a chat she is
  // reading is hearsay, and the graph's ended list is not for hearsay.
  const read = factsFor({ entities: [{ name: 'Ryan', kind: 'person', aliases: [] }], facts: [{ subject: 'Ryan', relation: 'lives in', object: 'Fremantle', sentence: 'Ryan lives in Fremantle.' }], ended: [{ id: 'f1' }] } as never);
  assert.deepEqual(read!.ended, []);
  assert.equal(read!.facts.length, 1);
  assert.equal(factsFor(null), null);
  assert.equal(factsFor({ entities: [], facts: [], ended: [] }), null, 'nothing found is nothing written');
  // A fact with no sentence cannot be rendered or checked, so it is not one.
  assert.equal(factsFor({ entities: [], facts: [{ subject: 'Ryan', relation: 'is', sentence: '' }], ended: [] } as never), null);
});

test('the prompt tells it whose plans matter and never to reply', () => {
  const said = overheardPrompt('Tommy');
  assert.match(said, /never reply/i);
  assert.match(said, /Only things Tommy is actually part of/);
  assert.match(said, /Never invent one/, 'a time must be said, not guessed');
  assert.match(said, /claimedBy: who said it/, 'nothing here is his own word');
  assert.match(overheardInput('Sam', TODAY, [{ chat: 'Sam', chatName: 'Sam', who: 'Sam', text: 'running  late', at: TODAY }]), /Date of this conversation: 2026-09-19\n\nSam: running late/);
});
