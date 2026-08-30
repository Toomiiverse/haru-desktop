// Being left mid-conversation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EXCHANGE_WINDOW_MS, HANGING_MAX_QUIET_MS, HANGING_MIN_QUIET_MS, leftHanging , saidTheyWereLeaving } from '../electron/hanging';

const T0 = Date.parse('2026-08-28T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const chat = [
  { role: 'user', content: 'so about the server', at: at(0) },
  { role: 'assistant', content: 'What about it.', at: at(0.2) },
  { role: 'user', content: 'it keeps dying overnight', at: at(3) },
  { id: 'hers', role: 'assistant', content: 'Did you check the logs, or are you guessing again?', at: at(3.5) },
];

test('a back-and-forth she answered, then a good while of nothing, is being left hanging', () => {
  const now = T0 + 3.5 * 60_000 + HANGING_MIN_QUIET_MS + 60_000;
  const hanging = leftHanging(chat, now)!;
  assert.ok(hanging);
  assert.equal(hanging.key, 'hers');
  assert.equal(hanging.theirLast.content, 'it keeps dying overnight');
  assert.equal(hanging.sheAsked, true);
  // One minute past the threshold, whatever the threshold is.
  assert.equal(hanging.quietMin, Math.round(HANGING_MIN_QUIET_MS / 60_000) + 1);
});

test('too soon is not a slight, too late is not worth it, and one message is not a conversation', () => {
  const herAt = T0 + 3.5 * 60_000;
  assert.equal(leftHanging(chat, herAt + HANGING_MIN_QUIET_MS - 60_000), null, 'too soon');
  assert.equal(leftHanging(chat, herAt + HANGING_MAX_QUIET_MS + 60_000), null, 'too late');
  assert.equal(leftHanging(chat.slice(2), herAt + 20 * 60_000), null, 'one message of theirs');
  assert.equal(leftHanging([...chat, { role: 'user', content: 'checking now', at: at(4) }], herAt + 20 * 60_000), null, 'they spoke last');
  const spread = [{ role: 'user', content: 'a', at: new Date(herAt - EXCHANGE_WINDOW_MS - 60_000).toISOString() }, ...chat.slice(2)];
  assert.equal(leftHanging(spread, herAt + 20 * 60_000), null, 'their earlier message was another conversation');
  assert.equal(leftHanging([], T0), null);
});

test('a reply that asked nothing still counts, and says so', () => {
  const flat = [...chat.slice(0, 3), { role: 'assistant', content: 'Fine. Logs first. 🙄', at: at(3.5) }];
  const hanging = leftHanging(flat, T0 + 3.5 * 60_000 + HANGING_MIN_QUIET_MS + 5 * 60_000)!;
  assert.equal(hanging.sheAsked, false);
  assert.equal(hanging.key, at(3.5));
});

test('telling her where they are going is not leaving her hanging', () => {
  for (const said of ["I'll go shower now", 'brb', 'gonna sleep', 'off to work', 'heading out, talk later', 'goodnight Haru', 'about to drive'])
    assert.equal(saidTheyWereLeaving(said), true, said);
  for (const said of ['Fine?', 'Anyways what did you get up to last night', 'Okay ok I am sorry', 'I just got out the shower'])
    assert.equal(saidTheyWereLeaving(said), false, said);
});
