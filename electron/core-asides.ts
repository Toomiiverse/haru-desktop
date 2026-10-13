/** Execute Core's aside state plan. Unknown commits never publish or retry. */
import {corePolicySync} from './core-policy-sync';
import {commitDayNightPlan} from './core-day-night';
import type {CoreStore} from './core-store';
import {activeTask} from './task-controller';
export function coreAsideMutation(action:string,args:unknown,core:CoreStore,facts:{now:number;at:string;day:string;timeZone:string}){
  const assertCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();
  assertCurrent();const config=core.docRef('config',{});   // 3780: by digest (two whole-config crossings a turn; the plan already answers by digest)
  const entropy=corePolicySync<{ids:number;newId:boolean}>('asides.entropy',[action,args,config]);
  const packet=corePolicySync<any>('asides.mutate',[action,args,{...facts,config,ids:Array.from({length:entropy.ids},()=>Math.random().toString(36).slice(2,10)),...(entropy.newId?{id:Math.random().toString(36).slice(2,10)}:{})}]);
  if(packet.plan)commitDayNightPlan(core,packet.plan,assertCurrent);
  return packet.result;
}
