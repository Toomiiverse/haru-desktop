import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTIONS_KEPT, MAX_LOOK_TRIES, noteFailure, captionsFor, describedShots, forgetCaptions, moreThanOnePass, noteCaption, readCaptions, shotsNeedingALook, unseenShots, type Caption } from '../electron/seen';

const caption = (day: string, name: string, text = 'a window'): Caption => ({ day, name, at: `${day}T09:00:00.000Z`, text });

test('the oldest day is looked at first, in the order the day happened', () => {
  const held = {
    '2026-08-28': ['1200.png', '0900.png'],
    '2026-08-27': ['2300.png'],
  };
  assert.deepEqual(unseenShots(held, [], 4), [
    { day: '2026-08-27', name: '2300.png' },
    { day: '2026-08-28', name: '0900.png' },
    { day: '2026-08-28', name: '1200.png' },
  ]);
});

test('a shot already looked at is not looked at again, and a pass is bounded', () => {
  const held = { '2026-08-28': ['a.png', 'b.png', 'c.png'] };
  const seen = [caption('2026-08-28', 'a.png')];
  assert.deepEqual(unseenShots(held, seen, 5), [
    { day: '2026-08-28', name: 'b.png' },
    { day: '2026-08-28', name: 'c.png' },
  ]);
  // Three hundred waiting must not become three hundred in one pass.
  const backlog = { '2026-08-28': Array.from({ length: 300 }, (_, i) => `${i}.png`) };
  assert.equal(unseenShots(backlog, [], 6).length, 6);
});

test('looking again replaces the caption rather than adding a second', () => {
  const first = noteCaption([], caption('2026-08-28', 'a.png', 'a browser'));
  const again = noteCaption(first, caption('2026-08-28', 'a.png', 'a browser, with a spreadsheet behind it'));
  assert.equal(again.length, 1);
  assert.equal(again[0].text, 'a browser, with a spreadsheet behind it');
});

test('the list is capped, oldest out', () => {
  let captions: Caption[] = [];
  for (let i = 0; i < CAPTIONS_KEPT + 20; i++) captions = noteCaption(captions, caption('2026-08-28', `${i}.png`));
  assert.equal(captions.length, CAPTIONS_KEPT);
  assert.equal(captions[0].name, '20.png');
});

test('a day reads back in order, and captions do not outlive their shots', () => {
  const captions = [caption('2026-08-28', 'b.png'), caption('2026-08-27', 'x.png'), caption('2026-08-28', 'a.png')];
  assert.deepEqual(captionsFor(captions, '2026-08-28').map(entry => entry.name), ['a.png', 'b.png']);
  assert.deepEqual(forgetCaptions(captions, '2026-08-28').map(entry => entry.day), ['2026-08-28', '2026-08-28']);
});

test('a mangled record is dropped rather than carried forward', () => {
  assert.deepEqual(readCaptions(null), []);
  assert.deepEqual(readCaptions([{ day: '2026-08-28' }, caption('2026-08-28', 'a.png')]).length, 1);
});

test('the model is held only while there is a backlog to come back to', () => {
  const one = { '2026-08-28': ['a.png', 'b.png'] };
  assert.equal(moreThanOnePass(one, []), false);
  const many = { '2026-08-28': Array.from({ length: 40 }, (_, i) => `${i}.png`) };
  assert.equal(moreThanOnePass(many, []), true);
  // Caught up mid-backlog: nothing left to come back for.
  const done = many['2026-08-28'].map(name => caption('2026-08-28', name));
  assert.equal(moreThanOnePass(many, done), false);
});

test('a shot the desk already described is not looked at again', () => {
  const held = { '2026-08-28': ['a.png', 'b.png', 'c.png'] };
  const log = {
    '2026-08-28': [
      { shot: 'a.png', description: 'A browser showing the Search Console.' },
      { shot: 'b.png', description: '   ' },
      { shot: 'c.png' },
    ],
  };
  assert.deepEqual(describedShots(log), { '2026-08-28': ['a.png'] });
  // b has an empty description and c none at all, so both still need a look.
  assert.deepEqual(shotsNeedingALook(held, [], describedShots(log), 5), [
    { day: '2026-08-28', name: 'b.png' },
    { day: '2026-08-28', name: 'c.png' },
  ]);
});

test('the two ledgers agree — ours and theirs both count as done', () => {
  const held = { '2026-08-28': ['a.png', 'b.png'] };
  const described = { '2026-08-28': ['a.png'] };
  const ours = [caption('2026-08-28', 'b.png')];
  assert.deepEqual(shotsNeedingALook(held, ours, described, 5), []);
  assert.equal(moreThanOnePass(held, ours, described), false);
});

test('a log with no descriptions changes nothing', () => {
  assert.deepEqual(describedShots({}), {});
  assert.deepEqual(describedShots({ '2026-08-28': [{ shot: 'a.png' }] }), {});
});

test('a shot that keeps failing is left alone, however it fails', () => {
  const held = { '2026-08-28': ['big.png', 'ok.png'] };
  let captions = noteFailure([], '2026-08-28', 'big.png', '2026-08-29T00:00:00.000Z');
  // Once is bad luck: still in the queue, and still ahead of the others.
  assert.deepEqual(unseenShots(held, captions, 5).map(s => s.name), ['big.png', 'ok.png']);
  captions = noteFailure(captions, '2026-08-28', 'big.png', '2026-08-29T00:05:00.000Z');
  assert.equal(captions.find(c => c.name === 'big.png')?.tries, MAX_LOOK_TRIES);
  // Twice is the picture. It stops being offered; nothing else is affected.
  assert.deepEqual(unseenShots(held, captions, 5).map(s => s.name), ['ok.png']);
});

test('a failed look is not a caption', () => {
  const captions = noteFailure([], '2026-08-28', 'big.png', '2026-08-29T00:00:00.000Z');
  assert.deepEqual(captionsFor(captions, '2026-08-28'), []);
  // And a later success replaces the failure rather than sitting beside it.
  const after = noteCaption(captions, caption('2026-08-28', 'big.png', 'A spreadsheet.'));
  assert.equal(after.length, 1);
  assert.equal(captionsFor(after, '2026-08-28')[0].text, 'A spreadsheet.');
});
