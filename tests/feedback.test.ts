// A rating, as it will be learned from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPOKE_KEPT, cleanNote, feedbackEntry, modelThatSpoke, readSpoke, recordFeedback, rememberSpoke, repliedTo } from '../electron/feedback';

const history = [
  { id: 'o', role: 'assistant', content: 'You are up early.' },
  { id: 'u1', role: 'user', content: 'How good is hy3' },
  { id: 'a1', role: 'assistant', content: 'Strong for its size.', reaction: 'down' },
  { id: 'u2', role: 'user', content: 'thanks' },
];
const about = { source: 'phone' as const, model: 'qwen', at: '2026-08-28T04:00:00.000Z' };

test('an entry carries the reply, the message it answered, and what they said about it', () => {
  const entry = feedbackEntry(history, { ...about, id: 'a1', reaction: 'up', note: '  too   nice ' });
  assert.deepEqual(entry, { at: about.at, source: 'phone', id: 'a1', reaction: 'up', note: 'too nice', prompt: 'How good is hy3', reply: 'Strong for its size.', model: 'qwen' });
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

// Which brain actually spoke. Added 2026-09-20: every thumb on disk was
// stamped with the local brain whoever answered, because the stored message
// carries no model and the renderer owns it.
test('modelThatSpoke reads back the route that was speaking when the reply was stamped', () => {
  const spoke = [
    { at: '2026-09-01T10:00:00.000Z', model: 'qwen-27b', brain: 'local' },
    { at: '2026-09-15T12:00:00.000Z', model: 'kimi-k2-5', brain: 'hosted:kimi-k2-5' },
    { at: '2026-09-19T16:11:00.000Z', model: 'claude-sonnet-5', brain: 'escalated:claude-sonnet-5' },
  ];
  assert.equal(modelThatSpoke(spoke, '2026-09-16T09:00:00.000Z', 'fallback'), 'kimi-k2-5');
  assert.equal(modelThatSpoke(spoke, '2026-09-01T10:00:00.000Z', 'fallback'), 'qwen-27b', 'the stamp itself counts');
  assert.equal(modelThatSpoke(spoke, '2026-09-20T00:00:00.000Z', 'fallback'), 'claude-sonnet-5');
  assert.equal(modelThatSpoke(spoke, '2026-08-01T00:00:00.000Z', 'fallback'), 'fallback', 'older than the record');
  assert.equal(modelThatSpoke(spoke, undefined, 'fallback'), 'fallback', 'a reply with no stamp');
  assert.equal(modelThatSpoke([], '2026-09-16T09:00:00.000Z', 'fallback'), 'fallback');
});

test('the spoke record is bounded and readable back', () => {
  let spoke = readSpoke(undefined);
  assert.deepEqual(spoke, []);
  for (let index = 0; index < 250; index += 1) spoke = rememberSpoke(spoke, { at: `2026-09-20T00:00:${String(index % 60).padStart(2, '0')}.000Z`, model: `m${index}`, brain: 'local' }, SPOKE_KEPT);
  assert.equal(spoke.length, SPOKE_KEPT);
  assert.equal(spoke.at(-1)!.model, 'm249', 'the newest survives');
  assert.deepEqual(readSpoke([{ at: 'x', model: 'y', brain: 'z' }, { nonsense: true }]), [{ at: 'x', model: 'y', brain: 'z' }]);
});

test('repliedTo hands back the reply stamp, which is how the model is found', () => {
  const history = [
    { id: 'u1', role: 'user', content: 'oi', at: '2026-09-16T08:59:00.000Z' },
    { id: 'a1', role: 'assistant', content: 'what', at: '2026-09-16T09:00:00.000Z' },
  ];
  assert.equal(repliedTo(history, 'a1')!.at, '2026-09-16T09:00:00.000Z');
  assert.equal(repliedTo(history, 'u1'), null, 'not a reply of hers');
});
