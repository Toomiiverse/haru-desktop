import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyGate } from '../electron/reply-gate';

test('an opening goes out at once and the commit sends only the rest', () => {
  const out: string[] = [], logged: string[] = [];
  const gate = new ReplyGate(t => out.push(t), l => logged.push(l));
  gate.opening('[neutral] Morning.');
  gate.commit('[neutral] Morning. [curious] Sleep at all?');
  assert.deepEqual(out, ['[neutral] Morning.', ' [curious] Sleep at all?']);
  assert.deepEqual(logged, ['[reply-gate] {"opening":"kept","chars":18}']);
});

test('a final text that no longer starts with the opening is reset and shown whole, not failed', () => {
  const out: string[] = [], warned: string[] = [];
  const gate = new ReplyGate(t => out.push(t), l => warned.push(l));
  gate.opening('[neutral] Morning.');
  gate.commit('[annoyed] Took you long enough.');
  assert.deepEqual(out, ['[neutral] Morning.', '�', '[annoyed] Took you long enough.']);
  assert.deepEqual(warned, ['[reply-gate] {"opening":"replaced","chars":18}']);
  assert.throws(() => gate.commit('x'), /reply_already_published/);
});

test('without an opening the commit publishes everything', () => {
  const out: string[] = [];
  const gate = new ReplyGate(t => out.push(t));
  gate.commit('[neutral] Hi.');
  assert.deepEqual(out, ['[neutral] Hi.']);
});

test('a reset takes the opening back and the next round may open again', () => {
  const out: string[] = [], logged: string[] = [];
  const gate = new ReplyGate(t => out.push(t), l => logged.push(l));
  gate.opening('[smug] Odokawa.');
  gate.reset();
  assert.deepEqual(logged, ['[reply-gate] {"opening":"reset","chars":15}']);
  gate.reset();   // idle resets publish nothing more
  gate.opening('[neutral] Two things.');
  gate.commit('[neutral] Two things. [happy] The walrus.');
  assert.deepEqual(out, ['[smug] Odokawa.', '\uFFFD', '[neutral] Two things.', ' [happy] The walrus.']);
});

test('a hold shows while a tool runs and the opening takes it back first', () => {
  const out: string[] = [];
  const gate = new ReplyGate(t => out.push(t));
  gate.hold('hang on, looking');
  gate.hold('one sec');   // a later tool keeps the first line
  gate.opening('[neutral] Twenty degrees.');
  gate.commit('[neutral] Twenty degrees. [dry] Bring a jacket.');
  assert.deepEqual(out, ['hang on, looking', '�', '[neutral] Twenty degrees.', ' [dry] Bring a jacket.']);
});

test('a hold with no opening is taken back by the commit, and by a reset', () => {
  const out: string[] = [];
  const gate = new ReplyGate(t => out.push(t));
  gate.hold('one sec');
  gate.reset();
  gate.reset();   // nothing held any more
  gate.hold('checking that now');
  gate.commit('[neutral] Done.');
  assert.deepEqual(out, ['one sec', '�', 'checking that now', '�', '[neutral] Done.']);
});

test('a hold after an opening or a commit shows nothing', () => {
  const out: string[] = [];
  const gate = new ReplyGate(t => out.push(t));
  gate.opening('[neutral] Hi.');
  gate.hold('one sec');
  gate.commit('[neutral] Hi. There.');
  gate.hold('one sec');
  assert.deepEqual(out, ['[neutral] Hi.', ' There.']);
});
