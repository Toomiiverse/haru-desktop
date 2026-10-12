/** Core selects agenda state and Google effects. This adapter executes exact plans. */
import {randomUUID} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {CoreStore} from './core-store';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const current=()=>activeTask.getStore()?.signal.throwIfAborted();
export const agendaFacts=(core:CoreStore)=>({config:core.get('config',{}),memory:core.get('memories',{})});
export const agendaClock=(now:Date)=>({year:now.getFullYear(),month:now.getMonth()+1,day:now.getDate(),hour:now.getHours(),minute:now.getMinutes(),second:now.getSeconds(),millisecond:now.getMilliseconds()});
export function applyAgendaPlan(core:CoreStore,packet:any,changed?:(packet:any)=>void){
 const p=packet?.plan;if(!p)return packet?.result;
 core.transaction(()=>{current();if(!same(core.get('config',{}),p.expectedConfig))throw Error('core_agenda_config_stale');
  if(Object.hasOwn(p,'expectedMemory')&&!same(core.get('memories',{}),p.expectedMemory))throw Error('core_agenda_memory_stale');
  core.set('config',p.config);if(Object.hasOwn(p,'memory'))core.set('memories',p.memory);
 });
 // Observers run only after the native commit is confirmed. No callback means
 // no invented commit receipt after timeout/lost reply.
 changed?.(packet);return packet.result;
}
export function mutateAgenda(core:CoreStore,kind:string,args:unknown,changed?:(packet:any)=>void){current();return applyAgendaPlan(core,corePolicySync('agenda-life.mutate',[agendaFacts(core),kind,args,new Date().toISOString(),randomUUID()]),changed);}
export function agendaProgram(core:CoreStore,op:string,args:unknown[],changed?:(packet:any)=>void){current();return applyAgendaPlan(core,corePolicySync(op,[agendaFacts(core),...args]),changed);}
export type GoogleObservation={status?:number;data?:Record<string,unknown>;text?:string;error?:string;dispatched:boolean};
export async function syncAgendaGoogle(adapter:{core:CoreStore;today:string;zone:string;execute:(command:any,beforeSend:()=>void)=>Promise<GoogleObservation>;changed?:(packet:any)=>void}){
 current();let packet=corePolicySync<any>('agenda-google.start',[agendaFacts(adapter.core),adapter.today,adapter.zone,new Date().toISOString()]);
 applyAgendaPlan(adapter.core,packet,adapter.changed);let state=packet.state;
 for(;;){
  current();packet=corePolicySync<any>('agenda-google.claim',[agendaFacts(adapter.core),state,new Date().toISOString()]);applyAgendaPlan(adapter.core,packet,adapter.changed);state=packet.state;
  if(packet.done){if(packet.error)throw Error(packet.error);return packet.result;}
  for(let command=packet.command;command;){
   current();
   // Revalidate the exact durable command immediately before any resource HTTP
   // request. Node never chooses a different method, target or retry.
   const permission=corePolicySync<any>('agenda-google.dispatch',[agendaFacts(adapter.core),state,command]);
   if(!permission.allowed)throw Error(permission.reason);
   const observation=await adapter.execute(command,()=>{current();const checked=corePolicySync<any>('agenda-google.dispatch',[agendaFacts(adapter.core),state,command]);if(!checked.allowed)throw Error(checked.reason);});
   current();packet=corePolicySync<any>('agenda-google.observed',[agendaFacts(adapter.core),state,command,observation,new Date().toISOString()]);
   // Commit uncertainty escapes; it must not be turned into a Google failure.
   applyAgendaPlan(adapter.core,packet,adapter.changed);state=packet.state;command=packet.command;
  }
 }
}
