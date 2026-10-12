/** Core plans local perception; native adapters capture, execute and commit once. */
import {createHash} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';
import {attachmentCurrent} from './core-attachments';
import type {CoreStore} from './core-store';
export const screenPolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('screen.'+op,args);
export function commitPerceptionPlan(core:CoreStore,plan:any){
 if(!plan)return;
 core.transaction(()=>{attachmentCurrent();for(const [key,expected] of Object.entries(plan.expected)){if(!core.sameDoc(key,expected,key==='activity'?{}:''))throw Error('core_perception_document_stale');}for(const [key,value] of Object.entries(plan.changes))core.set(key,value);});
}
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export type ScreenAdapter={core:CoreStore;facts:()=>any;update:(values:any)=>void;capture:(options:any)=>Promise<Buffer|null>;read:(file:string)=>Buffer;settle:(file:string)=>Promise<boolean>;look:(bytes:Buffer,request:any)=>Promise<{description:string}>;quip:(request:any)=>Promise<string>;publish:(line:string,options:any,provider:any)=>void;game:()=>any;gameUpdated:(text:string)=>void;deferred:(error:unknown)=>boolean;retry:(shot:any,delay:number)=>void;pending:()=>unknown};
export async function runCoreScreen(kind:'glance'|'screenshot',adapter:ScreenAdapter,shot?:{path:string;at:number}){
 attachmentCurrent();const first=screenPolicy('start',[kind,adapter.facts()]);if(first.action==='stop')return;
 if(kind==='glance')adapter.update({lastLookAt:first.stamp});
 try{
  let bytes:Buffer|null;
  if(first.action==='capture')bytes=await adapter.capture(first.capture);
  else{if(!shot||!await adapter.settle(shot.path))return;bytes=adapter.read(shot.path);}
  attachmentCurrent();const source=bytes?hash(bytes):null,prepared=screenPolicy('prepare',[first.state,adapter.facts(),source]);if(prepared.action==='stop')return;
  if(!bytes)throw Error('core_screen_bytes_missing');
  const seen=await adapter.look(bytes,prepared.request);attachmentCurrent();
  const facts=adapter.facts(),currentSource=shot?hash(adapter.read(shot.path)):source;
  const observed=screenPolicy('observed',[prepared.state,facts,currentSource,seen.description]);
  if(kind==='screenshot')commitPerceptionPlan(adapter.core,screenPolicy('descriptionPlan',[adapter.core.get('activity',{}),facts.day,facts.name,seen.description,facts.logEnabled]));
  adapter.update(observed.update);if(observed.action==='stop')return;
  const raw=await adapter.quip(screenPolicy('compose',[observed.state,adapter.facts()]));attachmentCurrent();
  // A request may finish after the active model/configuration changed.
  screenPolicy('assertCurrent',[observed.state,adapter.facts(),shot?hash(adapter.read(shot.path)):currentSource]);
  const line=screenPolicy<string>('line',[kind,raw]),publication=screenPolicy('publication',[observed.state,line]);
  if(!publication.publish)return;
  const game=adapter.game();if(publication.remember&&game){const key=screenPolicy<string>('gameKey',[game.name]),plan=screenPolicy('gameNote',[game.name,publication.memoryLine,new Date().toISOString(),adapter.core.get(key,'')]);commitPerceptionPlan(adapter.core,plan);adapter.gameUpdated(plan.text);}
  adapter.publish(publication.line,publication.options,observed.state.provider);
 }catch(error){
  attachmentCurrent();if(!adapter.deferred(error))throw error;
  if(kind==='glance')adapter.update({lastLookAt:0});else{const command=screenPolicy('deferred',[adapter.pending(),shot]);if(command.retry)adapter.retry(command.shot,command.delayMs);}
 }
}
