// Which brain answers, decided from the message alone.
//
// The cases that matter are the ones seen going wrong: a question about the
// world answered by the local model like a search engine, and an errand that
// happens to mention a price staying an errand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../electron/escalate';

const on = { enabled: true, minWords: 25 };

test('switched off means nothing goes out, whatever the question', () => {
  assert.equal(decide('How good is hy3 for llm', { enabled: false, minWords: 25 }).escalate, false);
});

test('a question about the world is research and goes out', () => {
  for (const text of [
    'How good is hy3 for llm',
    'Is it any good for small local models?',
    'Any other alternatives?',
    'How much does it cost',
    'Qwen3 vs Gemma 3, which is better for coding?',
    'What is the best GPU for a 9B model',
    'Tell me about the RTX 3060',
  ]) {
    const verdict = decide(text, on);
    assert.equal(verdict.escalate, true, text);
    assert.equal(verdict.because, 'it is a research question', text);
  }
});

test('with a conversation route set, a question about the world stays with her', () => {
  assert.equal(decide('How good is the RX 9060 XT vs the 5060', on).escalate, true);
  const routed = decide('How good is the RX 9060 XT vs the 5060', on, { routed: true });
  assert.equal(routed.escalate, false);
  assert.equal(routed.because, 'the conversation route answers it');
  assert.equal(decide('What do you think of the ending? Did it earn it?', on, { routed: true }).escalate, false);
});

test('an errand stays home even when it mentions a price', () => {
  assert.equal(decide('Remind me to check GPU prices tomorrow', on).escalate, false);
  assert.equal(decide('Add the 10m HDMI cable to my list', on).escalate, false);
});

test('their day is not research', () => {
  for (const text of ["What's on today", 'What have I got on tomorrow', 'im bored', 'You alive?', 'Okay okay I’m sorry', 'IM TRYING CALM DOWN']) {
    assert.equal(decide(text, on).escalate, false, text);
  }
});

test('asking for reasoning still goes out, as it always did', () => {
  assert.equal(decide('Explain why the store should close on Mondays', on).escalate, true);
  assert.equal(decide("What's the difference between a Q4_K_M and a Q5?", on).escalate, true);
});
