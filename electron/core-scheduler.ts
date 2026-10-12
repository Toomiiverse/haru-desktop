// A transport wake-up and registered handlers. Core alone decides job times,
// booking caps, durable grants and outcomes. No local execution on failure.
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {coreServiceOptions} from './core-service-client';
import type {Job,Outcome,ScheduleFile} from './scheduler';

export const activeScheduledJob=new AsyncLocalStorage<{id:string;kind:string;token:string}>();
type Reply={version:1;op:string;schedule:ScheduleFile;revision:number;executes:false;grant?:{token:string;job:Job;priority:'background';executes:false}|null;
  nextPollMs?:number;reason?:string;booked?:boolean;at?:number;cancelled?:boolean};
type Options={load():ScheduleFile;save(file:ScheduleFile):void;handlers:Record<string,(job:Job)=>Outcome|Promise<Outcome>>;log?:(line:string)=>void};

export function createCoreScheduler(options:Options){
  let mirror=structuredClone(options.load()),started=false,running=false,timer:ReturnType<typeof setTimeout>|undefined;
  let tail:Promise<unknown>=Promise.resolve();
  const held=coreServiceOptions();
  if(!held||process.env.HARU_CORE_BRAIN_WORKER!=='on')throw Error('core_scheduler_owner_required');
  const address=new URL(held.endpoint);
  if(address.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(address.hostname)||address.username||address.password
    ||address.search||address.hash||address.pathname!=='/')throw Error('core_scheduler_loopback_required');
  if(statSync(held.tokenFile).mode&0o077)throw Error('core_scheduler_private_token_required');
  const token=readFileSync(held.tokenFile,'utf8').trim();if(token.length<32)throw Error('core_scheduler_private_token_required');
  const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');const birth=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
  async function send(op:string,extra:Record<string,unknown>={},requestId:string=randomUUID()):Promise<Reply>{
    const response=await fetch(address.origin+'/v1/scheduler',{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:'Bearer '+token},
      body:JSON.stringify({version:1,owner:{pid:process.pid,birth},request_id:requestId,op,...extra}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('core_scheduler_unavailable');
    const reply=await response.json() as Reply;
    if(reply.version!==1||reply.op!==op||reply.executes!==false||!Number.isSafeInteger(reply.revision)||!Array.isArray(reply.schedule?.jobs)
      ||!Array.isArray(reply.schedule?.runs)||reply.schedule.jobs.length>128||reply.schedule.runs.length>200)throw Error('core_scheduler_protocol_error');
    mirror=structuredClone(reply.schedule);return reply;
  }
  function ordered<T>(operation:()=>Promise<T>):Promise<T>{const value=tail.then(operation);tail=value.catch(()=>{});return value;}
  const call=(op:string,extra:Record<string,unknown>={},requestId?:string)=>ordered(()=>send(op,extra,requestId));
  function arm(delay:number){if(!started)return;if(timer)clearTimeout(timer);timer=setTimeout(()=>void tick().catch(()=>{}),Math.max(1000,Math.min(60000,delay)));timer.unref();}
  async function tick():Promise<number>{
    if(running||!started)return 0;running=true;let delay=1000;
    const requestId=randomUUID();
    try{
      const reply=await call('poll',{},requestId);delay=reply.nextPollMs??1000;
      const grant=reply.grant;if(!grant)return 0;
      if(grant.priority!=='background'||grant.executes!==false||typeof grant.token!=='string'||!['maintenance','booked','traffic-watch','anime-fetch'].includes(grant.job?.kind))
        throw Error('core_scheduler_invalid_grant');
      let outcome:Outcome|{interrupted:true;reason:string};
      try{
        const handler=options.handlers[grant.job.kind];if(!handler)throw Error('core_scheduler_handler_missing');
        outcome=await activeScheduledJob.run({id:grant.job.id,kind:grant.job.kind,token:grant.token},()=>handler(grant.job));
      }catch{outcome={interrupted:true,reason:'handler_exception_outcome_unknown'};}
      await call('settle',{token:grant.token,outcome});
      console.log('[core-scheduler] '+JSON.stringify({event:'settled',kind:grant.job.kind,status:'interrupted' in outcome?'interrupted':'failed' in outcome?'failed':'later' in outcome?'later':'done'}));
      return 1;
    }catch(error){
      // A timed-out grant or settlement is interrupted without replaying its
      // handler. If reconciliation is unavailable, startup will settle it.
      await call('abandon',{claim_request_id:requestId}).catch(()=>{});
      console.log('[core-scheduler] '+JSON.stringify({event:'unavailable',reason:'outcome_unconfirmed'}));
      throw error;
    }finally{running=false;arm(delay);}
  }
  return {
    start(){if(started)return;started=true;void call('ensure').then(()=>tick()).catch(()=>arm(1000));},
    stop(){started=false;if(timer)clearTimeout(timer);timer=undefined;},
    tick,
    async add(job:Job){await call('add',{job});},
    async cancel(id:string){return Boolean((await call('cancel',{job_id:id})).cancelled);},
    list:()=>structuredClone(mirror.jobs),runs:()=>structuredClone(mirror.runs),booked:()=>structuredClone(mirror.booked??[]),
    updateMirror(file:ScheduleFile){mirror=structuredClone(file);},
    async book(input:{at:number;why:string},id:string){const reply=await call('book',{...input,job_id:id});return reply.booked?{booked:true as const,at:reply.at!}:{booked:false as const,reason:reply.reason??'Booking was not saved.'};},
    ensureDaily(_input:{id:string;kind:string;daily:string;timezone:string;staleAfterMs:number}){void call('ensure').catch(()=>console.log('[core-scheduler] '+JSON.stringify({event:'unavailable',reason:'ensure_unconfirmed'})));},
  };
}
