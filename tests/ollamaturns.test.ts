// What a chat template will accept, checked against what the app produces.
//
// Every shape here is one Qwen3.5's template was seen to refuse with a 500 —
// or to accept — on the live endpoint. The point of the tests is that the
// three composers that speak first, the time-gap marker, and a tool loop that
// spilled to the hosted model for a round all come out renderable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { forOllama } from '../electron/ollamaturns';

const gap = '[Time passed here — what follows was said 20 minutes later.]';

test('the leading system message stays exactly where it is', () => {
  const out = forOllama([{ role: 'system', content: 'You are Haru.' }, { role: 'user', content: 'hi' }]);
  assert.deepEqual(out, [{ role: 'system', content: 'You are Haru.' }, { role: 'user', content: 'hi' }]);
});

test('a system message mid-history is merged into the user turn that follows it', () => {
  const out = forOllama([
    { role: 'system', content: 'You are Haru.' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'What.' },
    { role: 'system', content: gap },
    { role: 'user', content: 'still there?' },
  ]);
  assert.deepEqual(out.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(out[3].content, `${gap}\n\nstill there?`);
});

test('a marker with nothing of theirs after it stands as a user turn of its own', () => {
  const out = forOllama([
    { role: 'system', content: 'You are Haru.' },
    { role: 'user', content: 'hi' },
    { role: 'system', content: gap },
    { role: 'assistant', content: 'Still here. Unfortunately.' },
  ]);
  assert.deepEqual(out.map(m => m.role), ['system', 'user', 'user', 'assistant']);
  assert.equal(out[2].content, gap);
});

test('two markers in a row fold into one turn', () => {
  const out = forOllama([
    { role: 'system', content: 'You are Haru.' },
    { role: 'user', content: 'hi' },
    { role: 'system', content: 'one' },
    { role: 'system', content: 'two' },
    { role: 'user', content: 'again' },
  ]);
  assert.deepEqual(out.map(m => m.role), ['system', 'user', 'user']);
  assert.equal(out[2].content, 'one\n\ntwo\n\nagain');
});

test('tool-call arguments that arrive as JSON text go out as the object', () => {
  const out = forOllama([
    { role: 'system', content: 'You are Haru.' },
    { role: 'user', content: 'how good is hy3' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_abc', function: { name: 'search_web', arguments: '{"query": "hy3 llm"}' } }] },
    { role: 'tool', tool_name: 'search_web', content: 'strong for STEM' },
  ]);
  assert.deepEqual(out[2].tool_calls, [{ id: 'call_abc', function: { name: 'search_web', arguments: { query: 'hy3 llm' } } }]);
  assert.equal(out[3].role, 'tool');
});

test('arguments already an object are left alone, and unparseable text becomes an empty object', () => {
  const object = { query: 'x' };
  const out = forOllama([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'a', arguments: object } }, { function: { name: 'b', arguments: '{not json' } }] },
  ]);
  assert.equal(out[1].tool_calls?.[0].function?.arguments, object);
  assert.deepEqual(out[1].tool_calls?.[1].function?.arguments, {});
});

test('a conversation with no user turn gets an empty one, so she has someone to answer', () => {
  assert.deepEqual(forOllama([{ role: 'system', content: 'Speak first.' }]), [
    { role: 'system', content: 'Speak first.' },
    { role: 'user', content: '' },
  ]);
});

test('nothing in, nothing but the empty turn out; and the input is never mutated', () => {
  assert.deepEqual(forOllama([]), [{ role: 'user', content: '' }]);
  const input = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }, { role: 'system', content: 'g' }, { role: 'user', content: 'v' }];
  const snapshot = JSON.stringify(input);
  forOllama(input);
  assert.equal(JSON.stringify(input), snapshot);
});
