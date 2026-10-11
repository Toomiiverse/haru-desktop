/** Fixed native cadence transport. No fallback to local timers/decisions. */
import {randomUUID} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {coreServiceOptions} from './core-service-client';
import {activeScheduledJob} from './core-scheduler';

type Grant = {kind:string;token:string;due:number;priority:'background';executes:false};
type Options = {
  config:{sampleSeconds:number};
  handlers:Record<string,()=>unknown|Promise<unknown>>;
};
/** Preserve the world's constrained schema while using the owned provider path.
 * The legacy world engine expects an Ollama-shaped Response, not a task reply.
 */
export async function periodicWorldFetch(
  send:(messages:any[],config:any,options:any)=>Promise<{content:string}>,
  config:{model:string;endpoint:string}, url:string, init:RequestInit,
) {
  const address=new URL(url),base=new URL(config.endpoint);
  if(address.origin!==base.origin||address.pathname!=='/api/chat'||address.search||address.hash
    ||address.username||address.password||address.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(address.hostname)
    ||init.method!=='POST'||typeof init.body!=='string')throw Error('periodic_world_local_required');
  const body=JSON.parse(init.body);
  if(body.model!==config.model||body.stream!==false||!Array.isArray(body.messages)||body.tools?.length)throw Error('periodic_world_request_invalid');
  const result=await send(body.messages,config,{tools:false,table:[],format:body.format,
    maxTokens:body.options.num_predict,numCtx:body.options.num_ctx,temperature:body.options.temperature,signal:init.signal});
  return new Response(JSON.stringify({message:{role:'assistant',content:result.content}}),{status:200,headers:{'content-type':'application/json'}});
}
export function createCorePeriodic(options:Options) {
  const held=coreServiceOptions();
  if(!held||(false as boolean))throw Error('core_periodic_owner_required');
  const address=new URL(held.endpoint);
  if(address.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(address.hostname)||address.username||address.password
    ||address.search||address.hash||address.pathname!=='/')throw Error('core_periodic_loopback_required');
  if(statSync(held.tokenFile).mode&0o077)throw Error('core_periodic_private_token_required');
  const token=readFileSync(held.tokenFile,'utf8').trim();
  if(token.length<32)throw Error('core_periodic_private_token_required');
  const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
  const owner={pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};
  const generation=randomUUID();
  let started=false,registered=false,polling=false,sequence=0,timer:ReturnType<typeof setTimeout>|undefined;
  const running=new Map<string,Promise<void>>();
  async function send(op:string,extra:Record<string,unknown>={}) {
    const response=await fetch(address.origin+'/v1/periodic',{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:'Bearer '+token,connection:'close'},
      body:JSON.stringify({version:1,op,owner,generation,...extra}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('core_periodic_unavailable');
    const reply=await response.json();
    if(reply.version!==1||reply.op!==op||reply.executes!==false)throw Error('core_periodic_protocol_error');
    return reply;
  }
  function arm(ms=1000) {
    if(!started)return;
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>void tick().catch(()=>{}),Math.max(1000,Math.min(60000,ms)));timer.unref();
  }
  async function run(grant:Grant) {
    let outcome:'done'|'interrupted'='done',observation:unknown;
    try {
      observation=await activeScheduledJob.run({id:'periodic:'+grant.kind,kind:'periodic:'+grant.kind,token:grant.token},options.handlers[grant.kind]);
    } catch {outcome='interrupted';}
    const sleepiness=grant.kind==='life'&&typeof observation==='number'&&Number.isFinite(observation)&&observation>=0&&observation<=1?observation:undefined;
    const recallBacklog=(true as boolean)&&grant.kind==='recall-vectors'&&observation&&typeof observation==='object'&&typeof (observation as any).recallBacklog==='boolean'?(observation as {recallBacklog:boolean}).recallBacklog:undefined;
    const fields={token:grant.token,outcome,...(sleepiness!==undefined?{sleepiness}:{}),...(recallBacklog!==undefined?{recallBacklog}:{})};
    let reply;
    try {reply=await send('settle',fields);}
    catch {reply=await send('settle',fields);}
    if(reply.settled!==true||!['done','interrupted'].includes(reply.outcome))throw Error('core_periodic_invalid_settlement');
    console.log('[core-scheduler] '+JSON.stringify({event:'periodic_settled',kind:grant.kind,status:reply.outcome}));
  }
  async function tick() {
    if(!started||polling)return 0;
    polling=true;const current=++sequence;
    try {
      if(!registered) {
        const reply=await send('start',{config:options.config});
        if(!Array.isArray(reply.registered)||reply.registered.length!==Object.keys(options.handlers).length
          ||new Set(reply.registered).size!==reply.registered.length||reply.registered.some((kind:unknown)=>typeof kind!=='string'||!Object.hasOwn(options.handlers,kind)))
          throw Error('core_periodic_handler_mismatch');
        registered=true;
      }
      if(!started)return 0;
      const reply=await send('poll',{sequence:current});
      if(!started){await send('abandon',{sequence:current});return 0;}
      if(!Array.isArray(reply.grants)||reply.grants.length>4||new Set(reply.grants.map((g:Grant)=>g.kind)).size!==reply.grants.length
        ||new Set(reply.grants.map((g:Grant)=>g.token)).size!==reply.grants.length)throw Error('core_periodic_invalid_grants');
      for(const grant of reply.grants) {
        if(!grant||grant.priority!=='background'||grant.executes!==false||typeof grant.token!=='string'
          ||!/^[-a-zA-Z0-9._]{1,80}$/.test(grant.token)||!Number.isSafeInteger(grant.due)||grant.due<0
          ||!Object.hasOwn(options.handlers,grant.kind)||running.has(grant.kind))throw Error('core_periodic_invalid_grant');
      }
      // Validate the entire batch before dispatching any handler.
      for(const grant of reply.grants) {
        const pending=run(grant).catch(()=>console.log('[core-scheduler] '+JSON.stringify({event:'periodic_unavailable',kind:grant.kind,reason:'settlement_unconfirmed'})))
          .finally(()=>running.delete(grant.kind));
        running.set(grant.kind,pending);
      }
      return reply.grants.length;
    } catch(error) {
      // A claim whose acknowledgement was lost must never invoke a handler.
      await send('abandon',{sequence:current}).catch(()=>{});
      console.log('[core-scheduler] '+JSON.stringify({event:'periodic_unavailable',reason:'dispatch_unconfirmed'}));
      throw error;
    } finally {polling=false;arm();}
  }
  return {
    start(){if(started)return;started=true;void tick().catch(()=>{});},
    stop(){started=false;if(timer)clearTimeout(timer);timer=undefined;},
    tick,
    async drained(){await Promise.all([...running.values()]);},
    active:()=>running.size,
    async worldReady():Promise<boolean> {
      const grant=activeScheduledJob.getStore();
      if(!started||!registered||grant?.kind!=='periodic:world'||grant.id!=='periodic:world')
        throw Error('core_periodic_world_grant_required');
      const reply=await send('world-attention',{token:grant.token});
      const reasons=['ready','intake_paused','foreground','quiet_period','model_busy','admission_unavailable'];
      if(typeof reply.allowed!=='boolean'||!reasons.includes(reply.reason)||reply.allowed!==(reply.reason==='ready'))
        throw Error('core_periodic_world_attention_invalid');
      return reply.allowed;
    },
  };
}
