/** Core-owned chat lifecycle. Native transactions retain the sole write authority. */
import {corePolicySync} from './core-policy-sync';
import type {CoreStore} from './core-store';
import {activeTask} from './task-controller';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const assertCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();
export function lifecycleFacts(core:CoreStore,period:string){
  const config=core.get('config',{}),memory=core.get('memories',{});
  return {provider:config.ai?.config??null,sessions:memory.sessions??[],monthNotes:memory.monthNotes??[],
    archive:core.get('archive',{})[period]??null,activity:core.get('activity',{})[period]??[],activityEnabled:config.activityLog??true,
    at:new Date().toISOString()};
}
export function commitLifecyclePlan(core:CoreStore,plan:any){
  if(!plan||typeof plan!=='object')throw Error('core_chat_plan_invalid');
  core.transaction(()=>{
    assertCurrent();
    if(Object.hasOwn(plan,'expectedConfig')&&!same(core.get('config',{}),plan.expectedConfig))throw Error('core_chat_config_stale');
    if(plan.memoryField){
      if(!['sessions','monthNotes'].includes(plan.memoryField))throw Error('core_chat_memory_field_invalid');
      const current=lifecycleFacts(core,plan.period),source={archive:current.archive,activity:current.activity,activityEnabled:current.activityEnabled,provider:current.provider};
      if(!same(source,plan.source)||!same(current[plan.memoryField as 'sessions'|'monthNotes'],plan.expected))throw Error('core_chat_summary_stale');
      if(plan.sourceSessions&&!same(current.sessions.filter((r:any)=>r.day.slice(0,7)===plan.period),plan.sourceSessions))throw Error('core_chat_month_stale');
      const memory=core.get('memories',{});memory[plan.memoryField]=plan.value;core.set('memories',memory);
    }
    if(plan.archive){
      const archive=core.get('archive',{});
      if(!same(archive[plan.archive.key]??null,plan.archive.expected))throw Error('core_chat_archive_stale');
      archive[plan.archive.key]=plan.archive.value;core.set('archive',archive);
    }
    if(Object.hasOwn(plan,'config'))core.set('config',plan.config);
  });
}
export async function runChatSummary(mode:'day'|'month',period:string,messages:unknown[],replace:boolean,adapter:{core:CoreStore;model:(request:any)=>Promise<any>;form:(command:any)=>void}){
  assertCurrent();let packet=corePolicySync<any>('chat-lifecycle.summaryStart',[mode,period,messages,replace,lifecycleFacts(adapter.core,period)]);
  for(let n=0;n<3;n++){
    if(Object.hasOwn(packet,'result')){
      if(packet.plan)commitLifecyclePlan(adapter.core,packet.plan);
      if(packet.formation)adapter.form(packet.formation);
      return packet.result;
    }
    if(!packet.request||!packet.state)throw Error('core_chat_summary_protocol');
    assertCurrent();let observation:any;
    try{const result=await adapter.model(packet.request);observation={ok:true,value:result.content??''};}
    catch{observation={ok:false};}
    assertCurrent();packet=corePolicySync('chat-lifecycle.summaryObserved',[packet.state,observation,lifecycleFacts(adapter.core,period)]);
  }
  throw Error('core_chat_summary_bound');
}
export function runChatRollover(core:CoreStore,key:string,dispatch:(command:any)=>void,readAsides:()=>unknown[]){
  assertCurrent();const config=core.get('config',{}),previous=config.chat?.dayKey;
  const packet=corePolicySync<any>('chat-lifecycle.rollover',[config,key,core.get('archive',{})[previous]??null,new Date().toISOString()]);
  if(packet.result)return packet.result;
  commitLifecyclePlan(core,packet.plan);
  for(const command of packet.commands){assertCurrent();dispatch(command);}
  commitLifecyclePlan(core,corePolicySync('chat-lifecycle.rolloverFinish',[core.docRef('config',{}),packet.finish,readAsides()]));
  dispatch({kind:'broadcast'});
}
export function runManualChat(core:CoreStore,key:string){
  commitLifecyclePlan(core,corePolicySync('chat-lifecycle.manual',[core.docRef('config',{}),key,core.get('archive',{})[key]??null,new Date().toISOString()]));
}
export function appendChatArchive(core:CoreStore,key:string,messages:unknown[]){
  commitLifecyclePlan(core,corePolicySync('chat-lifecycle.archiveAppend',[key,messages,core.get('archive',{})[key]??null]));
}
export function runArchiveMerge(core:CoreStore,currentMonth:string,dispatch:(command:any)=>void){
  const archive=core.get('archive',{}),memory=core.get('memories',{});
  const packet=corePolicySync<any>('chat-lifecycle.merge',[Object.keys(archive),memory.sessions??[],memory.monthNotes??[],currentMonth]);
  if(Object.keys(packet.groups).length)core.transaction(()=>{
    assertCurrent();const current=core.get('archive',{});
    if(!same(Object.keys(current),packet.expectedKeys)||!same(current,archive))throw Error('core_chat_archive_stale');
    const rebuilt:Record<string,unknown[]>={};
    for(const [day,keys] of Object.entries(packet.groups)){
      if(!Array.isArray(keys)||keys.some(k=>typeof k!=='string'||!Object.hasOwn(current,k)))throw Error('core_chat_merge_protocol');
      rebuilt[day]=keys.flatMap(key=>current[key]??[]);
    }
    core.set('archive',rebuilt);
  });
  for(const command of packet.scheduled)setTimeout(()=>{try{assertCurrent();dispatch(command);}catch(error){console.warn('[memory] Core backfill refused:',error instanceof Error?error.message:'failed');}},command.delay);
}
export function pruneLifecycleRecords(core:CoreStore,document:'archive'|'activity',now:number,zone:string){
  const current=core.get(document,{}),sessions=core.get('memories',{}).sessions??[];
  const plan=corePolicySync<any>('chat-lifecycle.retention',[Object.keys(current),sessions,now,document,zone]);
  if(plan.remove.length)core.transaction(()=>{
    assertCurrent();if(!same(core.get(document,{}),current)||!same(core.get('memories',{}).sessions??[],sessions))throw Error('core_chat_retention_stale');
    const next={...current};for(const key of plan.remove)delete next[key];core.set(document,next);
  });
  return plan;
}

