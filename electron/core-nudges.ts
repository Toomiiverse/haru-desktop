/** Metadata transport only. Core chooses; the adapter retains source facts and callbacks. */
import { readFileSync, statSync } from 'node:fs';
import { coreServiceOptions } from './core-service-client';
import { nudgeKeywords, nudgeFingerprint, isNudgeAside, rateNudge, learnNudgeResponse, type NudgeSignal, type NudgeMessage } from './nudge-learning';
import { pickNudgeCandidate, publishNudge, type NudgeDraft, type NudgeCandidate } from './nudges';
import { phoneOpportunityId, selectPhoneOpportunity, scanPhoneOpportunities, reservePhoneDelivery, finishPhoneDelivery, type PhoneNudgeState } from './nudge-schedule';
import { heldBack } from './push';
import { zonedNow, localDateKey } from './dates';
import type { Aside, NudgePreference } from './asides';
const stamp = (value?: string) => { const n=Date.parse(value??''); return Number.isSafeInteger(n)&&n>=0?n:null; };
export function nudgeMetadata(candidates:readonly NudgeCandidate[],asides:readonly Aside[],learning:readonly NudgeSignal[]) {
  return {
    candidates:candidates.map(c=>({key:c.subject.key,kind:c.subject.kind,terms:c.subject.keywords??nudgeKeywords(c.subject.material),
      weight:Number.isFinite(c.weight)?c.weight:null,priority:c.priority??0,revision:c.subject.revision||null,
      occurredAtMs:stamp(c.subject.occurredAt),expiresAtMs:stamp(c.subject.expiresAt),opportunityId:phoneOpportunityId(c),
      development:c.subject.development?{...c.subject.development,at:undefined,atMs:stamp(c.subject.development.at)}:null})),
    asides:asides.map(a=>({atMs:stamp(a.at),source:a.source,topic:a.nudgeTopic||null,event:a.nudgeEvent||null,kind:a.nudgeKind??null,
      reached:a.reached??null,answered:Boolean(a.answeredAt),feedback:a.nudgeFeedback??null})),
    learning:learning.map(s=>({atMs:stamp(s.at),topic:s.topic,terms:s.terms,choice:s.choice??null,engagement:s.engagement??null})),
  };
}
let held:{url:string;token:string;owner:{pid:number;birth:string}}|undefined;
function transport() {
  if(held)return held;
  const opts=coreServiceOptions();
  if(!opts||(false as boolean))throw Error('core_nudge_owner_required');
  const url=new URL(opts.endpoint);
  if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('core_nudge_loopback_required');
  if(statSync(opts.tokenFile).mode&0o077)throw Error('core_nudge_private_token_required');
  const token=readFileSync(opts.tokenFile,'utf8').trim();
  if(token.length<32)throw Error('core_nudge_private_token_required');
  const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
  return held={url:url.origin,token,owner:{pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]}};
}
async function request(path:string,op:string,now:number,payload:object) {
  const t=transport(),body=JSON.stringify({version:1,op,owner:t.owner,nowMs:now,...payload});
  if(Buffer.byteLength(body)>262144)throw Error('core_nudge_payload_too_large');
  const started=performance.now();let result:any;
  try {
    const response=await fetch(t.url+'/v1/nudges/'+path,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+t.token},body,signal:AbortSignal.timeout(1500)});
    if(!response.ok)throw Error('core_nudge_unavailable');result=await response.json();
  } catch {throw Error('core_nudge_unavailable');}
  console.log('[core-nudge] '+JSON.stringify({op,totalMs:performance.now()-started}));
  return result;
}
async function choose(op:'pick'|'phone',candidates:readonly NudgeCandidate[],asides:readonly Aside[],now:number,learning:readonly NudgeSignal[],extra={}) {
  const result=await request('select',op,now,{...nudgeMetadata(candidates,asides,learning),...extra});
  const index=result?.index;
  if(result.version!==1||result.op!==op||result.executes!==false
    || !(index===null||Number.isInteger(index)&&index>=0&&index<candidates.length)
    || result.reason!==(index===null?'no_eligible_subject':'selected')
    || result.opportunityId!==(op==='phone'&&index!==null?phoneOpportunityId(candidates[index]):null))throw Error('core_nudge_protocol_error');
  return index as number|null;
}
export async function corePickNudge(candidates:readonly NudgeCandidate[],asides:readonly Aside[],now:number,learning:readonly NudgeSignal[]) {
  
  const index=await choose('pick',candidates,asides,now,learning);
  return index===null?null:candidates[index];
}
export async function coreSelectPhoneNudge(state:PhoneNudgeState,candidates:readonly NudgeCandidate[],asides:readonly Aside[],learning:readonly NudgeSignal[],messages:readonly NudgeMessage[],now:number) {
  
  const messagesOnly=messages.flatMap(m=>{
    const atMs=stamp(m.at);
    return m.role==='user'&&atMs!==null&&atMs<=now?[{atMs,terms:nudgeKeywords(m.content??'')}]:[];
  });
  const index=await choose('phone',candidates,asides,now,learning,{pending:state.pending,messages:messagesOnly});
  if(index===null)return null;
  const opportunity=state.pending.find(p=>p.id===phoneOpportunityId(candidates[index]));
  if(!opportunity)throw Error('core_nudge_protocol_error');
  return {candidate:candidates[index],opportunity};
}
/** Re-read after the HTTP await. Preserve newer delivery counters and discard removed/expired opportunities. */
export function claimCorePhoneNudge(current:PhoneNudgeState,id:string,now:number):PhoneNudgeState|null {
  if(!current.pending.some(p=>p.id===id&&p.dueAt<=now&&p.expiresAt>now))return null;
  return {...current,pending:current.pending.filter(p=>p.id!==id)};
}

