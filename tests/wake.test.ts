// Her name, as Whisper hears it, and her word back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERRUPTED_ASIDE, WAKE_ACKS, wakeAck, wakePhraseIn } from '../electron/wake';
import { EMOTIONS } from '../electron/emotion';

test('her name at the start wakes her, with whatever came after it as the message', () => {
  assert.deepEqual(wakePhraseIn('Hey Haru'), { woke: true, rest: '' });
  assert.deepEqual(wakePhraseIn('hey, haru!'), { woke: true, rest: '' });
  assert.deepEqual(wakePhraseIn('Haru, what is the weather like?'), { woke: true, rest: 'what is the weather like?' });
  assert.deepEqual(wakePhraseIn('Hey Harry, directions to Coles.'), { woke: true, rest: 'directions to Coles.' });
  assert.deepEqual(wakePhraseIn('okay haru remind me at six'), { woke: true, rest: 'remind me at six' });
  assert.deepEqual(wakePhraseIn(' "Hey Haru." '), { woke: true, rest: '' });
});

test('her name elsewhere, or a word that merely starts like it, does not', () => {
  assert.equal(wakePhraseIn('I told Haru about it').woke, false);
  assert.equal(wakePhraseIn('Harumph.').woke, false);
  assert.equal(wakePhraseIn('Harvest is late this year').woke, false);
  assert.equal(wakePhraseIn('').woke, false);
  assert.equal(wakePhraseIn('so anyway').rest, 'so anyway');
});

test('her word back is one of hers, in a mood the voice has a clip for', () => {
  for (const ack of WAKE_ACKS) {
    assert.ok(ack.line.length > 0 && ack.line.length < 40);
    assert.ok((EMOTIONS as readonly string[]).includes(ack.emotion), ack.emotion);
  }
  assert.equal(wakeAck(() => 0).line, WAKE_ACKS[0].line);
  assert.equal(wakeAck(() => 0.999).line, WAKE_ACKS[WAKE_ACKS.length - 1].line);
});

test('ordinary interruption keeps conversational continuity without inferring rejection', () => {
  assert.match(INTERRUPTED_ASIDE, /ordinary conversational turn-taking/);
  assert.match(INTERRUPTED_ASIDE, /same warmth, mood and speaking style/);
  assert.match(INTERRUPTED_ASIDE, /actual words call for a change/);
  assert.match(INTERRUPTED_ASIDE, /Do not assume they heard the unfinished part/);
  assert.doesNotMatch(INTERRUPTED_ASIDE, /React to that as you would/);
});
