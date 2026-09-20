// Being left mid-conversation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EXCHANGE_WINDOW_MS, HANGING_MAX_QUIET_MS, HANGING_MIN_QUIET_MS, judgeInput, judgePrompt, leftHanging, readJudgement, ridesOnHisAsk, saidTheyWereLeaving, isClosing } from '../electron/hanging';

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

test('a closing is the end of a conversation, not a silence', () => {
  for (const said of ['All right. Thanks, Haru.', 'ok', 'Okay ok', 'got it', 'thanks for the reminder Haru', 'Fine.', 'cheers'])
    assert.equal(isClosing(said), true, said);
  for (const said of ['Anyways what did you get up to last night', 'I just got out the shower', 'Remind me to get Nutella @4pm please', 'thanks but what did you mean?'])
    assert.equal(isClosing(said), false, said);
});

test('a question mark is not a debt: whose question it came off is carried through', () => {
  const t = (min: number, role: string, content: string) => ({ role, content, at: new Date(T0 + min * 60_000).toISOString() });
  // He asked, she answered, she tacked one on (2026-09-08).
  const his = [t(0, 'user', 'You awake yet?'), t(2, 'user', 'How much power does a 5080 need'), t(2.2, 'assistant', "Around 360W TDP. What's the rest of the build?")];
  const rider = leftHanging(his, T0 + 30 * 60_000)!;
  assert.equal(rider.sheAsked, true);
  assert.equal(rider.ridesOnHisAsk, true);
  // She opened the subject herself, so nothing of his is on the end of it.
  const hers = [t(0, 'user', 'Was for my own rig'), t(2, 'user', 'the upgrade doesn’t seem worth it'), t(2.2, 'assistant', "It's not. Spend the money on Emma. You told her yet?")];
  const opened = leftHanging(hers, T0 + 30 * 60_000)!;
  assert.equal(opened.sheAsked, true);
  assert.equal(opened.ridesOnHisAsk, false);
  assert.equal(ridesOnHisAsk([]), false);
});

test('the judge answers in one word, or it has not answered', () => {
  assert.equal(readJudgement('BLOCKING'), 'blocking');
  assert.equal(readJudgement('rider'), 'rider');
  assert.equal(readJudgement('  Rider.  '), 'rider');
  // A model that talks its way there is read on its last word, not its first.
  assert.equal(readJudgement('This could look like a RIDER, but she cannot proceed — BLOCKING'), 'blocking');
  assert.equal(readJudgement('Not blocking at all. RIDER'), 'rider');
  // Anything else is no answer, and the caller falls back rather than guessing.
  assert.equal(readJudgement('I am not sure what you mean.'), null);
  assert.equal(readJudgement(''), null);
  assert.equal(readJudgement(undefined as unknown as string), null);
});

test('the judge is shown the exchange and told what it is deciding', () => {
  const input = judgeInput({
    theirLast: { role: 'user', content: 'Are you able to  launch\n it in my phone?' },
    herLast: { role: 'assistant', content: 'I can only put it on whatever player you have open. You got the Jellyfin app running or just the browser tab?' },
  });
  assert.match(input, /He said: Are you able to launch it in my phone\?/, 'whitespace is tidied');
  assert.match(input, /She replied: I can only put it on/);
  assert.match(input, /BLOCKING or RIDER\?$/);
  const prompt = judgePrompt();
  assert.match(prompt, /BLOCKING/);
  assert.match(prompt, /RIDER/);
  assert.match(prompt, /Answer with one word/);
  assert.match(prompt, /Jellyfin app running/, 'the case no pattern gets right is in the prompt as an example');
});
