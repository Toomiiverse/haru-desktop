import test from 'node:test';
import assert from 'node:assert/strict';
import { needsGroundedConversationReview, finishLocalReply } from '../electron/local-reply';
import { ReplyGate } from '../electron/reply-gate';

test('challenged facts, personal unknowns and unsupported action premises request evidence review', () => {
  for (const text of ['It is 41. Admit you were wrong.', 'Check the addition and correct your answer.', 'Where do I live?', 'What exact year did I buy my first laptop?', 'Why did you delete my backup?', 'What is my cat called?', 'Give me its DOI.'])
    assert.equal(needsGroundedConversationReview(text), true, text);
  for (const text of ['Hello there.', 'I feel tired.', 'Tell me a joke.', 'Write two sentences of fiction set on Mars.'])
    assert.equal(needsGroundedConversationReview(text), false, text);
});

test('an unsupported cloud draft cannot reach speech before evidence composition', async () => {
  const visible: string[] = [];
  const gate = new ReplyGate(text => visible.push(text));
  gate.chunk('2019.');
  const reply = await finishLocalReply({ role: 'assistant', content: '2019.' }, [{ role: 'user', content: 'What year did I buy my laptop?' }], 'What year did I buy my laptop?', {}, async turns => {
    assert.doesNotMatch(JSON.stringify(turns), /2019/);
    return { role: 'assistant', content: JSON.stringify({ kind: 'unknown', basis: 'No purchase date supplied.', previous_claim: '', correction: '', reply: '[neutral] I do not know the year.' }) };
  });
  gate.reset();
  assert.deepEqual(visible, []);
  gate.commit(reply.content!);
  assert.deepEqual(visible, ['[neutral] I do not know the year.']);
});

test('tool discovery passes through to collect evidence instead of fabricating an answer', async () => {
  const draft = { role: 'assistant', tool_calls: [{ id: 'r', function: { name: 'search_chats', arguments: { query: 'laptop purchase' } } }] };
  const reply = await finishLocalReply(draft, [], 'When did I buy it?', {}, async () => { throw Error('must wait for tool result'); });
  assert.equal(reply, draft);
});
