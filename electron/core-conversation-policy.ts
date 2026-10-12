/** Bounded Core continuation; only registered model transport and native commits. */
import {corePolicySync} from './core-policy-sync';
import {remainingStore,applyRemainingPlan} from './core-remaining';
import {activeTask} from './task-controller';
export function conversationCommit(root:string,packet:any){
  activeTask.getStore()?.signal.throwIfAborted();
  if(packet.plan)applyRemainingPlan(remainingStore(root),packet.plan);
}
export async function conversationProgram(kind:string,args:any,read:()=>any,execute:(command:any)=>Promise<any>){
  activeTask.getStore()?.signal.throwIfAborted();
  let packet=corePolicySync<any>('conversation-program.start',[kind,args,read()]);
  for(let step=0;step<12;step++){
    if(Object.hasOwn(packet,'result'))return packet.result;
    if(packet.error)throw Error(packet.error);
    if(!['model','random'].includes(packet.command?.kind)||!packet.state)throw Error('core_conversation_command_protocol');
    activeTask.getStore()?.signal.throwIfAborted();
    let observation:any;
    try{observation={ok:true,value:await execute(packet.command)};}
    catch(error){activeTask.getStore()?.signal.throwIfAborted();observation={ok:false,error:error instanceof Error?error.message:String(error)};}
    activeTask.getStore()?.signal.throwIfAborted();
    packet=corePolicySync<any>('conversation-program.observed',[packet.state,observation,read()]);
  }
  throw Error('core_conversation_continuation_bound');
}
