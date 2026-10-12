import {randomUUID} from 'node:crypto';import {corePolicySync} from './core-policy-sync';import {activeTask} from './task-controller';
export const voiceSensePolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('voice-sense.'+op,args);
const current=()=>activeTask.getStore()?.signal.throwIfAborted();
export class CoreVoiceSense {
 private readonly id=randomUUID();private analyzer:any=null;private completion:any=null;
 constructor(private now:()=>number){}
 configure(analyzer:any){this.analyzer=analyzer;}
 call<T=any>(op:string,args:unknown[]=[]):T{const observed=this.completion;const result=voiceSensePolicy<T>('command',[this.id,randomUUID(),op,args,this.now(),Boolean(this.analyzer),op==='analysisComplete'?null:observed]);if(this.completion===observed)this.completion=null;return result;}
 async analyze(audio:Uint8Array,mime:string,words?:number){try{const command=this.call('analyzeAdmission');if(!command.analyze)return null;let result=null;try{result=await this.analyzer(audio,mime,words);}catch{}return result??null;}catch{return null;}}
 private observe(command:any,audio:Uint8Array,mime:string){if(!command.analyze)return;void this.analyze(audio,mime,command.words).then(reading=>{this.completion={ticket:command.ticket,reading};try{this.call('analysisComplete',[command.ticket,reading]);}catch{}});}
 generated(text:string,plan:any,engine:string,audio:Uint8Array,mime:string){const command=this.call('generated',[text,plan,engine,audio.length]);this.observe(command,audio,mime);}
 stream(text:string,plan:any,engine:string,source:ReadableStream<Uint8Array>,mime:string,wrap?:((bytes:Uint8Array)=>Uint8Array)){
  const reader=source.getReader();let issued:any;try{issued=this.call('streamPlan',[text,plan,engine]);}catch(error){void reader.cancel(error).catch(()=>{});throw error;}const parts:Uint8Array[]=[];let bytes=0,started=false,finished=false;
  const finish=(partial:boolean)=>{if(finished)return;finished=true;const command=this.call('streamFinish',[issued,partial,bytes]);if(!command.analyze)return;const clip=new Uint8Array(bytes);let offset=0;for(const part of parts){clip.set(part,offset);offset+=part.length;}this.observe(command,wrap?wrap(clip):clip,mime);};
  return new ReadableStream<Uint8Array>({pull:async controller=>{try{const chunk=await reader.read();if(chunk.done){finish(false);controller.close();return;}if(chunk.value.length&&!started){this.call('streamFirst',[issued]);started=true;}if(bytes<issued.maxBytes){const part=chunk.value.slice(0,issued.maxBytes-bytes);parts.push(part);bytes+=part.length;}controller.enqueue(chunk.value);}catch(error){try{finish(true);}finally{await reader.cancel(error).catch(()=>{});controller.error(error);}}},cancel:async reason=>{try{finish(true);}finally{await reader.cancel(reason);}}},{highWaterMark:0});
 }
}
export async function coreAnalyzeLocalVoice(audio:Uint8Array,mime:string,fetchImpl:typeof fetch,endpoint:string,words?:number){
 try{current();let parsed:any=null;try{const url=new URL(endpoint);parsed={protocol:url.protocol,hostname:url.hostname,username:url.username,password:url.password,origin:url.origin};}catch{}const command=voiceSensePolicy('localStart',[parsed,mime,words??null,process.env.HARU_VOICE_AFFECT??null]);if(command.action==='done')return command.value;const timeout=AbortSignal.timeout(command.timeoutMs),task=activeTask.getStore()?.signal,signal=task?AbortSignal.any([timeout,task]):timeout;let state=command.state;
 for(;;){current();const response=await fetchImpl(command.url,{method:command.method,headers:command.headers,body:audio as unknown as BodyInit,signal,redirect:command.redirect});current();let result=voiceSensePolicy('localResult',[state,{status:response.status,ok:response.ok}]);if(result.action==='read-json'){const body=await response.json();current();return voiceSensePolicy('localJSON',[body]);}if(result.action==='cancel-body'){await response.body?.cancel();result=result.next;}if(result.action==='done')return result.value;await new Promise(resolve=>setTimeout(resolve,result.waitMs));current();state=result.state;}
 }catch{return null;}
}
