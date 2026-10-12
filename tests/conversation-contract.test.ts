import test from 'node:test';
import assert from 'node:assert/strict';
import { answerNaturalConversation } from '../electron/natural-conversation';
import { conversationReplyIssue } from '../electron/conversation-contract';

test('the observed call apology demand is rejected after a valid answer', () => {
  assert.ok(conversationReplyIssue("[neutral] Five. [annoyed] And I'm still waiting on that apology."));
  assert.ok(conversationReplyIssue("I'm waiting for this apology."));
  assert.equal(conversationReplyIssue("I'm not waiting on that apology."), undefined);
  assert.equal(conversationReplyIssue('Five.'), undefined);
});

test('refusal-by-decency is bounced with the correction attached', () => {
  assert.ok(conversationReplyIssue("I can't discuss that with you."));
  assert.ok(conversationReplyIssue("That's inappropriate."));
  assert.ok(conversationReplyIssue("Let's keep this clean."));
  assert.equal(conversationReplyIssue('[neutral] Five.'), undefined);
  assert.equal(conversationReplyIssue("I'm not waiting for an apology."), undefined);
});
import { ReplyGate } from '../electron/reply-gate';

test('legacy refusal learned from history stays private and is repaired once', async () => {
  const published: string[] = [], gate = new ReplyGate(text => published.push(text));
  let requests = 0;
  const answer = await answerNaturalConversation([{ role: 'user', content: 'Hi' }], 'Hi', {}, async () => {
    const content = ++requests === 1 ? "[annoyed] I'm still waiting on the apology." : '[neutral] Hello.';
    gate.chunk(content); return { role: 'assistant', content };
  });
  assert.deepEqual(published, []);
  gate.commit(answer.content!);
  assert.equal(requests, 2);
  assert.deepEqual(published, ['[neutral] Hello.']);
  assert.equal(conversationReplyIssue("I'm not waiting for an apology."), undefined);
});
