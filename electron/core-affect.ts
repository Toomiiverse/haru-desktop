/** Affect admission courier. Core owns appraisal, decisions and exact CAS plans. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import {coreAdapterOwner} from './core-policy-sync';
import {cleaningChunks,stripDelivery} from './delivery';
import {commitDayNightPlan} from './core-day-night';

export const affectScope=new AsyncLocalStorage<any>();
let storage:()=>any;
export function configureAffect(read:()=>any) {storage=read;}
export function currentAffect(){return affectScope.getStore();}
/** Relay Core's phase label without changing the spoken words. */
export function affectDelivery(affect:any,text:string){
  return affect&&!affect.preserveVerbatim&&affect.label?'['+affect.label+'] '+stripDelivery(text):text;
}

async function settingsTransport(change?:unknown){
  const options=coreServiceOptions();if(!options)throw Error('affect_owner_unavailable');
  const client=new CoreServiceClient(options) as any;
  const response=await fetch(client.endpoint+'/v1/affect/settings',{
    method:change===undefined?'GET':'POST',redirect:'error',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+client.token},
    ...(change===undefined?{}:{body:JSON.stringify({...change as object,version:1,owner:coreAdapterOwner(),nowMs:Date.now()})}),
    signal:AbortSignal.timeout(12000),
  });
  if(!response.ok)throw Error(response.status===409?'affect_settings_changed':'affect_settings_unconfirmed');
  const value=await response.json();if(value.version!==1)throw Error('affect_protocol_error');
  return value;
}
export async function readAffectSettings(){return settingsTransport();}
export async function saveAffectSettings(change:unknown){
  const packet=await settingsTransport(change);
  commitDayNightPlan(storage(),packet.plan,()=>{});
  const observed=await settingsTransport();
  if(observed.revision!==packet.revision)throw Error('affect_settings_changed');
  return observed;
}

async function transport(packet:any,signal?:AbortSignal){
  const options=coreServiceOptions();if(!options)throw Error('affect_owner_unavailable');
  const client=new CoreServiceClient(options) as any;
  const response=await fetch(client.endpoint+'/v1/affect',{method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+client.token},
    body:JSON.stringify({version:1,...packet,owner:coreAdapterOwner(),nowMs:Date.now()}),
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('affect_admission_unconfirmed');
  const value=await response.json();
  if(value.version!==1||value.eventId!==packet.eventId)throw Error('affect_protocol_error');
  return value;
}

export async function admitAffect(messages:any[],options:any={}){
  if(process.env.HARU_SERVICE_AFFECT_V2!=='on')return null;
  options.signal?.throwIfAborted();
  const latest=messages.at(-1)??{};
  const eventId=String(options.eventId??latest.id??randomUUID());
  const packet=await transport({op:'admit',eventId,text:String(latest.content??''),
    history:messages.slice(0,-1).slice(-8).map(m=>({role:m.role,content:String(m.content??'').slice(-2000)})),
    call:options.call===true,cloudAllowed:options.cloudAllowed!==false},options.signal);
  if(packet.plan){
    options.signal?.throwIfAborted();
    commitDayNightPlan(storage(),packet.plan,()=>options.signal?.throwIfAborted());
    return transport({op:'confirm',eventId,text:String(latest.content??''),cloudAllowed:options.cloudAllowed!==false,call:options.call===true},options.signal);
  }
  return packet;
}

export async function affectOutcome(affect:any,status:string){
  if(affect&&!affect.duplicate){
    const result=await transport({op:'outcome',eventId:affect.eventId,status});
    if(result.reflect===true){
      // Execute Core's post-publication command once. A stale/uncertain commit
      // is discarded, never rebased or retried with a newly invented decision.
      void transport({op:'reflect',eventId:affect.eventId}).then(packet=>{
        if(packet.plan)commitDayNightPlan(storage(),packet.plan,()=>{});
      }).catch(()=>{console.warn('[affect] post-task reflection unconfirmed; not replayed');});
    }
  }
}

export async function affectTurn<T>(messages:any[],options:any,run:(options:any)=>Promise<T>):Promise<any>{
  const affect=options.affect??currentAffect()??await admitAffect(messages,options);
  if(!affect)return run(options);
  if(affect.reply){
    const status=affect.status;
    await affectOutcome(affect,status);
    return {content:affect.reply,message:{role:'assistant',content:affect.reply},ran:[],disposition:status,ignored:false};
  }
  return affectScope.run(affect,async()=>{
    const relayed={...options};
    if(options.onChunk&&!affect.preserveVerbatim){
      let first=true;
      const make=()=>cleaningChunks(text=>{if(text){options.onChunk((first?'['+affect.label+'] ':'')+text);first=false;}});
      let clean=make();relayed.onChunk=(text:string)=>clean(text);
      relayed.onChunkReset=()=>{first=true;clean=make();options.onChunkReset?.();};
    }
    try{
      const answer:any=await run(relayed);
      if(!affect.preserveVerbatim&&typeof answer?.content==='string'){
        answer.content=affectDelivery(affect,answer.content);
        if(answer.message)answer.message={...answer.message,content:answer.content};
      }
      await affectOutcome(affect,'completed').catch(()=>{});return answer;
    }
    catch(error){await affectOutcome(affect,options.signal?.aborted?'cancelled':'unknown').catch(()=>{});throw error;}
  });
}
