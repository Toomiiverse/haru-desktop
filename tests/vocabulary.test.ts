// The names the ear is told to expect, and where they come from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { namesInText, spokenVocabulary } from '../electron/vocabulary';
import { echoesVocabulary, looksLikeNothing } from '../electron/listen';

test('the names Whisper was getting wrong are found in the conversation as written', () => {
  const chat = [
    'Anyways I need to go to iGaming to grab a 9060XT for a customers PC',
    "That card doesn't exist. AMD hasn't even announced the 9000 series yet, let alone a \"9060 XT\".",
    'I meant, where are you up to in Chainsaw Man?',
    "I told you. Himeno's death. Denji's hesitation. The end of Part 1.",
    'Four accounts plus Family Sharing is a perfectly fine scrappy workaround.',
  ];
  const names = namesInText(chat);
  for (const want of ['iGaming', '9060XT', 'AMD', 'Chainsaw Man', 'Himeno', 'Denji', 'Family Sharing', 'PC']) {
    assert.ok(names.includes(want), `${want} in ${JSON.stringify(names)}`);
  }
});

test('a word that opens a sentence is not a name, and neither is one she also writes in lowercase', () => {
  const chat = ['Fine. Eat. But don\'t take an hour.', 'Just pay the damn fine if you get one.', 'Check the part list. Good. Don\'t drop it.', 'Stop gloating. Go get it.'];
  assert.deepEqual(namesInText(chat), []);
  assert.deepEqual(namesInText(['Morning. Rain again. Tch.']), [], 'her openers');
  assert.deepEqual(namesInText(['Obviously you forgot. Honestly.']), [], 'no adverb is a name');
  assert.deepEqual(namesInText(["Himeno's death. Denji's hesitation. Eat. Move."]), ['Himeno', 'Denji'], 'a possessive vouches for a name at the front of a sentence; an order is not one');
  assert.deepEqual(namesInText(['Reze is back. I liked Reze.']), ['Reze', 'Reze'], 'seen mid-sentence once, the one opening a sentence counts too');
  assert.deepEqual(namesInText(['It has Family Sharing. Ask Emily.']), ['Family Sharing', 'Emily'], 'Family is not an adverb');
  assert.deepEqual(namesInText(['Family Sharing works.']), ['Sharing'], 'at the front of a sentence with no witness, the first word is an order until proven otherwise');
});

test('a run of capitalised words is one term, and a comma ends it', () => {
  assert.deepEqual(namesInText(['Ask Denji, Himeno and Aki about it']), ['Denji', 'Himeno', 'Aki']);
  assert.deepEqual(namesInText(['I am at The PC Project now']), ['PC Project'], 'the article is not part of it here; the places list carries the full name');
  assert.deepEqual(namesInText(['the RX 9060 XT is out']), ['RX 9060 XT']);
  assert.deepEqual(namesInText(['about 9060 of them']), [], 'a number with no word beside it is a number');
});

test('what she is told outranks what she inferred, the latest conversation outranks the oldest, and nothing is said twice', () => {
  const list = spokenVocabulary({
    names: ['Haru', 'Tommy'],
    taught: ['Reze'],
    places: ['The PC Project', 'iGaming'],
    kept: ['Order the Ryzen for Marcus'],
    chat: ['We talked about Chainsaw Man yesterday', 'Then I went to igaming', 'And Himeno came up today'],
  });
  assert.deepEqual(list.slice(0, 5), ['Haru', 'Tommy', 'Reze', 'The PC Project', 'iGaming']);
  assert.ok(list.indexOf('Himeno') < list.indexOf('Chainsaw Man'), 'latest first');
  assert.equal(list.filter(term => term.toLowerCase() === 'igaming').length, 1, 'once, whichever case');
  assert.ok(list.includes('Ryzen') && list.includes('Marcus'));
});

test('the list is capped, and by characters as well as by count', () => {
  const many = Array.from({ length: 80 }, (_, i) => `N${i}`);
  assert.equal(spokenVocabulary({ names: many }).length, 30);
  const long = Array.from({ length: 20 }, (_, i) => `Somebody With A Very Long Name Number ${i}`);
  const total = spokenVocabulary({ names: long }).join(', ').length;
  assert.ok(total <= 220, `${total} chars`);
  assert.deepEqual(spokenVocabulary({}), []);
});

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
