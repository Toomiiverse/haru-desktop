// 4080: a one-shot background task (the weekly reflection) can run on the Core's reader entries, which routing never sees.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the background fallthrough adds the reader entries to its own registry only', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  const at = main.indexOf("...naturalPolicy<ModelEntry[]>('readerEntries',[])];");
  assert.ok(at > 0);
  assert.ok(main.slice(at, at + 900).includes("const background=new TaskController(taskBridge.call,registry,"), 'used by the one-shot task built right after');
  assert.equal(main.split("naturalPolicy<ModelEntry[]>('readerEntries'").length, 2, 'nowhere else');
});
