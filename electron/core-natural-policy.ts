/** Core decisions; the caller supplies its already-accounted provider adapter. */
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import {ToolLoopFailure} from './toolloop';
export function naturalPolicy<T=any>(name:string,args:unknown[]):T{
 const wire=corePolicySync<any>('natural-policy.'+name,JSON.parse(JSON.stringify(args)));
 if(wire?.ok===false)throw Error(wire.error?.message??'core_natural_policy_error');
 if(wire?.ok!==true)throw Error('core_natural_policy_protocol');
 return wire.value as T;
}
export function naturalError(error:any,review?:new(message:string)=>Error):never{
 if(error?.kind==='ToolLoopFailure')throw new ToolLoopFailure(error.code,error.message);
 if(error?.kind==='VoiceReplyNeedsReview'&&review)throw new review(error.message);
 throw Error(error?.message??'core_natural_response_error');
}
export async function naturalProgram(kind:string,args:any,ask:(messages:any[])=>Promise<any>,review?:new(message:string)=>Error){
 let packet=naturalPolicy<any>('start',[kind,args]);let lastValue:any,lastError:unknown;
 for(let i=0;i<3;i++){
  activeTask.getStore()?.signal.throwIfAborted();
  if(Object.hasOwn(packet,'result'))return kind==='natural'?lastValue:packet.result;
  if(packet.error){if(packet.error.source==='provider')throw lastError;if(packet.error.source==='provider-wrapped')throw new Error(packet.error.message,{cause:lastError});naturalError(packet.error,review);}
  if(packet.command?.kind!=='ask'||!Array.isArray(packet.command.messages)||!packet.state)throw Error('core_natural_program_protocol');
  let observed:any;
  try{observed={ok:true,value:lastValue=await ask(packet.command.messages)}}
  catch(error){lastError=error;activeTask.getStore()?.signal.throwIfAborted();observed={ok:false,error:{kind:error instanceof ToolLoopFailure?'ToolLoopFailure':'Error',...(error instanceof ToolLoopFailure?{code:error.code}:{}),message:error instanceof Error?error.message:String(error)}}}
  activeTask.getStore()?.signal.throwIfAborted();
  packet=naturalPolicy<any>('observed',[packet.state,observed]);
 }
 throw Error('core_natural_program_bound');
}
