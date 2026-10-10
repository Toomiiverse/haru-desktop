import {routePolicy,observedRequest} from './core-route-admission';
// Core owns deterministic intent and ranking; working capability/privacy/price
// adapters still prepare admissible candidates, and dispatch rechecks them.
import {markTurn} from './turn-timing';
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import {eligibleModels,type ModelEntry,type ModelRole,type RouteRequest,type ProviderConfig} from './model-registry';
import {isAllowedTaskProvider,isDirectProvider} from './direct-providers';
import {assertOutboundSafe} from './outbound';
import {taskIntent,selectTaskModel,nextTaskRole,routingTextHistory,type TaskInputs,type TaskIntent} from './task-router';
import {selectFastConversationModel,NATURAL_MAX_TOKENS} from './natural-conversation';
const ROLES=new Set(['everyday','conversation','local-perception','affordable-cloud','specialist','complex','premium']);
function client(){const options=coreServiceOptions();if(!options)throw Error('core_router_requires_service');return new CoreServiceClient(options);}
export async function coreTaskIntent(message:string,inputs:TaskInputs={}):Promise<TaskIntent>{
  if(process.env.HARU_CORE_ROUTER!=='on')return taskIntent(message,inputs);
  const started=performance.now();
  const result=await client().route({version:1,op:'intent',message,pictures:!!inputs.pictures,files:!!inputs.files,
    perception:!!inputs.perception,min_words:inputs.minWords??25,history:routingTextHistory((inputs.history??[]).map(row=>({role:row.role,content:row.content??''})))});
  if(!ROLES.has(result.role)||typeof result.reason!=='string'||result.reason.length>256)throw Error('core_router_protocol_error');
  console.log('[core-router] '+JSON.stringify({event:'intent',role:result.role,reason:result.reason,totalMs:performance.now()-started}));
  return {role:result.role,reason:result.reason};
}
// Her sleep preference, schedule and the Perth clock, read from the store by main and
// reported to Core with every conversation route: Core decides whether it is her night.
let nightFacts:()=>unknown=()=>null;
export function provideNightFacts(read:()=>unknown){nightFacts=read;}
export function coreRouteCandidates(entries:readonly ModelEntry[],role:ModelRole,request:RouteRequest){
  let cloudAllowed=request.cloudAllowed;
  if(cloudAllowed){try{assertOutboundSafe(request.conversation??[],request.toolSchema);}catch{cloudAllowed=false;}}
  if(process.env.HARU_CORE_ROUTE_ADMISSION==='on'){
    // Core supplies the scope before adapters inspect credentials/cooldowns.
    // Indices refer to this exact snapshot; malformed references fail closed.
    const night=nightFacts();
    const indices=routePolicy<number[]>('candidateScope',[entries,role,night]);
    if(!Array.isArray(indices)||indices.some((n,i)=>!Number.isInteger(n)||n<0||n>=entries.length||(i>0&&n<=indices[i-1])))throw Error('core_router_protocol_error');
    const scoped=indices.map(n=>entries[n]);
    return routePolicy<{entry:ModelEntry;candidate:{id:string;role:ModelRole;cost_micros:number;tie_order:number;attempts?:number;successes?:number}}[]>('candidates',[scoped,role,observedRequest(scoped,{...request,cloudAllowed}),night]);
  }
  const permitted=entries.filter(entry=>(entry.local||isAllowedTaskProvider(entry.config))
    &&(entry.role===role||(role==='specialist'&&entry.role==='complex')));
  const eligible=eligibleModels(permitted,{...request,cloudAllowed}).sort((a,b)=>a.entry.id.localeCompare(b.entry.id));
  return eligible.map(({entry,costMicros},tie_order)=>({entry,candidate:{id:entry.id,role:entry.role,cost_micros:costMicros,tie_order,
    ...(entry.observed?{attempts:entry.observed.attempts,successes:entry.observed.successes}:{})}}));
}
export async function coreSelectTaskModel(entries:readonly ModelEntry[],role:ModelRole,request:RouteRequest):Promise<ModelEntry|undefined>{
  if(process.env.HARU_CORE_ROUTER!=='on')return selectTaskModel(entries,role,request);
  const started=performance.now(),offered=coreRouteCandidates(entries,role,request);
  markTurn('routing_candidates',{candidates:offered.length});
 const result=await client().route({version:1,op:'select',role,candidates:offered.map(row=>row.candidate)});
  if(!['eligible_role','specialist_substitute','unavailable'].includes(result.reason))throw Error('core_router_protocol_error');
  const chosen=offered.find(row=>row.entry.id===result.candidate_id)?.entry;
  if(result.candidate_id!==null&&!chosen||result.candidate_id===null&&result.reason!=='unavailable'
    ||chosen&&(result.reason==='unavailable'||chosen.role!==role&&!(role==='specialist'&&chosen.role==='complex')))throw Error('core_router_protocol_error');
  console.log('[core-router] '+JSON.stringify({event:'selection',role,candidateId:chosen?.id??null,model:chosen?.config.model??null,
    reason:result.reason,totalMs:performance.now()-started}));
  return chosen;
}

