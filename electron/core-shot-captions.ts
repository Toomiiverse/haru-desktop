/** Supervised image I/O. Core owns selections, prompts, retries and record plans. */
import {createHash} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {CoreStore} from './core-store';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const current=()=>activeTask.getStore()?.signal.throwIfAborted();
const facts=(core:CoreStore)=>({config:core.get('config',{}),activity:core.get('activity',{})});
const hash=(bytes:Buffer|null)=>bytes?createHash('sha256').update(bytes).digest('hex'):null;
export function commitShotPlan(core:CoreStore,plan:any){
 if(!plan)return;
 core.transaction(()=>{
  current();if(!same(core.get('config',{}),plan.expectedConfig))throw Error('core_shot_config_stale');
  if(Object.hasOwn(plan,'expectedActivity')&&!same(core.get('activity',{}),plan.expectedActivity))throw Error('core_shot_activity_stale');
  core.set('config',plan.config);if(Object.hasOwn(plan,'activity'))core.set('activity',plan.activity);
 });
}
export async function runSyncedCaptions(adapter:{core:CoreStore;held:()=>Record<string,string[]>;exists:()=>boolean;busy:()=>boolean;lock:(on:boolean)=>void;urls:()=>Record<string,unknown>;addresses:()=>string[];read:(shot:any)=>Buffer|null;look:(bytes:Buffer,request:any)=>Promise<{description:string}>;deferred:(error:unknown)=>boolean}){
 current();const packet=corePolicySync<any>('shot-captions.start',[facts(adapter.core),adapter.held(),adapter.exists(),adapter.busy(),adapter.urls(),adapter.addresses()]);
 if(packet.result)return packet.result;commitShotPlan(adapter.core,packet.plan);
 if(!packet.shots.length)return 'empty';adapter.lock(true);
 try{
  for(const shot of packet.shots){
   current();const bytes=adapter.read(shot),command=corePolicySync<any>('shot-captions.prepare',[packet.state,shot,facts(adapter.core),hash(bytes)]);
   if(command.result)continue;
   if(!bytes||!command.request||!command.source)throw Error('core_shot_protocol');
   let observation:any;
   try{const result=await adapter.look(bytes,command.request);observation={ok:true,description:result.description};}
   catch(error){observation={ok:false,deferred:adapter.deferred(error),aboutThisImage:Boolean((error as any)?.aboutThisImage)};}
   current();const settled=corePolicySync<any>('shot-captions.observed',[command.source,observation,facts(adapter.core),hash(adapter.read(shot)),new Date().toISOString()]);
   // An uncertain write escapes. It cannot become a model failure or retry.
   commitShotPlan(adapter.core,settled.plan);if(settled.result==='stop')return 'stopped';
  }
  return 'done';
 }finally{adapter.lock(false);}
}
