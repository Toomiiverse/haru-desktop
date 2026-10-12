import test from 'node:test';
import assert from 'node:assert/strict';
import { toolCallProblem, withToolContract } from '../electron/tool-contract';
import { runToolLoop, type ToolLoopDeps } from '../electron/toolloop';
import { evidenceProblem } from '../electron/evidence-check';
import { makeToolReceipt } from '../electron/tool-receipt';
import type { ChatMessage, ChatTool } from '../electron/provider';
const table: ChatTool[] = [{ type: 'function', function: { name: 'get_gpu_info', description: '', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'set_reminder', description: '', parameters: { type: 'object', properties: { text: { type: 'string' }, at: { type: 'string' } }, required: ['text', 'at'] } } }];
const call = (name: string, args: unknown = {}) => ({ function: { name, arguments: args } });
test('offered schemas reject unavailable tools, malformed names and invalid argument shapes', () => {
  for (const c of [call('run_command'), call('get_gpu_info\ncommand: fake readings'), call('get_gpu_info', '{'), call('get_gpu_info', []), call('get_gpu_info', { unexpected: 1 }), call('set_reminder', {text: 'basil'}), call('set_reminder', {text: 1, at: 'tomorrow'})]) assert.ok(toolCallProblem(c, table));
  assert.equal(toolCallProblem(call('get_gpu_info', '{}'), table), null);
  assert.equal(toolCallProblem(call('set_reminder', {text:'basil',at:'2026-10-01T09:00:00Z'}), table), null);
});
test('entire mixed batch is rejected before any execution and malformed protocol is not replayed', async () => {
  let execution = 0, asked = 0;
  const messages: ChatMessage[] = [{role:'user',content:'Check GPUs.'}];
  const deps: ToolLoopDeps = { requireToolContract:true,
    ask: async () => ++asked === 1 ? withToolContract({role:'assistant',tool_calls:[call('get_gpu_info'),call('run_command\nFAKE')]},table) : {role:'assistant',content:"I cannot check right now."},
    runTool:async () => {execution++;return '{}';},pageWasRead:()=>false,handsAllowed:()=>false,withdrawHands(){},hasOpenTask:()=>false,canSearch:()=>false };
  const result = await runToolLoop(messages,deps);
  assert.equal(execution,0);assert.equal(result.rounds,2);assert.ok(!JSON.stringify(messages).includes('FAKE'));
});
test('textual calls cannot bypass the actual empty tool contract', async () => {
  let n=0;
  await runToolLoop([{role:'user',content:'Check GPUs.'}],{requireToolContract:true,ask:async()=>withToolContract({role:'assistant',content:++n===1?'get_gpu_info()':"I cannot check right now."},[]),runTool:async()=>{throw Error('must not execute');},pageWasRead:()=>false,handsAllowed:()=>false,withdrawHands(){},hasOpenTask:()=>false,canSearch:()=>false});
  assert.equal(n,2);
});
test('a valid offered call executes once and a fresh result supports the final reply', async () => {
  let n=0,executed=0;
  const result=await runToolLoop([{role:'user',content:'Check GPU 0.'}],{requireToolContract:true,
    ask:async()=>withToolContract(++n===1?{role:'assistant',tool_calls:[call('get_gpu_info')]}:{role:'assistant',content:'GPU 0: 7%.'},table),
    runTool:async()=>{executed++;return '[{"index":0,"utilization_percent":7}]';},pageWasRead:()=>false,handsAllowed:()=>false,withdrawHands(){},hasOpenTask:()=>false,canSearch:()=>false});
  assert.equal(executed,1);assert.equal(result.content,'GPU 0: 7%.');
});
test('duplicate protocol IDs are rejected without executing either call', async () => {
  let n=0;
  await runToolLoop([{role:'user',content:'Check GPUs.'}],{requireToolContract:true,
    ask:async()=>withToolContract(++n===1?{role:'assistant',tool_calls:[{...call('get_gpu_info'),id:'same'},{...call('get_gpu_info'),id:'same'}]}:{role:'assistant',content:'Nothing was checked.'},table),
    runTool:async()=>{throw Error('must not execute');},pageWasRead:()=>false,handsAllowed:()=>false,withdrawHands(){},hasOpenTask:()=>false,canSearch:()=>false});
  assert.equal(n,2);
});
test('printed reminder arguments are withheld but explicitly requested JSON remains allowed', async () => {
  const printed='{"title":"basil","date":"tomorrow"}';
  for(const requested of [false,true]){
    let n=0;
    const result=await runToolLoop([{role:'user',content:requested?'Show example reminder JSON.':'Set a reminder.'}],{requireToolContract:true,
      ask:async()=>({role:'assistant',content:++n===1?printed:'Nothing was saved.'}),runTool:async()=>{throw Error('must not execute');},pageWasRead:()=>false,handsAllowed:()=>false,withdrawHands(){},hasOpenTask:()=>false,canSearch:()=>false});
    assert.equal(n,requested?1:2);assert.equal(result.content,requested?printed:'Nothing was saved.');
  }
});
test('live GPU claims require exact fresh evidence across compact and qualified phrasings', () => {
  const now=Date.now();const r=makeToolReceipt('get_gpu_info',{},JSON.stringify({gpus:[{index:0,utilization_percent:0},{index:1,utilization_percent:83},{index:2,utilization_percent:0}]}),now,now);
  for (const text of ['All three GPUs idle.','GPU 0: idle.','GPU 0 is busy.','All three are sitting at 0%.','```json\n{"gpu_utilization":"45%"}\n```',"I cannot confirm, but GPU 0 is at 0%."]) assert.ok(evidenceProblem(text,[],now,'Are all three GPUs idle?'),text);
  assert.ok(evidenceProblem('GPU 1: 81%.',[r],now));
  assert.equal(evidenceProblem('GPU 0: 0%, GPU 1: 83%, GPU 2: 0%.',[r],now),null);
  assert.equal(evidenceProblem('GPU 0: idle.',[r],now),null);
  assert.ok(evidenceProblem('All three GPUs idle.',[r],now));
  assert.equal(evidenceProblem('If GPU 0 is idle, run the test.',[],now),null);
  assert.equal(evidenceProblem('GPU 0: 0%, GPU 1: 83%, GPU 2: 0%. Only GPU 2 is at zero — so "the other two are basically idle" was wrong for GPU 1. It is busy, but 83% is not idle.',[r],now),null);
  assert.ok(evidenceProblem('GPU 0: 0%, GPU 1: 83%, GPU 2: 0%. GPU 1 is idle.',[r],now));
});
test('failed reminder results and absent receipts cannot support success', () => {
  const now=Date.now();const bad=makeToolReceipt('set_reminder',{},'{"ok":true,"created":false}',now,now);
  assert.equal(bad.outcome,'failed');
  for(const receipts of [[],[bad]]) for(const text of ['Reminder set.','I saved your reminder.',"I'll remind you tomorrow."]) assert.ok(evidenceProblem(text,receipts,now),text);
  assert.equal(evidenceProblem('The reminder was not created.',[bad],now),null);
});
test('requested observations cannot be replaced with promises or invented file contents', () => {
  const now=Date.now();
  assert.ok(evidenceProblem("I'll check the GPU stats. One moment.",[],now,'Check GPU utilization now.'));
  assert.ok(evidenceProblem('I read the note. Maintenance is October 11.',[],now,'Read Router migration.md and report the window.'));
  assert.equal(evidenceProblem('I cannot access that file.',[],now,'Read Router migration.md.'),null);
  assert.equal(evidenceProblem('Use nvidia-smi.',[],now,'How do I check GPU utilization?'),null);
  assert.ok(evidenceProblem('# Machine output\n```json\n{"result":"success","kept_item":{"title":"basil"}}\n```\nWater the basil. Done.',[],now,'Set a reminder to water basil tomorrow. If it fails, do not retry.'));
  assert.ok(evidenceProblem('I attempted to set it but cannot confirm whether it saved.',[],now,'Set a reminder to water basil tomorrow.'));
});
