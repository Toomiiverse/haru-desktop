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

test('the entry is due just before the quiet ends, and as a catch-up through the morning', () => {
  const prefs = { quietFrom: '23:00', quietTo: '06:00' };
  const evening = (at: Date) => (at.getHours() < 12 ? 'last-night' : 'tonight');
  const at = (h: number, m = 0) => new Date(2026, 7, 30, h, m, 0, 0);
  assert.equal(diaryDueFor(at(2), prefs, evening), null, 'the middle of the night is too early — the night is not over');
  assert.equal(diaryDueFor(at(5, 15), prefs, evening), 'last-night');
  assert.equal(diaryDueFor(at(5, 59), prefs, evening), 'last-night');
  assert.equal(diaryDueFor(at(8), prefs, evening), 'last-night', 'missed the window: still owed');
  assert.equal(diaryDueFor(at(14), prefs, evening), null, 'by the afternoon it is too late to be last night');
  assert.equal(diaryDueFor(at(23, 30), prefs, evening), null, 'just gone to bed: nothing to write yet');
  assert.ok(DIARY_BEFORE_WAKE_MINUTES >= 30);
});

test('what she writes from is facts, laid out, with the rule that it is only those', () => {
  const m: DayMaterial = {
    day: '2026-08-29', theySaid: ['nothing important, ignore me', 'Set me a reminder to eat @12'], theirMessages: 37, herUnprompted: 5,
    irritation: 5, grudge: 1, ignoredToday: 1, went: 'fine', ticked: ['Rental Inspection'],
    nights: [{ about: 'Elden Ring review', note: 'brilliant and cruel', interest: 'Elden Ring' }],
    tastes: [{ name: 'Elden Ring', stance: 'A masterpiece that hates you.' }], weather: '15°C and clear',
  };
  const note = diaryInstruction(m);
  assert.match(note, /small hours after 2026-08-29, before he is up/);
  assert.match(diaryInstruction({ ...m, hisLastMessageAt: '10:49 PM' }), /His last message to you was at 10:49 PM\. You do not know when he went to bed/);
  assert.match(note, /before he is up/);
  assert.match(note, /WHAT YOU \(Haru\) DID TONIGHT while he slept — yours, not his/);
  assert.match(note, /YOUR OWN THINGS \(yours, not his/);
  assert.match(note, /never written as something he did or said/);
  assert.match(note, /a time of day or a thing they own/);
  assert.match(note, /WHAT HE SAID TO YOU today \(37 messages in all\)/);
  assert.match(note, /"nothing important, ignore me"/);
  assert.match(note, /37 messages in all/);
  assert.match(note, /They got on your nerves today\./);
  assert.match(note, /1 of your messages to them got no answer\./);
  assert.match(note, /You messaged them first 5 times\./);
  assert.match(note, /They got done: Rental Inspection\./);
  assert.match(note, /spent the night on Elden Ring, one of your own things: brilliant and cruel/);
  assert.match(note, /Elden Ring — A masterpiece that hates you\./);
  assert.match(note, /Write about them in the third person, by name/);
  assert.match(note, /never "you"/);
  assert.match(note, /no sign-off aimed at them/);
  assert.match(note, /Do not invent an event/);
  // A day of nothing says so rather than leaving a gap to fill.
  const quiet = diaryInstruction({ ...m, theySaid: [], theirMessages: 0, herUnprompted: 0, irritation: 0, grudge: 0, ignoredToday: 0, went: 'silent', ticked: [], nights: [], tastes: [], weather: undefined });
  assert.match(quiet, /He said nothing to you today\./);
  assert.match(quiet, /went to bed without telling you a single thing/);
  assert.match(quiet, /Tonight you did nothing at all/);
  assert.match(quiet, /do not fill it with something/);
});

test('entries are dated sections, appended, and read back newest last', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'haru-diary-'));
  appendEntry(root, '2026-08-29', 'Tommy was a pain. I read about Elden Ring instead.', weekday);
  appendEntry(root, '2026-08-30', 'Better today.', weekday);
  const raw = readFileSync(path.join(root, DIARY_FILE), 'utf8');
  assert.match(raw, /^# Haru's Diary/);
  assert.match(raw, /## 2026-08-29 — Saturday/);
  assert.match(raw, /## 2026-08-30 — Sunday/);
  assert.deepEqual(recentEntries(root, 1), [{ day: '2026-08-30', title: 'Better today.', text: 'Better today.' }]);
  assert.equal(recentEntries(root, 5).length, 2);
  assert.equal(recentEntries(path.join(root, 'nowhere'), 2).length, 0);
  assert.equal(formatEntry('2026-08-29', '  x  ', weekday), '## 2026-08-29 — Saturday\n\nx\n\n');
  assert.deepEqual(parseEntries('## bad header\n\ntext\n## 2026-01-01 — Thursday\n\nok'), [{ day: '2026-01-01', title: 'ok', text: 'ok' }]);
});

test('the last entries reach her prompt as her own words, and none is nothing', () => {
  assert.equal(diaryContext([]), '');
  const said = diaryContext([{ day: '2026-08-29', text: 'Tommy was a pain.' }]);
  assert.match(said, /From your own diary/);
  assert.match(said, /2026-08-29: Tommy was a pain\./);
});

test('an entry carries her title on its heading, and an old one gets its first sentence', () => {
  const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' });
  assert.equal(formatEntry('2026-08-29', 'x', weekday, 'The night he said Boom'), '## 2026-08-29 — Saturday — The night he said Boom\n\nx\n\n');
  const parsed = parseEntries('## 2026-08-29 — Saturday — The night he said Boom\n\nTommy shouted. I read.\n\n## 2026-08-30 — Sunday\n\nA long first sentence that goes on and on past the point where a tab can show it in one line, honestly. Then more.');
  assert.equal(parsed[0].title, 'The night he said Boom');
  assert.match(parsed[1].title, /^A long first sentence that goes on and on past the point wher…$/);
  assert.equal(entryTitle('Short one. And another.'), 'Short one.');
  assert.equal(entryTitle('anything', '"Quoted title"'), 'Quoted title');
  // A title with a dash in it survives the split.
  assert.equal(parseEntries('## 2026-08-29 — Saturday — Boom — and then nothing\n\nx')[0].title, 'Boom — and then nothing');
});
