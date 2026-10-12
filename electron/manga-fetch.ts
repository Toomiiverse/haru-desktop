/** Execute only Core's named user-fetch commands; preserve uncertain mutations. */
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {SuwayomiConfig} from './suwayomi';
export type MangaFetchMemory={effects():unknown;commit(plan:{expected:unknown;ledger:unknown}):void;assertCurrent():void};
type Plan={state?:any;command?:{op:string;args:any[]};result?:Record<string,unknown>};
const effects=new Set(['install','libraryAdd','categoryAdd','refreshChapters','enqueue','start']);
const policy=<T>(op:string,args:unknown[])=>corePolicySync<T>('manga-fetch.'+op,args);
export async function runMangaFetch(input:{title:string;mangaId?:number;confirm?:boolean},config:SuwayomiConfig,dispatch:(op:string,args:any[])=>Promise<unknown>,memory:MangaFetchMemory,mode:'get'|'status'='get'){
  let plan=policy<Plan>('begin',[input,config,mode]);
  for(let step=0;step<96&&plan.command;step++){
    const cmd=plan.command,current=plan,task=activeTask.getStore();
    await task?.check();task?.signal.throwIfAborted();memory.assertCurrent();
    let observation:{ok:boolean;value?:unknown;blocked?:boolean};
    if(effects.has(cmd.op)){
      const claim=policy<any>('claim',[memory.effects(),plan,Date.now()]);
      if(!claim.dispatch)observation={ok:true,blocked:true};
      else{
        memory.commit(claim);let accepted=false;
        try{task?.signal.throwIfAborted();memory.assertCurrent();observation={ok:true,value:await dispatch(cmd.op,cmd.args)};accepted=true;}catch{observation={ok:false};}
        memory.commit(policy<any>('settle',[memory.effects(),claim.record,accepted,Date.now()]));
      }
    }else{
      try{observation={ok:true,value:await dispatch(cmd.op,cmd.args)};}catch{observation={ok:false};}
    }
    task?.signal.throwIfAborted();memory.assertCurrent();
    memory.commit(policy<any>('reconcile',[memory.effects(),current,observation,Date.now()]));
    plan=policy<Plan>('observed',[current,observation,Date.now()]);
  }
  if(plan.command||!plan.result)throw Error('manga_fetch_protocol_limit');
  return plan.result;
}
