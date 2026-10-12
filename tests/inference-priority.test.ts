import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundInferenceDeferred, InferencePriority, inferenceEndpoint } from '../electron/inference-priority';
import { guardedRequest } from '../electron/outbound';
import { look, DEFAULT_VISION } from '../electron/vision';
import { ReplyGate } from '../electron/reply-gate';

const local = 'http://127.0.0.1:11436';
const other = 'http://127.0.0.1:11435';
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const deferred = (error: unknown) => error instanceof BackgroundInferenceDeferred;

test('boot and recent conversation protect the shared instance, then allow its backlog', async () => {
  let now = 0, calls = 0;
  const priority = new InferencePriority({ now: () => now, quietMs: 100 });
  const run = () => priority.runBackground(local, local, async () => ++calls);
  await assert.rejects(run(), deferred);
  now = 100;
  assert.equal(await run(), 1);
  priority.interaction();
  now = 199;
  await assert.rejects(run(), deferred);
  now = 200;
  assert.equal(await run(), 2);
});

test('loopback aliases share protection; different ports and remote hosts remain distinct', () => {
  assert.equal(inferenceEndpoint('http://localhost:11436/'), inferenceEndpoint(local));
  assert.equal(inferenceEndpoint('http://[::1]:11436'), inferenceEndpoint(local));
  assert.notEqual(inferenceEndpoint(other), inferenceEndpoint(local));
  assert.notEqual(inferenceEndpoint('http://example.test:11436'), inferenceEndpoint(local));
});

test('overlapping foreground turns retain protection until both finish, including errors', async () => {
  let now = 0;
  const priority = new InferencePriority({ now: () => now, quietMs: 100 });
  const first = pending<void>(), second = pending<void>();
  const a = priority.runForeground(() => first.promise);
  const b = priority.runForeground(async () => { await second.promise; throw Error('turn failed'); });
  const rejected = assert.rejects(b, /turn failed/);
  first.resolve(); await a;
  now = 1000;
  assert.equal(priority.backgroundReason(local, local), 'conversation');
  second.resolve(); await rejected;
  assert.equal(priority.backgroundReason(local, local), 'recent_conversation');
  now += 100;
  assert.equal(priority.backgroundReason(local, local), null);
});

test('detached callbacks lose foreground privileges when their turn ends', async () => {
  const priority = new InferencePriority();
  const ready = pending<void>();
  let detached!: Promise<boolean>;
  await priority.runForeground(async () => {
    assert.equal(priority.inForeground, true);
    detached = ready.promise.then(() => priority.inForeground);
  });
  ready.resolve();
  assert.equal(await detached, false);
});

test('foreground preempts automatic vision; late captions never become evidence and can retry', async () => {
  let now = 100;
  const priority = new InferencePriority({ now: () => now, quietMs: 10 });
  now += 10;
  const response = pending<Response>();
  let signal!: AbortSignal, committed = 0;
  const job = priority.runBackground(local, local, async abort => {
    signal = abort;
    return look('synthetic image', { ...DEFAULT_VISION, enabled: true }, local, {}, async () => response.promise, { signal: abort });
  }).then(() => { committed++; });
  const rejected = assert.rejects(job, deferred);
  await priority.runForeground(async () => { assert.equal(signal.aborted, true); });
  response.resolve(Response.json({ message: { content: 'Late caption.' } }));
  await rejected;
  assert.equal(committed, 0);
  now += 10;
  assert.equal(await priority.runBackground(local, local, async () => 'retried'), 'retried');
});

test('only one automatic visual request enters an instance at a time', async () => {
  const priority = new InferencePriority({ quietMs: 0 });
  const ready = pending<string>();
  const first = priority.runBackground(local, local, () => ready.promise);
  await assert.rejects(priority.runBackground(local, local, async () => 'duplicate'), deferred);
  ready.resolve('first');
  assert.equal(await first, 'first');
});

test('vision on a separate instance stays available during a conversation', async () => {
  const priority = new InferencePriority();
  const ready = pending<string>();
  let signal!: AbortSignal;
  const job = priority.runBackground(other, local, async abort => { signal = abort; return ready.promise; });
  await priority.runForeground(async () => {
    assert.equal(signal.aborted, false);
    assert.equal(priority.backgroundReason(local, local), 'conversation');
  });
  ready.resolve('separate');
  assert.equal(await job, 'separate');
});

test('explicit foreground image requests remain possible', async () => {
  const priority = new InferencePriority();
  const result = await priority.runForeground(() => look('synthetic', { ...DEFAULT_VISION, enabled: true }, local, {},
    async () => Response.json({ message: { content: 'An explicit image.' } })));
  assert.equal(result.description, 'An explicit image.');
});

test('one local deadline spans nested draft and validation calls, withholding late text', async () => {
  const events: unknown[] = [], visible: string[] = [];
  const priority = new InferencePriority({ replyMs: 30, timing: event => events.push(event) });
  const gate = new ReplyGate(text => visible.push(text));
  let draftSignal!: AbortSignal;
  const late = pending<string>();
  let lateChunk!: (text: string) => void;
  await assert.rejects(priority.localReply(async () => {
    draftSignal = priority.replySignal!;
    gate.chunk('private draft');
    return priority.localReply(async () => {
      assert.equal(priority.replySignal, draftSignal);
      const result = await guardedRequest(async (_signal, chunk) => { lateChunk = chunk; return late.promise; },
        { signal: priority.replySignal, totalMs: 1000, onChunk: text => gate.chunk(text) });
      gate.commit(result);
      return result;
    });
  }), /local_reply_timeout/);
  assert.equal(draftSignal.aborted, true);
  lateChunk('late unvalidated text'); late.resolve('late unvalidated text');
  await Promise.resolve();
  assert.deepEqual(visible, []);
  assert.equal(events.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /private draft|unvalidated/);
});

test('successful local replies release their timer and subsequent rounds get a fresh budget', async () => {
  const priority = new InferencePriority({ replyMs: 100 });
  let first!: AbortSignal;
  assert.equal(await priority.localReply(async () => { first = priority.replySignal!; return 'valid'; }), 'valid');
  assert.equal(first.aborted, true);
  await priority.localReply(async () => { assert.notEqual(priority.replySignal, first); assert.equal(priority.replySignal!.aborted, false); });
  assert.equal(priority.replySignal, undefined);
});

test('normal failures retain their cause; telemetry cannot change scheduling or completion', async () => {
  const priority = new InferencePriority({ quietMs: 0, timing: () => { throw Error('logger'); } });
  await assert.rejects(priority.localReply(async () => { throw Error('privacy_denied'); }), /privacy_denied/);
  await priority.runForeground(async () => {
    await assert.rejects(priority.runBackground(local, local, async () => 'forbidden'), deferred);
  });
  assert.equal(await priority.localReply(async () => 'valid'), 'valid');
});
