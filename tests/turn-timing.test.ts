import test from 'node:test';
import assert from 'node:assert/strict';
import { markTurn, runTimedTurn, timeTurnReview, timingFor, type TimingEvent } from '../electron/turn-timing';
const pause=()=>new Promise<void>(r=>setImmediate(r));

test('concurrent turn contexts and nested reviews retain correlation without leaking detached work',async()=>{
  const a:TimingEvent[]=[],b:TimingEvent[]=[];let later!:()=>void;
  await Promise.all([
    runTimedTurn('a',async()=>{
      markTurn('harness_start');await pause();
      await timeTurnReview(async()=>{markTurn('dispatch',{attempt:1,model:'review-model'});await pause();markTurn('provider_complete',{attempt:1});});
      markTurn('published');
      // AsyncLocalStorage captures context at async-resource creation time.
      const detached=new Promise<void>(resolve=>{later=resolve;});
      void detached.then(()=>markTurn('dispatch',{model:'late'}));
      return 'answer';
    },v=>a.push(v)),
    runTimedTurn('b',async()=>{await pause();markTurn('dispatch',{attempt:1,model:'primary'});return 'other';},v=>b.push(v)),
  ]);
  later();await pause();
  assert.equal(new Set(a.map(v=>v.trace)).size,1);assert.notEqual(a[0].trace,b[0].trace);
  assert.equal(a.find(v=>v.stage==='dispatch')?.phase,'review');
  assert.equal(a.find(v=>v.stage==='published')?.phase,'turn');
  assert.equal(a.some(v=>v.model==='late'),false);
  assert.ok(b.every(v=>v.phase==='turn'));
  assert.equal(a.at(-1)?.stage,'runner_end');assert.equal(a.at(-1)?.status,'ok');
});

test('telemetry failure cannot replace a reply, provider failure, or review failure',async()=>{
  const failed=()=>{throw Error('broken logger');};
  assert.equal(await runTimedTurn('ok',async()=>{markTurn('published');return 'reply';},failed),'reply');
  const original=new Error('private failure text');const events:TimingEvent[]=[];
  await assert.rejects(runTimedTurn('error',()=>timeTurnReview(async()=>{throw original;}),v=>events.push(v)),e=>e===original);
  assert.equal(events.find(v=>v.stage==='review_end')?.status,'error');
  assert.equal(events.at(-1)?.status,'error');
  assert.doesNotMatch(JSON.stringify(events),/private failure text/);
});

test('wire records omit raw request ids, arbitrary data and invalid metadata, and are bounded',()=>{
  const events:TimingEvent[]=[];const mark=timingFor('a user controlled request id',v=>events.push(v));
  mark('received',{model:'credential?key=secret',step:'private words',attempt:NaN,text:'secret reply',error:'secret error',token:'secret token'} as any);
  assert.doesNotMatch(JSON.stringify(events),/user controlled|secret|private words|credential/);
  assert.match(events[0].trace,/^[a-f0-9]{24}$/);
  for(let i=0;i<300;i++)mark('dispatch',{attempt:i});
  assert.equal(events.length,256);
  assert.ok(events.every(v=>Number.isFinite(v.monoMs)&&Number.isFinite(v.at)));
});

test('review outside an intake turn has no observable behavior change',async()=>{
  markTurn('published');assert.equal(await timeTurnReview(async()=>42),42);
});
