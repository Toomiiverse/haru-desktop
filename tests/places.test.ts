// Somewhere real: what counts as asking for one, and what she is told.

import test from 'node:test';
import assert from 'node:assert/strict';
import { groundedInstruction, placeQuery } from '../electron/places';

const PERTH = 'Perth, Australia';

test('the question that started it: a steak restaurant, in the city they named', () => {
  assert.equal(placeQuery('What’s a good steak restaurant in Perth', PERTH), 'a good steak restaurant in Perth');
  assert.equal(placeQuery('any good steakhouses?', PERTH), 'any good steakhouses Perth, Australia');
  assert.equal(placeQuery('where can I get a decent coffee', PERTH), 'where can I get a decent coffee Perth, Australia');
  assert.equal(placeQuery('recommend a bakery near me', PERTH), 'recommend a bakery near me Perth, Australia');
});

test('their own city wins over the setting', () => {
  assert.equal(placeQuery('best pub in Fremantle', 'Perth, Australia'), 'best pub in Fremantle Perth, Australia');
  assert.equal(placeQuery('good cafe in Perth CBD', PERTH), 'good cafe in Perth CBD');
});

test('mentioning a place is not asking for one', () => {
  assert.equal(placeQuery('remind me to book the restaurant at 6', PERTH), null);
  assert.equal(placeQuery('we went to that bar last night', PERTH), null);
  assert.equal(placeQuery('I ate at the pub', PERTH), null);
  assert.equal(placeQuery('what is a good way to learn rust', PERTH), null);
  assert.equal(placeQuery('hey', PERTH), null);
});

test('with no city configured the question is searched as asked', () => {
  assert.equal(placeQuery('good ramen shop', ''), 'good ramen shop');
});

test('what she is told leaves no room to add one she remembers', () => {
  const note = groundedInstruction('1. Some Grill — https://example.com — steaks');
  assert.match(note, /the only thing you know about which places exist/);
  assert.match(note, /may not add a place you happen to remember/);
  assert.match(note, /could not turn one up/);
  assert.match(note, /do not mention, correct or apologise/);
});

test('a bare "places" or "spots" counts, but not a figure of speech', () => {
  assert.equal(placeQuery('any good ramen places', PERTH), 'any good ramen places Perth, Australia');
  assert.equal(placeQuery('good coffee spots near the office', PERTH), 'good coffee spots near the office Perth, Australia');
  assert.equal(placeQuery('what is a good place to start with rust', PERTH), null);
});
