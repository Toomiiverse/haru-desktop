/** Supervised command transport; Python owns download/watch decisions and receipts. */
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import {activeScheduledJob} from './core-scheduler';
import type {Job,Outcome} from './scheduler';
import type {AnimeConfig,Fetch,WatchInput} from './anime';
export type DownloadMemory={
  downloadEffects?():unknown;
  commitDownload?(plan:{expected:unknown;ledger:unknown}):void;
  watchRecords?():unknown;
  commitWatch?(plan:{expected:unknown;records:unknown}):void;
  assertPlaybackCurrent?():void;
  keep(fetch:Fetch):void|Promise<void>;
  markImported?(seriesId:number,atIso:string):void;
};
type Plan={state?:any;command?:{op:string;args:any[]};result?:any;notice?:any;watchMutation?:any;markImported?:{seriesId:number;at:string}};
const policy=<T>(op:string,args:unknown[])=>corePolicySync<T>('anime-downloads.'+op,args);
const EFFECTS=new Set(['add','monitor','grab','import','scan','publish']);
async function transport(initial:Plan,dispatch:(op:string,args:any[])=>Promise<unknown>,memory:DownloadMemory,watch=false):Promise<any>{
  let plan=initial;
  for(let steps=0;steps<96&&plan.command;steps++){
    const current=plan,cmd=current.command!;const task=activeTask.getStore();
    await task?.check();memory.assertPlaybackCurrent?.();
    let observation:{ok:boolean;value?:unknown;blocked?:boolean};
    if(watch){
      const grant=activeScheduledJob.getStore();
      if(!grant)throw Error('anime_watch_grant_required');
      policy('assertWatch',[current.state.job,grant]);
    }
    if(EFFECTS.has(cmd.op)){
      if(!memory.downloadEffects||!memory.commitDownload)throw Error('anime_download_storage_required');
      const claim=policy<any>('claim',[memory.downloadEffects(),current,Date.now()]);
      if(!claim.dispatch)observation={ok:true,blocked:true};
      else{
        memory.commitDownload(claim);
        let accepted=false;
        try{
          // Persist intent and its reconciliation job before the irreversible grab.
          if(claim.record.fetch)await memory.keep(claim.record.fetch);
          task?.signal.throwIfAborted();memory.assertPlaybackCurrent?.();
          observation={ok:true,value:await dispatch(cmd.op,cmd.args)};accepted=true;
        }catch{observation={ok:false};}
        memory.commitDownload(policy<any>('settle',[memory.downloadEffects(),claim.record,accepted,Date.now()]));
      }
    }else{
      try{observation={ok:true,value:await dispatch(cmd.op,cmd.args)};}catch{observation={ok:false};}
    }
    task?.signal.throwIfAborted();memory.assertPlaybackCurrent?.();
    if(memory.downloadEffects&&memory.commitDownload){
      memory.commitDownload(policy<any>('reconcile',[memory.downloadEffects(),current,observation,Date.now()]));
    }
    plan=policy<Plan>(watch?'watchObserved':'observed',[current,observation,Date.now()]);
    if(plan.watchMutation){
      if(!memory.commitWatch)throw Error('anime_watch_storage_required');memory.commitWatch(plan.watchMutation);
    }
    if(plan.markImported){
      if(!memory.markImported)throw Error('anime_import_receipt_storage_required');memory.markImported(plan.markImported.seriesId,plan.markImported.at);
    }
  }
  if(plan.command||!plan.result)throw Error('anime_download_protocol_limit');
  return plan.result;
}
export function runAnimeDownload(input:WatchInput,config:AnimeConfig,dispatch:(op:string,args:any[])=>Promise<unknown>,memory:DownloadMemory,mode:'download'|'status'='download'){
  return transport(policy<Plan>('begin',[input,config,mode]),dispatch,memory);
}
export async function runAnimeFetchWatch(job:Job,dispatch:(op:string,args:any[])=>Promise<unknown>,memory:DownloadMemory):Promise<Outcome>{
  if(!memory.watchRecords||!memory.commitWatch)throw Error('anime_watch_storage_required');
  const outcome=await transport(policy<Plan>('watchBegin',[job,memory.watchRecords(),Date.now()]),dispatch,memory,true);
  memory.commitWatch(policy<any>('watchFinish',[memory.watchRecords(),job,outcome]));
  return outcome;
}
