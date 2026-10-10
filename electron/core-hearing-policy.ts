import {corePolicySync} from './core-policy-sync';import {attachmentCurrent} from './core-attachments';import {commitPerceptionPlan} from './core-screen-policy';
export const hearingPolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('hearing.'+op,args);
export function applyCoreHearing(op:string,args:unknown[],core:any){attachmentCurrent();const packet=hearingPolicy('flow',[op,args,{config:core.get('config',{}),at:new Date().toISOString()}]);commitPerceptionPlan(core,packet.plan);return packet.result;}
