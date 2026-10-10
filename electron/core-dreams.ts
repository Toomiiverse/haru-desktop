/** Supervised dream adapters; Core chooses eligibility, prompts and reservation. */
import {coreStoreFor} from './core-store';
import {corePolicySync} from './core-policy-sync';
import {activeScheduledJob} from './core-scheduler';
import {activeTask} from './task-controller';
import {runCoreContinuation} from './core-day-night';
import {disabledLessons} from './dream-learning';
import {assertOutboundSafe} from './outbound';
import type {ModelEntry} from './model-registry';
import type {ChatMessage} from './provider';

type Deps={root:string;day:string;now:number;entry:ModelEntry;ask:(messages:ChatMessage[],maxTokens:number)=>Promise<string>;idle:()=>boolean;nights?:unknown;memories?:unknown;messages?:unknown;persona?:string};
export async function runCoreDream(domain:'dream-notebook'|'dream-learning',d:Deps){
  const core=coreStoreFor(d.root);if(!core)throw Error('core_dream_storage_required');
  const scope=activeScheduledJob.getStore();if(!scope)throw Error('core_dream_scope_required');
  const assertCurrent=()=>{
    activeTask.getStore()?.signal.throwIfAborted();
    if(JSON.stringify(activeScheduledJob.getStore())!==JSON.stringify(scope))throw Error('core_dream_scope_changed');
    corePolicySync('day-night.assertCurrent',[scope]);
  };
  const read=()=>({scope,day:d.day,now:d.now,entry:d.entry,idle:d.idle(),disabled:[...disabledLessons(d.root)],
    nights:d.nights,memories:d.memories,messages:d.messages,persona:d.persona,
    documents:{config:core.get('config',{}),'dream-notebook':core.get('dream-notebook',null),'dream-learning':core.get('dream-learning',null)}});
  return runCoreContinuation(domain,[],{core,read,assertCurrent,dispatch:async command=>{
    if(command.kind!=='ask'||!Array.isArray(command.messages)||!Number.isSafeInteger(command.maxTokens)||command.maxTokens<=0)throw Error('core_dream_command_protocol');
    assertOutboundSafe(command.messages);
    return d.ask(command.messages,command.maxTokens);
  }});
}
