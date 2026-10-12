import test from 'node:test';
import assert from 'node:assert/strict';
import {graphFingerprint,graphJob,graphFailure,graphPolicy,assertGraphCounter} from '../electron/graph-job';
import {emptyGraph} from '../electron/factgraph';
test('invalid graph counters fail before a model can add duplicate or NaN IDs',()=>{
  assert.equal(assertGraphCounter(emptyGraph()).nextId,1);
  assert.throws(()=>assertGraphCounter({...emptyGraph(),nextId:NaN}),/graph_metadata_requires_repair/);
  assert.throws(()=>assertGraphCounter({...emptyGraph(),nextId:0}),/graph_metadata_requires_repair/);
});
import {readTaskPolicy} from '../electron/model-registry';
test('same-size corrected archive and renamed user invalidate progress',()=>{
  const hash=graphFingerprint([{role:'user',content:'My pet is Pip.'}],'Tom');
  const checkpoint={...graphJob(null,hash),pieces:2};
  assert.equal(graphJob(checkpoint,hash).pieces,2);
  assert.equal(graphJob(checkpoint,graphFingerprint([{role:'user',content:'My pet is Bob.'}],'Tom')).pieces,0);
  assert.equal(graphJob(checkpoint,graphFingerprint([{role:'user',content:'My pet is Pip.'}],'Sam')).pieces,0);
});
test('extended provider outage never becomes success or unreadable quarantine',()=>{
  let job=graphJob(null,'hash');
  for(let i=0;i<100;i++)job=graphFailure(job,'unanswered',i*60000);
  assert.equal(job.status,'pending');assert.equal(job.failures,0);assert.equal(job.pieces,0);
  assert.equal(job.retryAt,99*60000+30*60000);
  assert.deepEqual(graphJob(JSON.parse(JSON.stringify(job)),'hash'),job);
});
test('unreadable replies quarantine without marking a day read; changed input can retry',()=>{
  let job=graphJob(null,'hash');for(let i=0;i<3;i++)job=graphFailure(job,'unreadable',0);
  assert.equal(job.status,'blocked');assert.equal(graphJob(job,'changed').status,'pending');
});
test('background cannot expand user allowance or permit tools/escalation',()=>{
  const original=readTaskPolicy({enabled:true,taskBudgetMicros:200000,dailyBudgetMicros:1000000});
  const bounded=graphPolicy(original);
  assert.equal(bounded.taskBudgetMicros,100000);assert.equal(bounded.dailyBudgetMicros,100000);
  assert.equal(bounded.maxAttempts,1);assert.equal(bounded.maxToolCalls,0);assert.equal(bounded.maxEscalations,0);
  const disabled=graphPolicy({...original,enabled:false,taskBudgetMicros:0,dailyBudgetMicros:0});
  assert.equal(disabled.enabled,false);assert.equal(disabled.taskBudgetMicros,0);assert.equal(disabled.dailyBudgetMicros,0);
});
