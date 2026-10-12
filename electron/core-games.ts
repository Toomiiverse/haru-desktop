import {corePolicySync} from './core-policy-sync';import type {CoreStore} from './core-store';import {commitPerceptionPlan} from './core-screen-policy';import {attachmentCurrent} from './core-attachments';
export const gamePolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('games.'+op,args);
export function openCoreGame(core:CoreStore,name:string,seed:string[],at:string){const key=gamePolicy<string>('key',[name]),packet=gamePolicy('open',[name,seed,at,core.get(key,'')]);commitPerceptionPlan(core,packet.plan);return packet.result;}
export function noteCoreGameMemory(core:CoreStore,name:string,line:string,at:string){const key=gamePolicy<string>('key',[name]),plan=gamePolicy('note',[name,line,at,core.get(key,'')]);commitPerceptionPlan(core,plan);return plan.text;}
export async function bootCoreGame(name:string,adapter:any){attachmentCurrent();const facts=adapter.facts(),command=gamePolicy('boot',[name,facts.current,facts.last,facts.now,facts.nights]);adapter.stamp(command.stamp);if(command.action==='stop')return;
 const opened=openCoreGame(adapter.core,name,command.seed,new Date().toISOString());adapter.opened({name,memory:opened.text});const quip=gamePolicy('quip',[name,opened,facts.provider,facts.refusal,facts.following,facts.today,facts.context]);if(!quip)return;
 const line=await adapter.quip(quip);attachmentCurrent();const current=adapter.facts();if(current.current?.name!==name)throw Error('game_boot_superseded');const publication=gamePolicy('publication',[name,line]);if(publication.publish)adapter.publish(publication,quip.provider);
}
