import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyGate } from '../electron/reply-gate';

test('an opening goes out at once and the commit sends only the rest', () => {
  const out: string[] = [];
  const gate = new ReplyGate(t => out.push(t));
  gate.opening('[neutral] Morning.');
  gate.commit('[neutral] Morning. [curious] Sleep at all?');
  assert.deepEqual(out, ['[neutral] Morning.', ' [curious] Sleep at all?']);
});

test('a final text that no longer starts with the opening is reset and shown whole, not failed', () => {
  const out: string[] = [], warned: string[] = [];
  const gate = new ReplyGate(t => out.push(t), l => warned.push(l));
  gate.opening('[neutral] Morning.');
  gate.commit('[annoyed] Took you long enough.');
  assert.deepEqual(out, ['[neutral] Morning.', '�', '[annoyed] Took you long enough.']);
  assert.equal(warned.length, 1);
  assert.throws(() => gate.commit('x'), /reply_already_published/);
});

test('without an opening the commit publishes everything', () => {
  const out: string[] = [];
  const gate = new ReplyGate(t => out.push(t));
  gate.commit('[neutral] Hi.');
  assert.deepEqual(out, ['[neutral] Hi.']);
});
