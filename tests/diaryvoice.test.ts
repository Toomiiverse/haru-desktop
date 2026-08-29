// The voice from the examples, without the events from the examples.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DIARY_FRAGMENTS, DIARY_VOICE, fragmentsInstruction, liftedFrom, LIFTED_SPAN_WORDS, NOT_THOSE_LINES } from '../electron/diaryvoice';

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