const humanMessages=(messages:readonly NudgeMessage[],now:number)=>messages.flatMap(m=>{
  const atMs=stamp(m.at);return m.role==='user'&&atMs!==null&&atMs<=now?[{atMs,terms:nudgeKeywords(m.content??'')}]:[];
});
export type PhoneScanInput=Parameters<typeof scanPhoneOpportunities>[0];
export function phoneScanMetadata(input:PhoneScanInput) {
  const metadata=nudgeMetadata(input.candidates,input.asides,input.learning);
  return {...metadata,learning:metadata.learning.map((s,i)=>({...s,asideId:input.learning[i].asideId})),
    messages:humanMessages(input.messages,input.now),state:input.state,blocked:input.blocked};
}
/** Comparison includes every decision input. Never commit a result from stale feedback or delivery state. */
export function sameCorePhoneScan(before:PhoneScanInput,after:PhoneScanInput) {
  return JSON.stringify(phoneScanMetadata(before))===JSON.stringify(phoneScanMetadata(after));
}
export async function coreScanPhoneNudges(input:PhoneScanInput):Promise<PhoneNudgeState> {
  
  const r=await request('scan','scan',input.now,phoneScanMetadata(input));
  const ids=new Set([...input.state.seen.map(s=>s.id),...input.candidates.map(phoneOpportunityId)]);
  const candidateIds=new Set(input.candidates.map(phoneOpportunityId));
  if(r?.version!==1||r.op!=='scan'||r.executes!==false||r.scannedAt!==input.now
    ||!Array.isArray(r.pending)||r.pending.length>24||!Array.isArray(r.seen)||r.seen.length>1000
    ||r.pending.some((p:any)=>!p||!candidateIds.has(p.id)||typeof p.topic!=='string'||!Number.isFinite(p.dueAt)||!Number.isSafeInteger(p.expiresAt)||p.dueAt<0||p.dueAt>=p.expiresAt||p.expiresAt<=input.now||p.expiresAt>input.now+172800000)
    ||r.seen.some((s:any)=>!s||!ids.has(s.id)||!Number.isSafeInteger(s.at)||s.at<0||s.at>input.now||input.now-s.at>=604800000)
    ||'deliveries' in r)throw Error('core_nudge_protocol_error');
  return {...input.state,scannedAt:r.scannedAt,pending:r.pending,seen:r.seen};
}

