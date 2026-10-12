/** Supervised attachment adapters. Core owns admission, caching and each next step. */
import {randomUUID} from 'node:crypto';
import {statSync} from 'node:fs';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {Attachment} from './attachments';
import type {VisionConfig} from './vision';
export const attachmentPolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('attachments.'+op,args);
export const attachmentCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();
export function attachmentFileSource(file:string){
 const s=statSync(file,{bigint:true});return {file,dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs)};
}
export function attachmentURLFacts(endpoints:string[],addresses:string[]){
 const urls:Record<string,unknown>={};for(const endpoint of endpoints){try{const u=new URL(endpoint);urls[endpoint]={hostname:u.hostname,href:u.href};}catch{urls[endpoint]={};}}
 return {urls,addresses};
}
let cache:Record<string,unknown>={};let known:Record<string,boolean>={};
const running=new Map<string,Promise<string>>();
export async function attachmentCapability(config:any,facts:any,probe:(command:any)=>Promise<any>){
 attachmentCurrent();const command=attachmentPolicy('capability',[config,known,facts]);
 if(command.action==='return')return command.value;
 let observation;try{observation=await probe(command);}catch{observation={available:false,vision:null};}
 attachmentCurrent();const result=attachmentPolicy('capabilityResult',[known,command,observation]);known=result.known;return result.value;
}
export type AttachmentAdapter={
 facts:()=>any;source:(attachment:Attachment)=>unknown;hasTools:()=>boolean;
 pdf:(file:string)=>Promise<any>;text:(file:string)=>string;image:(file:string)=>string;
 eyes:(vision:VisionConfig,provider:any)=>Promise<any>;look:(images:string|string[],command:any)=>Promise<any>;
 frames:(file:string)=>Promise<string[]>;readFrame:(file:string)=>string;audio:(file:string,seconds:number)=>Promise<string>;
 transcribe:(file:string)=>Promise<string>;waiting:(line:string)=>void;discard:(files:string[])=>void;
};
function assertSource(a:Attachment,adapter:AttachmentAdapter,source:unknown){
 attachmentCurrent();if(JSON.stringify(adapter.source(a))!==JSON.stringify(source))throw Error('attachment_source_changed');
}
export async function openCoreAttachment(a:Attachment,v:VisionConfig,provider:any,adapter:AttachmentAdapter):Promise<string>{
 const source=adapter.source(a);assertSource(a,adapter,source);const temporary:string[]=[];let frames:string[]=[],wav='';
 let packet=attachmentPolicy('openStart',[a,v,provider,adapter.facts(),adapter.hasTools(),Math.random()]);
 try{
  for(;;){
   assertSource(a,adapter,source);if(packet.error)throw Error(packet.error);if(Object.hasOwn(packet,'result'))return packet.result;
   const command=packet.command;let observation:any;
   switch(command.kind){
    case 'pdf':observation=await adapter.pdf(a.saved);break;
    case 'text':observation={text:adapter.text(a.saved)};break;
    case 'image':{const eyes=await adapter.eyes(v,provider);assertSource(a,adapter,source);observation=await adapter.look(adapter.image(a.saved),{...eyes,options:{...command.options,numCtx:eyes.numCtx}});break;}
    case 'wait':adapter.waiting(command.line);observation={};break;
    case 'frames':frames=await adapter.frames(a.saved);temporary.push(...frames);observation={count:frames.length};break;
    case 'video-look':observation=await adapter.look(frames.map(adapter.readFrame),command);break;
    case 'audio':wav=await adapter.audio(a.saved,command.seconds);temporary.push(wav);observation={};break;
    case 'transcribe':try{observation={ok:true,text:await adapter.transcribe(wav)};}catch(error){attachmentCurrent();observation={ok:false};}break;
    default:throw Error('core_attachment_command_invalid');
   }
   assertSource(a,adapter,source);packet=attachmentPolicy('openNext',[packet.state,observation]);
  }
 }finally{adapter.discard(temporary);}
}
export async function readCoreAttachment(a:Attachment,v:VisionConfig,provider:any,adapter:AttachmentAdapter):Promise<string>{
 attachmentCurrent();const source=adapter.source(a),packet=attachmentPolicy('cacheBegin',[cache,a,source,Date.now(),randomUUID(),[...running.keys()]]);
 if(packet.action==='return')return packet.value;
 if(packet.action==='join'){const held=running.get(packet.id);if(!held)throw Error('attachment_read_owner_unknown');return held;}
 cache=packet.state;
 const work=(async()=>{
  let observation:any,error:unknown;
  try{observation={ok:true,value:await openCoreAttachment(a,v,provider,adapter)};}catch(e){error=e;observation={ok:false,cancelled:Boolean(activeTask.getStore()?.signal.aborted)};}
  let currentSource:unknown=null;try{currentSource=adapter.source(a);}catch{}
  const result=attachmentPolicy('cacheEnd',[cache,packet.ticket,currentSource,Date.now(),observation]);cache=result.state;
  attachmentCurrent();if(result.error)throw Error(result.error);if(error)throw error;return result.value;
 })();running.set(packet.ticket.id,work);
 try{return await work;}finally{running.delete(packet.ticket.id);}
}
export async function foldCoreAttachments(messages:any[],inPlay:Map<number,Attachment[]>,sees:boolean,read:(a:Attachment)=>Promise<string>,image:(file:string)=>string){
 const plans=attachmentPolicy('fold',[messages,[...inPlay],sees]),out=[...messages];
 for(const plan of plans){const opened:any[]=[],images:string[]=[];
  for(const file of plan.files){attachmentCurrent();const attachment=file.attachment;
   try{if(file.action==='image'){images.push(image(attachment.saved));opened.push({attachment});}else opened.push({attachment,readable:await read(attachment)});}
   catch(error){attachmentCurrent();opened.push({attachment,readable:''});}
  }
  attachmentCurrent();out[plan.index]=attachmentPolicy('folded',[messages[plan.index],opened,images]);
 }
 return out;
}
