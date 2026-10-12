import test from 'node:test';
import assert from 'node:assert/strict';
import { recentWindow } from '../electron/history';

const thread = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));

test('under the leash nothing is cut', () => {
  assert.deepEqual(recentWindow(thread(40), 200).map(m => m.content), thread(40).map(m => m.content));
});

test('the cut holds for ten exchanges, then steps, and always starts on one of theirs', () => {
  const starts = [];
  for (let n = 202; n <= 244; n += 2) starts.push(recentWindow(thread(n), 200)[0].content);
  assert.deepEqual(starts, ['20', '20', '20', '20', '20', '20', '20', '20', '20', '20', '40', '40', '40', '40', '40', '40', '40', '40', '40', '40', '60', '60']);
  for (let n = 201; n <= 260; n++) { const w = recentWindow(thread(n), 200); assert.equal(w[0].role, 'user'); assert.ok(w.length >= 181 && w.length <= 200, String(w.length)); }
});

test('a cut that lands on her line moves to his next one', () => {
  const t = thread(230); t[40] = { role: 'assistant', content: 'hers' }; t[41] = { role: 'user', content: 'his' };
  assert.equal(recentWindow(t, 200)[0].content, 'his');
});
