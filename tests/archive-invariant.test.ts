import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreStore, docDigest } from '../electron/core-store';
import { ackDigests, isAcked, wire } from '../electron/core-policy-sync';

// 3690 (from the review): the per-object digest cache is only sound while the store never changes a document object in place.
// These drive the real transaction, rollback, schedule rebase, commit-conflict retry and write-behind paths with a stubbed
// worker, and after every step require each document's digest to equal a fresh hash of what the store serves.
function make(documents: Record<string, any>) {
  const s: any = Object.create(CoreStore.prototype);
  const db: any = { revision: 1, documents: JSON.parse(JSON.stringify(documents)) }; let conflictOnce = false; let release: () => void = () => {};
  Object.assign(s, { state: { revision: 1, userData: '/x', home: '/x', sourceRevision: '', documents: JSON.parse(JSON.stringify(documents)) }, staged: null, touched: new Set(),
    pendingAsync: false, pendingPatches: null, digests: new WeakMap(), broken: false, depth: 0, captured: undefined, asyncTail: Promise.resolve(), options: { asyncTransactions: true } });
  s.call = (method: string, params: any) => {
    if (method === 'open') return JSON.parse(JSON.stringify({ revision: db.revision, userData: '/x', home: '/x', sourceRevision: '', documents: db.documents }));
    if (method === 'commit') {
      if (conflictOnce) { conflictOnce = false; throw Error('authority_revision_conflict'); }
      if (params.baseRevision !== db.revision) throw Error('authority_revision_conflict');
      db.revision++; db.documents = { ...db.documents, ...JSON.parse(JSON.stringify(params.patches)) }; return { revision: db.revision, currentRevision: db.revision, timing: {} };
    }
    throw Error('unexpected ' + method);
  };
  s.callCommit = function (params: any) {
    let done = false, result: any;
    const finish = () => { if (done) return result; done = true; result = this.call('commit', params); this.state = { ...this.state, revision: result.revision, documents: { ...this.state.documents, ...params.patches } }; this.pendingAsync = false; return result; };
    this.finishPendingCommit = finish; return new Promise(r => { release = () => r(finish()); });
  };
  return { s, conflict: () => { conflictOnce = true; }, bump: (name: string, value: any) => { db.revision++; db.documents = { ...db.documents, [name]: value }; }, release: () => release() };
}
const names = ['config', 'archive', 'memories', 'schedule'];
function check(s: any, where: string) {
  for (const n of names) {
    const ref = s.docRef(n, {});
    if (n !== 'schedule') assert.equal(ref.digest, docDigest(s.get(n, {})), where + ': digest of ' + n);
    assert.equal(docDigest(ref.body), ref.digest, where + ': body/digest of ' + n);
  }
}
test('transaction, nested transaction and rollback keep cached digests true', () => {
  const { s } = make({ config: { a: 1 }, archive: { d: [1] }, memories: { m: [] }, schedule: { jobs: [] } });
  check(s, 'start');
  s.transaction(() => { check(s, 'tx-start'); s.set('config', { a: 2 }); check(s, 'tx-set'); s.transaction(() => { s.set('archive', { d: [1, 2] }); check(s, 'inner'); }); check(s, 'after-inner'); });
  check(s, 'after-commit'); assert.deepEqual(s.get('config'), { a: 2 });
  assert.throws(() => s.transaction(() => { s.set('config', { a: 3 }); check(s, 'doomed'); throw Error('x'); }));
  check(s, 'after-rollback'); assert.deepEqual(s.get('config'), { a: 2 });
});
test('schedule rebase and commit-conflict retries keep cached digests true', () => {
  const t = make({ config: { a: 1 }, archive: { d: [1] }, memories: { m: [] }, schedule: { jobs: [] } }); const s = t.s;
  check(s, 'start'); t.bump('schedule', { jobs: [1] }); s.get('schedule'); check(s, 'after-rebase');
  t.bump('schedule', { jobs: [2] }); s.set('config', { a: 9 }); check(s, 'after-conflict-retry'); assert.deepEqual(s.get('config'), { a: 9 });
  t.conflict(); s.set('archive', { d: [7] }); check(s, 'after-forced-conflict');
});
test('write-behind: pending, fence and landing keep cached digests true', async () => {
  const t = make({ config: { a: 1 }, archive: { d: [1] }, memories: { m: [] }, schedule: { jobs: [] } }); const s = t.s;
  check(s, 'start'); s.transactionBehind(() => { s.set('archive', { d: [1, 2] }); }); assert.ok(s.pendingAsync);
  for (const n of ['config', 'archive', 'memories']) assert.equal(s.docRef(n, {}).digest, docDigest(s.getPath(n, [], {})), 'pending ' + n);
  s.fence(); check(s, 'fenced'); t.release(); await s.asyncTail; check(s, 'landed');
});
test('acknowledged digests age out least recently used first, and use keeps one fresh', () => {
  ackDigests(['archive-digest']);
  for (let i = 0; i < 200; i++) {
    ackDigests(['config-' + i]);
    if (i % 10 === 0) wire([{ $doc: 'archive', digest: 'archive-digest', body: { big: 1 } }], { force: null, sent: [] });   // used: stays recent
  }
  assert.ok(isAcked('archive-digest') && isAcked('config-199') && !isAcked('config-0'));
  const wired = wire([{ $doc: 'archive', digest: 'archive-digest', body: { big: 1 } }], { force: null, sent: [] }) as any[];
  assert.deepEqual(wired[0], { $doc: 'archive', digest: 'archive-digest' });   // body not resent
});

test('sizesOf reads keys and lengths without cloning, from whatever view get() would serve', async () => {
  const t = make({ config: { a: 1 }, archive: { '2026-10-11': [1, 2], '2026-10-12': [3] }, memories: { m: [] }, schedule: { jobs: [] } }); const s = t.s;
  const shape = (n: string) => Object.entries(s.get(n, {})).map(([key, v]: [string, any]) => ({ key, length: v.length }));
  assert.deepEqual(s.sizesOf('archive'), shape('archive'));
  s.transaction(() => { s.set('archive', { '2026-10-11': [1, 2], '2026-10-12': [3, 4, 5], '2026-10-13': [] }); assert.deepEqual(s.sizesOf('archive'), shape('archive')); });
  s.transactionBehind(() => { s.set('archive', { '2026-10-13': [9] }); });
  assert.deepEqual(s.sizesOf('archive'), [{ key: '2026-10-13', length: 1 }]);   // the pending write, as get() would serve it
  t.release(); await s.asyncTail;
  assert.deepEqual(s.sizesOf('archive'), shape('archive'));
  assert.deepEqual(s.sizesOf('absent'), []);   // the old Object.entries(getArchive()) threw on an absent archive; an empty list is the benign reading
  const out = s.sizesOf('archive'); out[0].length = 99; assert.equal(s.get('archive')['2026-10-13'].length, 1);   // nothing internal leaves
  const odd = make({ archive: { d: { length: { n: 1 } } } }).s; const r = odd.sizesOf('archive'); r[0].length.n = 2;
  assert.deepEqual(odd.get('archive'), { d: { length: { n: 1 } } });   // a non-number length is a clone
});
