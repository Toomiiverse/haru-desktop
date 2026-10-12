import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyGate } from '../electron/reply-gate';
import { runToolLoop, type ToolLoopDeps } from '../electron/toolloop';
import { guardedRequest } from '../electron/outbound';

test('rejected rounds and late chunks never reach the UI; the accepted reply is published once', async () => {
  const shown: string[] = [], gate = new ReplyGate(t => shown.push(t));
  let asked = 0;
  const deps: ToolLoopDeps = { ask: async () => {
    const text = ++asked === 1 ? 'Your backup completed successfully.' : 'I cannot verify that the backup finished.';
    gate.chunk(text); assert.deepEqual(shown, []); return { role: 'assistant', content: text };
  }, runTool: async () => { throw Error('No tools'); }, resetStream: gate.reset, handsAllowed: () => false, pageWasRead: () => false, withdrawHands() {}, hasOpenTask: () => false, canSearch: () => false };
  const result = await runToolLoop([{ role: 'user', content: 'Did the backup finish?' }], deps);
  assert.deepEqual(shown, []);
  gate.commit(result.content);gate.chunk('late unsupported assertion');
  assert.deepEqual(shown, ['I cannot verify that the backup finished.']);
  assert.throws(() => gate.commit('duplicate'), /already_published/);
});
test('withheld transport chunks still satisfy the first-word timeout', async () => {
  const shown: string[] = [], gate = new ReplyGate(t => shown.push(t));
  const result = await guardedRequest(async (_signal, chunk) => { chunk('draft');await new Promise(r => setTimeout(r, 25));return 'final'; }, { firstWordMs: 10, totalMs: 1000, onChunk: gate.chunk });
  assert.equal(result, 'final');assert.deepEqual(shown, []);
});
