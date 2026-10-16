// 3950: the forming tick catches up a missing day note when there are no memories to form.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the tick asks summaryChoose and runs a day summary for the missing day', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes("corePolicySync<string|null>('chat-lifecycle.summaryChoose',[forming,config??null,getMood().lastMessageAt??null,currentChatDayKey(),lengths,getSessions(),Object.fromEntries(formRetries),Date.now()])"));
  assert.ok(main.includes("if(result!=='saved')noteFormingFailed('summary:'+missing);"));
});
