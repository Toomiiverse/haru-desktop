import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCoreScheduler,activeScheduledJob} from '../electron/core-scheduler';
import {CoreStore} from '../electron/core-store';
import {runChatTool,type ToolDeps} from '../electron/tools';

const blank=()=>({jobs:[],runs:[],booked:[]});
const job=()=>({id:'traffic-watch',kind:'traffic-watch',schedule:{at:Date.now()},dueAt:Date.now(),staleAfterMs:7200000,createdBy:'app' as const,createdAt:Date.now(),failures:0});

async function fixture(handle:(command:any,response:any)=>void,body:(scheduler:ReturnType<typeof createCoreScheduler>,events:any[])=>Promise<void>,handler:()=>any=()=>({done:true})){
  const folder=mkdtempSync(path.join(tmpdir(),'haru-core-scheduler-')),token=path.join(folder,'token');writeFileSync(token,'x'.repeat(48),{mode:0o600});
  const before={...process.env},events:any[]=[];
  const server=createServer(async(req,res)=>{let data='';for await(const chunk of req)data+=chunk;const command=JSON.parse(data);events.push(command);
    assert.equal(req.url,'/v1/scheduler');assert.equal(req.headers.authorization,'Bearer '+'x'.repeat(48));
    res.setHeader('content-type','application/json');handle(command,res);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port;
  process.env.HARU_CORE_SERVICE_ENDPOINT=`http://127.0.0.1:${port}`;process.env.HARU_CORE_SERVICE_TOKEN_FILE=token;process.env.HARU_CORE_BRAIN_WORKER='on';
  const scheduler=createCoreScheduler({load:blank,save:()=>{throw Error('native adapter wrote through legacy scheduler');},handlers:{'traffic-watch':handler}});
  try{await body(scheduler,events);}finally{scheduler.stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);rmSync(folder,{recursive:true,force:true});}
}
function reply(res:any,command:any,extra:any={}){res.end(JSON.stringify({version:1,op:command.op,schedule:blank(),revision:2,executes:false,...extra}));}
async function until(predicate:()=>boolean){for(let n=0;n<200;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('native adapter test timeout');}

test('registered handler runs only after native durable grant and inherits background context',async()=>{
  let calls=0,context:any;await fixture((command,res)=>reply(res,command,command.op==='poll'?{grant:{token:'fixture-grant',job:job(),priority:'background',executes:false},nextPollMs:60000}:{}),async(scheduler,events)=>{
    scheduler.start();await until(()=>events.some(e=>e.op==='settle'));scheduler.stop();
    assert.equal(calls,1);assert.equal(context.kind,'traffic-watch');assert.equal(context.token,'fixture-grant');
    assert.deepEqual(events.map(e=>e.op),['ensure','poll','settle']);assert.deepEqual(events[2].outcome,{done:true});
    assert.equal(events[1].owner.pid,process.pid);assert.match(events[1].owner.birth,/^\d+$/);
    assert.equal(await scheduler.tick(),0);
  },()=>{calls++;context=activeScheduledJob.getStore();return {done:true};});
});

test('lost grant reply abandons the occurrence without calling a handler',async()=>{
  let calls=0;await fixture((command,res)=>command.op==='poll'?res.destroy():reply(res,command),async(scheduler,events)=>{
    scheduler.start();await until(()=>events.some(e=>e.op==='abandon'));scheduler.stop();assert.equal(calls,0);
    assert.equal(events.find(e=>e.op==='abandon').claim_request_id,events.find(e=>e.op==='poll').request_id);
  },()=>{calls++;return {done:true};});
});

test('handler exception settles as interrupted without marking a safe retry',async()=>{
  await fixture((command,res)=>reply(res,command,command.op==='poll'?{grant:{token:'fixture-grant',job:job(),priority:'background',executes:false}}:{}),async(scheduler,events)=>{
    scheduler.start();await until(()=>events.some(e=>e.op==='settle'));scheduler.stop();
    assert.deepEqual(events.find(e=>e.op==='settle').outcome,{interrupted:true,reason:'handler_exception_outcome_unknown'});
  },()=>{throw Error('synthetic private handler error');});
});

test('unconfirmed settlement abandons rather than repeats a handler',async()=>{
  let calls=0;await fixture((command,res)=>command.op==='settle'?res.destroy():reply(res,command,command.op==='poll'?{grant:{token:'fixture-grant',job:job(),priority:'background',executes:false}}:{}),async(scheduler,events)=>{
    scheduler.start();await until(()=>events.some(e=>e.op==='abandon'));scheduler.stop();assert.equal(calls,1);
  },()=>{calls++;return {done:true};});
});

test('booking and cancellation wait for Core confirmation, never write local jobs',async()=>{
  await fixture((command,res)=>reply(res,command,command.op==='book'?{booked:false,reason:'Synthetic booking cap'}:{cancelled:true}),async(scheduler,events)=>{
    assert.deepEqual(await scheduler.book({at:Date.now()+600000,why:'Copper fixture'},'booked-copper'),{booked:false,reason:'Synthetic booking cap'});
    assert.equal(await scheduler.cancel('traffic-watch'),true);assert.deepEqual(events.map(e=>e.op),['book','cancel']);
  });
});

function cached(){const core=Object.create(CoreStore.prototype) as CoreStore;Object.assign(core,{state:{revision:1,userData:'/tmp/fixture',documents:{config:{mood:0},schedule:blank()}},depth:0,staged:null,touched:new Set(),pendingAsync:false,asyncTail:Promise.resolve(),options:{asyncTransactions:true}});return core;}

test('synchronous store rebases only an independently changed schedule document',()=>{
  const before=process.env.HARU_CORE_SCHEDULER;process.env.HARU_CORE_SCHEDULER='on';try{
    const core=cached();let commits=0;const newSchedule={...blank(),jobs:[job()]};Object.assign(core,{call:(method:string,input:any)=>{
      if(method==='open')return {revision:2,userData:'/tmp/fixture',documents:{config:{mood:0},schedule:newSchedule}};
      if(++commits===1)throw Error('authority_revision_conflict');assert.equal(input.baseRevision,2);return {revision:3,currentRevision:3};
    }});
    core.set('config',{mood:1});assert.equal(commits,2);assert.deepEqual((core as any).state.documents.schedule,newSchedule);assert.equal(core.getPath('config',['mood']),1);
    const unsafe=cached();Object.assign(unsafe,{call:(method:string)=>{if(method==='open')return {revision:2,documents:{config:{mood:99},schedule:blank()}};throw Error('authority_revision_conflict');}});
    assert.throws(()=>unsafe.set('config',{mood:1}),/core_authority_revision_conflict/);assert.equal((unsafe as any).broken,true);
  }finally{if(before===undefined)delete process.env.HARU_CORE_SCHEDULER;else process.env.HARU_CORE_SCHEDULER=before;}
});

// Async ordering and external-conflict rejection use the actual shared-buffer
// acknowledgement path in core-store-async.test.ts.

test('actual booking tool waits for asynchronous persistence and reports a refusal honestly',async()=>{
  let release:(value:any)=>void=()=>{};let finished=false;
  const promise=new Promise<any>(resolve=>{release=resolve;});
  const deps={onWeb:()=>false,booking:{book:()=>promise}} as unknown as ToolDeps;
  const turn=runChatTool({id:'fixture-call',function:{name:'book_follow_up',arguments:{why:'Fictional copper fixture',in_minutes:10}}},'fixture',deps).then(value=>{finished=true;return JSON.parse(value);});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
  release({booked:false,reason:'Synthetic native booking cap'});assert.deepEqual(await turn,{booked:false,reason:'Synthetic native booking cap'});
});
