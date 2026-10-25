// Her screen reading what he codes: the hunk picked from a changed file, and the folder picked from his transcripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changedLines, dirtyPaths, isSource, MAX_CHARS, MAX_LINES, newestTranscript, sessionCwd } from '../electron/codeWatch';

test('changedLines picks the stretch that changed, trimmed and capped', () => {
  const before = 'a\nb\nc\nd\n';
  assert.deepEqual(changedLines(before, 'a\n  x = 1;\n\n  y = 2;\nc\nd\n'), ['x = 1;', 'y = 2;']);
  assert.deepEqual(changedLines(before, 'a\nb\nc\nd\ne\n'), ['e']);
  assert.deepEqual(changedLines(before, 'a\nc\nd\n'), [], 'a deletion adds no lines');
  assert.deepEqual(changedLines(before, before), []);
  const many = changedLines(before, `a\n${Array.from({ length: 9 }, (_, i) => `l${i}`).join('\n')}\nd\n`);
  assert.equal(many.length, MAX_LINES);
  const long = changedLines('', 'x'.repeat(100));
  assert.equal(long[0].length, MAX_CHARS);
  assert.ok(long[0].endsWith('\u2026'));
});

test('sessionCwd reads the escaped Windows path', () => {
  assert.equal(sessionCwd('{"cwd":"C:\\\\Users\\\\Tommy PC\\\\Projects\\\\x","type":"user"}'), 'C:\\Users\\Tommy PC\\Projects\\x');
  assert.equal(sessionCwd('{"type":"summary"}'), null);
});

test('isSource keeps code and skips what builds and installs write', () => {
  assert.ok(isSource('src\\PortraitWindow.tsx'));
  assert.ok(isSource('scripts/portrait/build_assets.py'));
  assert.ok(!isSource('node_modules\\x\\index.js'));
  assert.ok(!isSource('dist-electron/main.js'));
  assert.ok(!isSource('build/portrait/iris.png'));
  assert.ok(!isSource('notes.txt~'));
});

test('newestTranscript is the one written to last', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'haru-code-'));
  mkdirSync(path.join(root, 'p1')); mkdirSync(path.join(root, 'p2'));
  const old = path.join(root, 'p1', 'a.jsonl'), fresh = path.join(root, 'p2', 'b.jsonl');
  writeFileSync(old, '{}'); writeFileSync(fresh, '{}'); writeFileSync(path.join(root, 'p2', 'c.txt'), '');
  utimesSync(old, new Date(2000, 0, 1), new Date(2000, 0, 1));
  assert.equal(newestTranscript(root), fresh);
  assert.equal(newestTranscript(path.join(root, 'missing')), null);
});

test('dirtyPaths lists changed and untracked files, a rename by its new name', () => {
  assert.deepEqual(dirtyPaths(' M src/a.ts\0?? tmp/b.ts\0R  new.ts\0old.ts\0 D gone.ts\0'), ['src/a.ts', 'tmp/b.ts', 'new.ts', 'gone.ts']);
  assert.deepEqual(dirtyPaths(''), []);
});
