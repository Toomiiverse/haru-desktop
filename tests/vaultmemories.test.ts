// The vault pages that become standing memories: People.md, Preferences.md
// and Us.md at the vault root, one bullet per record.
//
// The parsing half is what is worth testing — what counts as a record, what is
// skipped, and how a bullet's bold lead becomes its subject — because a page
// misread is a memory that never lands, and a TODO line admitted would be a
// memory that never stops being wrong. The admission half is two lines through
// the memory store's gate, which memory.test.ts already covers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { admitVaultMemories, parseVaultMemoryPage } from '../electron/vaultmemories';

const PEOPLE = `---
tags: [haru/people, tommy]
---

# People — Tommy's people

> One bullet per person.

## Family

- **Johnny** — Tommy's stepfather; his mom's second husband, later divorced from her.
- **Emma Wilson** — Tommy's girlfriend since 18 June 2024, born 28 January 2006.

## TODO: add anyone missing

- TODO: siblings or other family.
`;

const PREFERENCES = `# Preferences — how Haru behaves around Tommy

> Haru reads this page hourly.

- Keep replies human-length and direct — no support-staff voice.
- Don't interrupt with unprompted lines while Tommy is working at the shop.
- TODO: how long should replies be on work days?
`;

const US = `# Us — the shared history only we know

- **The bins** — Tommy's bins go out on Thursday.
- **Haru, with one r** — he once spelled her name "Harru".
- A moment that needs no name.
- TODO: nicknames you have for each other.
`;

test('People bullets become relationship records with the bold lead as subject', () => {
  const drafts = parseVaultMemoryPage(PEOPLE, 'People.md');
  assert.equal(drafts.length, 2, 'TODOs and headings are not records');
  assert.equal(drafts[0].kind, 'relationship');
  assert.equal(drafts[0].subject, 'Johnny');
  assert.equal(drafts[0].text, 'Johnny — Tommy\'s stepfather; his mom\'s second husband, later divorced from her.');
  assert.equal(drafts[1].subject, 'Emma Wilson');
  assert.ok(drafts[0].text.length > 0 && !drafts[0].text.includes('**'), 'asterisks are stripped');
});

test('Preferences bullets become preference records with no subject', () => {
  const drafts = parseVaultMemoryPage(PREFERENCES, 'Preferences.md');
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].kind, 'preference');
  assert.equal(drafts[0].subject, undefined);
  assert.equal(drafts[1].text, 'Don\'t interrupt with unprompted lines while Tommy is working at the shop.');
});

test('Us bullets become facts, subject from the bold lead or the shared "us"', () => {
  const drafts = parseVaultMemoryPage(US, 'Us.md');
  assert.equal(drafts.length, 3);
  assert.equal(drafts[0].kind, 'fact');
  assert.equal(drafts[0].subject, 'The bins');
  assert.equal(drafts[2].subject, 'us', 'a bullet without a bold lead is about the two of them');
});

test('an inline *(TODO: …)* note on a real bullet is not part of the record', () => {
  const drafts = parseVaultMemoryPage('- **Tommy\'s mum** — lives in Perth. *(TODO: what should Haru know about her?)*', 'People.md');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].text, 'Tommy\'s mum — lives in Perth.');
  assert.equal(drafts[0].subject, 'Tommy\'s mum');
});

test('the same bullet on the same page has the same id, so syncs repeat not duplicate', () => {
  const once = parseVaultMemoryPage(PEOPLE, 'People.md');
  const again = parseVaultMemoryPage(PEOPLE, 'People.md');
  assert.equal(once[0].id, again[0].id);
  assert.notEqual(once[0].id, once[1].id);
  const otherPage = parseVaultMemoryPage(PREFERENCES, 'Preferences.md');
  assert.notEqual(once[0].id, otherPage[0].id, 'pages do not collide');
});

test('a missing page is absent from the report, not an error', () => {
  const seen: string[] = [];
  const report = admitVaultMemories('/nonexistent', () => null);
  assert.equal(report.length, 0);
  assert.deepEqual(seen, []);
});

test('admission tallies new and repeated records per page', () => {
  const admitted: { text: string; kind: string; subject?: string }[] = [];
  const report = admitVaultMemories('/vault', draft => {
    if (draft.text.includes('Johnny')) return null; // e.g. refused by the gate
    admitted.push(draft);
    return { created: draft.text.includes('Emma') };
  }, file => {
    assert.ok(file.endsWith('/vault/People.md') || file.endsWith('/vault/Us.md'), `unexpected read: ${file}`);
    return file.endsWith('Us.md') ? US : PEOPLE;
  }, file => file.endsWith('Us.md') || file.endsWith('People.md'));
  assert.deepEqual(report, [
    { page: 'People.md', bullets: 2, admitted: 1, repeated: 0 },
    { page: 'Us.md', bullets: 3, admitted: 0, repeated: 3 },
  ]);
  assert.equal(admitted.length, 4);
  assert.ok(admitted.every(draft => draft.kind === 'relationship' || draft.kind === 'fact'));
});