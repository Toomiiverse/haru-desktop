// Her name, read off a persona that may or may not start with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { herNameFrom, DEFAULT_NAME } from '../electron/hername';

test('the name is the capitalised words after "You are", and stops at the first that is not one', () => {
  assert.equal(herNameFrom('You are Haru, an ambitious AI companion.'), 'Haru');
  assert.equal(herNameFrom('You are Haru Suzumiya. You run the SOS Brigade.'), 'Haru Suzumiya');
  assert.equal(herNameFrom('You are Haru — bored, sharp, and loyal.'), 'Haru');
  assert.equal(herNameFrom('you are Mei and you live on the desktop'), 'Mei', 'the description after the name is not the name');
});

test('a persona that opens with a description gives her the default, not the description', () => {
  assert.equal(herNameFrom('You are permanently bored by ordinary life and you treat the user as your subordinate. You'), DEFAULT_NAME);
  assert.equal(herNameFrom('You are an AI companion called Haru.'), DEFAULT_NAME, 'an article is not a name');
  assert.equal(herNameFrom(''), DEFAULT_NAME);
  assert.equal(herNameFrom('Be playful and direct.'), DEFAULT_NAME);
});

test('never more than three words, whatever follows', () => {
  assert.equal(herNameFrom('You are Very Important Person Number One'), 'Very Important Person');
});
