import test from 'node:test';
import assert from 'node:assert/strict';
import {visionConversation} from '../electron/vision';
import {coreLook} from '../electron/core-perception';

test('vision accounting uses the exact existing prompt and images',()=>{
  assert.deepEqual(visionConversation(['a','b'],{system:'Fixture system',ask:'Fixture image request'}),[
    {role:'system',content:'Fixture system'},{role:'user',content:'Fixture image request',images:['a','b']},
  ]);
  const defaultPrompt=visionConversation('a');assert.equal(defaultPrompt.length,1);assert.match(defaultPrompt[0].content,/picture/);assert.deepEqual(defaultPrompt[0].images,['a']);
});

test('disabled perception preserves the old wire request and never calls task authority',async()=>{
  const previous=process.env.HARU_CORE_PERCEPTION;delete process.env.HARU_CORE_PERCEPTION;
  let body:any;
  try{
    const sighting=await coreLook(['a',{enabled:true,model:'fixture',folder:''},'http://127.0.0.1:11436',{},async(_url,init)=>{
      body=JSON.parse(init.body);return new Response(JSON.stringify({message:{content:'A red square.'}}));
    },{ask:'Describe the fixture',numCtx:8192,numPredict:450,keepAlive:'5m'}],{
      rpc:async()=>{throw Error('unexpected_authority');},registry:()=>{throw Error('unexpected_registry');},policy:()=>{throw Error('unexpected_policy');},
    });
    assert.deepEqual(sighting,{description:'A red square.',model:'fixture'});
    assert.deepEqual(body,{model:'fixture',messages:[{role:'user',content:'Describe the fixture',images:['a']}],keep_alive:'5m',stream:false,think:false,options:{temperature:.2,num_ctx:8192,num_predict:450}});
  }finally{previous===undefined?delete process.env.HARU_CORE_PERCEPTION:process.env.HARU_CORE_PERCEPTION=previous;}
});

test('native perception rejects a nonlocal route before any task or image dispatch',async()=>{
  const previous=process.env.HARU_CORE_PERCEPTION;process.env.HARU_CORE_PERCEPTION='on';let calls=0;
  try{
    await assert.rejects(coreLook(['private-image',{enabled:true,model:'fixture',folder:''},'https://external.invalid',{},async()=>{calls++;throw Error('unexpected_transport');}],{
      rpc:async()=>{calls++;throw Error('unexpected_authority');},registry:()=>{throw Error('unexpected_registry');},policy:()=>{throw Error('unexpected_policy');},
    }),/core_perception_loopback_required/);assert.equal(calls,0);
  }finally{previous===undefined?delete process.env.HARU_CORE_PERCEPTION:process.env.HARU_CORE_PERCEPTION=previous;}
});
