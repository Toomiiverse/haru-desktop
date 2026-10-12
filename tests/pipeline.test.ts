import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskBridge } from '../electron/task-bridge';
import { TaskController, activeTask } from '../electron/task-controller';
import { assertOutboundSafe, guardedRequest } from '../electron/outbound';
import { readTaskPolicy, type ModelEntry } from '../electron/model-registry';
import type { ToolLoopDeps } from '../electron/toolloop';
import { withToolContract } from '../electron/tool-contract';
import { answerLocalNaturalConversation, prepareNaturalConversation } from '../electron/natural-conversation';
import { ReplyGate } from '../electron/reply-gate';

const local: ModelEntry = { id:'local',role:'everyday',local:true,enabled:true,config:{provider:'ollama',model:'local',endpoint:'http://127.0.0.1:11436',temperature:0},capabilities:{text:true,image:true,tools:true,contextWindow:32768,maxOutputTokens:100},pricing:{inputUsdPerMillion:0,outputUsdPerMillion:0} };
const cloud: ModelEntry = { ...local,id:'cloud',role:'specialist',local:false,config:{...local.config,provider:'venice',endpoint:'https://example.test',model:'specialist'},pricing:{inputUsdPerMillion:1,outputUsdPerMillion:2} };
const policy = readTaskPolicy({ taskBudgetMicros:500000,dailyBudgetMicros:5000000 });
function deps(ask: ToolLoopDeps['ask']): ToolLoopDeps { return { ask,runTool:async()=>'{"ok":true}',pageWasRead:()=>false,handsAllowed:()=>true,withdrawHands:()=>{},hasOpenTask:()=>false,canSearch:()=>false }; }
async function fixture(t: any, entries=[local,cloud], allowed=true, parent?:AbortSignal, observe?:(model:string,succeeded:boolean)=>void) {
 const bridge=new TaskBridge('/home/toomii/haru-core',path.join(mkdtempSync(path.join(tmpdir(),'haru-pipeline-')),'tasks.db'));
 t.after(()=>bridge.close());let id='';const rpc:typeof bridge.call=async(method,params)=>{const result=await bridge.call(method,params);if(method==='create')id=result.id;return result;};
 const task=new TaskController(rpc,entries,policy,allowed,observe);await task.start('Synthetic test only','local','foreground',parent);return {task,bridge,snapshot:()=>bridge.call('get',{taskId:id})};
}
test('full outbound scan includes old history, tool arguments and newly attached text',()=>{
 for (const row of [{role:'system',content:'password: synthetic-secret'}, {role:'tool',content:'api_key: synthetic-secret'}, {role:'assistant',content:'',tool_calls:[{function:{name:'x',arguments:{password:'synthetic-secret'}}}]}]) {
  assert.throws(()=>assertOutboundSafe([row,...Array.from({length:20},()=>({role:'user',content:'hello'}))]));
 }
 assert.throws(()=>assertOutboundSafe([{role:'assistant',tool_calls:[{function:{name:'x',arguments:JSON.stringify({password:'synthetic-secret'})}}]}]));
 assert.doesNotThrow(()=>assertOutboundSafe([{role:'system',content:'Never invent passwords or keys.'},{role:'user',content:'Hello'}]));
});
test('rejected unoffered operations never enter the durable ledger and may hand off once',async t=>{
 const {task,snapshot}=await fixture(t);let upgraded=false,executions=0,handoffs=0;
 const d=deps(async()=>withToolContract(upgraded?{role:'assistant',content:'I cannot check live GPU readings here.'}:{role:'assistant',tool_calls:[{function:{name:'run_command',arguments:{command:'must not run'}}}]},[]));
 d.requireToolContract=true;d.runTool=async()=>{executions++;return '{"ok":true}';};
 const result=await task.loop([{role:'user',content:'Check GPU utilization now.'}],d,()=>{upgraded=true;handoffs++;return cloud.config;});
 assert.equal(executions,0);assert.equal(handoffs,1);assert.equal((await snapshot()).operations.length,0);assert.match(result.content,/cannot check/);
});
test('timeout closes callbacks even when the provider ignores abort',async()=>{
 const chunks:string[]=[];
 await assert.rejects(guardedRequest(async(_signal,chunk)=>{await new Promise(r=>setTimeout(r,25));chunk('late');return 'late'}, {firstWordMs:5,totalMs:100,onChunk:c=>chunks.push(c)}),/first_word/);
 await new Promise(r=>setTimeout(r,40));assert.deepEqual(chunks,[]);
});
test('first word cannot waive total deadline; cancellation suppresses late output',async()=>{
 await assert.rejects(guardedRequest(async(_signal,chunk)=>{chunk('start');return new Promise(()=>{})},{firstWordMs:5,totalMs:15,onChunk:()=>{}}),/deadline/);
 const abort=new AbortController();const p=guardedRequest(async()=>new Promise(()=>{}),{signal:abort.signal,totalMs:100});abort.abort();await assert.rejects(p,/cancelled/);
});
test('durable local success records attempt and terminal result',async t=>{
 const {task}=await fixture(t);let calls=0;
 const r=await task.loop([{role:'user',content:'Hello'}],deps(async messages=>activeTask.getStore()!.post(messages,local.config,[],20,async()=>{calls++;return {role:'assistant',content:'Hello.'}})));
 assert.equal(r.content,'Hello.');assert.equal(calls,1);
});
test('honest worker-failure reply completes the turn without reporting provider success',async t=>{
 const observed:Array<[string,boolean]>=[];
 const {task,snapshot}=await fixture(t,[local,cloud],true,undefined,(model,success)=>observed.push([model,success]));
 const reply='The requested worker did not answer in time. I stopped the workflow without making the requested write.';
 const result=await task.loop([{role:'user',content:'Synthetic worker test'}],deps(async messages=>{
  try { await task.post(messages,cloud.config,[],20,async()=>{throw Error('first_word_timeout');}); }
  catch { await task.check();task.recordWorkerFailure(); }
  return {role:'assistant',content:reply};
 }));
 assert.equal(result.content,reply);
 const row=await snapshot();assert.equal(row.status,'completed');assert.equal(row.operations.length,0);
 assert.equal(row.events.filter((e:any)=>e.kind==='reserved').length,1);
 assert.equal(row.events.find((e:any)=>e.kind==='settled').detail.status,'unknown');
 assert.deepEqual(observed,[['specialist',false]]);
});
test('private turns cannot cloud spill, even on local absence',async t=>{
 const {task}=await fixture(t,[local,cloud],false);let calls=0;
 await assert.rejects(task.loop([{role:'user',content:'Hello'}],deps(async m=>task.post(m,cloud.config,[],20,async()=>{calls++;return {role:'assistant',content:'unsafe'}}))),/allowance/);assert.equal(calls,0);
});
test('unknown prices block dispatch before any provider call',async t=>{
 const {task}=await fixture(t,[local,{...cloud,pricing:null}]);let calls=0;
 await assert.rejects(task.loop([{role:'user',content:'Hello'}],deps(async m=>task.post(m,cloud.config,[],20,async()=>{calls++;return {role:'assistant',content:'unsafe'}}))),/unpriced/);assert.equal(calls,0);
});
test('quality handoff happens once and persists successful operations without replay',async t=>{
 const {task}=await fixture(t);let upgraded=false,executions=0,round=0;
 const call={function:{name:'remember_about_user',arguments:{text:'synthetic'}}};
 const d=deps(async()=>{round++;if(round===1 || upgraded && round===4)return {role:'assistant',tool_calls:[call]};return {role:'assistant',content:upgraded?'Recorded.':''}});
 d.runTool=async()=>{executions++;return '{"ok":true}'};
 const result=await task.loop([{role:'user',content:'Remember synthetic'}],d,()=>{upgraded=true;return cloud.config});
 assert.equal(upgraded,true);assert.equal(result.content,'Recorded.');assert.equal(executions,1);assert(result.ran.has('remember_about_user'));
});
test('a second failed worker cannot cause another capability escalation',async t=>{
 const {task}=await fixture(t);let escalations=0;
 await assert.rejects(task.loop([{role:'user',content:'Hello'}],deps(async()=>({role:'assistant',content:''})),()=>{escalations++;return cloud.config}));assert.equal(escalations,1);
});
test('cancellation during an action records result and prevents the next action',async t=>{
 const {task}=await fixture(t);let calls=0;
 const d=deps(async()=>({role:'assistant',tool_calls:[{function:{name:'one',arguments:{}}},{function:{name:'two',arguments:{}}}]}));
 d.runTool=async()=>{calls++;await task.cancel();return '{"ok":true}'};
 await assert.rejects(task.loop([{role:'user',content:'Synthetic'}],d));assert.equal(calls,1);
});

