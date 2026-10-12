/** Playback command transport. Core owns every semantic choice and receipt plan. */
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {WatchInput} from './anime';
export type PlaybackMemory={
  playbackEffects?():unknown;
  commitPlayback?(plan:{expected:unknown;ledger:unknown}):void;
  assertPlaybackCurrent?():void;
};
type Plan={state?:any;command?:{op:string;args:any[]};result?:Record<string,unknown>;delegateDownload?:boolean;observedEffect?:string};
const policy=<T>(op:string,args:unknown[])=>corePolicySync<T>('anime-playback.'+op,args);
export async function runAnimePlayback(input:WatchInput,dispatch:(op:string,args:any[])=>Promise<unknown>,memory:PlaybackMemory):Promise<Plan>{
  let plan=policy<Plan>('begin',[input]);
  for(let steps=0;steps<32&&plan.command;steps++){
    const current=plan;const command=current.command!;const task=activeTask.getStore();
    await task?.check();memory.assertPlaybackCurrent?.();
    let observation:{ok:boolean;value?:unknown;blocked?:boolean};
    if(command.op==='play'){
      if(!memory.playbackEffects||!memory.commitPlayback)throw Error('anime_playback_storage_required');
      const claim=policy<any>('claim',[memory.playbackEffects(),current,Date.now()]);
      if(!claim.dispatch){observation={ok:true,blocked:true};}
      else{
        memory.assertPlaybackCurrent?.();memory.commitPlayback(claim);
        let accepted=false;
        try{
          task?.signal.throwIfAborted();memory.assertPlaybackCurrent?.();
          await dispatch(command.op,command.args);accepted=true;
          observation={ok:true,value:null};
        }catch{observation={ok:false};}
        // Record uncertainty even after cancellation. No repeat command.
        const settled=policy<any>('settle',[memory.playbackEffects(),claim.record,accepted,Date.now()]);
        memory.commitPlayback(settled);
      }
    }else{
      try{observation={ok:true,value:await dispatch(command.op,command.args)};}
      catch{observation={ok:false};}
    }
    task?.signal.throwIfAborted();
    const now=Date.now();plan=policy<Plan>('observed',[current,observation,now]);
    if(plan.observedEffect){
      if(!memory.playbackEffects||!memory.commitPlayback)throw Error('anime_playback_storage_required');
      memory.commitPlayback(policy<any>('reconcile',[memory.playbackEffects(),current,observation,now]));
    }
  }
  if(plan.command)throw Error('anime_playback_protocol_limit');
  return plan;
}
