// A rating, as it will be learned from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanNote, feedbackEntry, recordFeedback } from '../electron/feedback';

const history = [
  { id: 'o', role: 'assistant', content: 'You are up early.' },
  { id: 'u1', role: 'user', content: 'How good is hy3' },
  { id: 'a1', role: 'assistant', content: 'Strong for its size.', reaction: 'down' },
  { id: 'u2', role: 'user', content: 'thanks' },
];
const about = { source: 'phone' as const, model: 'qwen', at: '2026-08-28T04:00:00.000Z' };

test('an entry carries the reply, the message it answered, and what they said about it', () => {
  const entry = feedbackEntry(history, { ...about, id: 'a1', reaction: 'up', note: '  too   nice ' });
  assert.deepEqual(entry, { at: about.at, source: 'phone', id: 'a1', reaction: 'up', note: 'too nice', emoji: null, prompt: 'How good is hy3', reply: 'Strong for its size.', model: 'qwen' });
});

test('a reply she volunteered answers nothing, and says so', () => {
  assert.equal(feedbackEntry(history, { ...about, id: 'o', reaction: 'down' })?.prompt, null);
});

test('a note added after a thumb still records the thumb', () => {
  assert.equal(feedbackEntry(history, { ...about, id: 'a1', note: 'flat' })?.reaction, 'down');
});

test('only a reply of hers can be rated', () => {
  assert.equal(feedbackEntry(history, { ...about, id: 'u1', reaction: 'up' }), null);
  assert.equal(feedbackEntry(history, { ...about, id: 'nope', reaction: 'up' }), null);
});

test('a note is trimmed, bounded, and absent when empty', () => {
  assert.equal(cleanNote('   '), null);
  assert.equal(cleanNote(42), null);
  assert.equal(cleanNote('x'.repeat(2000))?.length, 1000);
});

test('entries append as one line each', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haru-feedback-'));
  try {
    const file = join(dir, 'feedback.jsonl');
    const entry = feedbackEntry(history, { ...about, id: 'a1', reaction: 'up' })!;
    recordFeedback(file, entry);
    recordFeedback(file, { ...entry, reaction: 'down' });
    const lines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { reaction: string });
    assert.deepEqual(lines.map(line => line.reaction), ['up', 'down']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an emoji put on a reply is written down as itself, beside the thumb it did not replace', () => {
  const entry = feedbackEntry(history, { ...about, id: 'a1', emoji: ' 🙄 ' });
  assert.equal(entry?.emoji, '🙄');
  assert.equal(entry?.reaction, 'down');
});