test('call cancellation aborts the provider and durable task without escalation',async t=>{
 const parent=new AbortController();const {task,snapshot}=await fixture(t,[local,cloud],true,parent.signal);
 let providerSignal:AbortSignal|undefined;let escalations=0;let started!:()=>void;
 const dispatched=new Promise<void>(resolve=>{started=resolve;});
 const work=task.loop([{role:'user',content:'Hello'}],deps(async m=>task.post(m,local.config,[],20,async signal=>{
  providerSignal=signal;started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
 })),()=>{escalations++;return cloud.config;});
 const rejected=assert.rejects(work,/cancel/);await dispatched;parent.abort();await rejected;
 assert.equal(providerSignal?.aborted,true);assert.equal(escalations,0);
 assert.notEqual((await snapshot()).status,'active');
});

test('call cancellation preserves an already started action receipt and prevents the next action',async t=>{
 const parent=new AbortController();const {task,snapshot}=await fixture(t,[local,cloud],true,parent.signal);let calls=0;
 const d=deps(async()=>({role:'assistant',tool_calls:[{function:{name:'one',arguments:{}}},{function:{name:'two',arguments:{}}}]}));
 d.runTool=async()=>{calls++;parent.abort();return '{"ok":true}';};
 await assert.rejects(task.loop([{role:'user',content:'Synthetic'}],d));
 assert.equal(calls,1);const row=await snapshot();assert.equal(row.operations.length,1);assert.equal(row.operations[0].status,'succeeded');
});

