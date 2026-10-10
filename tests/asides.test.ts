// Her own remarks, and the one thing about them that has to survive the disk.
//
// There were no tests here at all, which is how three sources came to be
// dropped on every read: readAsides validates against a hand-written SOURCES
// list, the list fell behind the union, and the mismatch is silent — a
// 'hanging' aside simply comes back as 'other'. Nothing throws, nothing logs,
// and the evening tally quietly stops counting a third of what buzzed the
// phone. The round-trip below is checked by the compiler as well as at run
// time, so the next source added cannot go missing the same way.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spliceRecentAsides, splicedAsidesNote, addAside, markReached, readAsides, markAsked, openAsk, answerAsk, askedRecently, unansweredAsks, unansweredAsksNote, keepHeldBack, echoesAside, ASK_OPEN_MS, HELD_BACK_KEPT, type Aside, type AsideSource, type HeldBack, asideContext } from '../electron/asides';

// Every member of AsideSource. This is a Record over the union, so adding a
// source without adding it here fails to compile.
const EVERY_SOURCE: Record<AsideSource, true> = {
  screen: true, screenshot: true, activity: true, fullscreen: true, reminder: true,
  idle: true, journal: true, page: true, poke: true, kept: true, system: true,
  hanging: true, weather: true, upcoming: true, followup: true, goodnight: true, other: true, booked: true, thought: true,
  minecraft: true, anime: true,
};

const sources = Object.keys(EVERY_SOURCE) as AsideSource[];

test('every source survives being written and read back', () => {
  const written = sources.map((source, index) => ({
    id: `a${index}`, at: '2026-08-29T01:00:00.000Z', day: '2026-08-29', source, text: `said by ${source}`,
  }));
  const read = readAsides(written);
  assert.equal(read.length, sources.length);
  for (const [index, source] of sources.entries()) {
    assert.equal(read[index].source, source, `"${source}" came back as "${read[index].source}"`);
  }
});

test('something that is not a source at all still lands somewhere safe', () => {
  const [read] = readAsides([{ id: 'x', at: '', day: '', source: 'telepathy', text: 'hm' }]);
  assert.equal(read.source, 'other');
});

test('whether it reached the phone round-trips, and absent stays absent', () => {
  const rows = [
    { id: 'a', at: '', day: '', source: 'idle', text: 'landed', reached: true },
    { id: 'b', at: '', day: '', source: 'idle', text: 'did not', reached: false },
    { id: 'c', at: '', day: '', source: 'idle', text: 'before the flag existed' },
  ];
  const read = readAsides(rows);
  assert.equal(read[0].reached, true);
  assert.equal(read[1].reached, false);
  // Not false, and not true: unknown, which is what the tally treats as "count it".
  assert.equal('reached' in read[2], false);
});

test('marking one reached leaves the rest of the log alone', () => {
  const { asides } = addAside([], 'oi', 'idle', new Date('2026-08-29T01:00:00.000Z'), '2026-08-29');
  const { asides: two } = addAside(asides, 'again', 'reminder', new Date('2026-08-29T02:00:00.000Z'), '2026-08-29');
  const marked = markReached(two, two[1].id, true);
  assert.equal(marked[0].reached, undefined);
  assert.equal(marked[1].reached, true);
  assert.equal(marked.length, 2);
  // And a failed push is recorded as such, not left unknown.
  assert.equal(markReached(two, two[0].id, false)[0].reached, false);
  // An id that is not there changes nothing.
  assert.deepEqual(markReached(two, 'nope', true), two satisfies Aside[]);
});

test('an ask about their day is open for three hours, answered by the next message, and held over them after that', () => {
  const t0 = Date.parse('2026-08-31T06:53:00.000Z');
  let { asides, aside } = addAside([], 'So what are you actually doing at The PC Project, huh?', 'idle', new Date(t0), '2026-08-31');
  asides = markAsked(asides, aside.id, 'what they are doing at The PC Project');
  assert.equal(openAsk(asides, t0 + 20 * 60_000)?.id, aside.id, 'open twenty minutes on');
  assert.equal(askedRecently(asides, t0 + 60 * 60_000), true, 'not asked again within two hours');
  assert.equal(askedRecently(asides, t0 + 3 * 60 * 60_000), false);
  assert.deepEqual(unansweredAsks(asides, t0 + 20 * 60_000), [], 'not held against them while it is still open');
  assert.equal(unansweredAsks(asides, t0 + ASK_OPEN_MS + 60_000).length, 1, 'held after the window');
  assert.match(unansweredAsksNote(asides, 'Australia/Perth', t0 + ASK_OPEN_MS + 60_000), /at 2:53 pm you asked what they are doing at The PC Project and heard nothing back/i);
  const answered = answerAsk(asides, aside.id, new Date(t0 + 10 * 60_000).toISOString());
  assert.equal(openAsk(answered, t0 + 20 * 60_000), null, 'answered: no longer open');
  assert.deepEqual(unansweredAsks(answered, t0 + ASK_OPEN_MS + 60_000), [], 'nor held');
  assert.equal(readAsides(JSON.parse(JSON.stringify(answered)))[0].answeredAt, answered[0].answeredAt, 'kept across a reload');
  assert.equal(openAsk(asides, t0 + ASK_OPEN_MS + 1), null, 'too late to be an answer');
});

