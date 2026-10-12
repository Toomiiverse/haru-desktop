import {corePolicySync} from './core-policy-sync';
import {handsTaskRPC} from './core-hands-context';
// Own-time policy and rounds belong to Core; working local provider/device
// adapters retain their prompts, availability checks and deed persistence.
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import {whyNotAct,HANDS_TURN,type Moment} from './herhands';
import {TaskController} from './task-controller';
import {isLocalConfig,type ModelEntry,type TaskPolicy,type ProviderConfig} from './model-registry';
import {runToolLoop,splitOutcome,type ToolLoopDeps} from './toolloop';
import type {ChatMessage} from './provider';
import {makeToolReceipt,type ToolReceipt} from './tool-receipt';
import type {ToolCall} from './provider';
import type {TaskRPC} from './task-bridge';
export async function coreHandsWhyNotAct(moment:Moment):Promise<string|null>{
  if(process.env.HARU_CORE_AUTONOMOUS_HANDS!=='on')return whyNotAct(moment);
  const options=coreServiceOptions();
  if(!options||process.env.HARU_CORE_HARNESS!=='on'||process.env.HARU_CORE_HARNESS_PATH_PREFIX)return 'core own-time attention unavailable';
  try{
    const result=await new CoreServiceClient(options).attention({version:1,op:'autonomous-hands',moment});
    if(typeof result.allowed!=='boolean'||!(result.reason===null||typeof result.reason==='string'&&result.reason.length<=200)
      ||result.allowed!==(result.reason===null))throw Error('core_attention_protocol_error');
    console.log('[core-hands] '+JSON.stringify({event:'attention',allowed:result.allowed,reason:result.reason}));
    return result.reason;
  }catch{return 'core own-time attention unavailable';} // Never start actions on an uncertain gate.
}
export function ownTimeReceipt(call:ToolCall,output:string|ToolReceipt):ToolReceipt {
  if(typeof output!=='string')return output;
  const name=call.function?.name??'unknown',receipt=makeToolReceipt(name,call.function?.arguments,output,Date.now(),Date.now());
  const data=receipt.data as Record<string,unknown>;
  if(!data||typeof data!=='object'||Array.isArray(data)||receipt.outcome==='failed'||'receiptVersion' in data)return receipt;
  if(['unknown','pending','queued','accepted','scheduled','confirm','restarting','timedOut','cancelled','canceled'].some(key=>data[key]===true)
    ||['pending','unknown','running','queued','confirmation_required'].includes(String(data.outcome??data.status??data.state??'')))return receipt;
  return receipt;
}
export async function runCoreHands(conversation:ChatMessage[],config:ProviderConfig,deps:ToolLoopDeps,
  authority:{rpc:TaskRPC;registry:ModelEntry[];policy:TaskPolicy}){
  if(process.env.HARU_CORE_QUICK_HANDS==='on'&&process.env.HARU_CORE_AUTONOMOUS_HANDS!=='on')throw Error('hands_native_harness_required');
  if(process.env.HARU_CORE_AUTONOMOUS_HANDS!=='on')return runToolLoop(conversation,deps);
  if(!isLocalConfig(config))throw Error('autonomous_hands_local_only');
  if(process.env.HARU_CORE_HARNESS!=='on'||process.env.HARU_CORE_HARNESS_PATH_PREFIX||!coreServiceOptions())throw Error('autonomous_hands_requires_core');
  // Preserve the existing bounded local-only activity budget.
  const limits=process.env.HARU_CORE_QUICK_HANDS==='on'?corePolicySync<any>('hands.limits',[authority.policy]):{
    policy:{...authority.policy,taskBudgetMicros:0,dailyBudgetMicros:0,maxToolCalls:1,maxEscalations:0,deadlineMs:900000},request:HANDS_TURN,maxRounds:3,maxToolCalls:1};
  const task=new TaskController(handsTaskRPC(authority.rpc),authority.registry,limits.policy,false);
  await task.start(limits.request,config.model,'background');
  const result=await task.loop(conversation,{...deps,runTool:async call=>ownTimeReceipt(call,splitOutcome(await deps.runTool(call)).words),maxRounds:limits.maxRounds,maxToolCalls:limits.maxToolCalls});
  console.log('[core-hands] '+JSON.stringify({event:'returned',rounds:result.rounds,toolCount:result.ran.size,localOnly:true}));
  return result;
}
