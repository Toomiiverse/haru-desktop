import test from 'node:test';
import assert from 'node:assert/strict';
import {callRegistry,selectCallModel,CALL_ROUTE_ID} from '../electron/call-route';
import type {ModelEntry,RouteRequest} from '../electron/model-registry';
const entry:ModelEntry={id:'candidate',role:'specialist',config:{provider:'openai',endpoint:'https://api.deepseek.com',model:'deepseek-flash',temperature:.7},enabled:true,local:false,pricing:{inputUsdPerMillion:1,outputUsdPerMillion:1},capabilities:{text:true,image:false,tools:true,contextWindow:8192,maxOutputTokens:1024}};
const preference={enabled:true,modelId:'candidate'};
const request:RouteRequest={cloudAllowed:true,conversation:[{role:'user',content:'hello'}],inputs:['text'],tools:false,maxOutputTokens:100,budgetMicros:100000,available:()=>true};
test('call override leaves typed chat and escalation entries unchanged',async()=>{
  const original=[entry];assert.equal(callRegistry(original,preference,false),original);
  assert.equal(callRegistry(original,undefined,true),original);
  assert.equal(callRegistry(original,{enabled:true,modelId:'local-planner'},true),original);
  const registry=callRegistry(original,preference,true);
  assert.equal(registry[0],entry);assert.equal(registry[1].role,'conversation');
  assert.equal((await selectCallModel(registry,'conversation',request))?.id,CALL_ROUTE_ID);
  assert.equal(await selectCallModel(registry,'specialist',request),undefined);
});
test('call override cannot bypass privacy, capabilities, cost or failed-model exclusion',async()=>{
  const registry=callRegistry([entry],preference,true);
  for(const patch of [{cloudAllowed:false},{available:()=>false},{budgetMicros:0},{inputs:['image'] as const},{excludeIds:[CALL_ROUTE_ID]},
    {conversation:[{role:'user',content:'My password is secret-fixture-783.'}]}])
    assert.equal(await selectCallModel(registry,'conversation',{...request,...patch,inputs:[...(patch.inputs??request.inputs??['text'])]}),undefined);
  assert.equal(await selectCallModel(callRegistry([{...entry,pricing:null}],preference,true),'conversation',request),undefined);
});
