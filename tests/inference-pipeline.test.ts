import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { BackgroundInferenceDeferred, InferencePriority } from '../electron/inference-priority';

const build = process.env.HARU_LATENCY_RUNTIME ?? mkdtempSync(path.join(tmpdir(), 'haru-inference-'));
if (!process.env.HARU_LATENCY_RUNTIME) execFileSync(path.resolve('node_modules/.bin/tsc'), ['-p', 'electron/tsconfig.json', '--outDir', build]);
const source = readFileSync(path.join(build, 'main.js'), 'utf8').replace(/\b[a-z_]+_\d+\.default\./g, 'unusedDefault.').replace(/\b[a-z_]+_\d+\./g, '');
if (!process.env.HARU_LATENCY_RUNTIME) rmSync(build, { recursive: true, force: true });
const quietConsole = { log() {}, warn() {} };
function fn(name: string) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const defer = () => { throw new BackgroundInferenceDeferred('conversation'); };

test('real chat entry holds foreground priority before preparation and releases it on failure', async () => {
  const inferencePriority = new InferencePriority({ quietMs: 0 });
  await assert.rejects(vm.runInNewContext(`${fn('ollamaChat')}; ollamaChat([],{})`, {
    inferencePriority, markTurn() {},
    ollamaChatTurn: async () => { assert.equal(inferencePriority.inForeground, true); throw Error('preparation failed'); },
  }), /preparation failed/);
  assert.equal(inferencePriority.backgroundReason('http://localhost:11436', 'http://127.0.0.1:11436'), null);
});

test('actual screenshot backlog defers without recording failures, then retries the same image', async () => {
  let failures = 0, captions = 0, calls = 0;
  const context = {
    console: quietConsole, BackgroundInferenceDeferred, lookingAtShots: false,
    readVisionConfig: () => ({ enabled: true }), store: { get: () => ({}), set() {}, getActivityLog: () => [], setActivityLog() {} },
    shotStoreRoot: () => '/unused', existsSync: () => true, getSlate: () => null, readCaptions: () => [], captionsSince: () => [],
    heldShots: () => ({}), shotsSince: () => ({}), saidShotsBeforeSlate: false, describedShots: () => [],
    shotsNeedingALook: () => [{ day: '2026-09-30', name: 'synthetic.png' }], moreThanOnePass: () => false,
    visionEndpoint: () => 'http://127.0.0.1:11436', readShot: () => Buffer.from('synthetic'),
    modelHeaders: () => ({}), net: { fetch() {} }, SHOT_LOOK_PROMPT: '', visionNumCtx: () => 8192,
    backgroundLook: async () => { calls++; defer(); }, readShotDescription: (x: string) => x, CAPTION_MAX_CHARS: 100,
    noteFailure: () => { failures++; return []; }, noteCaption: () => { captions++; return []; },
    describeShot: (x: unknown) => x,
  };
  const runtime = vm.createContext(context);
  vm.runInContext(fn('lookAtSyncedShots'), runtime);
  await vm.runInContext('lookAtSyncedShots()', runtime);
  assert.equal(failures, 0); assert.equal(captions, 0); assert.equal(context.lookingAtShots, false);
  Object.assign(context, { backgroundLook: async () => { calls++; return { description: 'A synthetic caption.' }; } });
  await vm.runInContext('lookAtSyncedShots()', runtime);
  assert.equal(captions, 1); assert.equal(calls, 2); assert.equal(failures, 0);
});

test('actual screenshot watcher retains a deferred image for retry without replacing a newer image', async () => {
  for (const newer of [false, true]) {
    const shot = { path: 'synthetic.png' }, recent = { path: 'newer.png' };
    let scheduled = 0;
    const context = {
      console: quietConsole, BackgroundInferenceDeferred, pendingShot: shot, settleTimer: undefined,
      readScreenshotConfig: () => ({}), readVisionConfig: () => ({ enabled: true }), store: { get: () => ({ model: 'local' }) },
      settled: async () => true, maySpeak: () => false, screenshotSpokeAt: 0, readFileSync: () => Buffer.from('synthetic'),
      visionEndpoint: () => '', modelHeaders: () => ({}), net: { fetch() {} }, SHOT_LOOK_PROMPT: '', visionNumCtx: () => 8192,
      eyesHold: () => '5m', clearTimeout() {}, setTimeout: () => { scheduled++; return 1; },
      backgroundLook: async () => { if (newer) context.pendingShot = recent; defer(); },
    };
    await vm.runInNewContext(`${fn('remarkOnScreenshot')}; remarkOnScreenshot()`, context);
    assert.equal(context.pendingShot, newer ? recent : shot);
    assert.equal(scheduled, newer ? 0 : 1);
  }
});

test('real provider wrapper combines the local deadline with caller cancellation and preserves the hosted signal', async () => {
  const inferencePriority = new InferencePriority();
  for (const local of [true, false]) {
    const original = new AbortController();
    await inferencePriority.localReply(async () => {
      let received!: AbortSignal;
      const task = { post: async (...args: any[]) => { received = args[7]; return { role: 'assistant', content: 'valid' }; } };
      await vm.runInNewContext(`${fn('sendToProviderAdmitted')}; sendToProviderAdmitted([], {}, { tools: false, signal: originalSignal })`, {
        inferencePriority, AbortSignal, process: {env:{}}, providerAvailability: {assertAvailable(){}}, isLocalConfig: () => local, isAllowedTaskProvider: () => true, assertOutboundSafe() {},
        originalSignal: original.signal, activeTask: { getStore: () => task }, withToolContract: (x: unknown) => x,
      });
      if (local) { assert.notEqual(received, original.signal); original.abort(); assert.equal(received.aborted, true); }
      else assert.equal(received, original.signal);
    });
  }
});

test('actual transport defers background text models as well as vision before spending or dispatch', async () => {
  const inferencePriority = new InferencePriority();
  let sent = 0;
  const context = {
    inferencePriority, AbortSignal, process: {env:{}}, providerAvailability: {assertAvailable(){}}, isLocalConfig: () => true, protectedInferenceEndpoint: () => 'http://127.0.0.1:11436',
    sendToProviderAdmitted: async () => { sent++; return { role: 'assistant', content: 'valid' }; },
  };
  const code = `${fn('sendToProvider')}; sendToProvider([], {endpoint:'http://localhost:11436'}, {})`;
  await assert.rejects(vm.runInNewContext(code, context), error => error instanceof BackgroundInferenceDeferred);
  assert.equal(sent, 0);
  await inferencePriority.runForeground(() => vm.runInNewContext(code, context));
  assert.equal(sent, 1);
});
