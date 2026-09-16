import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCandidates, eventsPrompt, isWorthAnEvent } from '../electron/memory';

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

test('eventsPrompt keeps her own life out of his events', () => {
  const prompt = eventsPrompt();
  assert.match(prompt, /"They:" are the user, lines starting "Haru:" are you/);
  assert.match(prompt, /what she read or watched, when she sleeps or logs off/);
  assert.match(prompt, /never write it as something they did/);
});

test('isWorthAnEvent accepts real, nameable events', () => {
  assert.equal(isWorthAnEvent('Tommy downloaded Linux Arch'), true);
  assert.equal(isWorthAnEvent('Fired up the PC Project website'), true);
  assert.equal(isWorthAnEvent('Got the motherboard from Umart Belmont'), true);
  assert.equal(isWorthAnEvent('Picked up 16 GB of RAM'), true);
  assert.equal(isWorthAnEvent('Signed the lease on the Northbridge unit'), true);
});

test('isWorthAnEvent rejects instructions to Haru', () => {
  assert.equal(isWorthAnEvent('Haru to research screenshot identifier tools'), false);
  assert.equal(isWorthAnEvent('Haru to add anime-themed PC build preference'), false);
  assert.equal(isWorthAnEvent('Haru to tone down professional email responses'), false);
  assert.equal(isWorthAnEvent('Haru monitors productivity closely during work'), false);
});

test('isWorthAnEvent rejects generic, unnameable moments', () => {
  assert.equal(isWorthAnEvent('Followed emergency procedures efficiently'), false);
  assert.equal(isWorthAnEvent('Evacuated building due to undetailed incident'), false);
  assert.equal(isWorthAnEvent('Prepared for evacuation by gathering essentials'), false);
});

test('isWorthAnEvent rejects passing moments even with the subject named', () => {
  assert.equal(isWorthAnEvent('Tommy cleaned up the room'), false);
  assert.equal(isWorthAnEvent('Tommy feels tired today'), false);
  assert.equal(isWorthAnEvent('Tommy procrastinates on work emails'), false);
  assert.equal(isWorthAnEvent('Tommy was reminded to manage tasks effectively'), false);
});