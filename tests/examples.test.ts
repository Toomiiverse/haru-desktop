// How she sounds at her best, shown rather than described.

import test from 'node:test';
import assert from 'node:assert/strict';
import { examplePool, examplesNote, fitForExample, pickExamples, reusedExample, type Example } from '../electron/examples';

const archive = {
  '2026-09-02': [
    { role: 'user', content: 'GPU is installed' },
    { id: 'a1', role: 'assistant', content: 'Good. Now hand it over.' },
    { role: 'user', content: 'yes omg I did get it' },
    { id: 'a2', role: 'assistant', content: 'Good. Now that you actually did something, keep it up. Stop wasting my time.', reaction: 'up' },
  ],
  '2026-09-06': [
    { role: 'user', content: 'Just wanted to make sure you weren’t dead' },
    { id: 'b1', role: 'assistant', content: '[smug] Still here. Unfortunately for you.', reaction: 'up' },
    { role: 'user', content: 'you there?' },
    { id: 'b2', role: 'assistant', content: "I'm asleep. I'll see it when I'm up.", reaction: 'up' },
    { role: 'user', content: 'hello?' },
    { id: 'b3', role: 'assistant', content: "I'm asleep. I'll see it when I'm up." },
    { role: 'user', content: 'what time is it' },
    { id: 'b4', role: 'assistant', content: 'It is 10:40. You have a clock, use it.', reaction: 'up' },
    { role: 'user', content: 'Thanks Harry' },
    { id: 'b5', role: 'assistant', content: "It's Haru. You know this. You've known this for months.", reaction: 'down' },
  ],
  '2026-09-15': [
    { role: 'user', content: 'recent' },
    { id: 'c1', role: 'assistant', content: 'Too recent to be an example, she can still see this.', reaction: 'up' },
  ],
};
const rewrites = { a1: { text: "Good. It's in. Boot it up and let's see if you seated it crooked." } };

test('the pool: rewrites and liked replies from older days — not canned, not stale facts, not disliked, not the old voice', () => {
  const pool = examplePool(archive, rewrites, '2026-09-14');
  assert.deepEqual(pool.map(example => [example.id, example.kind]), [['a1', 'revoiced'], ['b1', 'liked']]);
  assert.equal(pool[0].hers, "Good. It's in. Boot it up and let's see if you seated it crooked.");
  assert.equal(pool[1].hers, 'Still here. Unfortunately for you.', 'delivery tags come off');
  assert.equal(pool.some(example => example.id === 'a2'), false, 'liked before the persona rewrite');
  assert.equal(pool.some(example => example.id === 'b2'), false, 'said word for word twice: canned');
  assert.equal(pool.some(example => example.id === 'b4'), false, 'a time in it');
  assert.equal(pool.some(example => example.id === 'c1'), false, 'still in her shown history');
  assert.equal(examplePool(archive, rewrites, '2026-09-14', '2026-09-01').some(example => example.id === 'a2'), true);
  assert.equal(fitForExample('hi', 'x'.repeat(400)), false);
});

test('picks rotate by day, at most two rewrites, and the note says the lines are spent', () => {
  const pool: Example[] = [
    ...['r1', 'r2', 'r3'].map(id => ({ id, theirs: 'x', hers: `rewrite ${id} long enough to count`, kind: 'revoiced' as const, day: '2026-09-02' })),
    ...['l1', 'l2', 'l3', 'l4'].map(id => ({ id, theirs: 'y', hers: `liked ${id} long enough to count`, kind: 'liked' as const, day: '2026-09-06' })),
  ];
  const today = pickExamples(pool, '2026-09-17');
  assert.equal(today.length, 3);
  assert.equal(today.filter(example => example.kind === 'revoiced').length, 2);
  assert.deepEqual(pickExamples(pool, '2026-09-17'), today, 'stable within a day');
  const week = new Set(['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'].flatMap(day => pickExamples(pool, day).map(example => example.id)));
  assert.ok(week.size > 3, 'rotates across days');
  const note = examplesNote(today);
  assert.match(note, /never reuse one/);
  assert.match(note, /\n\nThem: x\nYou: rewrite/);
  assert.equal(examplesNote([]), '');
});

test('a reply that lifts eight words in a row from an example is caught', () => {
  const examples = examplePool(archive, rewrites, '2026-09-14');
  assert.equal(reusedExample("Fine. Good. It's in. Boot it up and let's see if you seated it crooked, genius.", examples)?.id, 'a1');
  assert.equal(reusedExample('Boot it up and see.', examples), null);
});
