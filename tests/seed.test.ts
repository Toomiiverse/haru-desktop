// Her recent replies, as the model is shown them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { seedEmoji, SEEDED_REPLIES } from '../electron/seed';

const hers = (content: string) => ({ role: 'assistant', content });
const theirs = (content: string) => ({ role: 'user', content });
const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test('her last six replies each carry one of her emoji, after the first sentence', () => {
  const history = Array.from({ length: 8 }, (_, i) => [theirs(`q${i}`), hers(`Fine. You did it. Now go ${i}.`)]).flat();
  const out = seedEmoji(history);
  const replies = out.filter(turn => turn.role === 'assistant');
  assert.equal(replies.slice(-SEEDED_REPLIES).every(turn => emoji.test(turn.content)), true);
  assert.equal(replies.slice(0, -SEEDED_REPLIES).some(turn => emoji.test(turn.content)), false, 'older replies are left as they were');
  assert.match(replies.at(-1)!.content, /^Fine\. [^\s]+ You did it\. Now go 7\.$/);
});

test('a reply that already has an emoji is hers as it is, and still counts as one of the six', () => {
  const history = [theirs('a'), hers('Took you long enough. 🙄 Go.'), theirs('b'), hers('Fine. Go.')];
  const out = seedEmoji(history, 1);
  assert.equal(out[1].content, 'Took you long enough. 🙄 Go.');
  assert.equal(out[3].content !== 'Fine. Go.', true);
  assert.equal(seedEmoji(history, 2)[1].content, 'Took you long enough. 🙄 Go.');
});

test('with no sentence end in reach, the emoji leads', () => {
  const [, reply] = seedEmoji([theirs('a'), hers('you absolute walking hazard of a man who never listens')]);
  assert.match(reply.content, /^[^\s]+ you absolute walking hazard/);
});

test('their turns, the system prompt, and the stored history are untouched', () => {
  const history = [{ role: 'system', content: 'You are Haru.' }, theirs('hi 😊'), hers('Fine. Go.')];
  const snapshot = JSON.stringify(history);
  const out = seedEmoji(history);
  assert.equal(out[0].content, 'You are Haru.');
  assert.equal(out[1].content, 'hi 😊');
  assert.equal(JSON.stringify(history), snapshot);
});
