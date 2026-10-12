/** Core-authored journal/check-in transactions and grant-bound publication. */
import {corePolicySync} from './core-policy-sync';
import {commitDayNightPlan} from './core-day-night';
import type {CoreStore} from './core-store';
import {activeTask} from './task-controller';

type RecordAdapter={core:CoreStore;read:()=>any;publish?:(name:string,value:unknown)=>void;asked?:(date:string|undefined)=>void};
export function commitUserRecord(action:string,args:unknown,adapter:RecordAdapter){
  const assertCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();
  assertCurrent();const facts=adapter.read();
  const entropy=corePolicySync<{ids:number;newId:boolean}>('user-records.mutationEntropy',[action,args,facts.config]);
  const packet=corePolicySync<any>('user-records.mutate',[action,args,{...facts,ids:Array.from({length:entropy.ids},()=>Math.random().toString(36).slice(2,10)),...(entropy.newId?{id:Math.random().toString(36).slice(2,10)}:{})}]);
  if(packet.plan){
    // Unknown commit outcome propagates. No read/retry can replay this mutation.
    commitDayNightPlan(adapter.core,packet.plan,assertCurrent);
    adapter.asked?.(packet.askedOn??undefined);
    if(packet.event)adapter.publish?.(packet.event.name,packet.event.value);
  }
  return packet.result;
}

type AskAdapter={core:CoreStore;read:()=>any;prepare?:()=>void;compose:(command:any)=>Promise<unknown>;publish:(command:any)=>boolean};
export async function runOwnedJournal(adapter:AskAdapter){
  const assertCurrent=()=>{activeTask.getStore()?.signal.throwIfAborted();corePolicySync('user-records.assertCurrent',[adapter.read().scope]);};
  assertCurrent();const admission=corePolicySync<any>('user-records.askEligible',[adapter.read()]);
  if(Object.hasOwn(admission,'result'))return admission.result;
  adapter.prepare?.();
  let packet=corePolicySync<any>('user-records.askStart',[adapter.read()]);
  if(Object.hasOwn(packet,'result'))return packet.result;
  commitDayNightPlan(adapter.core,packet.plan,assertCurrent);
  assertCurrent();corePolicySync('user-records.askCurrent',[packet.state,adapter.read()]);
  let observation:any;
  try{observation={ok:true,value:await adapter.compose(packet.command)};}catch{observation={ok:false};}
  assertCurrent();packet=corePolicySync<any>('user-records.askGenerated',[packet.state,observation,adapter.read()]);
  commitDayNightPlan(adapter.core,packet.plan,assertCurrent);
  if(Object.hasOwn(packet,'result'))return packet.result;
  assertCurrent();corePolicySync('user-records.askCurrent',[packet.state,adapter.read()]);
  try{observation={ok:true,value:adapter.publish(packet.command)};}catch{observation={ok:false};}
  assertCurrent();packet=corePolicySync<any>('user-records.askPublished',[packet.state,observation,adapter.read()]);
  commitDayNightPlan(adapter.core,packet.plan,assertCurrent);
  return packet.result;
}
