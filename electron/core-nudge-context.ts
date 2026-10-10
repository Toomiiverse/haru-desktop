/** Raw recorded facts in, Core-derived subjects/context out. No models or writes. */
import {readFileSync} from 'node:fs';
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import type {Aside,NudgeTone} from './asides';
import type {NudgeCandidate,NudgeSubject} from './nudges';
import type {NudgeMessage} from './nudge-learning';
const LIMIT=262144;
export type SourceKind='task'|'conversation'|'own'|'relationship'|'connect'|'phone';
type Reading={at:string;day:string;about:string;note:string;interest?:string;game?:string};
type Task={id:string;kind:string;title:string;done?:boolean;underway?:string;completedAt?:string};
export type SourceSnapshot={now:number;completionWindowMs:number;tasks:readonly Task[];messages:readonly NudgeMessage[];
  nights:readonly Reading[];days:readonly Reading[];finished:readonly {at:string;title:string;seriesId:string}[];
  interests:readonly {name:string}[];asides:readonly Aside[];lastAttemptAt?:string;candidates:readonly NudgeCandidate[]};
export type ContextSnapshot={now:number;subject:NudgeSubject;asides:readonly Aside[];conversation:string;whereabouts:string;slate:string;irritation:number;ego:number;temperament:string};
const stamp=(s?:string)=>{const n=Date.parse(s??'');return Number.isSafeInteger(n)&&n>=0?n:null;};
const aside=(a:Aside)=>({at:a.at,atMs:stamp(a.at),text:a.text,source:a.source,nudgeTopic:a.nudgeTopic??null,nudgeEvent:a.nudgeEvent??null,nudgeTone:a.nudgeTone??null});
const reading=(r:Reading)=>({at:r.at,atMs:stamp(r.at),day:r.day,about:r.about,note:r.note,interest:r.interest??null,game:r.game??null});
export function sourceMetadata(s:SourceSnapshot) {
  return {completionWindowMs:s.completionWindowMs,tasks:s.tasks.map(t=>({id:t.id,kind:t.kind,title:t.title,done:Boolean(t.done),underway:t.underway??null,underwayMs:stamp(t.underway),completedAt:t.completedAt??null,completedAtMs:stamp(t.completedAt)})),
    messages:s.messages.map(m=>({role:m.role??null,content:m.content??null,at:m.at??null,atMs:stamp(m.at)})),nights:s.nights.map(reading),days:s.days.map(reading),
    finished:s.finished.map(f=>({at:f.at,atMs:stamp(f.at),title:f.title,seriesId:f.seriesId})),interests:s.interests.map(i=>i.name),asides:s.asides.map(aside),lastAttemptAtMs:stamp(s.lastAttemptAt),
    candidates:s.candidates.map((c,i)=>({subject:c.subject,weight:c.weight,...(c.priority!==undefined?{priority:c.priority}:{}),...(c.asked!==undefined?{asked:c.asked}:{}),adapterId:'extra:'+i}))};
}
export function contextMetadata(s:ContextSnapshot) {return {subject:s.subject,asides:s.asides.map(aside),conversation:s.conversation,whereabouts:s.whereabouts,slate:s.slate,irritation:s.irritation,ego:s.ego,temperament:s.temperament};}
export const sameSourceSnapshot=(a:SourceSnapshot,b:SourceSnapshot)=>JSON.stringify(sourceMetadata(a))===JSON.stringify(sourceMetadata(b));
export const sameContextSnapshot=(a:ContextSnapshot,b:ContextSnapshot)=>JSON.stringify(contextMetadata(a))===JSON.stringify(contextMetadata(b));

