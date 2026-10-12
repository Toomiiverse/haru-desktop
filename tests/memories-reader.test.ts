import test from 'node:test';
import assert from 'node:assert/strict';
import { memoriesReader, type MemoryRecord } from '../electron/memory';

test('memories are migrated once per saved document and every reader gets its own copy', () => {
  let saved: unknown = [{ id: 'a', text: 'one' }];
  let calls = 0;
  const read = memoriesReader(() => saved, s => { calls++; return (s as { id: string; text: string }[]).map(e => ({ id: e.id, text: e.text, kind: 'fact' } as unknown as MemoryRecord)); });
  const first = read(); read(); read();
  assert.equal(calls, 1);
  (first[0] as { text: string }).text = 'mutated';
  assert.equal((read()[0] as { text: string }).text, 'one');   // a caller's copy never reaches the next reader
  saved = [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }];
  assert.equal(read().length, 2);
  assert.equal(calls, 2);   // recomputed only because the document changed
});
