// 4010: a hosted model call with no live task opens its own ledger task whether or not a scheduled job is running.
// Before, only scheduled jobs did; a second thought, the chat opening line, a tick-off remark, screen and helper quips
// and the startup fold all threw cloud_task_required into a discarded console.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the background task fallthrough no longer needs a scheduled job', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes('if(!task&&!options.turn&&!table.length){'));
  assert.ok(!main.includes('(isLocalConfig(config)||((activeScheduledJob.getStore())))'));
  assert.ok(main.includes("(job?' — '+job:' — unscheduled')"));   // the ledger says which spend came from outside a job
  // the guard that is left only fires for turn or tool-table calls, which always run inside a task
  assert.equal(main.split("throw new Error('cloud_task_required')").length, 2);
});
