// 4000: the forming tick folds a past month with day notes but no month note; the startup fold ran outside a job scope and a hosted model refused it.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the tick asks monthChoose when no day note is missing and runs a month fold inside the job scope', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes("corePolicySync<string|null>('chat-lifecycle.monthChoose',[forming,config??null,getMood().lastMessageAt??null,currentChatDayKey(),getSessions(),getMonthNotes(),Object.fromEntries(formRetries),Date.now()])"));
  assert.ok(main.includes("const folded=await runChatSummary('month',month,[],true,"));
  assert.ok(main.includes("if(folded!=='saved')noteFormingFailed('month:'+month);"));
});
