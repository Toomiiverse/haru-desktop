import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectFastConversationModel, NATURAL_MAX_TOKENS } from '../electron/natural-conversation';
import { estimateReservation, isLocalConfig, type ModelEntry } from '../electron/model-registry';
import { selectTaskModel } from '../electron/task-router';
import { coreFastConversationModel } from '../electron/core-router';

const entry: ModelEntry = { id:'conversation',role:'conversation',enabled:true,local:false,
 config:{provider:'openai',endpoint:'https://api.abliteration.ai/v1',model:'abliterated-model-large-v2',temperature:0.7},
 pricing:{inputUsdPerMillion:2,outputUsdPerMillion:6},capabilities:{text:true,image:false,tools:true,contextWindow:100000,maxOutputTokens:8192} };
const setting={...entry.config,enabled:true};
const conversation=[{role:'user',content:'Please be less formal.'}];
const local={provider:'ollama',endpoint:'http://127.0.0.1:11436',model:'local-fixture',temperature:0.7};

test('short replies reserve their actual output limit, retaining the conservative input bound',()=>{
 for(const limit of [128,192]){
  const budget=estimateReservation(entry,conversation,limit)!.costMicros;
  const request={conversation,cloudAllowed:true,budgetMicros:budget,maxOutputTokens:limit};
  assert.equal(selectTaskModel([entry],'conversation',{...request,maxOutputTokens:undefined}),undefined);
  assert.equal(selectFastConversationModel([entry],setting,request)?.config.model,entry.config.model);
  assert.equal(selectFastConversationModel([entry],setting,{...request,budgetMicros:budget-1}),undefined);
 }
 const budget=estimateReservation(entry,conversation,128)!.costMicros;
 assert.ok(selectFastConversationModel([entry],setting,{conversation,cloudAllowed:true,budgetMicros:budget}));
});

test('the short allowance never bypasses privacy, credentials, missing prices or disabled routes',()=>{
 const request={conversation,cloudAllowed:true,budgetMicros:10000,available:()=>true};
 for(const denied of [{...request,cloudAllowed:false},{...request,available:()=>false},{...request,budgetMicros:0},
  {...request,conversation:[{role:'user',content:'password: synthetic-private-value'}]}])assert.equal(selectFastConversationModel([entry],setting,denied),undefined);
 assert.equal(selectFastConversationModel([{...entry,pricing:null}],setting,request),undefined);
 assert.equal(selectFastConversationModel([entry],{...setting,enabled:false},request),undefined);
});

const build=process.env.HARU_LATENCY_RUNTIME??mkdtempSync(path.join(tmpdir(),'haru-fast-budget-'));
if(!process.env.HARU_LATENCY_RUNTIME)execFileSync(path.resolve('node_modules/.bin/tsc'),['-p','electron/tsconfig.json','--outDir',build]);
const source=readFileSync(path.join(build,'main.js'),'utf8').replace(/\b[a-z_]+_\d+\./g,'');
if(!process.env.HARU_LATENCY_RUNTIME)rmSync(build,{recursive:true,force:true});
const start=source.indexOf('const naturalMaxTokens =');
const end=source.indexOf('const modelObservations',start);
assert.ok(start>=0&&end>start);
async function route(overrides:Record<string,unknown>={}){
 const context={naturalKind:'social',NATURAL_MAX_TOKENS,selectFastConversationModel,coreFastConversationModel,registry:[entry],store:{get:()=>setting},cloudAllowed:true,
  policy:{enabled:true,taskBudgetMicros:estimateReservation(entry,conversation,192)!.costMicros,dailyBudgetMicros:100000},conversation,
  hasKeyFor:()=>true,isLocalConfig,config:local,home:local,brain:{config:local,role:'everyday',because:'preliminary allowance'},
  eligible:()=>undefined,sendToWindows(){},console:{log(){}},prepMark(){},
  brainFromEntry:(e:ModelEntry,because:string)=>({config:e.config,role:e.role,hosted:!e.local,because}),...overrides};
 return vm.runInNewContext(`(async()=>{${source.slice(start,end)};return {config,brain,naturalMaxTokens};})()`,context);
}

test('actual final routing reconsiders a preliminary local fallback using the compact request',async()=>{
 for(const kind of ['social','play']){
  const selected=await route({naturalKind:kind});assert.equal(selected.config.model,entry.config.model);
  assert.equal(selected.brain.hosted,true);assert.equal(selected.naturalMaxTokens,kind==='play'?192:128);
 }
});

test('actual final routing preserves local-only, unavailable, unaffordable and full-pipeline decisions',async()=>{
 for(const overrides of [{cloudAllowed:false},{hasKeyFor:()=>false},{naturalKind:null},
  {policy:{enabled:true,taskBudgetMicros:1,dailyBudgetMicros:100000}},
  {conversation:[{role:'user',content:'password: synthetic-private-value'}]},
  {store:{get:()=>({...setting,enabled:false})}}])assert.equal((await route(overrides)).config.model,local.model);
});

test('actual final routing waits for an asynchronous eligible full-conversation route',async()=>{
 const selected=await route({naturalKind:null,config:entry.config,brain:{config:entry.config,role:'conversation',because:'ordinary'},
  eligible:async()=>{await Promise.resolve();return entry;}});
 assert.equal(selected.config.model,entry.config.model);assert.equal(selected.brain.hosted,true);
});
