// A tuning note: what was wrong with a reply, kept where she cannot read it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTuningPage, cleanRather, cleanWrong, recordTuning, tuningNote, tuningPage } from '../electron/tuning';

const history = [
  { id: 'o', role: 'assistant', content: 'You are up early.' },
  { id: 'u1', role: 'user', content: 'How was work' },
  { id: 'a1', role: 'assistant', content: 'Fine. You never ask twice.', reaction: 'down' },
];
const about = { source: 'phone' as const, model: 'qwen', at: '2026-09-20T09:14:00.000Z', day: '2026-09-20' };

test('a note carries the reply, what it answered, and both halves of the correction', () => {
  const note = tuningNote(history, { ...about, id: 'a1', wrong: '  too   clipped ', rather: 'Long day. You?' });
  assert.deepEqual(note, {
    at: about.at, day: '2026-09-20', source: 'phone', id: 'a1',
    wrong: 'too clipped', rather: 'Long day. You?',
    reaction: 'down', prompt: 'How was work', reply: 'Fine. You never ask twice.', model: 'qwen',
  });
});

test('the thumb already on the reply is recorded, never given', () => {
  assert.equal(tuningNote(history, { ...about, id: 'o', wrong: 'flat' })?.reaction, null);
  assert.equal(tuningNote(history, { ...about, id: 'a1', wrong: 'flat' })?.reaction, 'down');
});

test('a reply she volunteered answers nothing, and says so', () => {
  assert.equal(tuningNote(history, { ...about, id: 'o', wrong: 'flat' })?.prompt, null);
});

test('only a reply of hers can be tuned', () => {
  assert.equal(tuningNote(history, { ...about, id: 'u1', wrong: 'flat' }), null);
  assert.equal(tuningNote(history, { ...about, id: 'nope', wrong: 'flat' }), null);
});

test('either half alone is a note; neither is a mis-tap', () => {
  assert.ok(tuningNote(history, { ...about, id: 'a1', wrong: 'too clipped' }));
  assert.ok(tuningNote(history, { ...about, id: 'a1', rather: 'Long day. You?' }));
  assert.equal(tuningNote(history, { ...about, id: 'a1', wrong: '   ', rather: '' }), null);
  assert.equal(tuningNote(history, { ...about, id: 'a1' }), null);
});

test('what was wrong is one line; what he would rather keeps its paragraphs', () => {
  assert.equal(cleanWrong(' two\nlines '), 'two lines');
  assert.equal(cleanWrong(42), null);
  assert.equal(cleanWrong('x'.repeat(2000))?.length, 1000);
  assert.equal(cleanRather('one\n\n\n\ntwo'), 'one\n\ntwo');
  assert.equal(cleanRather('  \n '), null);
  assert.equal(cleanRather('x'.repeat(9000))?.length, 4000);
});

test('notes append as one line each, and the day gets a page a person can read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haru-tuning-'));
  try {
    const file = join(dir, 'tuning.jsonl');
    const first = tuningNote(history, { ...about, id: 'a1', wrong: 'too clipped' })!;
    const second = tuningNote(history, { ...about, id: 'a1', rather: 'Long day.\n\nYou?' })!;
    recordTuning(file, first);
    recordTuning(file, second);
    const lines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { wrong: string | null });
    assert.deepEqual(lines.map(line => line.wrong), ['too clipped', null]);

    const pages = join(dir, 'tuning');
    appendTuningPage(pages, first);
    appendTuningPage(pages, second);
    assert.deepEqual(readdirSync(pages), ['2026-09-20.md']);
    const page = readFileSync(join(pages, '2026-09-20.md'), 'utf8');
    // One heading for the day however many notes land on it, and one for each note.
    assert.equal(page.match(/^# /gm)?.length, 1);
    assert.equal(page.match(/^### /gm)?.length, 2);
    assert.match(page, /\*\*Wrong:\*\* too clipped/);
    assert.match(page, /> Long day\.\n>\n> You\?/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a reply with markdown of its own cannot restyle the page', () => {
  const note = tuningNote(history.map(m => m.id === 'a1' ? { ...m, content: '# not a heading' } : m), { ...about, id: 'a1', wrong: 'shouting' })!;
  assert.match(tuningPage(note), /^> # not a heading$/m);
  assert.equal(tuningPage(note).match(/^# /gm), null);
});
