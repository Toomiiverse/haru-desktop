import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCandidates, eventsPrompt } from '../electron/memory';

test('eventCandidates strips bullets and empties', () => {
  const reply = [
    '- Started the PC Project website',
    '* Fixed the TV power connector',
    '1. Finished the edit',
    '',
    'nothing notable',
  ].join('\n');
  const out = eventCandidates(reply);
  assert.deepEqual(out, ['Started the PC Project website', 'Fixed the TV power connector', 'Finished the edit']);
});

test('eventCandidates returns nothing for the sentinel', () => {
  assert.deepEqual(eventCandidates('nothing notable'), []);
  assert.deepEqual(eventCandidates('Nothing notable'), []);
  assert.deepEqual(eventCandidates(''), []);
});

test('eventCandidates trims trailing punctuation', () => {
  assert.deepEqual(eventCandidates('Decided on the new colour scheme.'), ['Decided on the new colour scheme']);
});

test('eventsPrompt asks for lasting events only', () => {
  const prompt = eventsPrompt();
  assert.match(prompt, /will still matter in a month/);
  assert.match(prompt, /nothing notable/);
  assert.match(prompt, /Reply with the lines only/);
});