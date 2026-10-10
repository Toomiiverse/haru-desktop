import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatReceipts } from '../electron/chat-receipts';
import { shellRelevant } from '../electron/tools';

test('business mentions do not route chat to a terminal; actual commands still do', () => {
  for (const text of ['I am at The PC Project', 'How far is the PC Project from Murdoch?', 'Working at PC Project today']) assert.equal(shellRelevant(text), false, text);
  for (const text of ['Run git status for The PC Project', 'Check the server at PC Project', 'Open the terminal', 'Update the PC']) assert.equal(shellRelevant(text), true, text);
});

test('receipts reuse an accepted turn, reject changed input, expire and isolate slates', () => {
  const receipts = new ChatReceipts(2, 100);
  const first = receipts.begin('a', 'input', 'slate', 0);
  assert.equal(first.fresh, true);
  assert.equal(receipts.begin('a', 'input', 'slate', 1).fresh, false);
  assert.throws(() => receipts.begin('a', 'other', 'slate', 2), /conflict/);
  receipts.begin('b', 'input', 'slate', 2);
  assert.throws(() => receipts.begin('c', 'input', 'slate', 3), /busy/);
  first.entry.state = 'done'; first.entry.reply = 'saved';
  assert.equal(receipts.get('a', 'slate', 3)?.reply, 'saved');
  receipts.begin('c', 'input', 'slate', 4);
  assert.equal(receipts.get('a', 'slate', 5), undefined);
  assert.equal(receipts.get('b', 'slate', 103), undefined);
  assert.equal(receipts.get('c', 'new slate', 104), undefined);
});
