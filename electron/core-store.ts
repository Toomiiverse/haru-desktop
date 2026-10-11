import {markTurn} from './turn-timing';
import {corePolicySync} from './core-policy-sync';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { memorySourceRevision } from './memory-revision';
import { coreServiceOptions, type CoreServiceOptions } from './core-service-client';
export type CoreStoreOptions={root:string;db:string;node:string;desktop?:string;service?:CoreServiceOptions;asyncTransactions?:boolean};
type Snapshot={revision:number;userData:string;home:string;sourceRevision:string;documents:Record<string,any>};
const registry=new Map<string,CoreStore>();
export function coreStoreOptions(env:NodeJS.ProcessEnv=process.env):CoreStoreOptions|undefined{
 if(env.HARU_CORE_STORAGE!=='on')return;
 const root=env.HARU_CORE_ROOT??path.join(os.homedir(),'haru-core');
 return {root,db:env.HARU_CORE_DB??path.join(root,'data/haru-core.db'),node:env.HARU_CORE_NODE??'/usr/bin/node',service:coreServiceOptions(env),asyncTransactions:(true as boolean)};
}
export function coreStoreFor(root:string):CoreStore|undefined{return registry.get(path.resolve(root));}
export class CoreStore {
 private worker:Worker;private buffer=new SharedArrayBuffer(64*1024*1024);private state!:Snapshot;private broken=false;
 private depth=0;private staged:Record<string,any>|null=null;private touched=new Set<string>();
 private captured:Record<string,any>|undefined;
 private pendingAsync=false;private asyncTail:Promise<unknown>=Promise.resolve();
 private finishPendingCommit:(()=>any)|undefined;
 constructor(readonly options:CoreStoreOptions,userData:string){
  if(![options.root,options.db,options.node,userData].every(path.isAbsolute))throw Error('absolute_paths_required');
  this.worker=new Worker(path.join(__dirname,'core-store-worker.js'),{workerData:{...options,desktop:options.desktop??__dirname}});
  this.worker.on('error',()=>{this.broken=true;});this.worker.unref();
  try{this.state=this.call('open',{userData});registry.set(path.resolve(userData),this);registry.set(path.resolve(this.state.home),this);}
  catch(e){void this.worker.terminate();throw e;}
 }
 private call(method:string,params:unknown):any{
  const started=performance.now();let spanStatus:'ok'|'error'='error';
  try {
  if(this.broken)throw Error('core_authority_unavailable');
  const header=new Int32Array(this.buffer,0,2);Atomics.store(header,0,0);Atomics.store(header,1,0);
  const id=randomUUID();this.worker.postMessage({request:{protocol:1,id,method,params},buffer:this.buffer});
  const status=Atomics.wait(header,0,0,method==='backup'?30_000:10_000);
  if(status==='timed-out'||Atomics.load(header,0)!==1){this.broken=true;void this.worker.terminate();throw Error('core_authority_commit_unconfirmed');}
  const response=JSON.parse(Buffer.from(this.buffer,8,Atomics.load(header,1)).toString('utf8'));
  if(response.id!==id){this.broken=true;throw Error('core_authority_protocol_error');}
  if(!response.ok)throw Error(response.error??'core_authority_failed');
  if(method==='commit')console.log(`[core-write-timing] ${JSON.stringify({workerWaitMs:performance.now()-started,...response.result.timing})}`);
  spanStatus='ok';return response.result;
  } finally {markTurn('storage_span',{step:method,durationMs:performance.now()-started,status:spanStatus});}
 }
 private refreshPending(){
  if(this.pendingAsync){
   // Fence the complete commit, including known-conflict retries, before a
   // synchronous caller can observe or change its source documents.
   try{if(!this.finishPendingCommit)throw Error('core_authority_commit_unconfirmed');this.finishPendingCommit();}
   catch(error){this.broken=true;throw error;}
  }
 }
 private async callCommit(params:{id:string;baseRevision:number;patches:Record<string,any>}):Promise<any>{
  if(this.broken)throw Error('core_authority_unavailable');
  const started=performance.now();
  this.worker.ref();
  const id=randomUUID(),buffer=new SharedArrayBuffer(64*1024),header=new Int32Array(buffer,0,2);
  const originalDocuments=this.state.documents;
  let settled=false,failed=false,result:any,failure:unknown;
  const finish=()=>{
   if(!settled){
    try{
     if(Atomics.wait(header,0,0,10_000)==='timed-out'||Atomics.load(header,0)!==1){void this.worker.terminate();throw Error('core_authority_commit_unconfirmed');}
     const response=JSON.parse(Buffer.from(buffer,8,Atomics.load(header,1)).toString('utf8'));
     if(response.id!==id)throw Error('core_authority_protocol_error');
     for(let attempt=0;attempt<4;attempt++){
      try{
       if(attempt===0){
        if(!response.ok)throw Error((true as boolean)&&response.error==='authority_revision_conflict'?'authority_revision_conflict':'core_authority_commit_unconfirmed');
        result=response.result;
       }else result=this.call('commit',{id:randomUUID(),baseRevision:this.state.revision,patches:params.patches});
       break;
      }catch(error){
       if((false as boolean)||!(error instanceof Error)||error.message!=='authority_revision_conflict'||attempt===3)throw error;
       this.rebaseSchedule(originalDocuments);
      }
     }
     if(result.currentRevision!==result.revision)throw Error('core_authority_revision_conflict');
     this.state={...this.state,revision:result.revision,documents:{...this.state.documents,...params.patches}};
     console.log(`[core-write-timing] ${JSON.stringify({asyncCommit:true,workerWaitMs:performance.now()-started,...result.timing})}`);
    }catch(error){failed=true;failure=error;this.broken=true;}
    finally{settled=true;this.pendingAsync=false;}
   }
   if(failed)throw failure;
   return result;
  };
  this.finishPendingCommit=finish;
  try{
   this.worker.postMessage({request:{protocol:1,id,method:'commit',params},buffer});
   const atomics=Atomics as unknown as {waitAsync(a:Int32Array,i:number,v:number,t:number):{async:boolean;value:string|Promise<string>}};
   const status=await atomics.waitAsync(header,0,0,10_000).value;
   if(status==='timed-out'&&!settled){this.broken=true;void this.worker.terminate();throw Error('core_authority_commit_unconfirmed');}
   return finish();
  }finally{markTurn('storage_span',{step:'asyncCommit',durationMs:performance.now()-started,status:this.broken?'error':'ok'});if(this.finishPendingCommit===finish)this.finishPendingCommit=undefined;this.worker.unref();}
 }
 get(name:string,fallback?:any):any{this.refreshPending();if(name==='schedule'&&(true as boolean)&&!this.touched.has('schedule')){this.rebaseSchedule();if(this.staged)this.staged.schedule=this.state.documents.schedule;}return structuredClone((this.staged??this.state.documents)[name]??fallback);}
 /** Clone only the requested config branch. Copying all chat/configuration
  * for each scalar read dominates warm conversation preparation. The selected
  * value still cannot mutate authoritative or staged state without a commit. */
 getPath(name:string,parts:readonly string[],fallback?:any):any{
  this.refreshPending();
  let value=(this.staged??this.state.documents)[name];
  for(const part of parts){if(value==null||!Object.hasOwn(value,part))return fallback;value=value[part];}
  return value===undefined?fallback:structuredClone(value);
 }
 has(name:string):boolean{this.refreshPending();return Object.hasOwn(this.staged??this.state.documents,name);}
 set(name:string,value:any):void{
  this.refreshPending();
  if(this.staged){this.staged[name]=structuredClone(value);this.touched.add(name);return;}
  this.commit({[name]:structuredClone(value)});
 }
 private commit(patches:Record<string,any>){
  if(!Object.keys(patches).length)return;
  if(this.captured){Object.assign(this.captured,patches);return;}
  let result:any;
  for(let attempt=0;attempt<4;attempt++){
   try{result=this.call('commit',{id:randomUUID(),baseRevision:this.state.revision,patches});break;}
   catch(error){if((false as boolean)||!(error instanceof Error)||error.message!=='authority_revision_conflict'||attempt===3)throw error;this.rebaseSchedule();}
  }
  if(result.currentRevision!==result.revision){this.broken=true;throw Error('core_authority_revision_conflict');}
  this.state={...this.state,revision:result.revision,documents:{...this.state.documents,...patches}};
 }
 private rebaseSchedule(expected:Record<string,any>=this.state.documents){
  const fresh=this.call('open',{userData:this.state.userData}) as Snapshot;
  const names=new Set([...Object.keys(expected),...Object.keys(fresh.documents)]);
  if(fresh.revision<this.state.revision||[...names].some(name=>name!=='schedule'&&JSON.stringify(expected[name])!==JSON.stringify(fresh.documents[name]))){
   this.broken=true;throw Error('core_authority_revision_conflict');
  }
  this.state=fresh;
 }
 transaction<T>(fn:()=>T):T{
  this.refreshPending();
  const started=performance.now(),outer=this.depth===0,previous=this.staged,previousTouched=this.touched;
  // Values enter and leave through cloning get/set methods. Only the document
  // map needs a copy; untouched archives and memories never need to be cloned.
  this.staged={...(previous??this.state.documents)};this.touched=new Set(outer?[]:previousTouched);this.depth++;
  try{
   const result=fn();if(result&&typeof(result as any).then==='function')throw Error('core_transaction_must_be_synchronous');
   const next=this.staged;this.depth--;
   if(outer){
    const patches=Object.fromEntries([...this.touched].filter(k=>JSON.stringify(next[k])!==JSON.stringify(this.state.documents[k])).map(k=>[k,next[k]]));
    this.staged=null;this.touched=new Set();
    console.log(`[core-write-timing] ${JSON.stringify({transactionPreparationMs:performance.now()-started,documents:Object.keys(patches).length})}`);
    this.commit(patches);
   }
   return result;
  }catch(e){this.depth=outer?0:this.depth-1;this.staged=previous;this.touched=previousTouched;throw e;}
 }
 transactionAsync<T>(fn:()=>T):Promise<T>{
  if(this.depth)throw Error('core_async_transaction_cannot_nest');
  // Async waiting can be enabled independently of authority ownership. Both
  // transports use the same ordered worker connection and revision checks.
  if(!this.options.service&&!this.options.asyncTransactions)return Promise.resolve(this.transaction(fn));
  const operation=this.asyncTail.then(async()=>{
   if(this.broken)throw Error('core_authority_unavailable');
   this.captured={};let value:T,patches:Record<string,any>;
   try{value=this.transaction(fn);patches=this.captured;}finally{this.captured=undefined;}
   if(!Object.keys(patches!).length)return value!;
   const revision=this.state.revision;this.pendingAsync=true;
   try{
    const result=await this.callCommit({id:randomUUID(),baseRevision:revision,patches:patches!});
    if(result.currentRevision!==result.revision)throw Error('core_authority_revision_conflict');
    // A synchronous caller may already have fenced and committed a newer
    // revision while this promise's continuation was waiting to run.
    if(this.state.revision<=result.revision)this.state={...this.state,revision:result.revision,documents:{...this.state.documents,...patches!}};
    return value!;
   }catch(error){this.broken=true;throw error;}finally{this.pendingAsync=false;}
  });
  this.asyncTail=operation.catch(()=>{});return operation;
 }
 sourceRevision():string{this.refreshPending();const d=this.staged??this.state.documents;return memorySourceRevision(d.config,d.memories,d.graph);}
 health(){return this.call('health',{});}
 backup(reason:string):string{return this.call('backup',{reason});}
 clearExperiences(){if((true as boolean)){this.transaction(()=>{const plan=corePolicySync<Record<string,unknown>>('memory-admin.assets',[Object.keys(this.staged!),this.get('dream-learning')]);for(const [key,value]of Object.entries(plan))this.set(key,value);});return;}this.transaction(()=>{this.set('diary','');this.set('dreams','');this.set('dream-notebook',[]);const learning=this.get('dream-learning');if(learning)this.set('dream-learning',{...learning,runs:[],lessons:[]});for(const key of Object.keys(this.staged!))if(key.startsWith('game:'))this.set(key,'');});}
 close(){for(const [key,value]of registry)if(value===this)registry.delete(key);if(!this.broken)this.call('close',{});this.broken=true;this.worker.postMessage({stop:true});void this.worker.terminate();}
}
