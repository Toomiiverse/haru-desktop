import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {coreObservation,noteCoreUserActivity,noteCoreGame} from '../electron/core-live-state';
import {coreLook} from '../electron/core-perception';
import {TaskController} from '../electron/task-controller';
import {readTaskPolicy} from '../electron/model-registry';

const attention={action:'defer',role:'local-perception',allowed:false,reason:'foreground_or_maintenance',executes:false};
function response(allowed=false){return new Response(JSON.stringify({version:1,applied:true,attention:{...attention,allowed}}),{headers:{'content-type':'application/json'}});}
async function fixture(run:(token:string)=>Promise<void>){
  const old={...process.env},fetcher=globalThis.fetch,root=mkdtempSync(path.join(tmpdir(),'haru-live-state-')),token=path.join(root,'token');
  writeFileSync(token,'synthetic-private-observation-token-'.repeat(2),{mode:0o600});
  process.env.HARU_CORE_LIVE_STATE='on';process.env.HARU_CORE_BRAIN_WORKER='on';
  process.env.HARU_CORE_SERVICE_ENDPOINT='http://127.0.0.1:8791';process.env.HARU_CORE_SERVICE_TOKEN_FILE=token;
  try{await run(token);}finally{
    globalThis.fetch=fetcher;for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);
    rmSync(root,{recursive:true,force:true});
  }
}

test('owned observations transmit process generation and opaque metadata only',async()=>fixture(async()=>{
  const sent:any[]=[];
  globalThis.fetch=async(url,init)=>{assert.equal(url,'http://127.0.0.1:8791/v1/live/events');sent.push(JSON.parse(init!.body as string));return response();};
  const result=await coreObservation('VisionFrame','background-vision',{media_id:'fixture-reference',frames:2,priority:'background'});
  assert.deepEqual(result,attention);assert.equal(sent.length,1);assert.equal(sent[0].owner.pid,process.pid);
  const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');assert.equal(sent[0].owner.birth,stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]);
  assert.equal(sent[0].event.source,'background-vision');assert.equal(sent[0].event.frames,2);assert.ok(sent[0].event.sequence>0);
  assert.equal('images' in sent[0].event,false);assert.equal('text' in sent[0].event,false);
}));

test('disabled mode is network free and unsafe transport fails before a request',async()=>fixture(async token=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return response();};
  delete process.env.HARU_CORE_LIVE_STATE;
  assert.equal((await coreObservation('UserActivity','user-activity',{kind:'speech'})).allowed,true);
  noteCoreUserActivity();noteCoreGame('Disabled Fixture');assert.equal(calls,0);
  process.env.HARU_CORE_LIVE_STATE='on';process.env.HARU_CORE_SERVICE_ENDPOINT='https://remote.invalid';
  await assert.rejects(coreObservation('UserActivity','user-activity',{kind:'speech'}),/loopback_required/);
  process.env.HARU_CORE_SERVICE_ENDPOINT='http://127.0.0.1:8791';chmodSync(token,0o644);
  await assert.rejects(coreObservation('UserActivity','user-activity',{kind:'speech'}),/private_token_required/);assert.equal(calls,0);
}));

test('failed or malformed decisions cannot authorize background vision',async()=>fixture(async()=>{
  for(const reply of [new Response('{}',{status:503}),new Response(JSON.stringify({version:1,applied:true,attention:{...attention,executes:true}})),new Response('{}')]){
    globalThis.fetch=async()=>reply;
    await assert.rejects(coreObservation('VisionFrame','background-vision',{media_id:'fixture',frames:1,priority:'background'}),/core_observation_/);
  }
}));

test('speech notices do not wait and unchanged game observations are coalesced',async()=>fixture(async()=>{
  const sent:any[]=[];globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(init!.body as string));return response();};
  assert.equal(noteCoreUserActivity('speech'),undefined);
  noteCoreGame('Fictional Lantern');noteCoreGame('Fictional Lantern');noteCoreGame('Fictional Kite');
  await new Promise(setImmediate);
  assert.deepEqual(sent.map(s=>s.event.type),['UserActivity','GameStarted','GameStopped','GameStarted']);
  assert.equal(sent[0].event.kind,'speech');assert.equal(sent[2].event.game,'Fictional Lantern');
  assert.ok(sent.every((s,i)=>i===0||s.event.sequence>sent[i-1].event.sequence));
}));

test('deferred background perception cannot create a task or transmit its pixels',async()=>fixture(async()=>{
  process.env.HARU_CORE_PERCEPTION='on';process.env.HARU_CORE_COMPOSITION='on';const sent:any[]=[];let tasks=0,images=0;
  globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(init!.body as string));return response();};
  const options:any={priority:'background'};
  await assert.rejects(coreLook(['synthetic-private-pixels',{enabled:true,model:'fixture',folder:''},'http://127.0.0.1:11436',{},async()=>{images++;throw Error('unexpected_image_dispatch');},options],{
    rpc:async()=>{tasks++;throw Error('unexpected_task');},registry:()=>[],policy:()=>readTaskPolicy({}),
  }),/background_inference_deferred/);
  assert.equal(tasks,0);assert.equal(images,0);assert.equal(sent.length,1);assert.equal(sent[0].event.priority,'background');
  assert.equal(JSON.stringify(sent).includes('synthetic-private-pixels'),false);
}));

test('permitted standalone background perception retains background task priority and the vision wire',async()=>fixture(async()=>{
  process.env.HARU_CORE_PERCEPTION='on';process.env.HARU_CORE_COMPOSITION='on';delete process.env.HARU_CORE_MODEL_PROVIDER;
  const start=TaskController.prototype.start,compose=TaskController.prototype.compose,post=TaskController.prototype.post;
  let priority:string|undefined,wire:any;
  globalThis.fetch=async()=>response(true);
  TaskController.prototype.start=async(_request,_model,p)=>{priority=p;};
  TaskController.prototype.compose=async(run:any)=>run();
  TaskController.prototype.post=async(_messages,_config,_tools,_max,run:any)=>run(new AbortController().signal,()=>{},64);
  try{
    const options:any={priority:'background',ask:'Describe this fixture',numCtx:8192};
    const sighting=await coreLook(['fixture-image',{enabled:true,model:'fixture',folder:''},'http://127.0.0.1:11436',{},async(_url,init)=>{
      wire=JSON.parse(init.body);return new Response(JSON.stringify({message:{content:'A copper badge.'}}));
    },options],{rpc:async()=>{throw Error('unexpected_rpc');},registry:()=>[],policy:()=>readTaskPolicy({})});
    assert.equal(priority,'background');assert.equal(sighting.description,'A copper badge.');assert.deepEqual(wire.messages,[{role:'user',content:'Describe this fixture',images:['fixture-image']}]);
  }finally{TaskController.prototype.start=start;TaskController.prototype.compose=compose;TaskController.prototype.post=post;}
}));