test('cancel while creating a task prevents the first model request',async()=>{
 const parent=new AbortController();const calls:string[]=[];
 const task=new TaskController(async(method)=>{calls.push(method);if(method==='create')parent.abort();return {id:'fixture',revision:1};},[],policy,false);
 await assert.rejects(task.start('Synthetic','local','foreground',parent.signal),/cancel/);
 assert.deepEqual(calls,['create','cancel']);
});

test('provider catalog verifies current deployment and reserves cache-write upper bound',async()=>{
 const {veniceRegistryEntries}=await import('../electron/model-catalog');
 const config={...cloud.config,endpoint:'https://api.venice.ai/api/v1'};
 const catalog={data:[{id:'specialist',context_length:1000000,model_spec:{pricing:{input:{usd:3},cache_write:{usd:3.75},output:{usd:15}},capabilities:{supportsVision:true,supportsFunctionCalling:true}}}]};
 const rows=veniceRegistryEntries(catalog,[{id:'specialist',role:'specialist',config}]);
 assert.equal(rows[0].pricing.inputUsdPerMillion,3.75);
 assert.equal(veniceRegistryEntries(catalog,[{id:'specialist',role:'specialist',config:{...config,model:'changed'}}]).length,0);
});
test('unresolved operation stops quality handoff and returns a durable pending reply',async t=>{
 const {task,snapshot}=await fixture(t);let escalations=0,asked=0;
 const d=deps(async()=>++asked===1?{role:'assistant',tool_calls:[{function:{name:'save',arguments:{}}}]}:{role:'assistant',content:''});
 d.runTool=async()=>'{"status":"unknown"}';
 const result=await task.loop([{role:'user',content:'Synthetic'}],d,()=>{escalations++;return cloud.config});assert.equal(escalations,0);
 assert.match(result.content,/Completion is unverified/);assert.equal((await snapshot()).reason,'awaiting_verification');
});
test('local visual final composition retains image evidence',async()=>{
 const {groundedReplyTurns}=await import('../electron/local-reply');
 const turns=groundedReplyTurns([{role:'user',content:'Describe',images:['synthetic-image']}],'Describe',{});
 assert.deepEqual(turns[1].images,['synthetic-image']);
});

test('queued external work cannot become completion or handoff, even if the model cannot answer',async t=>{
 const {task,snapshot}=await fixture(t);let escalations=0,asked=0;
 const d=deps(async()=>++asked===1?{role:'assistant',tool_calls:[{function:{name:'start_backup',arguments:{}}}]}:{role:'assistant',content:''});
 d.runTool=async()=>'{"ok":true,"status":"queued"}';
 const result=await task.loop([{role:'user',content:'Synthetic backup'}],d,()=>{escalations++;return cloud.config});assert.equal(escalations,0);
 assert.match(result.content,/Completion is unverified/);const row=await snapshot();assert.equal(row.status,'interrupted');assert.equal(row.operations[0].status,'unknown');
});

