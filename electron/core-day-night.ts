/** Execute Core's bounded continuation. No local domain selection or replay. */
import {randomUUID} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';
import type {CoreStore} from './core-store';

type Adapter={core:CoreStore;read:(state?:any)=>any;assertCurrent:()=>void;dispatch:(command:any,bindings:Map<string,unknown>)=>Promise<unknown>};
export function commitDayNightPlan(core:CoreStore,plan:any,assertCurrent:()=>void){
  if(!plan||!plan.expected||!plan.changes||Object.keys(plan.changes).some(k=>!Object.hasOwn(plan.expected,k)))throw Error('core_day_night_commit_protocol');
  core.transaction(()=>{
    assertCurrent();
    for(const [name,value] of Object.entries(plan.expected))if(JSON.stringify(core.get(name,null))!==JSON.stringify(value))throw Error('core_day_night_stale_documents');
    for(const fence of plan.fences??[]){
      if(fence.document!=='archive'||typeof fence.key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(fence.key))throw Error('core_day_night_fence_protocol');
      if(JSON.stringify(core.get('archive',{})[fence.key]??null)!==JSON.stringify(fence.expected))throw Error('core_day_night_stale_archive');
    }
    for(const [name,value] of Object.entries(plan.changes))core.set(name,value);
  });
}
export async function runCoreContinuation(domain:'day-night'|'diary'|'dream-notebook'|'dream-learning',args:unknown[],adapter:Adapter){
  const bindings=new Map<string,unknown>();
  adapter.assertCurrent();
  let packet=corePolicySync<any>(domain+'.start',[...args,adapter.read()]);
  for(let count=0;count<256;count++){
    if(Object.hasOwn(packet,'result'))return packet.result;
    const command=packet.command;if(!command||typeof command.kind!=='string'||!packet.state)throw Error('core_day_night_protocol');
    adapter.assertCurrent();let observation:{ok:boolean;value?:unknown};
    if(command.kind==='commit'){
      // Never convert an uncertain commit into an observation and continue.
      commitDayNightPlan(adapter.core,command.plan,adapter.assertCurrent);observation={ok:true};
    }else if(command.kind==='random'){
      if(command.count!==1||!Array.isArray(command.draws)||command.draws.length>=3)throw Error('core_day_night_entropy_protocol');
      observation={ok:true,value:[...command.draws,Math.random()]};
    }else if(command.kind==='ids'){
      if(command.count!==1)throw Error('core_day_night_entropy_protocol');
      observation={ok:true,value:[Math.random().toString(36).slice(2,10)]};
    }else{
      try{observation={ok:true,value:await adapter.dispatch(command,bindings)};}
      catch{observation={ok:false};}
    }
    adapter.assertCurrent();
    packet=corePolicySync<any>(domain+'.observed',[packet.state,observation,adapter.read(packet.state)]);
  }
  throw Error('core_day_night_continuation_bound');
}
export function bindDayNightProject(bindings:Map<string,unknown>,project:unknown){
  const reference=randomUUID();bindings.set(reference,project);return {reference,project};
}
export function boundDayNightProject(bindings:Map<string,unknown>,command:{reference:string;project:unknown}){
  const held=bindings.get(command.reference);
  if(!held||JSON.stringify(held)!==JSON.stringify(command.project))throw Error('core_day_night_project_binding');
  return held;
}

export function runCoreDayNight(mode:'day'|'night',adapter:Adapter){return runCoreContinuation('day-night',[mode],adapter);}
