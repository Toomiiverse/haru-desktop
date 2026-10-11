// The names the ear is told to expect, and where they come from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { namesInText, spokenVocabulary } from '../electron/vocabulary';
import { echoesVocabulary, looksLikeNothing } from '../electron/listen';

test('the hotwords read back as speech are treated as nothing said', () => {
  const vocabulary = ['Haru', 'Tommy', 'The PC Project', 'iGaming', 'Chainsaw Man', 'Himeno'];
  assert.ok(echoesVocabulary('Haru, Tommy, The PC Project, iGaming, Chainsaw Man, Himeno', vocabulary), 'the whole list');
  assert.ok(echoesVocabulary('Haru, Tommy, The PC Project', vocabulary), 'the front of it');
  assert.ok(echoesVocabulary('The PC Project, iGaming', vocabulary), 'two terms from the middle');
  assert.ok(echoesVocabulary('PC Project, iGaming, Chainsaw', vocabulary), 'four words of it cut mid-term');
  assert.ok(!echoesVocabulary('Chainsaw Man?', vocabulary), 'one term alone is a thing a person says');
  assert.ok(!echoesVocabulary('Where are you up to in Chainsaw Man?', vocabulary));
  assert.ok(!echoesVocabulary('I am heading to iGaming to grab a card for Tommy', vocabulary), 'terms inside a sentence are the point');
  assert.ok(!echoesVocabulary('Chainsaw Man, Haru', vocabulary), 'not in the order they were sent');
  assert.ok(looksLikeNothing('Haru, Tommy, The PC Project', vocabulary));
  assert.ok(!looksLikeNothing('Haru, are you there?', vocabulary));
  assert.ok(looksLikeNothing('Thank you.'), 'the old checks stand');
});
