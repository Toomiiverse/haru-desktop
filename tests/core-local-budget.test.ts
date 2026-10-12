import test from 'node:test';
import assert from 'node:assert/strict';
import {modelResidency,coreLocalBudget} from '../electron/core-local-budget';
import {InferencePriority} from '../electron/inference-priority';
import {activeTask} from '../electron/task-controller';
import {CoreServiceClient} from '../electron/core-service-client';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('only the exact requested model and sufficient allocated context are warm',()=>{
  assert.equal(modelResidency({models:[]},'fixture',8192),'cold');
  assert.equal(modelResidency({models:[{name:'fixture',context_length:8192}]},'fixture',8192),'warm');
  assert.equal(modelResidency({models:[{model:'fixture',context_length:20480}]},'fixture',8192),'warm');
  assert.equal(modelResidency({models:[{name:'fixture-other',context_length:8192}]},'fixture',8192),'cold');
  assert.equal(modelResidency({models:[{name:'fixture',context_length:4096}]},'fixture',8192),'cold');
  assert.equal(modelResidency({models:[{name:'fixture'}]},'fixture',8192),'unknown');
  assert.equal(modelResidency({models:[null]},'fixture',8192),'unknown');
  assert.equal(modelResidency({},'fixture',8192),'unknown');
});

test('disabled local budget makes no residency or service request',async()=>{
  const old=process.env.HARU_CORE_LOCAL_BUDGETS;delete process.env.HARU_CORE_LOCAL_BUDGETS;
  try{assert.equal(await coreLocalBudget({provider:'ollama',endpoint:'http://127.0.0.1:11436',model:'fixture',temperature:.2},8192,async()=>{throw Error('unexpected_fetch');}),undefined);}
  finally{old===undefined?delete process.env.HARU_CORE_LOCAL_BUDGETS:process.env.HARU_CORE_LOCAL_BUDGETS=old;}
});

test('native provider observes residency without an Electron Ollama request, probe failure stays unknown',async()=>{
  const keys=['HARU_CORE_LOCAL_BUDGETS','HARU_CORE_MODEL_PROVIDER','HARU_CORE_SERVICE_ENDPOINT','HARU_CORE_SERVICE_TOKEN_FILE'];
  const old=keys.map(key=>process.env[key]);const folder=mkdtempSync(join(tmpdir(),'haru-residency-'));
  const residency=CoreServiceClient.prototype.modelResidency,budget=CoreServiceClient.prototype.localBudget;
  writeFileSync(join(folder,'token'),'a'.repeat(64),{mode:0o600});
  let probes=0,budgets=0;const signal=new AbortController().signal;
  Object.assign(process.env,{HARU_CORE_LOCAL_BUDGETS:'on',HARU_CORE_MODEL_PROVIDER:'on',HARU_CORE_SERVICE_ENDPOINT:'http://127.0.0.1:8791',HARU_CORE_SERVICE_TOKEN_FILE:join(folder,'token')});
  try{
    CoreServiceClient.prototype.modelResidency=async(input,actualSignal)=>{
      assert.equal(actualSignal,signal);assert.equal(input.endpoint,'http://127.0.0.1:11436');
      probes++;if(probes===2)throw Error('unavailable');
      return {version:1,model:'fixture',provider:'llamacpp',residency:'warm',context_tokens:8192};
    };
    CoreServiceClient.prototype.localBudget=async(input)=>{
      budgets++;assert.equal(input.task_id,'fixture');assert.equal(input.residency,budgets===1?'warm':'unknown');
      return {limit_ms:35000,task_limited:false};
    };
    const task={signal,binding:async()=>({taskId:'fixture',revision:1})} as any;
    for(let i=0;i<2;i++)assert.equal(await activeTask.run(task,()=>coreLocalBudget({provider:'ollama',endpoint:'http://localhost:11436/',model:'fixture',temperature:.2},8192,async()=>{throw Error('unexpected_legacy_probe');})),35000);
    assert.equal(probes,2);assert.equal(budgets,2);
  }finally{
    CoreServiceClient.prototype.modelResidency=residency;CoreServiceClient.prototype.localBudget=budget;
    keys.forEach((key,i)=>old[i]===undefined?delete process.env[key]:process.env[key]=old[i]);rmSync(folder,{recursive:true,force:true});
  }
});

test('explicit local allowance still shares one cancellation signal and timer',async()=>{
  const priority=new InferencePriority({replyMs:5});let outer:AbortSignal|undefined;
  const result=await priority.localReply(async()=>{
    outer=priority.replySignal;
    return priority.localReply(async()=>{assert.equal(priority.replySignal,outer);await new Promise(resolve=>setTimeout(resolve,15));return 'confirmed';});
  },100);
  assert.equal(result,'confirmed');assert.equal(outer?.aborted,true);
  await assert.rejects(priority.localReply(async()=>new Promise(resolve=>setTimeout(()=>resolve('late'),50)),10),/local_reply_timeout/);
  await assert.rejects(priority.localReply(async()=>'',180001),/invalid_local_reply_limit/);
});
