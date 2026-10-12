import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCorePeriodic,periodicWorldFetch} from '../electron/core-periodic';
import {activeScheduledJob} from '../electron/core-scheduler';
const grant=(kind='life',token='grant-fixture')=>({kind,token,due:1,priority:'background',executes:false});
const delay=()=>new Promise(r=>setTimeout(r,10));
async function until(fn:()=>boolean){for(let n=0;n<200;n++){if(fn())return;await delay();}throw Error('periodic_test_timeout');}
function reply(command:any,res:any,extra:any={}){res.end(JSON.stringify({version:1,op:command.op,executes:false,...extra}));}
async function fixture(handle:(c:any,r:any)=>void,body:(p:ReturnType<typeof createCorePeriodic>,events:any[])=>Promise<void>,handlers:Record<string,()=>any>={life:()=>.5}){
 const folder=mkdtempSync(path.join(tmpdir(),'haru-core-periodic-')),token=path.join(folder,'token');writeFileSync(token,'x'.repeat(48),{mode:0o600});
 const before={...process.env},events:any[]=[];
 const server=createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;const c=JSON.parse(text);events.push(c);
  assert.equal(req.url,'/v1/periodic');assert.equal(req.headers.authorization,'Bearer '+'x'.repeat(48));res.setHeader('content-type','application/json');
  if(c.op==='start')reply(c,res,{registered:Object.keys(handlers)});else handle(c,res);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 Object.assign(process.env,{HARU_CORE_SERVICE_ENDPOINT:'http://127.0.0.1:'+(server.address() as any).port,HARU_CORE_SERVICE_TOKEN_FILE:token,HARU_CORE_BRAIN_WORKER:'on'});
 const p=createCorePeriodic({config:{minecraftSeconds:45,sampleSeconds:30},handlers});
 try{await body(p,events);}finally{p.stop();await p.drained();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
 for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);rmSync(folder,{recursive:true,force:true});}
}

test('native grant is required and the entire asynchronous handler owns its background context',async()=>{
 let release:()=>void=()=>{},calls=0,context:any;const held=new Promise<void>(r=>release=r);
 await fixture((c,r)=>reply(c,r,c.op==='poll'?{grants:[grant()]}:{settled:true,outcome:'done'}),async(p,events)=>{
  p.start();await until(()=>calls===1);assert.equal(p.active(),1);assert.equal(events.some(e=>e.op==='settle'),false);
  assert.equal(context.kind,'periodic:life');assert.equal(context.token,'grant-fixture');release();await p.drained();p.stop();
  assert.equal(events.find(e=>e.op==='settle').sleepiness,.25);assert.equal(p.active(),0);
 },{life:async()=>{calls++;context=activeScheduledJob.getStore();await held;assert.equal(activeScheduledJob.getStore(),context);return .25;}});
});

test('lost poll acknowledgement never invokes the handler',async()=>{
 let calls=0;await fixture((c,r)=>c.op==='poll'?r.destroy():reply(c,r,{abandoned:true}),async(p,events)=>{
  p.start();await until(()=>events.some(e=>e.op==='abandon'));p.stop();assert.equal(calls,0);assert.equal(events.find(e=>e.op==='abandon').sequence,events.find(e=>e.op==='poll').sequence);
 },{life:()=>calls++});
});

test('a stop while the poll is pending abandons the batch before execution',async()=>{
 let finish:()=>void=()=>{},calls=0;await fixture((c,r)=>c.op==='poll'?(finish=()=>reply(c,r,{grants:[grant()]})):reply(c,r,{abandoned:true}),async(p,events)=>{
  p.start();await until(()=>events.some(e=>e.op==='poll'));p.stop();finish();await until(()=>events.some(e=>e.op==='abandon'));assert.equal(calls,0);
 },{life:()=>calls++});
});

test('a failed handler is interrupted and no private exception text leaves the adapter',async()=>{
 await fixture((c,r)=>reply(c,r,c.op==='poll'?{grants:[grant()]}:{settled:true,outcome:c.outcome}),async(p,events)=>{
  p.start();await until(()=>events.some(e=>e.op==='settle'));p.stop();assert.equal(events.find(e=>e.op==='settle').outcome,'interrupted');assert.equal(JSON.stringify(events).includes('private-value'),false);
 },{life:()=>{throw Error('private-value');}});
});

test('lost settlement retries the receipt, never the handler',async()=>{
 let calls=0,settles=0;await fixture((c,r)=>{
  if(c.op==='settle'&&++settles===1)r.destroy();else reply(c,r,c.op==='poll'?{grants:[grant()]}:{settled:true,outcome:'done'});
 },async(p,events)=>{p.start();await until(()=>settles===2);await p.drained();p.stop();assert.equal(calls,1);
 assert.deepEqual(events.filter(e=>e.op==='settle').map(e=>e.token),['grant-fixture','grant-fixture']);}, {life:()=>{calls++;return .4;}});
});

