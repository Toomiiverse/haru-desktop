import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InferencePriority } from '../electron/inference-priority';
import { TaskBridge } from '../electron/task-bridge';
import { TaskController } from '../electron/task-controller';
import { readModelRegistry, readTaskPolicy } from '../electron/model-registry';

test('a cancelled local fallback settles its durable attempt before reporting failure, without cloud escalation', async t => {
  // A separate diagnostic database, never the live task worker or its recovery.
  const bridge = new TaskBridge('/home/toomii/haru-core', path.join(mkdtempSync(path.join(tmpdir(), 'haru-inference-ledger-')), 'tasks.db'));
  t.after(() => bridge.close());
  const local = { provider: 'ollama', model: 'synthetic-local', endpoint: 'http://127.0.0.1:11436', temperature: 0.1 };
  const registry = readModelRegistry({}, { local });
  const events: { method: string; args: any }[] = [];
  let taskId = '';
  const task = new TaskController(async (method, args) => {
    events.push({ method, args });
    const result = await bridge.call(method, args);
    if (method === 'create') taskId = result.id;
    return result;
  }, registry, readTaskPolicy({ deadlineMs: 10_000 }), false);
  await task.start('Synthetic fallback deadline test', local.model);
  const priority = new InferencePriority({ replyMs: 100 });
  let dispatched = false;
  await assert.rejects(priority.localReply(() => task.compose(() => task.post(
    [{ role: 'user', content: 'Synthetic request.' }], local, [], 100,
    async () => { dispatched = true; return new Promise(() => {}); }, undefined, undefined, priority.replySignal,
  ))), /local_reply_timeout/);
  assert.equal(dispatched, true);
  const record = await bridge.call('get', { taskId });
  assert.equal(record.status, 'failed');
  assert.equal(record.reservedMicros, 0);
  assert.equal(record.spentMicros, 0);
  assert.equal(record.escalations, 0);
  assert.equal(events.filter(e => e.method === 'reserve').length, 1);
  assert.equal(events.find(e => e.method === 'settle')?.args.status, 'unknown');
  assert.ok(events.findIndex(e => e.method === 'settle') < events.findIndex(e => e.method === 'finish'));
});
