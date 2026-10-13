import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreStore, docDigest } from '../electron/core-store';

// A store with its state set directly (no storage worker): docRef/sameDoc read only state, staging and pending fields.
function store(documents: Record<string, any>): any {
  const s: any = Object.create(CoreStore.prototype);
  Object.assign(s, { state: { revision: 1, userData: '/x', home: '/x', sourceRevision: '', documents }, staged: null, touched: new Set(),
    pendingAsync: false, pendingPatches: null, digests: new WeakMap(), broken: false, depth: 0, captured: undefined });
  return s;
}

test('a document keeps its digest across commits to other documents, and a new object gets a new one', () => {
  const archive = { '2026-10-12': [{ role: 'user', content: 'hi' }] };
  const s = store({ archive, config: { a: 1 } });
  const first = s.docRef('archive', {});
  assert.equal(first.digest, docDigest(archive));
  assert.ok(s.digests.has(archive));
  s.state = { ...s.state, revision: 2, documents: { ...s.state.documents, config: { a: 2 } } };   // another document committed
  assert.equal(s.docRef('archive', {}).digest, first.digest);
  const next = { ...archive, '2026-10-13': [{ role: 'user', content: 'again' }] };
  s.state = { ...s.state, revision: 3, documents: { ...s.state.documents, archive: next } };
  assert.equal(s.docRef('archive', {}).digest, docDigest(next));
  assert.ok(s.sameDoc('archive', { $digest: docDigest(next) }) && !s.sameDoc('archive', { $digest: first.digest }));
});

test('the body is the hashed object, cloned, even if a commit lands before it is sent', () => {
  const archive = { d: [1, 2] };
  const s = store({ archive });
  const ref = s.docRef('archive', {});
  s.state = { ...s.state, revision: 2, documents: { archive: { d: [9] } } };   // committed between docRef() and the send
  const body = ref.body as any;
  assert.deepEqual(body, { d: [1, 2] });
  assert.equal(docDigest(body), ref.digest);
  body.d.push(3);
  assert.deepEqual(archive, { d: [1, 2] });   // a clone: the store's object is untouched
});

test('an absent document hashes and sends its fallback, uncached', () => {
  const s = store({});
  const ref = s.docRef('archive', {});
  assert.equal(ref.digest, docDigest({}));
  assert.deepEqual(ref.body, {});
  assert.equal(s.docRef('archive', null).digest, docDigest(null));
});

test('a staged document is hashed as staged', () => {
  const s = store({ config: { a: 1 } });
  s.staged = { config: { a: 5 } };
  assert.equal(s.docRef('config', {}).digest, docDigest({ a: 5 }));
  assert.deepEqual(s.docRef('config', {}).body, { a: 5 });
});
