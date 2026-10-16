// 3960: a background composition's task carries the scheduled job's kind, so spend per job is visible in the ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the composition label carries the job kind', async () => {
  const { readFileSync } = await import('node:fs');
  assert.ok(readFileSync(require.resolve('../../electron/main.ts'), 'utf8').includes("await background.start('Background model composition (no actions)'+(job?' — '+job:' — unscheduled'),config.model,local?'background':'foreground');"));
});
