import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadArchive, normalizeArchive, saveArchive } from '../electron/archive';

function dir(): string {
  return mkdtempSync(path.join(tmpdir(), 'haru-archive-test-'));
}

test('a day of transcript survives the round trip', () => {
  const file = path.join(dir(), 'archive.json');
  assert.deepEqual(loadArchive(file), {});
  const archive = { '2026-08-28': [{ role: 'user', content: 'morning' }], '2026-08-29': [] };
  saveArchive(file, archive);
  assert.deepEqual(loadArchive(file), archive);
});

test('nothing partial is left behind by a write', () => {
  const home = dir();
  const file = path.join(home, 'archive.json');
  saveArchive(file, { '2026-08-29': [1, 2, 3] });
  assert.deepEqual(readdirSync(home), ['archive.json']);
});

test('a mangled day is dropped, the rest is kept', () => {
  assert.deepEqual(normalizeArchive({ '2026-08-29': ['a'], '2026-08-28': 'not a day' }), { '2026-08-29': ['a'] });
  assert.deepEqual(normalizeArchive(null), {});
  assert.deepEqual(normalizeArchive(['2026-08-29']), {});
});

test('an unreadable file reads as no archive rather than throwing', () => {
  const file = path.join(dir(), 'archive.json');
  writeFileSync(file, '{ this is not json');
  assert.deepEqual(loadArchive(file), {});
});