async function request(op:'sources'|'context',now:number,payload:object) {
  if(process.env.HARU_CORE_NUDGE_CONTEXT!=='on')throw Error('core_nudge_context_disabled');
  const opts=coreServiceOptions();if(!opts||process.env.HARU_CORE_BRAIN_WORKER!=='on')throw Error('core_nudge_context_owner_required');
  new CoreServiceClient(opts);
  const token=readFileSync(opts.tokenFile,'utf8').trim(),stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
  const body=JSON.stringify({version:1,op,owner:{pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]},nowMs:now,...payload});
  if(Buffer.byteLength(body)>LIMIT)throw Error('core_nudge_context_payload_too_large');
  try {
    const response=await fetch(new URL('/v1/nudges/'+op,opts.endpoint),{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+token},body,signal:AbortSignal.timeout(1500)});
    if(!response.ok||!response.body)throw Error('core_nudge_context_unavailable');
    const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT)throw Error('core_nudge_context_result_too_large');chunks.push(Buffer.from(value));}}
    finally {await reader.cancel().catch(()=>{});}
    const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(r?.version!==1||r.op!==op||r.executes!==false||r.snapshotAtMs!==now)throw Error('core_nudge_context_protocol_error');
    return r;
  } catch(error) {if(error instanceof Error&&error.message.startsWith('core_nudge_context_'))throw error;throw Error('core_nudge_context_unavailable');}
}
const kinds=['memory','day','task','own','recommendation','checkin','callback'];
const tones=['amused','curious','opinionated','approving','challenging'];
const string=(s:unknown,max:number)=>typeof s==='string'&&s.length<=max;
function validSubject(s:any) {
  return s&&string(s.key,1000)&&kinds.includes(s.kind)&&string(s.material,65536)&&string(s.instruction,16384)
    &&Object.keys(s).every(k=>['key','kind','material','instruction','keywords','revision','occurredAt','expiresAt','development'].includes(k))
    &&(s.keywords===undefined||Array.isArray(s.keywords)&&s.keywords.length<=18&&s.keywords.every((v:unknown)=>string(v,256)))
    &&(s.revision===undefined||string(s.revision,1000))&&(s.occurredAt===undefined||string(s.occurredAt,100))&&(s.expiresAt===undefined||string(s.expiresAt,100))
    &&(s.development===undefined||s.development&&['completion','opinion'].includes(s.development.kind)&&string(s.development.id,1000)&&string(s.development.at,100)&&Object.keys(s.development).sort().join(',')==='at,id,kind');
}
export async function coreSourceNudges(input:SourceSnapshot,sourceKind:SourceKind,fresh:()=>SourceSnapshot):Promise<NudgeCandidate[]> {
  const payload=sourceMetadata(input),r=await request('sources',input.now,{sourceKind,...payload});
  if(r.sourceKind!==sourceKind||Object.keys(r).sort().join(',')!=='candidates,executes,op,snapshotAtMs,sourceKind,version'||!Array.isArray(r.candidates)||r.candidates.length>512)throw Error('core_nudge_context_protocol_error');
  const ids=new Set<string>();
  const candidates=r.candidates.map((c:any)=>{
    if(!c||Object.keys(c).some(k=>!['subject','weight','priority','asked','adapterId'].includes(k))||!validSubject(c.subject)||!Number.isFinite(c.weight)||Math.abs(c.weight)>1e12
      ||c.priority!==undefined&&(!Number.isInteger(c.priority)||Math.abs(c.priority)>100)||c.asked!==undefined&&!string(c.asked,1000))throw Error('core_nudge_context_protocol_error');
    const {adapterId,...value}=c;
    if(adapterId===undefined)return value as NudgeCandidate;
    if(typeof adapterId!=='string'||!/^extra:\d+$/.test(adapterId)||ids.has(adapterId))throw Error('core_nudge_context_protocol_error');
    const index=Number(adapterId.slice(6));
    if(adapterId!=='extra:'+index||!['connect','phone'].includes(sourceKind))throw Error('core_nudge_context_protocol_error');
    const original=input.candidates[index];ids.add(adapterId);
    if(!original||original.subject.key!==c.subject.key||original.subject.kind!==c.subject.kind||original.subject.revision!==c.subject.revision||original.asked!==c.asked)throw Error('core_nudge_context_protocol_error');
    return {...value,...(original.accepted?{accepted:original.accepted}:{})} as NudgeCandidate;
  });
  if(JSON.stringify(payload)!==JSON.stringify(sourceMetadata(fresh())))throw Error('core_nudge_context_snapshot_changed');
  if(Date.now()-input.now>1500||input.now>Date.now()+1500)throw Error('core_nudge_context_snapshot_expired');
  return candidates;
}
export async function coreNudgeContext(input:ContextSnapshot,fresh:()=>ContextSnapshot):Promise<{mood:string;continuity:string;delivery:{tone:NudgeTone;instruction:string}}> {
  const payload=contextMetadata(input),r=await request('context',input.now,payload);
  if(Object.keys(r).sort().join(',')!=='continuity,delivery,executes,mood,op,snapshotAtMs,version'||!string(r.mood,32768)||!string(r.continuity,262144)
    ||!r.delivery||Object.keys(r.delivery).sort().join(',')!=='instruction,tone'||!tones.includes(r.delivery.tone)||!string(r.delivery.instruction,4096))throw Error('core_nudge_context_protocol_error');
  if(JSON.stringify(payload)!==JSON.stringify(contextMetadata(fresh())))throw Error('core_nudge_context_snapshot_changed');
  if(Date.now()-input.now>1500||input.now>Date.now()+1500)throw Error('core_nudge_context_snapshot_expired');
  return {mood:r.mood,continuity:r.continuity,delivery:r.delivery};
}
