import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreStore } from '../electron/core-store';

function fixture(kind: 'schedule'|'external'|'unknown'|'protocol'|'success') {
  const core = Object.create(CoreStore.prototype) as CoreStore;
  let state = { revision: 1, userData: '/tmp/fixture', home: '/tmp/fixture', documents: { config: { mood: 0, counter: 0 }, schedule: { jobs: [] as string[] } } };
  const writes: any[] = []; let opens = 0;
  const call = (method: string, input: any): any => {
    if (method === 'open') { opens++; return structuredClone(state); }
    assert.equal(method, 'commit'); writes.push(input);
    assert.equal(input.baseRevision, state.revision);
    state = { ...state, revision: state.revision + 1, documents: { ...state.documents, ...structuredClone(input.patches) } };
    return { revision: state.revision, currentRevision: state.revision };
  };
  const worker = { ref() {}, unref() {}, terminate() { return Promise.resolve(); }, postMessage({ request, buffer }: any) {
    let response: any;
    if (kind === 'success') response = { id: request.id, ok: true, result: call('commit', request.params) };
    else {
      writes.push(request.params);
      if (kind === 'schedule') state = { ...state, revision: 2, documents: { ...state.documents, schedule: { jobs: ['external-schedule'] } } };
      if (kind === 'external') state = { ...state, revision: 2, documents: { ...state.documents, config: { mood: 99, counter: 0 } } };
      response = { id: kind === 'protocol' ? 'wrong' : request.id, ok: false,
        error: kind === 'unknown' ? 'authority_remote_unconfirmed' : 'authority_revision_conflict' };
    }
    const bytes = Buffer.from(JSON.stringify(response)), header = new Int32Array(buffer, 0, 2);
    new Uint8Array(buffer, 8, bytes.length).set(bytes); Atomics.store(header, 1, bytes.length); Atomics.store(header, 0, 1); Atomics.notify(header, 0);
  } };
  Object.assign(core, { state: structuredClone(state), worker, call, depth: 0, staged: null, touched: new Set(), pendingAsync: false, asyncTail: Promise.resolve(), options: { asyncTransactions: true } });
  return { core, writes, state: () => state, opens: () => opens };
}

for (const kind of ['schedule', 'success'] as const) test(`sync access fences the entire async ${kind} write before committing newer state`, async () => {
  const before = process.env.HARU_CORE_SCHEDULER; process.env.HARU_CORE_SCHEDULER = 'on';
  try {
    const f = fixture(kind); let callbacks = 0;
    const pending = f.core.transactionAsync(() => { callbacks++; const config = f.core.get('config'); config.counter = 1; f.core.set('config', config); });
    await Promise.resolve(); // Original response is ready; its async continuation has not resumed.
    f.core.transaction(() => { const config = f.core.get('config'); assert.equal(config.counter, 1); config.mood = 9; f.core.set('config', config); });
    await pending;
    assert.equal(callbacks, 1, 'transaction callbacks must never be replayed');
    assert.deepEqual(f.core.get('config'), { mood: 9, counter: 1 });
    assert.deepEqual(f.state().documents.config, { mood: 9, counter: 1 });
    assert.equal(f.writes.length, kind === 'schedule' ? 3 : 2);
    assert.equal(f.opens(), kind === 'schedule' ? 1 : 0);
    if (kind === 'schedule') assert.deepEqual(f.state().documents.schedule.jobs, ['external-schedule']);
    assert.notEqual((f.core as any).broken, true);
  } finally { if (before === undefined) delete process.env.HARU_CORE_SCHEDULER; else process.env.HARU_CORE_SCHEDULER = before; }
});

for (const [kind, reason] of [['external', 'core_authority_revision_conflict'], ['unknown', 'core_authority_commit_unconfirmed'], ['protocol', 'core_authority_protocol_error']] as const)
test(`async fence rejects ${kind} without replay or overwriting data`, async () => {
  const before = process.env.HARU_CORE_SCHEDULER; process.env.HARU_CORE_SCHEDULER = 'on';
  try {
    const f = fixture(kind), pending = f.core.transactionAsync(() => f.core.set('config', { mood: 1, counter: 1 }));
    await Promise.resolve();
    assert.throws(() => f.core.get('config'), new RegExp(reason));
    await assert.rejects(pending, new RegExp(reason));
    assert.equal(f.writes.length, 1);
    assert.equal(f.state().documents.config.mood, kind === 'external' ? 99 : 0);
    assert.equal(f.state().documents.config.counter, 0);
  } finally { if (before === undefined) delete process.env.HARU_CORE_SCHEDULER; else process.env.HARU_CORE_SCHEDULER = before; }
});