for(const invalid of ['unknown','duplicate-kind','duplicate-token','bad-priority'])test('validates the whole batch before execution: '+invalid,async()=>{
 let calls=0;const grants:any[]=[grant()];
 if(invalid==='unknown')grants.push(grant('unknown','second'));
 if(invalid==='duplicate-kind')grants.push(grant('life','second'));
 if(invalid==='duplicate-token')grants.push(grant('other','grant-fixture'));
 if(invalid==='bad-priority')grants.push({...grant('other','second'),priority:'foreground'});
 await fixture((c,r)=>reply(c,r,c.op==='poll'?{grants}:{abandoned:true}),async(p,events)=>{
  p.start();await until(()=>events.some(e=>e.op==='abandon'));p.stop();assert.equal(calls,0);
 },{life:()=>calls++,other:()=>calls++});
});


test('world composition keeps its schema and bounded local request on the owned path',async()=>{
 const config={model:'fixture',endpoint:'http://127.0.0.1:11436'},schema={type:'object',properties:{action:{enum:['rest','read']}}};
 const messages=[{role:'user',content:'Choose a fictional activity.'}],signal=new AbortController().signal;
 let options:any;
 const response=await periodicWorldFetch(async(m,c,o)=>{assert.deepEqual(m,messages);assert.equal(c,config);options=o;return {content:'{"action":"read"}'};},config,
  config.endpoint+'/api/chat',{method:'POST',signal,body:JSON.stringify({model:'fixture',stream:false,format:schema,messages,options:{num_predict:100,num_ctx:4096,temperature:.7}})});
 assert.deepEqual(options,{tools:false,table:[],format:schema,maxTokens:100,numCtx:4096,temperature:.7,signal});
 assert.equal((await response.json()).message.content,'{"action":"read"}');
});

test('world adapter never falls back to an unowned fetch after admission failure',async()=>{
 const config={model:'fixture',endpoint:'http://127.0.0.1:11436'},body=JSON.stringify({model:'fixture',stream:false,messages:[],options:{}});
 await assert.rejects(periodicWorldFetch(async()=>{throw Error('background_inference_deferred');},config,config.endpoint+'/api/chat',{method:'POST',body}),/background_inference_deferred/);
 await assert.rejects(periodicWorldFetch(async()=>{throw Error('must not dispatch');},config,'https://example.com/api/chat',{method:'POST',body}),/periodic_world_local_required/);
});

for(const allowed of [false,true])test('world readiness stays bound to its native grant: '+allowed,async()=>{
 let observed:boolean|undefined,current:ReturnType<typeof createCorePeriodic>;
 await fixture((c,r)=>reply(c,r,c.op==='poll'?{grants:[grant('world')]}:c.op==='world-attention'
  ?{allowed,reason:allowed?'ready':'quiet_period'}:{settled:true,outcome:'done'}),async(p,events)=>{
  current=p;
  await assert.rejects(p.worldReady(),/world_grant_required/);
  p.start();await until(()=>events.some(e=>e.op==='settle'));p.stop();assert.equal(observed,allowed);
  const query=events.find(e=>e.op==='world-attention'),poll=events.find(e=>e.op==='poll');
  assert.equal(query.token,'grant-fixture');assert.deepEqual(query.owner,poll.owner);assert.equal(query.generation,poll.generation);
 },{world:async()=>{observed=await current!.worldReady();}});
});

for(const invalid of ['contradictory','unknown','lost'])test('world readiness fails closed: '+invalid,async()=>{
 let current:ReturnType<typeof createCorePeriodic>,dispatched=0;
 await fixture((c,r)=>{
  if(c.op==='world-attention'&&invalid==='lost'){r.destroy();return;}
  reply(c,r,c.op==='poll'?{grants:[grant('world')]}:c.op==='world-attention'
   ?{allowed:true,reason:invalid==='unknown'?'anything':'quiet_period'}:{settled:true,outcome:c.outcome});
 },async(p,events)=>{current=p;p.start();await until(()=>events.some(e=>e.op==='settle'));p.stop();
  assert.equal(dispatched,0);assert.equal(events.find(e=>e.op==='settle').outcome,'interrupted');
 },{world:async()=>{if(await current.worldReady())dispatched++;}});
});

test('another periodic handler cannot borrow world readiness',async()=>{
 let current:ReturnType<typeof createCorePeriodic>;
 await fixture((c,r)=>reply(c,r,c.op==='poll'?{grants:[grant()]}:{settled:true,outcome:c.outcome}),async(p,events)=>{
  current=p;p.start();await until(()=>events.some(e=>e.op==='settle'));p.stop();
  assert.equal(events.some(e=>e.op==='world-attention'),false);assert.equal(events.find(e=>e.op==='settle').outcome,'interrupted');
 },{life:async()=>{await current.worldReady();}});
});
