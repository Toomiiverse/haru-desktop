// What she is told about her own recent remarks when she is about to make
// another. The list used to call every one of them unanswered, including the
// ones they had come back and talked past — and told at half nine that "text
// me when you've finished chewing" went unanswered, she asked whether he was
// still eating the steak, an hour after he had said he was home.

import test from 'node:test';
import assert from 'node:assert/strict';
import { alreadySaidRecently, type Aside } from '../electron/asides';

const TZ = 'Australia/Perth';
const at = (iso: string, text: string, source: Aside['source'] = 'idle'): Aside =>
  ({ id: text.slice(0, 6), at: iso, day: iso.slice(0, 10), source, text });

test('remarks made before their last message are overtaken, not hanging; only the ones since still are', () => {
  const asides = [
    at('2026-09-02T10:27:00Z', 'Don’t let the rain ruin your steak.', 'weather'),
    at('2026-09-02T12:12:00Z', 'Text me when you’ve finished chewing.', 'journal'),
    at('2026-09-02T13:25:00Z', 'So you’re finally home and letting your phone buzz for nothing.'),
  ];
  const theirLast = Date.parse('2026-09-02T13:04:00Z');
  const note = alreadySaidRecently(asides, TZ, Date.parse('2026-09-02T13:36:00Z'), theirLast);
  const [overtaken, hanging] = note.split('since they last spoke.');
  assert.match(overtaken, /before they last spoke to you/);
  assert.match(overtaken, /overtaken by what they have told you/);
  assert.match(overtaken, /finished chewing/);
  assert.match(overtaken, /ruin your steak/);
  assert.doesNotMatch(overtaken, /buzz for nothing/);
  assert.match(hanging, /they went unanswered/);
  assert.match(hanging, /buzz for nothing/);
  assert.doesNotMatch(hanging, /finished chewing/);
  assert.match(note, /Do not make any of these points again/);
});

test('with nothing said by them yet, or no time known, every remark is still hanging', () => {
  const asides = [at('2026-09-02T13:25:00Z', 'Where the hell are you?')];
  const now = Date.parse('2026-09-02T13:36:00Z');
  for (const theirLast of [undefined, Date.parse('2026-09-02T09:00:00Z')]) {
    const note = alreadySaidRecently(asides, TZ, now, theirLast);
    assert.match(note, /since they last spoke.*went unanswered/s);
    assert.doesNotMatch(note, /before they last spoke/);
  }
});

test('nothing recent, nothing said', () => {
  assert.equal(alreadySaidRecently([], TZ, Date.now(), Date.now()), '');
});

test('the subject she has been woken up to write about is not a closed subject', () => {
  const asides = [at('2026-09-20T01:15:00Z', 'You’ve had 29 minutes to send a screenshot of that 3D modeling nonsense.')];
  const now = Date.parse('2026-09-20T02:25:00Z');
  const theirLast = Date.parse('2026-09-20T00:46:00Z');
  // Without a subject, the weather is named as an example of what is closed.
  const plain = alreadySaidRecently(asides, TZ, now, theirLast);
  assert.match(plain, /The subjects of those remarks — the weather, the time/);
  // In a weather push it is the errand, and saying both at once is what turned
  // "rain starting up" into three more lines about being left on read.
  const weather = alreadySaidRecently(asides, TZ, now, theirLast, undefined, 'The weather');
  assert.doesNotMatch(weather, /— the weather, the time/);
  assert.match(weather, /The weather is the exception/);
  assert.match(weather, /it is not on that list/);
  // Everything else about the note is unchanged.
  assert.match(weather, /You have already said these, off your own back, since they last spoke/);
  assert.match(weather, /3D modeling nonsense/);
});
