// 3930: the weekly reflection asks the Core which model to use (DeepSeek for now).
import test from 'node:test';
import assert from 'node:assert/strict';
test('the week tick asks natural-policy.weekConfig for its model', async () => {
  const { readFileSync } = await import('node:fs');
  assert.ok(readFileSync(require.resolve('../../electron/main.ts'), 'utf8').includes("week:()=>reflectOnHerWeek(naturalPolicy<ProviderConfig>('weekConfig',[config]))"));
});