export function feedbackMetadata(asides:readonly Aside[],learning:readonly NudgeSignal[]) {
  return {asides:asides.map(a=>({id:a.id,atMs:stamp(a.at),nudge:isNudgeAside(a),topic:a.nudgeTopic??`legacy:${nudgeFingerprint(a.text)}`,
    terms:a.nudgeKeywords??nudgeKeywords(a.text),kind:a.nudgeKind??null,answered:Boolean(a.answeredAt)})),
    learning:nudgeMetadata([],[],learning).learning.map((s,i)=>({...s,asideId:learning[i].asideId}))};
}
export function sameCoreFeedback(asides:readonly Aside[],learning:readonly NudgeSignal[],currentAsides:readonly Aside[],currentLearning:readonly NudgeSignal[]) {
  // Full adapter state also includes feedback, reached flags and prose: preserve concurrent changes to all fields.
  return JSON.stringify([asides,learning])===JSON.stringify([currentAsides,currentLearning]);
}
async function attributed(op:'rate'|'response',asides:Aside[],learning:NudgeSignal[],now:number,extra:object) {
  const r=await request('feedback',op,now,{...feedbackMetadata(asides,learning),...extra});
  if(r?.version!==1||r.op!==op||r.executes!==false||!(r.index===null||Number.isInteger(r.index)&&r.index>=0&&r.index<asides.length)
    ||![null,'more','less','discussed'].includes(r.choice)||!(r.engagement===null||Number.isFinite(r.engagement)&&r.engagement>=0&&r.engagement<=2)
    ||r.index===null&&(r.choice!==null||r.engagement!==null)
    ||r.index!==null&&(!isNudgeAside(asides[r.index])||op==='response'&&![0,1,2].includes(r.engagement)))throw Error('core_nudge_protocol_error');
  return r;
}
function signalFor(aside:Aside,now:number,choice:NudgePreference|null,engagement:number|null):NudgeSignal {
  return {asideId:aside.id,topic:aside.nudgeTopic??`legacy:${nudgeFingerprint(aside.text)}`,terms:aside.nudgeKeywords??nudgeKeywords(aside.text),kind:aside.nudgeKind,at:new Date(now).toISOString(),
    ...(choice?{choice}:{}),...(engagement!==null?{engagement}:{})};
}
export async function coreRateNudge(asides:Aside[],learning:NudgeSignal[],id:string,choice:NudgePreference|null,now:number) {
  
  const r=await attributed('rate',asides,learning,now,{id,choice});
  if(r.index===null)return null;
  const target=asides[r.index];
  if(target.id!==id||r.choice!==choice)throw Error('core_nudge_protocol_error');
  const aside={...target,nudgeFeedback:choice??undefined},signal=signalFor(target,now,r.choice,r.engagement);
  return {aside,asides:asides.map(a=>a.id===id?aside:a),learning:[...learning.filter(s=>s.asideId!==id),...(r.choice||r.engagement?[signal]:[])].slice(-300)};
}
export async function coreLearnNudgeResponse(asides:Aside[],learning:NudgeSignal[],messages:readonly NudgeMessage[],now:number) {
  
  const message=messages.at(-1);
  if(message?.role!=='user'||!message.content?.trim()||!asides.some(isNudgeAside))return null;
  const preceding=messages.slice(0,-1).filter(m=>m.role==='assistant').at(-1);
  const reply={content:message.content,terms:nudgeKeywords(message.content),named:(typeof message.replyTo==='string'?message.replyTo:message.replyTo?.id)??null,
    precedingExists:Boolean(preceding),precedingAtMs:stamp(preceding?.at)};
  const r=await attributed('response',asides,learning,now,{reply});
  if(r.index===null)return null;
  const target=asides[r.index],signal=signalFor(target,now,r.choice,r.engagement);
  return {asides:asides.map(a=>a.id===target.id?{...a,answeredAt:new Date(now).toISOString(),...(r.choice==='discussed'&&r.engagement===0?{nudgeFeedback:'discussed' as const}:{})}:a),
    learning:[...learning.filter(s=>s.asideId!==target.id),signal].slice(-300)};
}