test('a line that chased something off the list says so, so "what\'s this about?" has an answer', () => {
  const now = Date.parse('2026-08-31T11:47:00.000Z');
  const { asides } = addAside([], '6 p.m. sharp. Venice route. Do not sleepwalk through it.', 'reminder', new Date(now - 2 * 60_000), '2026-08-31', 'Check the Venice route');
  const context = asideContext(asides, now);
  assert.match(context, /2 minutes ago: "6 p\.m\. sharp\./);
  assert.match(context, /that was you chasing "Check the Venice route" off their list/);
  assert.match(context, /using what is written above rather than guessing from the conversation/);
  assert.equal(readAsides(JSON.parse(JSON.stringify(asides)))[0].about, 'Check the Venice route', 'kept across a reload');
  const plain = addAside([], 'Still at The PC Project?', 'idle', new Date(now - 2 * 60_000), '2026-08-31').asides;
  assert.doesNotMatch(asideContext(plain, now), /chasing/, 'a line about nothing on the list says nothing about one');
});


test('what she bit back is kept newest-last and bounded', () => {
  let held: HeldBack[] = [];
  for (let i = 0; i < HELD_BACK_KEPT + 5; i++) held = keepHeldBack(held, { at: `2026-09-06T0${i % 10}:00:00.000Z`, why: 'she spoke unprompted 40s ago', line: `line ${i}` });
  assert.equal(held.length, HELD_BACK_KEPT);
  // The oldest fall off the front, and the newest is the one just added.
  assert.equal(held[held.length - 1].line, `line ${HELD_BACK_KEPT + 4}`);
  assert.equal(held[0].line, 'line 5');
});

test('a nudge that repeats a recent remark, or quotes one back with its clock stamp, is an echo', () => {
  const now = Date.parse('2026-09-02T14:51:00.000Z');
  const said = '33 minutes and you’re just sitting there. 🙄 So? Still eating the steak or do I need to send the National Guard?';
  const asides: Aside[] = [{ id: 'a', at: '2026-09-02T13:36:40.000Z', day: '2026-09-02', source: 'idle', text: said }];
  assert.equal(echoesAside(`9:36 PM — “${said}`, asides, now), true);
  assert.equal(echoesAside(said, asides, now), true);
  // The stamp alone is not the echo — with no remark to match, a stamped line is not one of hers back again.
  assert.equal(echoesAside('9:36 PM — anything at all', [], now), false);
  assert.equal(echoesAside('So what did your mum make of the place?', asides, now), false);
  // An old remark is not held against her.
  assert.equal(echoesAside(said, asides, now + 13 * 60 * 60_000), false);
  // A short remark inside a longer new line is still caught: the pushed
  // implementation strips the log-row trappings and compares the text underneath,
  // with no minimum length — a two-word aside quoted back is an echo too.
  assert.equal(echoesAside('Fine. 😒 Go to bed.', [{ id: 'b', at: '2026-09-02T14:00:00.000Z', day: '2026-09-02', source: 'idle', text: 'Fine. 😒' }], now), true);
});

test('a notification he answers is the conversation: her line goes in before his, for that turn', () => {
  const now = Date.parse('2026-09-18T08:27:27Z');
  const pushed = { id: 'a1', text: 'I caught a Pidgey and named it after you. It keeps missing.', source: 'followup', at: '2026-09-18T08:22:19Z', day: '2026-09-18', about: '' } as unknown as Aside;
  const messages = [
    { role: 'user', content: "How's your game going", at: '2026-09-18T08:21:05Z' },
    { role: 'assistant', content: 'Give it an hour.', at: '2026-09-18T08:21:05Z' },
    { role: 'user', content: 'Hahah did you actually??', at: '2026-09-18T08:27:27Z' },
  ];
  const { messages: seen, spliced } = spliceRecentAsides(messages, [pushed], now);
  assert.deepEqual(seen.map(m => [m.role, m.content.slice(0, 16)]), [['user', "How's your game "], ['assistant', 'Give it an hour.'], ['assistant', 'I caught a Pidge'], ['user', 'Hahah did you ac']]);
  assert.equal(spliced.length, 1);
  assert.equal(messages.length, 3, 'the transcript itself is not touched');
  const note = splicedAsidesNote(spliced);
  assert.match(note, /a notification on their phone/);
  assert.match(note, /Do not say the line again/);
  // Older than the window, already answered, already in the conversation, or no message of his: nothing is spliced.
  assert.equal(spliceRecentAsides(messages, [{ ...pushed, at: '2026-09-18T07:00:00Z' }], now).spliced.length, 0);
  assert.equal(spliceRecentAsides(messages, [{ ...pushed, at: '2026-09-18T08:20:00Z' }], now).spliced.length, 0, 'sent before her last reply: that exchange has moved on');
  assert.equal(spliceRecentAsides([...messages.slice(0, 2), { role: 'assistant', content: pushed.text, at: pushed.at }, messages[2]], [pushed], now).spliced.length, 0);
  assert.equal(spliceRecentAsides(messages.slice(0, 2), [pushed], now).spliced.length, 0);
  assert.equal(splicedAsidesNote([]), '');
  assert.match(splicedAsidesNote([{ ...pushed, about: 'car rego' } as Aside]), /chasing "car rego" off their list/);
});
