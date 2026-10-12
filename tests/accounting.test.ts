import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fromOpenAIReply } from '../electron/provider';
import { fromResponsesReply, streamResponses } from '../electron/responses-provider';
import { fromAnthropicReply, streamAnthropic } from '../electron/anthropic-provider';
import { readOpenAIStream } from '../electron/openai-stream';
import { takeProviderUsage } from '../electron/provider-usage';
import { usageCost, estimateReservation, readTaskPolicy, readModelRegistry, type ModelEntry } from '../electron/model-registry';
import { TaskController, type TaskTiming } from '../electron/task-controller';
import { TaskBridge } from '../electron/task-bridge';
const entry: ModelEntry = { id:'test',role:'specialist',local:false,enabled:true,
 config:{provider:'venice',endpoint:'https://example.test',model:'test',temperature:0},
 capabilities:{text:true,image:false,tools:true,contextWindow:100000,maxOutputTokens:1000},
 pricing:{inputUsdPerMillion:6,uncachedInputUsdPerMillion:3,outputUsdPerMillion:15,cachedInputUsdPerMillion:0.3,cacheWriteInputUsdPerMillion:3,cacheWrite1hInputUsdPerMillion:6} };
const reply = (usage?: unknown) => fromOpenAIReply({choices:[{message:{role:'assistant',content:'OK'}}],usage});
const sse = (events: unknown[]) => new Response(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''));
test('ordinary, cached and written input are mutually exclusive; reasoning is already in output',()=>{
 const usage={prompt_tokens:1000,completion_tokens:100,total_tokens:1100,prompt_tokens_details:{cached_tokens:200,cache_write_tokens:300},completion_tokens_details:{reasoning_tokens:90}};
 assert.equal(usageCost(entry,usage),3960);
 assert.equal(usageCost(entry,{input_tokens:500,output_tokens:100,cache_read_input_tokens:200,cache_creation_input_tokens:300,cache_creation:{ephemeral_5m_input_tokens:200,ephemeral_1h_input_tokens:100}},'anthropic'),4260);
 assert.equal(usageCost(entry,{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200,cache_write_tokens:300},output_tokens_details:{reasoning_tokens:90}}),3960);
 for(const u of [{}, {prompt_tokens:1}, {...usage,total_tokens:999}, {...usage,prompt_tokens_details:{cached_tokens:900,cache_write_tokens:200}}, {...usage,completion_tokens:-1}, {...usage,server_tool_use:{web_search_requests:1}}]) assert.equal(usageCost(entry,u),undefined);
});
test('billing rates survive registry read and extended tier uses actual total input',()=>{
 const rates={...entry.pricing!,extended:{...entry.pricing!,aboveInputTokens:900,inputUsdPerMillion:12,uncachedInputUsdPerMillion:6,outputUsdPerMillion:30,cachedInputUsdPerMillion:0.6}};
 const saved=readModelRegistry({entries:[{...entry,pricing:rates,pricingVerifiedAt:Date.now()}]},{local:{provider:'ollama',endpoint:'http://localhost:11434',model:'local',temperature:0}}).find(e=>e.id===entry.id)!;
 assert.deepEqual(saved.pricing,rates);
 assert.equal(usageCost(saved,{input_tokens:800,output_tokens:100,cache_read_input_tokens:200},'anthropic'),7920);
});
test('receipts are one-shot transport metadata, excluded from serialized messages and copied history',()=>{
 const usage={prompt_tokens:20,completion_tokens:2};const message=reply(usage);usage.prompt_tokens=0;
 assert(!JSON.stringify(message).includes('usage'));
 assert.equal(takeProviderUsage({...message}),undefined);
 assert.deepEqual(takeProviderUsage(message),{format:'openai',usage:{prompt_tokens:20,completion_tokens:2}});
 assert.equal(takeProviderUsage(message),undefined);
 assert.equal(takeProviderUsage({role:'assistant',content:JSON.stringify({usage})}),undefined);
});
test('OpenAI stream retains final cumulative usage once and rejects interrupted responses',async()=>{
 const message=await readOpenAIStream(sse([{choices:[{delta:{content:'OK'}}],usage:{prompt_tokens:10,completion_tokens:1}}, {choices:[{delta:{},finish_reason:'stop'}]}, {choices:[],usage:{prompt_tokens:10,completion_tokens:2}}, '[DONE]']),()=>{});
 assert.deepEqual(takeProviderUsage(message)?.usage,{prompt_tokens:10,completion_tokens:2});
 const interim=await readOpenAIStream(sse([{choices:[{delta:{content:'OK'}}],usage:{prompt_tokens:10,completion_tokens:1}}, {choices:[{delta:{},finish_reason:'stop'}]}, '[DONE]']),()=>{});
 assert.equal(takeProviderUsage(interim),undefined);
 await assert.rejects(readOpenAIStream(sse([{choices:[{delta:{content:'partial'}}],usage:{prompt_tokens:10,completion_tokens:1}}]),()=>{}),/incomplete/);
});
test('Responses ordinary and streaming receipts use completed response only',async()=>{
 const payload={status:'completed',output:[],usage:{input_tokens:20,output_tokens:2}};
 assert.deepEqual(takeProviderUsage(fromResponsesReply(payload,'test'))?.usage,payload.usage);
 const message=await streamResponses(sse([{type:'response.completed',response:payload}]),'test',()=>{});
 assert.deepEqual(takeProviderUsage(message)?.usage,payload.usage);
 await assert.rejects(streamResponses(sse([{type:'response.output_text.delta',delta:'partial'}]),'test',()=>{}),/incomplete/);
});
test('Anthropic cumulative stream merges start and final counters; incomplete usage stays unpriced',async()=>{
 const start={input_tokens:5,output_tokens:1,cache_read_input_tokens:20,cache_creation_input_tokens:10};
 const events=[{type:'message_start',message:{usage:start}},{type:'message_delta',usage:{output_tokens:4,input_tokens:null}},{type:'message_delta',usage:{output_tokens:8}},{type:'message_stop'}];
 const message=await streamAnthropic(sse(events),'test',()=>{});
 assert.deepEqual(takeProviderUsage(message),{format:'anthropic',usage:{...start,output_tokens:8}});
 assert.equal(takeProviderUsage(await streamAnthropic(sse([events[0],events[3]]),'test',()=>{})),undefined);
 assert.equal(takeProviderUsage(fromAnthropicReply({content:[],usage:start},'test'))?.format,'anthropic');
});
async function ledgerFixture(t: any, timing?: (event: TaskTiming) => void) {
 const bridge=new TaskBridge('/home/toomii/haru-core',path.join(mkdtempSync(path.join(tmpdir(),'haru-accounting-')),'tasks.db'));
 const events:{method:string;args:any}[]=[];let taskId='';
 const rpc:typeof bridge.call=async(method,args)=>{events.push({method,args});const result=await bridge.call(method,args);if(method==='create')taskId=result.id;return result};
 const messages=[{role:'user',content:'Synthetic accounting test.'}];
 const reserve=estimateReservation(entry,messages,1000)!.costMicros;
 const policy=readTaskPolicy({taskBudgetMicros:reserve+100,dailyBudgetMicros:reserve+100});
 const task=new TaskController(rpc,[entry],policy,true,undefined,timing);await task.start('Synthetic accounting test',entry.config.model);
 t.after(async()=>{ await task.compose(async()=>({role:'assistant',content:'cleanup'})).catch(()=>{});bridge.close(); });return {bridge,task,events,messages,reserve,policy,rpc,snapshot:()=>bridge.call('get',{taskId})};
}
test('timing observes actual dispatch, first text, completion and durable usage without content', async t => {
 const timings:TaskTiming[]=[];const f=await ledgerFixture(t,event=>timings.push(event));
 await f.task.compose(()=>f.task.post(f.messages,entry.config,[],1000,async(_signal,chunk)=>{
   chunk('private draft'); chunk(' more');
   return reply({prompt_tokens:10,completion_tokens:2,prompt_tokens_details:{cached_tokens:4}});
 }));
 assert.deepEqual(timings.map(e=>e.stage),['dispatch','first_provider_text','provider_complete','settled']);
 assert.equal(timings.at(-1)?.cachedTokens,4);assert.equal(timings.at(-1)?.basis,'provider_usage');
 assert.ok(timings.every(e=>e.at>=timings[0].at&&e.attempt===1));
 assert.doesNotMatch(JSON.stringify(timings),/private draft|Synthetic accounting|"OK"/);
});

