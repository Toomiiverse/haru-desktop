import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTIONS_KEPT, captionsFor, forgetCaptions, noteCaption, readCaptions, unseenShots, type Caption } from '../electron/seen';

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
