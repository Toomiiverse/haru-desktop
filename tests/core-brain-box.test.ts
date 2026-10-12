import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {coreCloudFetch,cloudWirePrivacyView} from '../electron/core-cloud-provider';
import {makeToolReceipt} from '../electron/tool-receipt';
import {assertOutboundSafe} from '../electron/outbound';
import {receivedProviderMessage} from '../electron/provider-state';
import {activeAttempt} from '../electron/task-controller';
import {CoreServiceClient} from '../electron/core-service-client';
import {corePrepareNaturalConversation} from '../electron/core-prompts';
import {naturalConversationTurns} from '../electron/natural-conversation';

test('cloud adapter preserves disabled transport and enforces final-body privacy before dispatch',async()=>{
  const old={...process.env},cloud=CoreServiceClient.prototype.cloudModel;
  const temp=mkdtempSync(path.join(tmpdir(),'haru-brain-box-')),token=path.join(temp,'token');writeFileSync(token,'private-test-token-'.repeat(4),{mode:0o600});
  try{
    delete process.env.HARU_CORE_CLOUD_PROVIDER;
    const init={method:'POST',body:'unchanged'},url='https://api.deepseek.com/chat/completions';let direct=0;
    await coreCloudFetch(async(address,options)=>{direct++;assert.equal(address,url);assert.equal(options,init);return new Response('{}');},url,init);
    assert.equal(direct,1);
    process.env.HARU_CORE_CLOUD_PROVIDER='on';process.env.HARU_CORE_SERVICE_ENDPOINT='http://127.0.0.1:8791';process.env.HARU_CORE_SERVICE_TOKEN_FILE=token;
    const attempt={taskId:'task',revision:2,attemptId:'attempt',model:'fixture',deadlineAt:Date.now()+10000};let requests:any[]=[];
    CoreServiceClient.prototype.cloudModel=async(input)=>{requests.push(input);return new Response('{}');};
    const body={model:'fixture',messages:[{role:'user',content:'Hello 世界'}],stream:false,max_tokens:64,temperature:.37};
    const options={method:'POST',headers:{authorization:'Bearer fixture-transient-key'},body:JSON.stringify(body)};
    await assert.rejects(coreCloudFetch(async()=>{throw Error('direct_transport_called');},url,options),/attempt_required/);
    await activeAttempt.run(attempt,()=>coreCloudFetch(async()=>{throw Error('direct_transport_called');},url,options));
    assert.deepEqual(requests[0].input.body,body);assert.equal(requests[0].input.credential,'fixture-transient-key');assert.equal(requests[0].endpoint,'https://api.deepseek.com');
    await activeAttempt.run(attempt,()=>assert.rejects(coreCloudFetch(async()=>{throw Error('direct_transport_called');},url,{...options,body:JSON.stringify({...body,messages:[{role:'user',content:'password: hunter2'}]})}),/privacy_blocked/));
    await activeAttempt.run(attempt,()=>assert.rejects(coreCloudFetch(async()=>{throw Error('direct_transport_called');},'https://api.deepseek.com.evil.test/chat/completions',options),/endpoint_required/));
    assert.equal(requests.length,1);
  }finally{
    CoreServiceClient.prototype.cloudModel=cloud;for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);rmSync(temp,{recursive:true,force:true});
  }
});

test('final cloud privacy scan preserves trusted receipt metadata and provider IDs while scanning tool data',()=>{
  // A timestamp that passes Luhn previously made a valid read fall back locally.
  const receipt=makeToolReceipt('vault_read',{path:'Synthetic.md'},'Synthetic note.',1790830534915,1790830534915);
  const content=JSON.stringify(receipt),id='call_SyntheticAbCdEfGhIjKlMnOpQr12345678';
  receivedProviderMessage({role:'assistant',tool_calls:[{id,function:{name:'vault_read',arguments:{path:'Synthetic.md'}}}]});
  const body={model:'fixture',messages:[{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name:'vault_read',arguments:'{"path":"Synthetic.md"}'}}]},
    {role:'tool',tool_call_id:id,content}],max_tokens:64,stream:false};
  assert.doesNotThrow(()=>assertOutboundSafe([{role:'system',content:JSON.stringify(cloudWirePrivacyView(body,'openai'))}]));
  assert.equal(body.messages[1].content,content);
  const privateBody={...body,messages:[{role:'tool',content:'password: hunter2'}]};
  assert.throws(()=>assertOutboundSafe([{role:'system',content:JSON.stringify(cloudWirePrivacyView(privateBody,'openai'))}]),/privacy_blocked/);
});

test('prompt overflow retains the full-pipeline fallback code and disabled mode retains legacy assembly',async()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'haru-prompt-rollback-')),token=path.join(temp,'token');writeFileSync(token,'private-test-token-'.repeat(4),{mode:0o600});
  const fetcher=globalThis.fetch,flag=process.env.HARU_CORE_PROMPT_ASSEMBLY;
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({detail:'natural_identity_overflow'}),{status:422,headers:{'content-type':'application/json'}});
    await assert.rejects(new CoreServiceClient({endpoint:'http://127.0.0.1:8791',tokenFile:token}).assemblePrompt({mode:'natural'}),/natural_context_overflow:identity/);
    delete process.env.HARU_CORE_PROMPT_ASSEMBLY;
    const messages=[{role:'user',content:'Hello.'}],character={identity:'Synthetic companion.',style:'Concise.'};
    const result=await corePrepareNaturalConversation(messages,'Hello.',character,{});
    assert.deepEqual(result.messages,naturalConversationTurns(messages,'Hello.',character,{}));
  }finally{
    globalThis.fetch=fetcher;if(flag===undefined)delete process.env.HARU_CORE_PROMPT_ASSEMBLY;else process.env.HARU_CORE_PROMPT_ASSEMBLY=flag;rmSync(temp,{recursive:true,force:true});
  }
});