export async function coreFastConversationModel(entries:readonly ModelEntry[],setting:unknown,request:RouteRequest):Promise<ModelEntry|undefined>{
  if(process.env.HARU_CORE_ROUTER!=='on')return selectFastConversationModel(entries,setting,request);
  if(process.env.HARU_CORE_ROUTE_ADMISSION==='on'){
    const selected=routePolicy<ModelEntry|null>('fast',[entries,setting,nightFacts()]);
    if(!selected)return;
    return coreSelectTaskModel([selected],'conversation',{...request,maxOutputTokens:request.maxOutputTokens??NATURAL_MAX_TOKENS,tools:false,toolSchema:[]});
  }
  if(!setting||typeof setting!=='object')return;
  const configured=setting as Partial<ProviderConfig>&{enabled?:boolean};if(configured.enabled!==true)return;
  const match=entries.find(entry=>entry.config.model===configured.model&&entry.config.provider===configured.provider&&entry.config.endpoint===configured.endpoint);
  if(!match||!isDirectProvider(match.config))return;
  return coreSelectTaskModel([{...match,role:'conversation'}],'conversation',{...request,maxOutputTokens:request.maxOutputTokens??NATURAL_MAX_TOKENS,tools:false,toolSchema:[]});
}

export async function coreNextTaskRole(current:ModelRole,intent:TaskIntent,fastToConversation=false):Promise<ModelRole|undefined>{
  if(process.env.HARU_CORE_ROUTER!=='on')return fastToConversation?'conversation':nextTaskRole(current,intent);
  const started=performance.now();
  const result=await client().route({version:1,op:'next-role',current_role:current,intent_role:intent.role,fast_to_conversation:fastToConversation});
  if(result.role!==null&&!ROLES.has(result.role))throw Error('core_router_protocol_error');
  console.log('[core-router] '+JSON.stringify({event:'next-role',current,intent:intent.role,role:result.role,totalMs:performance.now()-started}));
  return result.role??undefined;
}

// Preparation hint only. Native harness independently checks the ledger request
// and actual fresh images before selecting a tool-free visual composition.
export async function coreInputProfile(request:string,freshImages:boolean):Promise<'normal'|'grounded-perception'>{
  if(process.env.HARU_CORE_INPUT_PROFILES!=='on'||process.env.HARU_CORE_ROUTER!=='on'
    ||process.env.HARU_CORE_HARNESS!=='on'||process.env.HARU_CORE_VISUAL_PROFILES!=='on'
    ||process.env.HARU_CORE_HARNESS_PATH_PREFIX||!freshImages)return 'normal';
  const started=performance.now();
  let result;
  try{result=await client().route({version:1,op:'input-profile',request,fresh_images:freshImages});}
  catch{console.log('[core-router] '+JSON.stringify({event:'input-profile',profile:'normal',reason:'hint_unavailable',totalMs:performance.now()-started}));return 'normal';}
  if(result.version!==1||result.op!=='input-profile'
    ||!['normal','grounded-perception'].includes(result.profile)
    ||result.reason!==(result.profile==='normal'?'normal_planning':'literal_fresh_image'))throw Error('core_router_protocol_error');
  console.log('[core-router] '+JSON.stringify({event:'input-profile',profile:result.profile,totalMs:performance.now()-started}));
  return result.profile;
}
