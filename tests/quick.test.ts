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

test('with the small talk switched off, greetings and stray words go to the model; the lookups stay scripted', () => {
  const data = { now: new Date(2026, 7, 31, 14, 30), todayKey: '2026-08-31', nickname: 'Tommy', herName: 'Haru', agenda: { today: [{ title: 'Verge', done: false }], tomorrow: [] }, checkInsToday: 0, irritation: 0, ignoring: false } as never;
  assert.equal(quickAnswer('Hey Haru', data, { social: false }), null);
  assert.equal(quickAnswer('how are you today', data, { social: false }), null);
  assert.equal(quickAnswer('Rockingham', data, { social: false }), null);
  assert.equal(quickAnswer('what time is it', data, { social: false })?.reply, "It's 2:30 PM.");
  assert.equal(quickAnswer("what's on today", data, { social: false })?.tier, 3);
  assert.equal(quickAnswer('Hey Haru', data)?.tier, 1, 'unchanged when small talk is allowed');
});

