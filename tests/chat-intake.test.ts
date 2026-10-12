import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatIntake, type DeliveryReceipt } from '../electron/chat-intake';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r,ms));
async function fixture() {
  let available = false, calls = 0, finishCalls = 0;
  let receipt: DeliveryReceipt = { id:'fixture',state:'pending',execution:'queued' };
  const firstRead = deferred(), finishing = deferred();
  const answer = deferred<{reply:string}>();
  let finish = async () => { receipt = {...receipt,state:'done',execution:'done',reply:'saved'}; };
  let get = async () => receipt;
  const client = { call: async (command: Record<string,unknown>): Promise<any> => {
    if (command.op === 'claim') {
      if (!available) return {claim:null};
      available = false;
      return {claim:{id:'fixture',scope:'slate',input:{text:'fixture',files:[],mode:'plain'}}};
    }
    if (command.op === 'get') { const value = await get(); firstRead.resolve(); return {receipt:value}; }
    if (command.op === 'finish') { finishCalls++; finishing.resolve(); await finish(); }
    return {};
  }};
  const intake = new ChatIntake(client,{scope:()=>'slate',enabled:()=>true,say:()=>{calls++;return answer.promise;},sayStream:async()=>{throw Error('unused');}});
  await intake.start();
  await new Promise<void>(r => setImmediate(r));
  available = true;
  return {intake,answer,firstRead,finishing,setFinish:(fn:()=>Promise<void>)=>{finish=fn;},setGet:(fn:()=>Promise<DeliveryReceipt>)=>{get=fn;},done:()=>{receipt={...receipt,state:'done',execution:'done',reply:'saved'};},counts:()=>({calls,finishCalls})};
}

test('completion wakes immediately only after durable acknowledgement',async()=>{
  const f=await fixture(), ack=deferred();
  f.setFinish(async()=>{await ack.promise;f.done();});
  let delivered=false;
  const waiting=f.intake.wait('fixture','slate').then(v=>{delivered=true;return v;});
  try {
    await f.firstRead.promise;f.answer.resolve({reply:'saved'});await f.finishing.promise;
    await sleep(20);assert.equal(delivered,false);
    ack.resolve();
    assert.equal((await Promise.race([waiting,sleep(120).then(()=>null)]))?.state,'done');
    assert.equal(f.counts().calls,1);
  } finally {ack.resolve();await f.intake.stop();await waiting;}
});

test('completion while a stale pending read is in flight cannot lose notification',async()=>{
  const f=await fixture(), readStarted=deferred(), releaseRead=deferred();let reads=0;
  f.setGet(async()=>{if(++reads===1){readStarted.resolve();await releaseRead.promise;return{id:'fixture',state:'pending',execution:'running'};}return{id:'fixture',state:'done',execution:'done'};});
  const waiting=f.intake.wait('fixture','slate');
  try {
    await readStarted.promise;f.answer.resolve({reply:'saved'});await f.finishing.promise;
    await new Promise<void>(r=>setImmediate(r));releaseRead.resolve();
    assert.equal((await Promise.race([waiting,sleep(120).then(()=>null)]))?.state,'done');
  } finally {releaseRead.resolve();await f.intake.stop();await waiting;}
});

test('lost finish acknowledgement recovers by receipt polling without repeating inference',async()=>{
  const f=await fixture();f.setFinish(async()=>{f.done();throw Error('lost ack');});
  const waiting=f.intake.wait('fixture','slate');
  try {
    await f.firstRead.promise;f.answer.resolve({reply:'saved'});
    assert.equal((await waiting)?.state,'done');assert.equal(f.counts().calls,1);
  } finally {f.setFinish(async()=>{f.done();});await f.intake.stop();}
});

test('retrying retained completion wakes every waiter and never repeats inference',async()=>{
  const f=await fixture(), allow=deferred();let attempt=0;
  f.setFinish(async()=>{if(++attempt===1)throw Error('unavailable');await allow.promise;f.done();});
  const a=f.intake.wait('fixture','slate');
  try {
    await f.firstRead.promise;f.answer.resolve({reply:'saved'});await f.finishing.promise;
    await new Promise<void>(r=>setImmediate(r));
    const b=f.intake.wait('fixture','slate'); // kicks the retained completion
    await sleep(10);allow.resolve();
    const values=await Promise.race([Promise.all([a,b]),sleep(120).then(()=>[])]);
    assert.equal(values.length,2);assert.ok(values.every(v=>v?.state==='done'));
    assert.equal(f.counts().calls,1);assert.equal(f.counts().finishCalls,2);
  } finally {allow.resolve();await f.intake.stop();await a;}
});

test('completion before a waiter arrives is read from Core',async()=>{
  const f=await fixture();f.done();f.answer.resolve({reply:'saved'});
  try {assert.equal((await f.intake.wait('fixture','slate'))?.state,'done');}
  finally {await f.intake.stop();}
});

test('stop wakes waiting delivery while an already claimed runner drains',async()=>{
  const f=await fixture(),waiting=f.intake.wait('fixture','slate');
  await f.firstRead.promise;
  const stopping=f.intake.stop();
  try {
    assert.equal(await Promise.race([waiting,sleep(120).then(()=> 'timeout')]),null);
  } finally {f.answer.resolve({reply:'saved'});await stopping;}
});
