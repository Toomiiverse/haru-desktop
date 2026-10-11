// Her life, written down: the record of her nights and the diary she keeps.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendDream, appendEntry, DIARY_BEFORE_WAKE_MINUTES, DIARY_FILE, diaryContext, diaryDueFor, diaryInstruction, DREAMS_FILE, entryTitle, formatEntry, parseEntries, readDreams, recentEntries, type DayMaterial, type Dream } from '../electron/diary';

const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' });
const dream = (over: Partial<Dream> = {}): Dream => ({ at: '2026-08-30T18:30:00.000Z', day: '2026-08-29', kind: 'deepen', about: 'Elden Ring review', interest: 'Elden Ring', sources: [{ title: 'IGN', url: 'https://ign.example/x' }], reading: 'a whole page of review text', wrote: 'still brilliant', ...over });

test('every night is written down whole, and can be read back by the evening it belongs to', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'haru-dreams-'));
  appendDream(root, dream());
  appendDream(root, dream({ day: '2026-08-30', kind: 'free', about: 'neon signs', interest: undefined, transcript: true }));
  const raw = readFileSync(path.join(root, DREAMS_FILE), 'utf8');
  assert.equal(raw.trim().split('\n').length, 2);
  assert.match(raw, /a whole page of review text/, 'the reading itself is kept, not just a link');
  assert.equal(readDreams(root).length, 2);
  assert.deepEqual(readDreams(root, '2026-08-29').map(d => d.about), ['Elden Ring review']);
  assert.equal(readDreams(path.join(root, 'nowhere')).length, 0);
});
