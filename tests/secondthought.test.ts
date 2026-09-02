// The thing she says a minute later, and when she says nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSecondThought, secondThoughtDelay, secondThoughtNote, wantsSecondThought, SECOND_THOUGHT_MIN_MS, SECOND_THOUGHT_MAX_MS } from '../electron/secondthought';

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
