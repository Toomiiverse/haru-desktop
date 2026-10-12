import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocketServer} from 'ws';
import {runCoreHarness} from '../electron/core-harness';
import type {ToolLoopDeps} from '../electron/toolloop';

async function fixture(payload:Record<string,unknown>,enabled=true,action='worker',reply:Record<string,unknown>={role:'assistant',content:'Final response.'}){
  const root=mkdtempSync(path.join(tmpdir(),'haru-workflow-bridge-'));
  const token=path.join(root,'token');writeFileSync(token,'fixture-private-token-for-workflow-bridge',{mode:0o600});
  const old=process.env.HARU_CORE_WORKFLOW_PLANNING;process.env.HARU_CORE_WORKFLOW_PLANNING=enabled?'on':'off';
  const server=new WebSocketServer({host:'127.0.0.1',port:0});
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(typeof address==='string'||!address)throw Error('fixture_port_missing');
  const calls:unknown[]=[];let frame:any;let acknowledged:any;
  server.on('connection',socket=>{
    socket.once('message',raw=>{
      frame=JSON.parse(String(raw));
      socket.send(JSON.stringify({version:1,kind:'started',taskId:'fixture',revision:1,mode:'receipt-program',maxRounds:5}));
      socket.send(JSON.stringify({version:1,kind:'command',seq:1,action,payload}));
    });
    socket.on('message',raw=>{
      const reply=JSON.parse(String(raw));if(reply.seq!==1)return;
      acknowledged=reply;
      if(reply.ok)socket.send(JSON.stringify({version:1,kind:'completed',result:{message:{role:'assistant',content:'Done.'},content:'Done.',ran:['vault_write'],rounds:5,conversation:[]}}));
      else socket.send(JSON.stringify({version:1,kind:'failed',code:'adapter_failed',message:'Fixture adapter rejected the command.'}));
    });
  });
  const deps:ToolLoopDeps={splitPlanning:true,receiptPrograms:true,workerRoles:['conversation'],runWorker:async(conversation,options)=>{
    calls.push({conversation,options});return {message:{role:'assistant',content:'worker text'},model:'registered'};
  },ask:async(conversation,options)=>{calls.push({conversation,options});return reply as any;},runTool:async()=>{throw Error('unexpected_tool');},
    pageWasRead:()=>false,handsAllowed:()=>false,hasOpenTask:()=>false,canSearch:()=>false,withdrawHands(){}};
  try{
    const result=await runCoreHarness([{role:'user',content:'fixture request'}],deps,{endpoint:`http://127.0.0.1:${address.port}`,tokenFile:token},async()=>({taskId:'fixture',revision:1}));
    return {result,calls,frame,acknowledged};
  }finally{
    for(const client of server.clients)client.terminate();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(old===undefined)delete process.env.HARU_CORE_WORKFLOW_PLANNING;else process.env.HARU_CORE_WORKFLOW_PLANNING=old;
    rmSync(root,{recursive:true,force:true});
  }
}

const valid={role:'conversation',tools:false,maxTokens:768,scope:{},conversation:[{role:'system',content:'Tool-free worker.'},{role:'user',content:'Untrusted source envelope.'}]};
test('registered tool-free worker uses the negotiated bounded program rounds',async()=>{
  const result=await fixture(valid);
  assert.equal(result.result?.content,'Done.');assert.equal(result.result?.rounds,5);assert.equal(result.calls.length,1);
  assert.deepEqual(result.frame.worker_roles,['conversation']);assert.equal(result.frame.max_workflow_rounds,8);
  assert.ok(result.frame.supported_profiles.includes('receipt-program-v1'));
});
for(const [name,change]of [
  ['unoffered role',{role:'premium'}],['tools enabled',{tools:true}],['oversized output',{maxTokens:769}],
  ['tool-shaped messages',{conversation:[{role:'assistant',content:'',tool_calls:[{}]}]}],
  ['image input',{conversation:[{role:'user',content:'image',images:['opaque-image']}]}],
]as const)test(`worker dispatch rejects ${name}`,async()=>{
  await assert.rejects(fixture({...valid,...change}),/core_harness_worker_invalid/);
});
test('a disabled capability cannot negotiate extended workflow execution',async()=>{
  await assert.rejects(fixture(valid,false),/core_harness_workflow_invalid/);
});
test('workflow response keeps the tool-free profile and explicit output cap',async()=>{
  const result=await fixture({conversation:valid.conversation,tools:false,inputProfile:'workflow-response',maxTokens:320},true,'ask');
  assert.equal(result.calls.length,1);
  assert.deepEqual((result.calls[0] as any).options,{tools:false,inputProfile:'workflow-response',maxTokens:320});
});
test('unavailable workflow response sends a structured result for native completion',async()=>{
  const result=await fixture({conversation:valid.conversation,tools:false,inputProfile:'workflow-response',maxTokens:320},true,'ask',
    {role:'assistant',content:'',workflowResponseUnavailable:true});
  assert.deepEqual(result.acknowledged.result,{error:'workflow_response_unavailable'});
});
for(const [name,change]of [['content',{content:'untrusted answer'}],['tool calls',{tool_calls:[{}]}],['false flag',{workflowResponseUnavailable:false}]] as const)
test(`unavailable workflow response rejects ${name}`,async()=>{
  await assert.rejects(fixture({conversation:valid.conversation,tools:false,inputProfile:'workflow-response',maxTokens:320},true,'ask',
    {role:'assistant',content:'',workflowResponseUnavailable:true,...change}),/core_harness_response_invalid/);
});
test('an ordinary ask cannot claim the workflow completion fallback',async()=>{
  await assert.rejects(fixture({conversation:valid.conversation,tools:false},true,'ask',
    {role:'assistant',content:'',workflowResponseUnavailable:true}),/core_harness_response_invalid/);
});
for(const [name,change]of [['tools on',{tools:true}],['missing cap',{maxTokens:undefined}],['excessive cap',{maxTokens:1025}]] as const)
test(`workflow response rejects ${name}`,async()=>{
  await assert.rejects(fixture({conversation:valid.conversation,tools:false,inputProfile:'workflow-response',maxTokens:320,...change},true,'ask'),/core_harness_profile_invalid/);
});
