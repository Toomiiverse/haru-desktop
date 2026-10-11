/** Explicit Core continuations; exact existing shelf/model/native adapters only. */
import {randomUUID} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';
import type {CoreStore} from './core-store';
import {applyRemainingPlan} from './core-remaining';
import {activeTask} from './task-controller';
const check=()=>activeTask.getStore()?.signal.throwIfAborted();
export const supplementOwned=()=>(true as boolean);
export function supplement<T>(name:string,args:unknown[]):T{return corePolicySync<T>('context-supplement.'+name,args);}
export async function coreRefreshShelf(adapter:{held:()=>any;link:()=>any;config:()=>any;save:(value:any)=>void}){
 const held=adapter.held(),link=adapter.link(),plan=supplement<any>('shelfRefreshStart',[held,Boolean(link),Date.now()]);if(!plan.run){adapter.save(plan.value);return;}
 const config=adapter.config();let observation:any;try{observation={ok:true,library:await link.library()};}catch{observation={ok:false};}
 adapter.save(supplement('shelfRefreshObserved',[adapter.held(),observation,config.shelf,Date.now()]));
}
export function coreShelfLine(adapter:{held:()=>any;refresh:()=>Promise<void>;grudge:()=>number;sway:()=>unknown;log:(line:string)=>void}):string{
 if(supplement<boolean>('shelfDue',[adapter.held(),Date.now()]))void adapter.refresh();
 const result=supplement<{note:string;log:string|null}>('shelfContext',[adapter.held(),Date.now(),adapter.grudge(),adapter.sway(),Math.random()]);if(result.log)adapter.log(result.log);return result.note;
}
export async function coreReadOverheard(force:boolean,adapter:{core:CoreStore;facts:()=>any;drain:()=>any[][];busy:(value:boolean)=>void;stamp:(at:number)=>void;compose:(messages:any[],config:any,options:any)=>Promise<{content?:string}>;committed:(packet:any)=>void;log:(line:string)=>void}):Promise<void>{
 check();const admission=supplement<any>('tickStart',[adapter.facts(),force]);if(!admission.run)return;
 adapter.busy(true);adapter.stamp(admission.at);
 try{
  const batches=adapter.drain();
  for(const lines of batches){
   check();const packet=supplement<any>('tickRequest',[admission.source,lines,adapter.facts()]);
   let answer:{content?:string};
   // Unknown dispatch stays consumed. Neither an exception nor restart requeues these messages.
   try{answer=await adapter.compose(packet.request.messages,packet.request.config,packet.request.options);}catch{adapter.log('[overheard] provider response unavailable; consumed batch was not replayed');continue;}
   check();const snapshot={config:adapter.core.get('config',{}),memory:adapter.core.get('memories',{}),graph:adapter.core.get('graph',null)};
   const stamp=new Date().toISOString(),entropy=supplement<any>('tickResult',[packet,answer.content??'',adapter.facts(),snapshot,null,stamp]);
   const result=supplement<any>('tickResult',[packet,answer.content??'',adapter.facts(),snapshot,Array.from({length:entropy.idsNeeded},()=>randomUUID()),stamp]);
   applyRemainingPlan(adapter.core,result.plan);adapter.committed(result);
  }
 }finally{adapter.busy(false);}
}
