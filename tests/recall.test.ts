// What she said weeks ago, found again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cosine, exchangesFrom, pickRecalled, recallNote, RECALL_FLOOR } from '../electron/recall';

const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' });
const archive = {
  '2026-08-17': [
    { role: 'user', content: 'picking up a motherboard from Umart Belmont this morning' },
    { role: 'assistant', content: 'Fine. Do not drop it.' },
    { role: 'user', content: 'ok' },
  ],
  '2026-08-30': [{ role: 'user', content: 'went to mums house for dinner' }, { role: 'assistant', content: 'Good.' }],
  '2026-09-01': [{ role: 'user', content: 'yesterday, already in the prompt' }, { role: 'assistant', content: 'Yes.' }],
};

test('the archive becomes exchanges — his line and her answer — skipping the days already in front of her', () => {
  const out = exchangesFrom(archive, ['2026-09-01'], '2026-09-02');
  assert.deepEqual(out.map(e => e.day), ['2026-08-17', '2026-08-30'], 'the day already in the prompt is left out');
  assert.match(out[0].text, /^Them: picking up a motherboard from Umart Belmont this morning\nYou: Fine\. Do not drop it\.$/);
  assert.equal(out.some(e => e.text.startsWith('Them: ok')), false, 'a two-letter turn is not an exchange');
  assert.deepEqual(exchangesFrom(archive, [], '2026-09-02', 1).map(e => e.day), ['2026-09-01'], 'a one-day window reaches back one day');
  assert.deepEqual(exchangesFrom(archive, [], '2026-11-02').map(e => e.day), [], 'nothing at all once the window has passed them by');
});

test('only what is genuinely close comes back, best first, and it is dated when it does', () => {
  const found = exchangesFrom(archive, [], '2026-09-02');
  const vectors = new Map([[found[0].id, [1, 0, 0]], [found[1].id, [0, 1, 0]]]);
  const picked = pickRecalled(found, vectors, [0.98, 0.2, 0]);
  assert.equal(picked.length, 1, 'the unrelated one does not clear the floor');
  assert.equal(picked[0].exchange.day, '2026-08-17');
  assert.ok(picked[0].score >= RECALL_FLOOR);
  assert.deepEqual(pickRecalled(found, vectors, [0, 0, 1]), [], 'nothing close, nothing offered');
  const note = recallNote(picked, weekday);
  assert.match(note, /\[Monday 2026-08-17\]/);
  assert.match(note, /Umart Belmont/);
  assert.match(note, /not necessarily still true/);
  assert.equal(recallNote([], weekday), '');
});

test('cosine is a similarity and copes with nothing', () => {
  assert.equal(Math.round(cosine([1, 0], [1, 0]) * 100), 100);
  assert.equal(Math.round(cosine([1, 0], [0, 1]) * 100), 0);
  assert.equal(cosine([], [1, 0]), 0);
  assert.equal(cosine([1, 0], [1, 0, 0]), 0, 'different shapes are not comparable');
});
