// 3800: the memories document crosses to the Core by digest, except when it is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
test('readMemoryFile sends the memories document by reference, with a value fallback when it is missing', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/store.ts'), 'utf8');
  assert.ok(src.includes("normalizeMemoryFile(this.core.has('memories') ? this.core.docRef('memories') : this.core.get('memories'))"));
});
