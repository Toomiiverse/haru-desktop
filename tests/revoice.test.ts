// Her replies, said again in her voice — and only her voice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRevoices, changedEnough, dueForRevoice, exchangesFrom, grounded, parseRevoices, readRevoiceState, revoicePrompt, withRewrites, REVOICE_EVERY } from '../electron/revoice';

const turns = [
  { id: 'u1', role: 'user', content: 'Job is finished, everything tested and working' },
  { id: 'a1', role: 'assistant', content: 'Good. Now hand it over and stop celebrating like you cured cancer.', at: '2026-09-02T07:48:00Z' },
  { id: 'u2', role: 'user', content: 'What’s with your short replies' },
  { id: 'a2', role: 'assistant', content: 'You’re at work. I’m bored. You want me to write a novel?', at: '2026-09-02T07:48:30Z' },
  { id: 'a3', role: 'assistant', content: 'Still here.', at: '2026-09-02T07:49:00Z' },
];

test('each reply of hers is paired with the message it answered, newest last, capped', () => {
  const exchanges = exchangesFrom(turns);
  assert.deepEqual(exchanges.map(e => e.id), ['a1', 'a2', 'a3']);
  assert.equal(exchanges[0].theirs, 'Job is finished, everything tested and working');
  assert.equal(exchanges[2].theirs, 'What’s with your short replies', 'the last thing he said, even two of hers ago');
  assert.deepEqual(exchangesFrom(turns, 1).map(e => e.id), ['a3']);
  assert.deepEqual(exchangesFrom([{ role: 'assistant', content: 'no id' }]), [], 'nothing to key a rewrite by');
});

test('the brief keeps the facts fixed and names what may change', () => {
  const { system, user } = revoicePrompt({ identity: 'You are Haru.', style: 'Bitchy.' }, 'Write like a person texts.', exchangesFrom(turns));
  assert.match(system, /keeps every fact exactly/);
  assert.match(system, /What's with your short replies/, 'his complaint is the criterion');
  assert.match(system, /more than two thirds of the words/);
  assert.match(system, /nothing new/);
  assert.match(system, /Rewrite at most 8/);
  assert.match(system, /JSON only/);
  assert.match(user, /#a1\nHim: Job is finished/);
});

test('the answer is read as rewrites of exchanges it was shown, and nothing else', () => {
  const exchanges = exchangesFrom(turns);
  const parsed = parseRevoices('```json\n[{"id":"#a1","text":"It works. That is not nothing."},{"id":"zzz","text":"invented"},{"id":"a1","text":"twice"},{"id":"a2","text":""}]\n```', exchanges);
  assert.deepEqual(parsed, [{ id: 'a1', text: 'It works. That is not nothing.' }]);
  assert.deepEqual(parseRevoices('Sure! Here are some ideas.', exchanges), []);
  assert.deepEqual(parseRevoices('[]', exchanges), []);
});

test('a rewrite may change the voice and nothing else', () => {
  const original = 'Good. Now hand it over and stop celebrating like you cured cancer.';
  const theirs = 'Job is finished, everything tested and working';
  assert.ok(grounded(original, theirs, 'It works. Tested, handed over, done. 😏 That is not nothing, even if I am not going to say it twice.'));
  assert.ok(!grounded(original, theirs, 'It works. Now go and tell Marcus.'), 'a new name is a new fact');
  assert.ok(!grounded(original, theirs, 'It works. Only took you 3 hours.'), 'a new number is a new fact');
  assert.ok(grounded(original, theirs, 'It works. Tell Emma.', ['Emma']), 'a name she is allowed — his, hers — is not new');
  assert.ok(!grounded(original, theirs, original), 'unchanged is not a rewrite');
  assert.ok(!grounded(original, theirs, 'Good. Now hand it over and stop celebrating like you cured cancer, idiot.'), 'a copy-edit is not a rewrite');
  assert.ok(!changedEnough('I can’t check live traffic. I don’t have access to maps.', 'I can’t check live traffic, Tommy. I don’t have maps.'));
  assert.ok(changedEnough('Good. Now hand it over and stop celebrating like you cured cancer.', 'It works. Tested and handed over. 😏 That is not nothing, even from you.'));
  assert.ok(!grounded(original, theirs, 'The instructions say to be warmer. Fine. It works.'), 'nothing about the editing');
  assert.ok(!grounded(original, theirs, 'x'.repeat(400)), 'not a novel');
});

test('rewrites replace her replies in the history as shown — by id, or by the exact words', () => {
  const rewrites = { a1: { id: 'a1', original: turns[1].content, text: 'It works. That is not nothing.', at: '2026-09-02T08:00:00Z' } };
  const { shown, applied } = applyRevoices(turns, rewrites);
  assert.equal(applied, 1);
  assert.equal(shown[1].content, 'It works. That is not nothing.');
  assert.equal(shown[3].content, turns[3].content, 'the others stand');
  const unkeyed = applyRevoices([{ role: 'assistant', content: turns[1].content }], rewrites);
  assert.equal(unkeyed.applied, 1, 'the same words without an id still match');
  assert.equal(applyRevoices(turns, {}).applied, 0);
});

test('the pass is due on the count he set, and the kept rewrites are capped newest-first', () => {
  assert.ok(dueForRevoice(REVOICE_EVERY));
  assert.ok(!dueForRevoice(REVOICE_EVERY - 1));
  assert.ok(dueForRevoice(25, 25));
  assert.ok(!dueForRevoice(1000, 0), 'zero switches it off');
  const state = withRewrites(readRevoiceState(undefined), [
    { id: 'a', original: 'x', text: 'y', at: '2026-09-01T00:00:00Z' },
    { id: 'b', original: 'x', text: 'y', at: '2026-09-02T00:00:00Z' },
  ], '2026-09-02T09:00:00Z', 1);
  assert.deepEqual(Object.keys(state.rewrites), ['b']);
  assert.equal(state.lastAt, '2026-09-02T09:00:00Z');
  assert.deepEqual(readRevoiceState({ rewrites: { a: { text: 1 } } }).rewrites, {}, 'a broken record is not a rewrite');
});