test('read-write-read observes the changed value while duplicate mutations execute once',async t=>{
 const {task,snapshot}=await fixture(t);let reads=0,writes=0,asked=0;
 const read={function:{name:'get_gpu_info',arguments:{}}},write={function:{name:'run_command',arguments:{command:'synthetic-only'}}};
 const d=deps(async()=>++asked===1?{role:'assistant',tool_calls:[read,write,read,write]}:{role:'assistant',content:'GPU 0 is at 55°C.'});
 d.runTool=async(call)=>call.function?.name==='get_gpu_info'?JSON.stringify([{temperature_c:54+reads++}]):(writes++,'{"exit":0,"output":"synthetic"}');
 const result=await task.loop([{role:'user',content:'Synthetic only'}],d);
 assert.equal(result.content,'GPU 0 is at 55°C.');assert.equal(reads,2);assert.equal(writes,1);const row=await snapshot();assert.equal(row.status,'completed');assert.equal(row.operations.length,3);
});
test('honest queued reply is delivered, preserved in the ledger and not replayed',async t=>{
 const {task,snapshot}=await fixture(t);let asked=0,executed=0;
 const call={function:{name:'start_backup',arguments:{target:'synthetic'}}};
 const d=deps(async()=>++asked===1?{role:'assistant',tool_calls:[call,call]}:{role:'assistant',content:'The backup is queued; I cannot confirm completion.'});
 d.runTool=async()=>{executed++;return '{"ok":true,"status":"queued","jobId":"synthetic-job"}'};
 const result=await task.loop([{role:'user',content:'Synthetic only'}],d);const row=await snapshot();
 assert.equal(executed,1);assert.match(result.content,/backup is queued/);assert.equal(row.reason,'awaiting_verification');assert.equal(row.result,result.content);
 assert.equal(JSON.parse(row.operations[0].result).data.jobId,'synthetic-job');
});
test('failed read is a failed observation, not an unresolved side effect',async t=>{
 const {task,snapshot}=await fixture(t);let asked=0;
 const d=deps(async()=>++asked===1?{role:'assistant',tool_calls:[{function:{name:'get_gpu_info',arguments:{}}}]}:{role:'assistant',content:'I could not read the GPU.'});
 d.runTool=async()=>'Permission denied';await task.loop([{role:'user',content:'Synthetic only'}],d);
 const row=await snapshot();assert.equal(row.status,'completed');assert.equal(row.operations[0].status,'failed');
});

test('hosted timeout has one local generation, or one private repair, with durable accounting', async t => {
 for (const rejected of [0, 1, 2]) {
  const { task, snapshot } = await fixture(t);
  const latest = 'This coffee tastes good.';
  const prepared = prepareNaturalConversation([{ role: 'user', content: latest }], latest,
   { identity: 'Haru', style: 'Dry but grounded' }, { voice: {} });
  const messages = prepared.messages;
  const published: string[] = [], gate = new ReplyGate(text => published.push(text));
  let localCalls = 0;
  const work = task.loop(messages, deps(async turns => {
   try {
    return await task.post(turns, cloud.config, [], 20, async (_signal, chunk) => {
     await new Promise(resolve => setTimeout(resolve, 35));
     chunk('late unvalidated hosted draft');
     return { role: 'assistant', content: 'late unvalidated hosted draft' };
    }, gate.chunk, 5);
   } catch (error) {
    assert.match(String(error), /first_word_timeout/);
    gate.reset();
    return answerLocalNaturalConversation(prepared.sources, latest, {}, localTurns => task.post(localTurns, local.config, [], 100,
     async (_signal, chunk) => {
      const reply = ++localCalls <= rejected ? "[annoyed] I'm still waiting for an apology." : '[happy] Glad you like it.';
      chunk(reply);
      return { role: 'assistant', content: JSON.stringify({ basis:'The user likes the coffee.',reply }) };
     }, gate.chunk));
   }
  }));
  if (rejected === 2) await assert.rejects(work, /apology/);
  else {
   const answer = await work;
   assert.deepEqual(published, []);
   gate.commit(answer.content!);
  }
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(localCalls, rejected === 0 ? 1 : 2);
  assert.deepEqual(published, rejected === 2 ? [] : ['[happy] Glad you like it.']);
  const row = await snapshot();
  assert.equal(row.attempts, 1 + localCalls);
  assert.equal(row.events.find((e: any) => e.kind === 'settled')?.detail.status, 'unknown');
  assert.equal(row.reservedMicros, 0);
  assert(row.spentMicros > 0, 'timed-out hosted work retains a conservative charge');
  assert.equal(row.operations.length, 0);
 }
});