/** A failed provider observation may stop a read-only pass; a failed memory
 * commit propagates and can never be interpreted as permission to replay it. */
export async function runChatFormation(args:unknown[],adapter:{core:CoreStore;day:string;model:(request:any)=>Promise<any>;sort:(notes:any[])=>Promise<Map<string,unknown>|null>;add:(command:any)=>unknown}){
  const readSource=()=>{const config=adapter.core.get('config',{});return {slate:config.her?.slate??null,provider:config.ai?.config??null,profile:config.profile??null,archive:adapter.core.get('archive',{})[adapter.day]??null};};
  const source=readSource();
  const assertSource=()=>{assertCurrent();if(!same(readSource(),source))throw Error('core_chat_formation_source_stale');};
  assertSource();let packet=corePolicySync<any>('chat-lifecycle.formStart',args);
  for(let count=0;count<256;count++){
    if(Object.hasOwn(packet,'result'))return packet.result as boolean;
    assertSource();const command=packet.command;if(!command||!packet.state)throw Error('core_chat_form_protocol');
    let observation:any;
    if(command.kind==='add')observation={ok:true,value:adapter.add(command)??null};
    else if(command.kind==='model'){
      try{observation={ok:true,value:(await adapter.model(command.request)).content??''};}catch{observation={ok:false};}
    }else if(command.kind==='sort'){
      try{const result=await adapter.sort(command.notes);observation={ok:true,value:result?[...result]:null};}catch{observation={ok:false};}
    }else throw Error('core_chat_form_command');
    assertSource();packet=corePolicySync('chat-lifecycle.formObserved',[packet.state,observation]);
  }
  throw Error('core_chat_form_bound');
}
