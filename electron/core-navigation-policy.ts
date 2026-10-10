import {corePolicySync} from './core-policy-sync';import {attachmentCurrent} from './core-attachments';import {activeTask} from './task-controller';import {activeScheduledJob} from './core-scheduler';import {spawn} from 'node:child_process';
export const navigationPolicy=<T=any>(op:string,args:unknown[]):T=>corePolicySync<T>('navigation.'+op,args);
export function coreFix(line:string){const packet=navigationPolicy('parseFix',[line]);if(packet.error)throw Error(packet.error);return {...packet.value,accuracy:packet.value.accuracy===null?Number.NaN:packet.value.accuracy};}
export async function coreNavRemote(kind:string,args:unknown[],fetchImpl:any){
 attachmentCurrent();let command=navigationPolicy('remoteStart',[kind,args]);
 for(;;){if(command.error)throw Error(command.error);attachmentCurrent();const taskSignal=activeTask.getStore()?.signal,timeout=command.timeoutMs?AbortSignal.timeout(command.timeoutMs):undefined,signal=taskSignal&&timeout?AbortSignal.any([taskSignal,timeout]):taskSignal??timeout;
  const response=await fetchImpl(command.url,{...command.init,...(signal?{signal}:{})});attachmentCurrent();let body:any={};if(response.ok||command.ignoreJSONError){try{body=await response.json();}catch(error){if(!command.ignoreJSONError)throw error;}}
  attachmentCurrent();const result=navigationPolicy('remoteResult',[command.state,{ok:response.ok,status:response.status,body}]);if(result.error)throw Error(result.error);if(!result.next)return result.value;command=result.next;
 }
}
export async function coreWindowsFix(){
 attachmentCurrent();const command=navigationPolicy('windowsStart',[process.platform]);if(command.error)throw Error(command.error);
 return new Promise<any>((resolve,reject)=>{const child=spawn(command.file,command.args,{windowsHide:true});let output='',done=false;const signal=activeTask.getStore()?.signal;const finish=(error?:unknown,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value);};const abort=()=>{child.kill();finish(signal?.reason??Error('navigation_cancelled'));};const timer=setTimeout(()=>{child.kill();finish(Error(command.timeoutError));},command.timeoutMs);signal?.addEventListener('abort',abort,{once:true});child.stdout.on('data',chunk=>output+=chunk.toString());child.on('error',error=>finish(error));child.on('close',()=>{if(done)return;try{attachmentCurrent();const result=navigationPolicy('windowsResult',[output]);if(result.error)throw Error(result.error);finish(undefined,{...result.value,accuracy:result.value.accuracy===null?Number.NaN:result.value.accuracy});}catch(error){finish(error);}});});
}
export async function runCoreDirections(latest:string,recent:string[],adapter:any){
 attachmentCurrent();let packet=navigationPolicy('start',[latest,recent,adapter.facts()]);
 while(packet.action!=='done'){
  attachmentCurrent();let observation:any;
  if(packet.action==='cancel'){await adapter.cancel(packet.args.id);observation={ok:true};}
  else if(packet.action==='watch'){observation={ok:true,value:await adapter.watch(packet.args)};}
  else{try{observation={ok:true,value:await adapter.execute(packet.action,packet.args)};}catch(error){observation={ok:false};}}
  attachmentCurrent();packet=navigationPolicy('advance',[packet.state,observation,adapter.facts()]);
 }
 if(packet.cache)adapter.cache(packet.cache);return packet.value;
}
export async function startCoreTrafficWatch(destination:string,found:any,route:any,adapter:any){
 attachmentCurrent();const packet=navigationPolicy('startWatch',[destination,found,route,adapter.facts()]);if(packet.action==='done')return packet.value;
 await adapter.book(packet.job);attachmentCurrent();return navigationPolicy<string>('watchBooked',[packet.state,adapter.jobs()]);
}
export async function runCoreTrafficWatch(job:any,adapter:any){
 const grant=activeScheduledJob.getStore();const current=()=>{attachmentCurrent();navigationPolicy('assertWatch',[job,grant??null]);};current();let packet=navigationPolicy('watchStart',[job,adapter.facts()]);
 while(packet.action!=='done'){
  current();let observation:any;
  if(packet.action==='publish'){adapter.stamp(packet.stamp);const receipt=adapter.publish(packet.args);observation={ok:true,value:receipt};}
  else{try{observation={ok:true,value:await adapter.execute(packet.action,packet.args)};}catch(error){observation={ok:false};}}
  current();packet=navigationPolicy('watchAdvance',[packet.state,observation,adapter.facts()]);
 }
 return packet.value;
}
export async function runCorePlaceSearch(plan:any,aside:string,adapter:any){
 attachmentCurrent();let observation:any;
 try{const found=await adapter.search(plan.query,plan.options);attachmentCurrent();observation={ok:true,count:found.length,formatted:adapter.format(plan.query,found)};}catch(error){attachmentCurrent();observation={ok:false};}
 attachmentCurrent();return navigationPolicy<{aside:string;fromSearch:boolean}>('placeSearchResult',[plan,aside,observation,adapter.current()]);
}
