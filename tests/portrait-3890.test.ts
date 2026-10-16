// 3890: the portrait reaches the block sources and is written once a day after the day pass.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the portrait is a block source and follows a successful day pass', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8'), store = readFileSync(require.resolve('../../electron/memorystore.ts'), 'utf8');
  assert.ok(store.includes('portrait: deps.portrait(),'));
  assert.ok(main.includes("portrait: () => (store.get('portrait') as { text?: string } | undefined)?.text ?? '',"));
  assert.ok(main.includes('if(success)await writePortrait(config);'));
  assert.ok(main.includes("corePolicySync<any>('chat-lifecycle.portraitPlan',[core.docRef('config',{}),text,ask.day,new Date().toISOString()])"));
});