/** Admission metadata contains no payload, carrier tokens or device identities. */
export type CoreDeliveryInput = {
  kind:'random'|'events'|'system'|'weather'|'followup'; id:string; state:PhoneNudgeState;
  prefs:{enabled:boolean;held:boolean;quietFrom:string;quietTo:string};
  hasDevices:boolean; force:boolean; urgent:boolean; scheduled:boolean; momentBlocked:boolean;
  fromAside:boolean; userAwake:boolean; opportunityRequired:boolean; opportunityPresent:boolean;
  lastReachedAt:number; expiresAt:number|null;
};
export const sameCoreDelivery = (before:CoreDeliveryInput,after:CoreDeliveryInput) => JSON.stringify(before)===JSON.stringify(after);
export async function coreReserveDelivery(input:CoreDeliveryInput,now:number):Promise<{allowed:boolean;state:PhoneNudgeState;id:string|null;reason:string}> {
  
  const r=await request('delivery','reserve',now,input);
  const reasons=['no_devices','preference','quiet','no_opportunity','user_asleep','breather','moment_blocked','expired','duplicate','daily_cap','spacing','deliver','reserved'];
  if(r?.version!==1||r.op!=='reserve'||r.executes!==false||typeof r.allowed!=='boolean'||!reasons.includes(r.reason)
    ||r.allowed!==['deliver','reserved'].includes(r.reason))throw Error('core_nudge_protocol_error');
  if(!r.allowed||r.reason==='deliver') {
    if(r.reservation!==null)throw Error('core_nudge_protocol_error');
    return {allowed:r.allowed,state:input.state,id:null,reason:r.reason};
  }
  const d=r.reservation;
  if(!d||d.id!==input.id||d.at!==now||d.status!=='pending'||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)
    ||!Number.isInteger(d.hour)||d.hour<0||d.hour>23||Object.keys(d).sort().join(',')!=='at,day,hour,id,status'
    ||input.kind!=='random'||input.scheduled||input.force||input.state.deliveries.some(d=>d.id===input.id))throw Error('core_nudge_protocol_error');
  return {allowed:true,state:{...input.state,deliveries:[...input.state.deliveries,d].slice(-300)},id:input.id,reason:r.reason};
}
export async function coreFinishDelivery(state:PhoneNudgeState,id:string,sent:boolean,now:number) {
  
  const target=state.deliveries.find(d=>d.id===id)??null;
  const r=await request('delivery','finish',now,{target,sent});
  if(r?.version!==1||r.op!=='finish'||r.executes!==false||r.allowed!==Boolean(target)||r.reservation!==null
    ||r.reason!==(target?'finished':'missing_reservation')||r.id!==(target?.id??null)||r.at!==(target?.at??null)
    ||r.status!==(target?(sent?'sent':'failed'):null))throw Error('core_nudge_protocol_error');
  return target?{...state,deliveries:state.deliveries.map(d=>d.id===id?{...d,status:r.status}:d)}:state;
}
export type PublicationInput={asleep:boolean;knockedAwake:boolean;interjectionBlocked:boolean;expiresAt:number|null};
/** Re-evaluate admission after the await; publication and accepted callbacks stay synchronous. */
export async function corePublishNudge(draft:NudgeDraft,capture:()=>PublicationInput,publish:(draft:NudgeDraft)=>boolean) {
  
  const before=capture(),r=await request('publication','publication',Date.now(),before);
  if(r?.version!==1||r.op!=='publication'||r.executes!==false||r.reservation!==null||typeof r.allowed!=='boolean'
    ||!['asleep','knocked_awake','interjection_blocked','expired','publish'].includes(r.reason)||r.allowed!==(r.reason==='publish'))throw Error('core_nudge_protocol_error');
  if(!r.allowed||JSON.stringify(before)!==JSON.stringify(capture())||before.expiresAt!==null&&before.expiresAt<=Date.now())return false;
  return publishNudge(draft,publish);
}
