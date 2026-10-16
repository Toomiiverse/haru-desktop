// 4020: a hosted model call with no live task and no scheduled job runs at foreground priority; the Core refuses
// background work for 180 s after he speaks, so after-turn lines (second thought, opening, remarks) never ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../electron/core-policy-sync';
import { activeScheduledJob } from '../electron/core-scheduler';
import { TaskController } from '../electron/task-controller';
test('outside a job a hosted composition asks for foreground; inside a job the Core keeps it background', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes("config.model,local?'background':'foreground');"));
  const real = (policy as any).corePolicySync;
  (policy as any).corePolicySync = (op: string, args: any[]) => op === 'task-settlement.startPriority' ? (args[1] ? 'background' : args[0]) : real(op, args);
  const created: string[] = [];
  const task = new TaskController((async (method: string, params: any) => { if (method === 'create') created.push(params.priority); return { id: 't', revision: 1 }; }) as any, [] as any,
    { enabled: true, taskBudgetMicros: 1, dailyBudgetMicros: 1, maxAttempts: 1, maxToolCalls: 0, maxEscalations: 0, deadlineMs: 1000 } as any, true);
  try {
    await task.start('x', 'm', 'foreground');
    await activeScheduledJob.run({ id: 'periodic:forming', kind: 'periodic:forming', token: 'k' }, () => task.start('x', 'm', 'foreground'));
    assert.deepEqual(created, ['foreground', 'background']);
  } finally { (policy as any).corePolicySync = real; }
});