test('telemetry failure cannot block settlement or publication', async t => {
 const f=await ledgerFixture(t,()=>{throw Error('diagnostics unavailable');});
 assert.equal(await f.task.compose(()=>f.task.post(f.messages,entry.config,[],1000,async()=>reply({prompt_tokens:10,completion_tokens:2}))), 'OK');
 assert.equal((await f.snapshot()).spentMicros,60);
});
test('settlement releases task and daily headroom and persists its usage receipt',async t=>{
 const f=await ledgerFixture(t);const post=()=>f.task.post(f.messages,entry.config,[],1000,async()=>reply({prompt_tokens:10,completion_tokens:2}));
 await post();await post();assert.equal((await f.snapshot()).spentMicros,120);assert.equal((await f.snapshot()).reservedMicros,0);
 const settlements=f.events.filter(e=>e.method==='settle');assert.equal(settlements[0].args.usage.basis,'provider_usage');assert.equal(settlements[0].args.costMicros,60);
 await f.task.compose(async()=>({role:'assistant',content:'Done'}));
 const next=new TaskController(f.rpc,[entry],f.policy,true);await next.start('Second synthetic task',entry.config.model);
 await next.compose(()=>next.post(f.messages,entry.config,[],990,async()=>reply({prompt_tokens:10,completion_tokens:2})));
});
test('missing, malformed and fabricated usage retain full reservation',async t=>{
 for(const response of [reply(),reply({prompt_tokens:1,completion_tokens:-1}),{role:'assistant',content:'OK',usage:{prompt_tokens:0,completion_tokens:0}}]) {
  const f=await ledgerFixture(t);await f.task.compose(()=>f.task.post(f.messages,entry.config,[],1000,async()=>response));
  assert.equal((await f.snapshot()).spentMicros,f.reserve);
  assert.equal(f.events.find(e=>e.method==='settle')!.args.usage.basis,'reservation');
 }
});
test('transport failure and timeout preserve conservative charge even if late usage arrives',async t=>{
 const f=await ledgerFixture(t);
 await assert.rejects(f.task.compose(()=>f.task.post(f.messages,entry.config,[],1000,async()=>{await new Promise(r=>setTimeout(r,30));return reply({prompt_tokens:1,completion_tokens:1})},undefined,5)),/first_word/);
 await new Promise(r=>setTimeout(r,50));assert.equal((await f.snapshot()).spentMicros,f.reserve);
 assert.equal(f.events.find(e=>e.method==='settle')!.args.status,'unknown');
});
test('Venice catalog separates its cache_input rate from ordinary input and reservation ceiling',async()=>{
 const {veniceRegistryEntries}=await import('../electron/model-catalog');
 const config={...entry.config,endpoint:'https://api.venice.ai/api/v1',model:'claude-sonnet-5-5'};
 const rows=veniceRegistryEntries({data:[{id:config.model,context_length:200000,model_spec:{pricing:{input:{usd:3.75},output:{usd:18.75},cache_input:{usd:0.375},cache_write:{usd:4.6875}},capabilities:{supportsFunctionCalling:true}}}]},[{id:'specialist',role:'specialist',config}]);
 assert.equal(rows[0].pricing.cachedInputUsdPerMillion,0.375);
 const priced={...entry,pricing:rows[0].pricing};
 assert.equal(usageCost(priced,{prompt_tokens:1000,completion_tokens:10,prompt_tokens_details:{cached_tokens:800,cache_write_tokens:100}}),1332);
});
test('provider-reported spending is not clamped to its reservation',async t=>{
 const f=await ledgerFixture(t);
 await f.task.compose(()=>f.task.post(f.messages,entry.config,[],1000,async()=>reply({prompt_tokens:10000,completion_tokens:1000})));
 assert.equal((await f.snapshot()).spentMicros,45000);assert(45000>f.reserve);
});
test('reservation bounds every configured input billing category',()=>{
 const low={...entry,pricing:{...entry.pricing!,inputUsdPerMillion:1,cacheWrite1hInputUsdPerMillion:10}};
 const reservation=estimateReservation(low,[{role:'user',content:'hello'}],100)!;
 assert.equal(reservation.costMicros,reservation.inputTokens*10+1500);
});
