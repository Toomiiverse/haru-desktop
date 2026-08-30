// The voice from the examples, without the events from the examples.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DIARY_FRAGMENTS, DIARY_VOICE, fragmentsInstruction, liftedFrom, LIFTED_SPAN_WORDS, NOT_THOSE_LINES, NOT_THOSE_NAMES, unknownNames } from '../electron/diaryvoice';

const example = 'We were sitting there. In silence. A comfortable, post-competent-frying-pan-purchase silence. And then he says it. "Hey, uh... my girlfriend is coming over tomorrow." I just sat there.';

test('the voice is described, and nothing in it or the fragments names an event', () => {
  for (const text of [DIARY_VOICE, ...DIARY_FRAGMENTS]) {
    for (const leak of ['girlfriend', 'server', 'Elden', 'Margit', 'Scarlett', 'media', 'frying']) {
      assert.equal(text.toLowerCase().includes(leak.toLowerCase()), false, `"${leak}" leaked into the voice`);
    }
  }
  assert.match(DIARY_VOICE, /open on a hook/);
  assert.match(DIARY_VOICE, /contemptuous and fond at once/);
  assert.match(fragmentsInstruction(), /a tone to aim at, not lines to copy/);
  // Each fragment is shorter than a lift, so reusing one whole can never be flagged.
  for (const line of DIARY_FRAGMENTS) assert.ok(line.split(/\s+/).length < LIFTED_SPAN_WORDS, line);
  for (const line of DIARY_FRAGMENTS) assert.equal(liftedFrom(`Tonight. ${line} That was the day.`, [example, DIARY_FRAGMENTS.join(' ')]), null, line);
});

test('a lifted sentence is caught; a shared turn of phrase is not', () => {
  assert.equal(liftedFrom('And then he says it. "Hey, uh... my girlfriend is coming over tomorrow." I stared.', [example]), 'and then he says it hey uh my');
  assert.equal(liftedFrom('We were sitting there in silence again tonight, which is nothing new.', [example]), null, 'six shared words is a phrase, not a lift');
  assert.equal(liftedFrom('Short.', [example]), null);
  assert.equal(liftedFrom('anything at all', []), null);
  assert.notEqual(liftedFrom('AND THEN HE SAYS IT — "hey, uh, my GIRLFRIEND is coming over"', [example]), null);
  assert.match(NOT_THOSE_LINES, /a tone to aim at/);
});

test('a name the night never mentioned is caught; the ones it did are not', () => {
  const given = ['Tommy said "Boom see! I am actually doing work"', 'They got done: Rental Inspection, Scarlett Birthday Party.', 'Angel Beats is one of your own things'];
  const entry = 'Tommy shouted "Boom" at nothing. I dragged my feet across the Murdoch campus map planner, then devoured Angel Beats lore. Scarlett got her present. Was it impressive? Absolutely not.';
  assert.deepEqual(unknownNames(entry, given), ['Murdoch']);
  // Nothing strange in an entry that stays on its material.
  assert.deepEqual(unknownNames('Tommy did the Rental Inspection and then sulked. Barely a day.', given), []);
  // A sentence-opening capital is grammar, not a name.
  assert.deepEqual(unknownNames('Nothing happened. Honestly nothing. Tommy slept.', given), []);
  assert.match(NOT_THOSE_NAMES(['Murdoch']), /You named "Murdoch"/);
});

test('a possessive or a curly apostrophe is not a new name', () => {
  const given = ["Tommy said hello", "one of your own things: Chainsaw Man — Denji's moment in the Reze arc"];
  assert.deepEqual(unknownNames("Tommy’s day was a mess. Chainsaw Man’s Reze arc kept me up.", given), []);
  // A sentence-opening capital is grammar; mid-sentence, a stranger's name is caught without its 's.
  assert.deepEqual(unknownNames("Emma’s brother came over.", given), []);
  assert.deepEqual(unknownNames("Then, Emma’s brother came over.", given), ['Emma']);
});
