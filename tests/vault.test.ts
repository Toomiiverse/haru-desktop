// Her side of the vault.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diaryNotes, herNote, indexNote, memoriesNote, nightNotes, placesNote, standingNote, writeNotes } from '../electron/vault';
import { DEFAULT_VAULT_SKIP, HARU_FOLDER, walkVault } from '../electron/obsidian';
import type { Standing } from '../electron/standing';
import type { Her } from '../electron/her';

const night = { day: '2026-08-30', at: '2026-08-30T15:00:00.000Z', about: 'Chainsaw Man best character', note: 'Power. Obviously.', sources: ['https://example.org/a'], interest: 'Chainsaw Man' };
const her: Her = { things: [{ name: 'Chainsaw Man', kind: 'anime', since: '2026-08-28', nights: 2, because: 'He kept mentioning it.', stance: 'Loud, and better for it.', favourite: 'Power' }], adventures: [{ day: '2026-08-30', at: night.at, about: night.about, why: 'one of her things', note: night.note, sources: night.sources }], likes: [{ name: 'Power', of: 'Chainsaw Man' }], wants: [], diary: { entries: 2, since: '2026-08-29', latest: { day: '2026-08-31', title: 'He forgot to say goodnight' } }, nightsOut: { count: 1, first: '2026-08-30' } } as unknown as Her;
const standing: Standing = { emotion: 'annoyed', face: 'annoyed', mood: 'Annoyed, and not hiding it.', bond: { value: 62, level: 3, of: 100, title: 'Brigade member', note: 'Getting there.', toNext: 8 }, meters: [{ key: 'energy', label: 'Energy', value: 70, note: 'Fine.' }], patience: { key: 'patience', label: 'Patience', value: 40, note: 'Thin.' }, grudge: { value: 1, of: 5, note: 'One thing.' }, knownDays: 30, daysTalked: 22, minutesSinceSpoke: 46, waiting: [{ id: 'a', title: 'Verge collection', when: 'yesterday', late: true }], stale: [] } as unknown as Standing;

test('a diary day is a note with frontmatter, its weekday, and a link to that night when there was one', () => {
  const [note] = diaryNotes([{ day: '2026-08-30', title: 'A long Sunday', text: 'He went to his mum’s.' }], new Set(['2026-08-30']));
  assert.equal(note.relative, `${HARU_FOLDER}/Diary/2026-08-30.md`);
  assert.match(note.text, /^---\ndate: 2026-08-30\ntitle: "A long Sunday"\ntags: \[haru\/diary\]\n---\n/);
  assert.match(note.text, /\*Sunday, 2026-08-30\*/);
  assert.match(note.text, /\[\[Haru\/Nights\/2026-08-30\|what she got up to\]\]/);
  const [plain] = diaryNotes([{ day: '2026-08-29', title: 'Quote "this"', text: 'Nothing.' }], new Set());
  assert.doesNotMatch(plain.text, /Nights/);
  assert.match(plain.text, /title: "Quote \\"this\\""/, 'quotes in a title are escaped for the frontmatter');
});

test('a night links its thing into Her and its sources out; Her links back to the nights', () => {
  const [note] = nightNotes([night]);
  assert.equal(note.relative, `${HARU_FOLDER}/Nights/2026-08-30.md`);
  assert.match(note.text, /\[\[Haru\/Her#Chainsaw Man\|Chainsaw Man\]\]/);
  assert.match(note.text, /- https:\/\/example\.org\/a/);
  assert.match(note.text, /\[\[Haru\/Diary\/2026-08-30\|her diary\]\]/);
  const page = herNote(her);
  assert.match(page.text, /### Chainsaw Man/);
  assert.match(page.text, /Favourite: Power/);
  assert.match(page.text, /\[\[Haru\/Nights\/2026-08-30\|2026-08-30\]\] — Chainsaw Man best character \(one of her things\)/);
  assert.match(page.text, /Latest diary entry: \[\[Haru\/Diary\/2026-08-31\|He forgot to say goodnight\]\]/);
});

test('standing is a page with meters, the bond, and the waiting list as checkboxes; memories are current only, by subject', () => {
  const page = standingNote(standing, '2026-08-31T03:00:00.000Z');
  assert.match(page.text, /mood: annoyed\nbond_level: 3/);
  assert.match(page.text, /\| Energy \| ███████░░░ 70 \| Fine\. \|/);
  assert.match(page.text, /- \[ \] Verge collection — yesterday \*\*\(late\)\*\*/);
  assert.match(page.text, /Last heard from him 46 min ago/);
  const memories = memoriesNote([
    { id: '1', text: 'Works at Happytel', kind: 'fact', subject: 'Work', createdAt: '2026-08-01T00:00:00Z', lastSeenAt: '2026-08-30T00:00:00Z', mentions: 3 },
    { id: '2', text: 'Uses Ubuntu', kind: 'fact', createdAt: '2026-08-01T00:00:00Z', lastSeenAt: '2026-08-02T00:00:00Z', mentions: 1, supersededBy: '3' },
    { id: '3', text: 'Uses Debian', kind: 'fact', createdAt: '2026-08-03T00:00:00Z', lastSeenAt: '2026-08-03T00:00:00Z', mentions: 1 },
  ] as never);
  assert.match(memories.text, /count: 2/);
  assert.match(memories.text, /## Work\n\n- Works at Happytel \*\(fact, ×3, 2026-08-30\)\*/);
  assert.doesNotMatch(memories.text, /Ubuntu/);
  assert.match(memories.text, /## General\n\n- Uses Debian/);
});

test('places and the index; the writer touches only what changed, and the knowledge sync never reads her folder', () => {
  const vault = mkdtempSync(path.join(os.tmpdir(), 'haru-vault-'));
  const where = { enabled: true, last: null, places: [{ name: 'home', lat: -32.0673, lon: 115.8287, radiusM: 150, added: '2026-08-20T00:00:00Z' }] };
  const notes = [placesNote(where, 'at work'), indexNote({ latestDiary: { day: '2026-08-31', title: 'T', text: 'x' }, latestNight: '2026-08-30', standing, her, memories: 2, places: 1 })];
  assert.match(notes[0].text, /\| home \| 2026-08-20 \| \[open\]\(https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-32\.06730,115\.82870\) \|/);
  assert.match(notes[1].text, /- \[\[Haru\/Standing\|Standing\]\] — Annoyed, and not hiding it\./);
  assert.deepEqual(writeNotes(vault, notes), { written: 2, unchanged: 0 });
  assert.deepEqual(writeNotes(vault, notes), { written: 0, unchanged: 2 });
  const before = statSync(path.join(vault, HARU_FOLDER, 'Haru.md')).mtimeMs;
  writeNotes(vault, notes);
  assert.equal(statSync(path.join(vault, HARU_FOLDER, 'Haru.md')).mtimeMs, before, 'an unchanged note is not rewritten');
  assert.equal(readFileSync(path.join(vault, HARU_FOLDER, 'Places.md'), 'utf8'), notes[0].text);
  assert.ok(!readdirSync(path.join(vault, HARU_FOLDER)).some(name => name.endsWith('.tmp')));
  assert.ok(DEFAULT_VAULT_SKIP.includes(HARU_FOLDER));
  assert.deepEqual(walkVault(vault), [], 'nothing of hers comes back as knowledge');
});
