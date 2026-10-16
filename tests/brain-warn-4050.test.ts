// 4050: a brain warning reaches the journal as its tag and error code only, once a minute per tag+code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { warnLine } from '../electron/brain-warn';
test('tag and code only, never the words', () => {
  const seen = new Map<string, number>();
  assert.equal(warnLine(['[memory] Core month fold refused:', 'cloud_task_required'], 0, seen), '[brain-warn] {"tag":"memory","code":"cloud_task_required"}');
  assert.equal(warnLine(['[remind]', Error('background_inference_deferred: Tommy said he would call mum')], 0, seen), '[brain-warn] {"tag":"remind","code":"background_inference_deferred"}');
  assert.equal(warnLine(['[web] could not read her expression:', 'socket hang up'], 0, seen), '[brain-warn] {"tag":"web","code":"uncoded"}');
  assert.equal(warnLine(['no tag here'], 0, seen), null);
});
test('the same tag and code is written once a minute', () => {
  const seen = new Map<string, number>();
  assert.ok(warnLine(['[ai] x', 'provider_timeout'], 0, seen));
  assert.equal(warnLine(['[ai] x', 'provider_timeout'], 59_999, seen), null);
  assert.ok(warnLine(['[ai] x', 'provider_timeout'], 60_001, seen));
  assert.ok(warnLine(['[ai] x', 'model_not_registered'], 60_002, seen));
});
test('main.ts tees console.warn and console.error through it to stdout', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(main.includes("console.warn=tee(warn);console.error=tee(error);"));
  assert.ok(main.includes("if(line)process.stdout.write(line+'\\n');"));
});
