// Keeping the screenshots on the server.
//
// The name comes off the network, so most of this file is one question asked
// several ways: can a caller who controls the filename write outside the folder
// they were given. Everything else here is bookkeeping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MAX_SHOT_BYTES, heldShots, keepShot, localShots, missingFrom, pruneShots,
  readShot, safeDay, safeName,
} from '../electron/shotstore';

const root = () => mkdtempSync(path.join(tmpdir(), 'haru-shots-'));
const bytes = Buffer.from('not really a png, but bytes all the same');

test('a name that tries to climb out of the folder is refused, not repaired', () => {
  for (const name of [
    '../escape.png',
    '../../escape.png',
    '..\\\\escape.png',
    '/etc/passwd.png',
    'C:\\\\Windows\\\\system32\\\\evil.png',
    'sub/dir/shot.png',
    'shot.png/../../elsewhere.png',
    '.hidden.png',
    'shot.png\u0000.txt',
  ]) {
    assert.equal(safeName(name), null, `${name} was accepted`);
  }
});

test('a name that is not an image is refused whatever it is called', () => {
  for (const name of ['shot.exe', 'shot', 'shot.png.exe', 'shot.js', '', '   ', 'shot.PNG.txt']) {
    assert.equal(safeName(name), null, `${name} was accepted`);
  }
  assert.equal(safeName(123), null);
  assert.equal(safeName(null), null);
});

test('an ordinary screenshot name survives', () => {
  for (const name of ['Screenshot 2026-08-29 143001.png', 'shot_01.jpeg', 'a-b.c.webp', 'Clip.JPG']) {
    assert.equal(safeName(name), name, `${name} was refused`);
  }
});

test('only a real day key is a day', () => {
  assert.equal(safeDay('2026-08-29'), '2026-08-29');
  for (const day of ['..', '2026-8-9', 'today', '2026-08-29/..', '', null, 20260829]) {
    assert.equal(safeDay(day), null, `${String(day)} was accepted`);
  }
});

test('keepShot refuses a climbing name rather than writing it somewhere safe', () => {
  const dir = root();
  assert.throws(() => keepShot(dir, '2026-08-29', '../escaped.png', bytes), /not a name/);
  assert.throws(() => keepShot(dir, '..', 'shot.png', bytes), /not a day/);
  assert.equal(existsSync(path.join(path.dirname(dir), 'escaped.png')), false);
});

test('an empty or oversized file is refused', () => {
  const dir = root();
  assert.throws(() => keepShot(dir, '2026-08-29', 'shot.png', Buffer.alloc(0)), /empty/);
  assert.throws(() => keepShot(dir, '2026-08-29', 'shot.png', Buffer.alloc(MAX_SHOT_BYTES + 1)), /too big/);
});

test('a kept screenshot lands under its day and reads back', () => {
  const dir = root();
  keepShot(dir, '2026-08-29', 'shot.png', bytes);
  assert.equal(existsSync(path.join(dir, '2026-08-29', 'shot.png')), true);
  assert.deepEqual(readShot(dir, '2026-08-29', 'shot.png'), bytes);
  assert.equal(readShot(dir, '2026-08-29', 'missing.png'), null);
  assert.equal(readShot(dir, '2026-08-29', '../escape.png'), null);
});

test('what is held is listed by day, and rubbish in the folder is ignored', () => {
  const dir = root();
  keepShot(dir, '2026-08-29', 'a.png', bytes);
  keepShot(dir, '2026-08-29', 'b.png', bytes);
  keepShot(dir, '2026-08-28', 'c.png', bytes);
  mkdirSync(path.join(dir, 'not-a-day'), { recursive: true });
  writeFileSync(path.join(dir, '2026-08-29', 'notes.txt'), 'ignore me');
  const held = heldShots(dir);
  assert.deepEqual(Object.keys(held).sort(), ['2026-08-28', '2026-08-29']);
  assert.deepEqual(held['2026-08-29'].sort(), ['a.png', 'b.png']);
});

test('an empty or missing store is no screenshots, not a crash', () => {
  assert.deepEqual(heldShots(path.join(root(), 'nothing-here')), {});
  assert.deepEqual(heldShots(root()), {});
});

test('only what the server is missing is sent, in the order it happened', () => {
  const mine = [
    { file: 'x', name: 'a.png', day: '2026-08-28' },
    { file: 'y', name: 'b.png', day: '2026-08-29' },
    { file: 'z', name: 'c.png', day: '2026-08-29' },
  ];
  const missing = missingFrom({ '2026-08-29': ['b.png'] }, mine);
  assert.deepEqual(missing.map(shot => shot.name), ['a.png', 'c.png']);
  assert.deepEqual(missingFrom({}, mine).map(shot => shot.name), ['a.png', 'b.png', 'c.png']);
  assert.deepEqual(missingFrom({ '2026-08-28': ['a.png'], '2026-08-29': ['b.png', 'c.png'] }, mine), []);
});

test('the same name on two different days is two different screenshots', () => {
  const mine = [
    { file: 'x', name: 'shot.png', day: '2026-08-28' },
    { file: 'y', name: 'shot.png', day: '2026-08-29' },
  ];
  assert.deepEqual(missingFrom({ '2026-08-29': ['shot.png'] }, mine).map(s => s.day), ['2026-08-28']);
});

test('days older than the cutoff are dropped whole', () => {
  const dir = root();
  keepShot(dir, '2026-05-01', 'old.png', bytes);
  keepShot(dir, '2026-08-29', 'new.png', bytes);
  assert.equal(pruneShots(dir, '2026-08-01'), 1);
  assert.equal(existsSync(path.join(dir, '2026-05-01')), false);
  assert.equal(existsSync(path.join(dir, '2026-08-29', 'new.png')), true);
  assert.equal(pruneShots(dir, '2026-08-01'), 0, 'pruning again drops nothing');
});

test('local screenshots are found by age, skipping what cannot be sent', () => {
  const folder = root();
  const now = new Date('2026-08-29T12:00:00.000Z');
  writeFileSync(path.join(folder, 'recent.png'), bytes);
  writeFileSync(path.join(folder, 'notes.txt'), bytes);
  writeFileSync(path.join(folder, 'empty.png'), Buffer.alloc(0));
  const found = localShots(folder, at => at.toISOString().slice(0, 10), name => name.endsWith('.png'), now, 90);
  assert.deepEqual(found.map(shot => shot.name), ['recent.png'], 'a text file and an empty file both went');
  assert.ok(found[0].file.endsWith('recent.png'));
});

test('a folder that is not there is no screenshots, not a crash', () => {
  const found = localShots(path.join(root(), 'gone'), () => '2026-08-29', () => true, new Date(), 90);
  assert.deepEqual(found, []);
});
