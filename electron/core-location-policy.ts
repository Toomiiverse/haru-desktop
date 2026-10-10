import {corePolicySync} from './core-policy-sync';import {attachmentCurrent} from './core-attachments';import {commitPerceptionPlan} from './core-screen-policy';
export const locationPolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('location.'+op,args);
export const toldPolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('told.'+op,args);
export const locationFlow=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('location-flow.'+op,args);
export function locationClock(value:any,clock:(ms:number)=>string){const at=Date.parse(value?.at);return Number.isFinite(at)?clock(at):'';}
export function applyCoreLocation(op:string,args:unknown[],adapter:any){attachmentCurrent();const packet=locationFlow(op,[...args,adapter.facts()]);if(packet.error)throw Error(packet.error);commitPerceptionPlan(adapter.core,packet.plan);if(packet.mood)adapter.moodChanged(packet.mood);return packet.result;}
