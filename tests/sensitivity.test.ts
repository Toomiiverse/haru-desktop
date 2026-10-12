// What may leave the machine, and what stays.

import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationMayLeave, mayLeaveTheMachine } from '../electron/sensitivity';

test('naming a secret keeps their message home; her own line only when a value is beside the word', () => {
  assert.equal(mayLeaveTheMachine("what's my wifi password again").safe, false);
  assert.equal(mayLeaveTheMachine("you're using my name like a password. What do you want?", false, { namesAlone: false }).safe, true);
  assert.equal(mayLeaveTheMachine('fine, the password is hunter2now', false, { namesAlone: false }).safe, false);
  assert.equal(mayLeaveTheMachine('your api key: abcd1234efgh', false, { namesAlone: false }).safe, false);
  assert.equal(mayLeaveTheMachine('sk-abcdefghijklmnopqrstuvwxyz', false, { namesAlone: false }).safe, false, 'a key-shaped thing is refused whoever said it');
  const hers = { role: 'assistant', content: "you're using my name like a password" };
  assert.equal(conversationMayLeave([hers, { role: 'user', content: 'how was your day' }]).safe, true, 'her teasing does not keep the conversation home');
  assert.equal(conversationMayLeave([{ role: 'user', content: 'remind me of my password later' }, { role: 'user', content: 'how was your day' }]).safe, false, 'his does');
  assert.equal(conversationMayLeave([{ role: 'user', content: 'remind me of my password later' }, { role: 'user', content: 'hi' }]).because, 'it is about passwords or keys', 'their own earlier message, said plainly');
  assert.match(conversationMayLeave([{ role: 'assistant', content: 'the password is hunter2now' }, { role: 'user', content: 'hi' }]).because, /from earlier in this conversation/, 'hers, with a value in it');
});

test('a message id that happens to pass the card-number check does not keep the turn local', () => {
  const { assertOutboundSafe } = require('../electron/outbound');
  const messages = [{ id: '36582565-3772-4202-9a59-354ca2f23cdf-u', role: 'user', content: 'Ok ok looks cool', time: 'now', at: '2026-10-12T07:09:24.549Z' }];
  assert.doesNotThrow(() => assertOutboundSafe(messages, undefined));
  assert.throws(() => assertOutboundSafe([{ id: 'x', role: 'user', content: 'my card is 4111 1111 1111 1111' }], undefined), /outbound_privacy_blocked/);
});
