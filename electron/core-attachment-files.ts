/** File bytes, codecs and HTTP transport only; policy is authored by Core. */
import fs from 'node:fs';import path from 'node:path';
import {attachmentPolicy,attachmentCurrent} from './core-attachments';
export async function coreReadPdf(file:string,maxChars:number){
 const data=new Uint8Array(fs.readFileSync(file)),pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data,useSystemFonts:true,disableFontFace:true,isEvalSupported:false} as Parameters<typeof pdfjs.getDocument>[0]);
 const doc=await task.promise,parts:string[]=[];
 try{for(;;){attachmentCurrent();const command=attachmentPolicy('pdfStep',[doc.numPages,parts,maxChars]);if(command.next===null)break;const page=await doc.getPage(command.next),content=await page.getTextContent();parts.push(attachmentPolicy('pdfPage',[content.items]));}}
 finally{await task.destroy();}
 attachmentCurrent();return attachmentPolicy('pdfResult',[doc.numPages,parts,maxChars]);
}
export async function coreExtractFrames(file:string,tools:any,count:number,adapter:{duration:(file:string,tools:any)=>Promise<number>;dir:()=>string;run:(file:string,args:string[],ms:number)=>Promise<string>}){
 const length=await adapter.duration(file,tools),dir=adapter.dir(),stamp=Date.now(),shots:string[]=[];
 const commands=attachmentPolicy<any[]>('frames',[length,count]);
 for(const [i,command] of commands.entries()){
  attachmentCurrent();const out=path.join(dir,`frame-${stamp}-${i}.jpg`);
  try{await adapter.run(tools.ffmpeg,['-y','-ss',command.at,'-i',file,'-frames:v','1','-vf',`scale=${command.scale}`,'-q:v',command.quality,out],command.timeoutMs);attachmentCurrent();if(fs.existsSync(out)&&fs.statSync(out).size>0)shots.push(out);}
  catch(error){attachmentCurrent();}
 }
 return shots;
}
export async function coreVisionLook(images:string|string[],config:any,endpoint:string,headers:Record<string,string>,fetchImpl:any,options:any={}){
 attachmentCurrent();const request=attachmentPolicy('lookRequest',[config,endpoint,{...options,signal:undefined}]);if(request.error)throw Error(request.error);
 const messages=request.messages.map((m:any)=>m.images?{...m,images:Array.isArray(images)?images:[images]}:m);
 const response=await fetchImpl(request.url,{method:'POST',headers,signal:AbortSignal.any([AbortSignal.timeout(request.timeout),...(options.signal?[options.signal]:[])]),body:JSON.stringify({...request.body,messages})});
 let detail='',payload:any=null;if(response.ok)payload=await response.json();else detail=await response.text().catch(()=>'');
 options.signal?.throwIfAborted();attachmentCurrent();const result=attachmentPolicy('lookResponse',[config.model,response.status,detail,payload]);
 if(result.error){const error=Error(result.error);if(Object.hasOwn(result,'aboutThisImage'))Object.assign(error,{aboutThisImage:result.aboutThisImage});throw error;}
 return result.result;
}
import {spawn} from 'node:child_process';import {activeTask} from './task-controller';
export function coreMediaRun(file:string,args:string[],timeoutMs:number):Promise<string>{
 attachmentCurrent();return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{windowsHide:true}),signal=activeTask.getStore()?.signal;let out='',err='',done=false;
  const finish=(error:unknown,value?:string)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value??'');};
  const abort=()=>{child.kill();finish(signal?.reason??Error('attachment_cancelled'));};
  const timer=setTimeout(()=>{child.kill();finish(Error('ffmpeg took too long'));},timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});child.on('error',error=>finish(error));child.on('close',code=>{if(done)return;try{const result=attachmentPolicy('mediaExit',[code,out,err]);finish(result.error?Error(result.error):null,result.result);}catch(error){finish(error);}});
 });
}
