import test from 'node:test';
import assert from 'node:assert/strict';
import { readShotDescription } from '../electron/vision';

// ---- readShotDescription: the answer, or nothing ----
//
// Every one of these came back from the vision model on 2026-09-07 and was
// stored as what he had been looking at.

test('the template copied back as the answer is not a description', () => {
  assert.equal(readShotDescription('Text: <everything you read>\nDoing: <one sentence>'), '');
  assert.equal(readShotDescription('Text: everything you read\nDoing: one sentence'), '');
});

test('a real answer keeps its content and loses the template brackets', () => {
  assert.equal(
    readShotDescription('Text: <August 2026>\nDoing: <Checking the calendar and tasks in a calendar application>'),
    'Text: August 2026\nDoing: Checking the calendar and tasks in a calendar application',
  );
});

test('a field the model had nothing for is dropped, not stored as the word none', () => {
  assert.equal(readShotDescription('Text: None\nDoing: The image is of a character from a game.'), 'Doing: The image is of a character from a game.');
  assert.equal(readShotDescription('Text: None\nDoing: None'), '');
  assert.equal(readShotDescription('Text: <nothing>\nDoing: An animated character on a black background.'), 'Doing: An animated character on a black background.');
});

test('an ordinary two-line read is left exactly as it was', () => {
  const said = 'Text: No VM guests are running outdated hypervisor (qemu) binaries on this host.\nDoing: Running a command in a terminal.';
  assert.equal(readShotDescription(said), said);
});

test('a model that answers in prose instead of labels is still heard', () => {
  assert.equal(readShotDescription('A terminal window with a build running in it.'), 'A terminal window with a build running in it.');
});
