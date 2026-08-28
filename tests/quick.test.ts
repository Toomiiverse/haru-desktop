// The scripted route, for the one case a rule could not fix.

import test from 'node:test';
import assert from 'node:assert/strict';
import { quickAnswer, type QuickData } from '../electron/quick';

const data = (over: Partial<QuickData> = {}): QuickData => ({
  now: new Date('2026-08-28T05:00:00Z'), todayKey: '2026-08-28', nickname: 'Tommy', herName: 'Haru',
  agenda: { today: [], tomorrow: [] }, checkInsToday: 0, irritation: 0, ignoring: false, ...over,
} as QuickData);

test('a lone word out of nowhere is asked about, by script, and nothing is invented', () => {
  for (const word of ['Seeds', 'Belong', 'Mountain']) {
    const hit = quickAnswer(word, data({ lastOfHers: 'Go fix what is broken.' }));
    assert.ok(hit, word);
    assert.equal(hit!.tier, 2);
    assert.ok(hit!.reply.includes(word), `${word} is said back`);
    assert.ok(/[🙄😒👀😤]/u.test(hit!.reply));
  }
});

test('the same slip gets the same line, so she does not read as searching for one', () => {
  assert.equal(quickAnswer('Seeds', data())!.reply, quickAnswer('Seeds', data())!.reply);
});

test('a word that answers her question, or is a whole reply on its own, goes to the model', () => {
  assert.equal(quickAnswer('Seeds', data({ lastOfHers: 'What are you buying her?' })), null);
  for (const word of ['Done', 'Tired', 'Tomorrow', 'Nothing', 'Testing']) {
    const hit = quickAnswer(word, data());
    assert.ok(!hit || hit.tier !== 2 || !hit.reply.includes('not a message'), `${word} is a reply, not a stray`);
  }
});

test('two words, a number, or a sentence is not a stray word', () => {
  for (const text of ['Seeds please', '42', 'Belong to what?', 'x']) {
    const hit = quickAnswer(text, data({ lastOfHers: 'Go.' }));
    assert.ok(!hit || !hit.reply.includes('not a message'), text);
  }
});
