import test from 'node:test';
import assert from 'node:assert/strict';
import { docDigest, isDigestRef, sameDocument } from '../electron/core-store';
import { wire } from '../electron/core-policy-sync';

test('a document digest is stable for equal JSON and a digest ref compares against the live document', () => {
  const doc = { ai: { conversation: { model: 'x' } }, chat: { messages: [1, 2, 3] } };
  assert.equal(docDigest(doc), docDigest(JSON.parse(JSON.stringify(doc))));
  assert.ok(isDigestRef({ $digest: docDigest(doc) }) && !isDigestRef({ $digest: 'a', other: 1 }) && !isDigestRef(doc));
  assert.ok(sameDocument(doc, { $digest: docDigest(doc) }) && !sameDocument({ ...doc, extra: 1 }, { $digest: docDigest(doc) }));
  assert.ok(sameDocument(doc, JSON.parse(JSON.stringify(doc))) && !sameDocument(doc, { ai: {} }));   // whole-document expected still works
});

test('a document reference crosses with its body until acknowledged, and again when the Core asks for it', () => {
  const ref = { $doc: 'config', digest: 'd1', body: { big: 'x'.repeat(100) } };
  const first = { force: null, sent: [] as string[] };
  const wired = wire([{ facts: ref, n: 1 }], first) as any[];
  assert.deepEqual(first.sent, ['d1']);
  assert.deepEqual(wired[0].facts, ref);   // body carried: nothing acknowledged yet
  assert.equal(wired[0].n, 1);
  const forced = { force: new Set(['d1']), sent: [] as string[] };
  assert.deepEqual((wire([ref], forced) as any[])[0], ref);
  assert.deepEqual(forced.sent, ['d1']);
  const plain = wire([{ $doc: 'config', digest: 'd1' }]) as any[];   // no body field: not a reference, passed through
  assert.deepEqual(plain[0], { $doc: 'config', digest: 'd1' });
});
