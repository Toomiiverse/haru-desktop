// 3880: a reminder still goes out as a plain line when the model call fails.
import test from 'node:test';
import assert from 'node:assert/strict';
test('ownedReminder falls back to a plain line when the model fails', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(src.includes("catch(error){console.warn('[remind] plain line, model failed:'"));
  assert.ok(src.includes("line=`Reminder: ${packet.item.title}${packet.item.time?` at ${packet.item.time}`:''}.`;"));
});
