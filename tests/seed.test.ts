// Her recent replies, as the model is shown them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { seedEmoji, SEEDED_REPLIES, seedOffTheOrders } from '../electron/seed';

const hers = (content: string) => ({ role: 'assistant', content });
const theirs = (content: string) => ({ role: 'user', content });
const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test('her recent replies are shown without the sign-off, so the example she copies stays on the subject', () => {
  const strip = (text: string) => text.replace(/\s*Now go to bed\..*$/, '').trim();
  const turns = [
    { role: 'user', content: 'what did you watch' },
    { role: 'assistant', content: 'Chainsaw Man. Now go to bed. You have work.' },
    { role: 'user', content: 'which bit' },
    { role: 'assistant', content: 'The Reze arc.' },
  ];
  const shown = seedOffTheOrders(turns, strip);
  assert.equal(shown[1].content, 'Chainsaw Man.', 'the sign-off is gone from what she is shown');
  assert.equal(shown[3].content, 'The Reze arc.', 'a reply that never had one is untouched');
  assert.equal(turns[1].content, 'Chainsaw Man. Now go to bed. You have work.', 'what she actually said is not rewritten');
  assert.deepEqual(seedOffTheOrders(turns, text => text), turns, 'a strip that changes nothing changes nothing');
});

