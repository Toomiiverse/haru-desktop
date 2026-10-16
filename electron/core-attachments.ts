import {AsyncLocalStorage} from 'node:async_hooks';
/** Supervised attachment adapters. Core owns admission, caching and each next step. */
import {randomUUID} from 'node:crypto';
import {statSync} from 'node:fs';
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {Attachment} from './attachments';
import type {VisionConfig} from './vision';
import {explicitlyLocalOnly,mayLeaveTheMachine} from './sensitivity';
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
 frames:(file:string)=>Promise<string[]>;readFrame:(file:string)=>string;pdfPages:(file:string,count:number)=>Promise<string[]>;audio:(file:string,seconds:number)=>Promise<string>;
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
    case 'pdf-pages':frames=await adapter.pdfPages(a.saved,command.count);temporary.push(...frames);observation={count:frames.length};break;   // 4110: scanned pages, read like video frames
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
/** 3820: a picture reading goes to the chat model as the user's own text, so one that names a secret or asks to stay local
 *  would block the whole turn; the picture itself goes instead (images are outside the text scanner), as before 3820. */
export const readingUsable=(text:string)=>Boolean(text.trim())&&!explicitlyLocalOnly(text)&&mayLeaveTheMachine(text,false,{namesAlone:true}).safe;
/** 4130: where a "give me a sec" line goes during a phone turn: into her reply bubble, cleared (\uFFFD) when the real answer starts.
 *  The phone already treats \uFFFD as "that round was thrown away", so it needs no change. */
export const waitSink=new AsyncLocalStorage<(line:string)=>void>();
export function withWaitLine(onChunk:(chunk:string)=>void,onSentence?:(sentence:string,emotion:string)=>void){
 let shown=false;
 return {onChunk:(chunk:string)=>{if(shown&&chunk!=='\uFFFD'&&chunk){shown=false;onChunk('\uFFFD');}onChunk(chunk);},
  sink:(line:string)=>{shown=true;onChunk(line);onSentence?.(line,'neutral');}};
}
/** 4100: how long a call turn waits for a picture it has not read yet; a cached reading returns well inside this. */
const CALL_READ_MS=300;
export async function foldCoreAttachments(messages:any[],inPlay:Map<number,Attachment[]>,sees:boolean,read:(a:Attachment)=>Promise<string>,image:(file:string)=>string,call=false){
 const plans=attachmentPolicy('fold',[messages,[...inPlay],sees]),out=[...messages];
 // 3820: every file is read at once (a hosted picture read is 1.3-3.3 s; a message carries up to 6)
 await Promise.all(plans.map(async(plan:any)=>{
  const files=await Promise.all(plan.files.map(async(file:any)=>{attachmentCurrent();const attachment=file.attachment;
   try{
    if(file.action==='image')return {opened:{attachment},image:image(attachment.saved)};
    let readable='';
    if(call&&file.fallback==='image'){   // 4100: a call does not wait seconds for a picture; the read carries on outside the turn and is cached for her next reply
     const reading=activeTask.exit(()=>read(attachment));reading.catch(()=>{});
     const early=await Promise.race([reading,new Promise<null>(done=>setTimeout(()=>done(null),CALL_READ_MS))]).catch(()=>'');
     attachmentCurrent();
     if(early===null)return {opened:{attachment,readable:'',pending:true}};
     readable=early;
    } else try{readable=await read(attachment);}catch(error){attachmentCurrent();}
    if(file.fallback==='image'&&!readingUsable(readable)){console.log(`[attach] picture sent as image — ${readable.trim()?'the reading cannot leave as text':'no reading'}`);return {opened:{attachment},image:image(attachment.saved)};}
    return {opened:{attachment,readable}};
   }catch(error){attachmentCurrent();return {opened:{attachment,readable:''}};}
  }));
  // 4100: the picture bytes are added here, not sent through the policy call (2 MiB wire cap: one 1.6 MB picture or a few phone photos broke the turn)
  attachmentCurrent();const images=files.flatMap(f=>f.image===undefined?[]:[f.image]),folded=attachmentPolicy<any>('folded',[messages[plan.index],files.map(f=>f.opened),[]]);
  out[plan.index]=images.length?{...folded,images}:folded;
 }));
 return out;
}
