/** Supervised settings/deed adapters. Core decisions never substitute for grants. */
import {corePolicySync} from './core-policy-sync';
import {commitDayNightPlan} from './core-day-night';
import {coreStoreFor,type CoreStore} from './core-store';
import {activeTask} from './task-controller';
import type {SettingPlan} from './self';
export function remainingStore(root:string):CoreStore{
  const core=coreStoreFor(root);if(!core)throw Error('core_remaining_storage_required');return core;
}
export function applyRemainingPlan(core:CoreStore,plan:unknown){
  activeTask.getStore()?.signal.throwIfAborted();
  commitDayNightPlan(core,plan,()=>activeTask.getStore()?.signal.throwIfAborted());
}
export async function runCoreSettingTool(args:Record<string,unknown>,readConfig:()=>unknown,deps:{hostedModels:(route:'conversation'|'nudge'|'config')=>Promise<string[]|null>;changeMySetting:(plan:SettingPlan)=>Promise<{ok:boolean;note:string}>}){
  let packet=corePolicySync<any>('self.toolStart',[args,readConfig()]);
  for(let count=0;count<3;count++){
    if(Object.hasOwn(packet,'result'))return packet.result;
    activeTask.getStore()?.signal.throwIfAborted();
    if(packet.command?.kind==='models'){
      const route=packet.command.route;if(!['conversation','nudge','config'].includes(route))throw Error('core_setting_route_protocol');
      const models=await deps.hostedModels(route);
      activeTask.getStore()?.signal.throwIfAborted();
      packet=corePolicySync('self.toolObserved',[packet.state,{ok:true,value:models},readConfig()]);
    }else if(packet.command?.kind==='change'){
      // Unknown effects propagate. They cannot become a retry continuation.
      const done=await deps.changeMySetting(packet.command.plan);
      activeTask.getStore()?.signal.throwIfAborted();
      return corePolicySync('self.toolCompleted',[packet.state,done]);
    }else throw Error('core_setting_command_protocol');
  }
  throw Error('core_setting_continuation_bound');
}
