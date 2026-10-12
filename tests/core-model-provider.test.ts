import test from 'node:test';
import assert from 'node:assert/strict';
import {coreModelFetch,neutralModelInput} from '../electron/core-model-provider';
import {activeAttempt} from '../electron/task-controller';
const body={model:'fixture',messages:[{role:'user',content:'synthetic',images:['A'.repeat(2097152)]}],stream:false,think:false,keep_alive:-1,
  options:{temperature:.2,num_ctx:8192,num_predict:64}};
test('neutral request preserves images, schema and sampling omission',()=>{
 const input=neutralModelInput(body);assert.deepEqual(input.messages,body.messages);assert.equal(input.context_tokens,8192);assert.equal(input.max_tokens,64);assert.equal(input.request_type,'perception');
 assert(!('seed' in input));assert(!('top_p' in input));assert.equal(neutralModelInput({...body,think:undefined}).thinking,null);
 assert.throws(()=>neutralModelInput({...body,options:{...body.options,top_k:20}}),/unqualified/);
});
test('disabled provider boundary forwards the exact request without Core',async()=>{
 const old=process.env.HARU_CORE_MODEL_PROVIDER;delete process.env.HARU_CORE_MODEL_PROVIDER;
 const init={method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}};let calls=0;
 try{await coreModelFetch(async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:11436/api/chat');assert.equal(options,init);return new Response('{}');},'http://127.0.0.1:11436/api/chat',init);assert.equal(calls,1);}
 finally{old===undefined?delete process.env.HARU_CORE_MODEL_PROVIDER:process.env.HARU_CORE_MODEL_PROVIDER=old;}
});
test('enabled provider refuses unowned, mismatched and remote requests before dispatch',async()=>{
 const old=process.env.HARU_CORE_MODEL_PROVIDER;process.env.HARU_CORE_MODEL_PROVIDER='on';let calls=0;
 const fetcher=async()=>{calls++;return new Response('{}');},init={method:'POST',body:JSON.stringify(body)};
 try{
  await assert.rejects(coreModelFetch(fetcher,'https://example.com/api/chat',init),/loopback/);
  await assert.rejects(coreModelFetch(fetcher,'http://127.0.0.1:11436/api/chat',init),/attempt_required/);
  await activeAttempt.run({taskId:'one',revision:1,attemptId:'one',model:'other',deadlineAt:Date.now()+10000},async()=>{
   await assert.rejects(coreModelFetch(fetcher,'http://127.0.0.1:11436/api/chat',init),/service_required|mismatch/);
  });assert.equal(calls,0);
 }finally{old===undefined?delete process.env.HARU_CORE_MODEL_PROVIDER:process.env.HARU_CORE_MODEL_PROVIDER=old;}
});
