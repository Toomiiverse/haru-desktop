// Bounded observations only. Core owns state/attention and the native executor.
import {randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {coreServiceOptions} from './core-service-client';

type Source='user-activity'|'local-game'|'background-vision'|'foreground-vision';
type Type='UserActivity'|'GameStarted'|'GameStopped'|'VisionFrame';
type Attention={action:'background'|'observe'|'defer';role:'local-perception'|null;allowed:boolean;reason:string;executes:false};
let sequence=0;

export async function coreObservation(type:Type,source:Source,payload:Record<string,unknown>):Promise<Attention> {
  if(process.env.HARU_CORE_LIVE_STATE!=='on')return {action:'observe',role:null,allowed:true,reason:'compatibility',executes:false};
  const options=coreServiceOptions();
  if(!options||process.env.HARU_CORE_BRAIN_WORKER!=='on')throw Error('core_observation_owner_unavailable');
  const url=new URL(options.endpoint);
  if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')
    throw Error('core_observation_loopback_required');
  if(statSync(options.tokenFile).mode&0o077)throw Error('core_observation_private_token_required');
  const token=readFileSync(options.tokenFile,'utf8').trim();
  if(token.length<32)throw Error('core_observation_private_token_required');
  const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
  const birth=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
  const response=await fetch(url.origin+'/v1/live/events',{method:'POST',redirect:'error',
    headers:{'content-type':'application/json',authorization:'Bearer '+token},
    body:JSON.stringify({version:1,owner:{pid:process.pid,birth},event:{id:randomUUID(),source,sequence:++sequence,
      at_ms:Date.now(),type,...payload}}),signal:AbortSignal.timeout(1500)});
  if(!response.ok)throw Error('core_observation_unavailable');
  const result=await response.json();const attention=result.attention;
  if(result.version!==1||typeof result.applied!=='boolean'||typeof attention?.allowed!=='boolean'||attention.executes!==false
    ||!['background','observe','defer'].includes(attention.action)||![null,'local-perception'].includes(attention.role)
    ||typeof attention.reason!=='string'||attention.reason.length>200)throw Error('core_observation_protocol_error');
  return attention;
}

export function noteCoreUserActivity(kind:'speech'|'reaction'|'interaction'='interaction'):void {
  if(process.env.HARU_CORE_LIVE_STATE!=='on')return;
  void coreObservation('UserActivity','user-activity',{kind}).catch(()=>{
    console.log('[core-state] '+JSON.stringify({event:'observation_unavailable',kind:'UserActivity'}));
  });
}

let observedGame:string|null=null,lastGameObservation=0;
export function noteCoreGame(name:string|null):void {
  if(process.env.HARU_CORE_LIVE_STATE!=='on')return;
  const current=name?.trim().slice(0,200)||null,now=Date.now();
  if(current===observedGame&&now-lastGameObservation<60000)return;
  const previous=observedGame;observedGame=current;lastGameObservation=now;
  const updates:Promise<Attention>[]=[];
  if(previous&&previous!==current)updates.push(coreObservation('GameStopped','local-game',{game:previous}));
  if(current)updates.push(coreObservation('GameStarted','local-game',{game:current}));
  void Promise.all(updates).catch(()=>console.log('[core-state] '+JSON.stringify({event:'observation_unavailable',kind:'GameState'})));
}
