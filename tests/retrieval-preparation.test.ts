import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { prefetchCoreMemory, readCoreMemoryConfig, selectCoreMemory, type CoreMemoryRequest, type CoreMemoryResponse } from '../electron/core-memory';

const config = { ...readCoreMemoryConfig({ HARU_CORE_MEMORY: 'on' }), expectedEpochId: 'epoch' };
const revision = 'a'.repeat(64), slate = '2026-09-21T00:00:00.000Z';
const request: CoreMemoryRequest = { protocol: 1, query: 'remember my tea', latest: 'tea', expectedSourceRevision: revision,
  now: slate, expectedSlateAt: slate, expectedEpochId: 'epoch' };
const block = { value: 'current memory', memoryIds: [] };
const response: CoreMemoryResponse = { protocol: 1, epochId: 'epoch', slateAt: slate, sourceRevision: revision,
  retrieval: 'semantic', blocks: { human: block, preferences: block, relationship: block, shared_history: block } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const select = (read: ReturnType<typeof prefetchCoreMemory>, sourceRevision = () => revision, slateAt = () => slate) => selectCoreMemory({
  config, query: request.query, latest: request.latest, now: new Date(request.now), sourceRevision, slateAt, read,
  render: derived => derived ? derived.human.value : 'desktop memory', fallbackRender: () => 'fresh fallback',
});

test('prefetch is already running during desktop work and one matching read supplies selection', async () => {
  let reads = 0, resolve!: (value: CoreMemoryResponse) => void;
  const read = prefetchCoreMemory(config, { ...request }, async () => { reads++; return new Promise(r => { resolve = r; }); });
  await tick(); assert.equal(reads, 1);
  const selected = select(read);
  await tick(); assert.equal(reads, 1, 'selection consumes the same in-flight request');
  resolve(response);
  assert.equal((await selected).profile, 'current memory');
});

test('identical scalar inputs reuse the prefetch regardless of object property order', async () => {
  let reads = 0;
  const read = prefetchCoreMemory(config, request, async () => { reads++; return response; });
  const reversed = Object.fromEntries(Object.entries(request).reverse()) as CoreMemoryRequest;
  assert.equal(await read(config, reversed), response); assert.equal(reads, 1);
});

test('corrections, deletions and resets during desktop work cause a fresh Core read', async () => {
  for (const reset of [false, true]) {
    const changedRevision = 'b'.repeat(64), changedSlate = reset ? '2026-09-22T00:00:00.000Z' : slate;
    const seen: CoreMemoryRequest[] = [];
    const read = prefetchCoreMemory(config, request, async (_config, r) => {
      seen.push(r);
      return { ...response, sourceRevision: r.expectedSourceRevision, slateAt: r.expectedSlateAt,
        blocks: { ...response.blocks, human: { value: r.expectedSourceRevision === revision ? 'stale memory' : 'corrected or deleted', memoryIds: [] } } };
    });
    await tick();
    const selected = await select(read, () => changedRevision, () => changedSlate);
    assert.equal(seen.length, 2); assert.equal(seen[1].expectedSlateAt, changedSlate);
    assert.equal(selected.profile, 'corrected or deleted'); assert.doesNotMatch(selected.profile, /stale/);
  }
});

test('changes while a prefetched read is awaited still force freshly rendered fallback', async () => {
  for (const reset of [false, true]) {
    let currentRevision = revision, currentSlate = slate, resolve!: (value: CoreMemoryResponse) => void;
    const read = prefetchCoreMemory(config, request, async () => new Promise(r => { resolve = r; }));
    const pending = select(read, () => currentRevision, () => currentSlate);
    await tick();
    if (reset) currentSlate = '2026-09-22T00:00:00.000Z'; else currentRevision = 'b'.repeat(64);
    resolve(response);
    const selected = await pending;
    assert.equal(selected.status, 'fallback'); assert.equal(selected.profile, 'fresh fallback');
  }
});

test('early bridge failure is observed even if preparation is abandoned; consumed failure falls back', async () => {
  const read = prefetchCoreMemory(config, request, async () => { throw Error('private bridge error'); });
  await tick(); await tick();
  const selected = await select(read);
  assert.equal(selected.status, 'fallback'); assert.equal(selected.profile, 'fresh fallback');
  prefetchCoreMemory(config, request, async () => { throw Error('abandoned'); });
  await tick(); await tick();
});

test('off, nonblocking shadow and missing source revision never start speculative reads', async () => {
  let reads = 0;
  const read = async () => { reads++; return response; };
  for (const mode of ['off', 'shadow'] as const) assert.equal(prefetchCoreMemory({ ...config, mode }, request, read), read);
  assert.equal(prefetchCoreMemory(config, { ...request, expectedSourceRevision: undefined }, read), read);
  await tick(); assert.equal(reads, 0);
});

test('changed query or bridge configuration cannot consume a prefetched result', async () => {
  let reads = 0;
  const read = prefetchCoreMemory(config, request, async () => { reads++; return response; });
  await read({ ...config, keywordOnly: true }, request);
  await read(config, { ...request, query: 'different question' });
  assert.equal(reads, 3);
});

const build = process.env.HARU_LATENCY_RUNTIME ?? mkdtempSync(path.join(tmpdir(), 'haru-preparation-'));
if (!process.env.HARU_LATENCY_RUNTIME) execFileSync(path.resolve('node_modules/.bin/tsc'), ['-p', 'electron/tsconfig.json', '--outDir', build]);
const source = readFileSync(path.join(build, 'main.js'), 'utf8').replace(/\b[a-z_]+_\d+\./g, '');
if (!process.env.HARU_LATENCY_RUNTIME) rmSync(build, { recursive: true, force: true });

test('actual full preparation starts Core before waiting for desktop embeddings and keeps all vectors', async () => {
  const start = source.indexOf('const retrievalStartedAt = Date.now();');
  const end = source.indexOf("prepMark('embeddings');", start);
  assert.ok(start >= 0 && end > start);
  let reads = 0, finished = false;
  const releases: ((value: number[]) => void)[] = [];
  const context = {
    Date, Promise, recentUserContext: 'remember my', latest: 'tea', naturalKind: null,
    readCoreMemoryConfig: () => config, store: { memorySourceRevision: () => revision }, getSlate: () => ({ at: slate }),
    prefetchCoreMemory: (c: typeof config, r: CoreMemoryRequest) => prefetchCoreMemory(c, r, async () => { reads++; return response; }),
    tryEmbedQuery: () => new Promise<number[]>(resolve => releases.push(resolve)),
    recallModel: 'embedding-model', recallFormat: 'format', embedFormat: () => 'format', embedText: () => 'prefixed query',
  };
  const pending = vm.runInNewContext(`(async()=>{${source.slice(start, end)}return { queryVector, latestVector, recallVector, readMemoryForTurn, coreReadAt };})()`, context).then((v: any) => { finished = true; return v; });
  await tick(); assert.equal(reads, 1); assert.equal(releases.length, 3); assert.equal(finished, false);
  releases.forEach((resolve, i) => resolve([i]));
  const result = await pending;
  assert.equal(JSON.stringify([result.queryVector, result.latestVector, result.recallVector]), '[[0],[1],[2]]');
  const selected = await selectCoreMemory({ config, read: result.readMemoryForTurn, now: result.coreReadAt,
    query: 'remember my tea', latest: 'tea', sourceRevision: () => revision, slateAt: () => slate,
    render: derived => derived ? derived.human.value : 'desktop memory' });
  assert.equal(reads, 1); assert.equal(selected.status, 'on');
});
