/** Execute Core device plans with the existing sole native writer. */
import {corePolicySync} from './core-policy-sync';import {randomUUID} from 'node:crypto';import {attachmentCurrent} from './core-attachments';import {commitPerceptionPlan} from './core-screen-policy';
export const devicePolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('device-activity.'+op,args);
export const deviceFlow=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('device-flow.'+op,args);
export function deviceMutation(op:string,args:unknown[],adapter:any){attachmentCurrent();const packet=deviceFlow(op,[...args,adapter.facts()]);commitPerceptionPlan(adapter.core,packet&&Object.hasOwn(packet,'plan')?packet.plan:packet);return packet?.result;}
export function handleCoreHelper(line:string,adapter:any){
 attachmentCurrent();const packet=deviceFlow('helper',[line,{...adapter.facts(),id:randomUUID()}]);commitPerceptionPlan(adapter.core,packet.plan);adapter.update(packet.update);
 for(const command of packet.commands){attachmentCurrent();adapter.execute(command);}
}
export async function reactCoreActivity(activity:any,url:string,adapter:any){
 attachmentCurrent();const packet=deviceFlow('reactionStart',[activity,url,adapter.facts()]);commitPerceptionPlan(adapter.core,packet.plan);
 if(Object.hasOwn(packet,'place'))adapter.place(packet.place);
 if(packet.action==='stop')return;
 if(packet.action==='defer'){adapter.defer(packet.deferred,packet.delayMs);return;}
 adapter.started(activity.kind,packet.place,packet.stamp);
 try{const line=await adapter.quip(packet.request);attachmentCurrent();const result=deviceFlow('reactionResult',[packet.state,line,adapter.facts()]);commitPerceptionPlan(adapter.core,result.plan);adapter.publish(result);}
 finally{adapter.finished();}
}
export async function reactCoreFullscreen(title:string,adapter:any){
 attachmentCurrent();const packet=deviceFlow('fullscreenStart',[title,adapter.facts()]);if(packet.action==='stop')return;if(packet.action==='defer'){adapter.defer(packet.title,packet.delayMs);return;}
 adapter.stamp(packet.stamp);const line=await adapter.quip(packet.request);attachmentCurrent();adapter.publish(deviceFlow('fullscreenResult',[packet.state,line,adapter.facts()]));
}
const memoryAttempts=new Set<string>();
export async function tieCorePlace(said:string,replied:string,provider:any,adapter:any){
 const facts=()=>({...adapter.facts(),liveMemoryAttempts:[...memoryAttempts]});attachmentCurrent();const packet=deviceFlow('tieStart',[said,replied,provider,{...facts(),id:randomUUID()}]);commitPerceptionPlan(adapter.core,packet.plan);if(packet.action==='stop')return;
 memoryAttempts.add(packet.state.attempt);
 try{let observation:any;
  try{observation={ok:true,text:await adapter.quip(packet.request)};}catch(error){observation={ok:false};}
  attachmentCurrent();const ready=deviceFlow('tieResult',[packet.state,observation,facts()]);commitPerceptionPlan(adapter.core,ready.plan);if(ready.action==='stop')return;
  let receipt:any;try{receipt={result:adapter.remember(ready)};}catch(error){receipt={unknown:true};}
  attachmentCurrent();const plan=deviceFlow('tieReceipt',[packet.state,receipt,facts()]);commitPerceptionPlan(adapter.core,plan);
 }finally{memoryAttempts.delete(packet.state.attempt);}
}
