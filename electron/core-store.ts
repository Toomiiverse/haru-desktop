import {markTurn} from './turn-timing';
import {corePolicySync} from './core-policy-sync';
import { Worker } from 'node:worker_threads';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { memorySourceRevision } from './memory-revision';
import { coreServiceOptions, type CoreServiceOptions } from './core-service-client';
export type CoreStoreOptions={root:string;db:string;node:string;desktop?:string;service?:CoreServiceOptions;asyncTransactions?:boolean};
type Snapshot={revision:number;userData:string;home:string;sourceRevision:string;documents:Record<string,any>};
const registry=new Map<string,CoreStore>();
// 3440: documents by digest. A policy call names a document by the digest of its JSON and the bridge sends the body only
// for a version the Core has not seen; a plan's `expected` names the same digest and the committer checks it against the
// document as it stands. Decisions and staleness checks are unchanged; the 362 KB config stops crossing on every call.
export type DocRef={$doc:string;digest:string;body?:unknown};
export function docDigest(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)??'').digest('hex').slice(0,32);}
export function isDigestRef(value:unknown):value is {$digest:string}{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value as object).length===1&&typeof (value as {$digest?:unknown}).$digest==='string';}
// 3480 write-behind: while an async commit is in flight a reader is served the state the commit is writing (the patched
// documents) or the committed state (the others) instead of waiting ~70-120 ms for the disk; only a write, a schedule
// read (rebaseSchedule compares whole snapshots) or a nameless fence still waits. The commit's patches ARE the next state:
// a failed commit marks the store broken, after which nothing is served at all.
export function pendingRead(patches:Record<string,unknown>|null,name:string|undefined):'fence'|'pending'|'committed'{
 if(!patches||name===undefined||name==='schedule')return 'fence';
 return Object.hasOwn(patches,name)?'pending':'committed';
}
export function sameDocument(current:unknown,expected:unknown):boolean{return isDigestRef(expected)?docDigest(current)===expected.$digest:JSON.stringify(current)===JSON.stringify(expected);}
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
 private pendingAsync=false;private pendingPatches:Record<string,any>|null=null;private digests=new WeakMap<object,string>();private asyncTail:Promise<unknown>=Promise.resolve();
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
  if(method==='commit')console.log(`[core-write-timing] ${JSON.stringify({workerWaitMs:performance.now()-started,...response.result.timing,changed:changedKeys((params as any).patches,this.state.documents)})}`);
  spanStatus='ok';return response.result;
  } finally {markTurn('storage_span',{step:method,durationMs:performance.now()-started,status:spanStatus});}
 }
 private refreshPending(name?:string){
  if(this.pendingAsync&&pendingRead(this.pendingPatches,name)!=='fence')return;
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
        if(!response.ok)throw Error((response.error==='authority_revision_conflict')?'authority_revision_conflict':'core_authority_commit_unconfirmed');
        result=response.result;
       }else result=this.call('commit',{id:randomUUID(),baseRevision:this.state.revision,patches:params.patches});
       break;
      }catch(error){
       if((!(error instanceof Error))||error.message!=='authority_revision_conflict'||attempt===3)throw error;
       this.rebaseSchedule(originalDocuments);
      }
     }
     if(result.currentRevision!==result.revision)throw Error('core_authority_revision_conflict');
     this.state={...this.state,revision:result.revision,documents:{...this.state.documents,...params.patches}};
     console.log(`[core-write-timing] ${JSON.stringify({asyncCommit:true,workerWaitMs:performance.now()-started,...result.timing,changed:changedKeys(params.patches,originalDocuments)})}`);
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
 /** The documents as a reader should see them now: the staged map inside a transaction, else the committed state with any in-flight commit's patches over it. */
 private view(name:string):Record<string,any>{if(this.staged)return this.staged;return this.pendingAsync&&this.pendingPatches&&Object.hasOwn(this.pendingPatches,name)?{...this.state.documents,...this.pendingPatches}:this.state.documents;}
 get(name:string,fallback?:any):any{this.refreshPending(name);if(name==='schedule'&&(true as boolean)&&!this.touched.has('schedule')){this.rebaseSchedule();if(this.staged)this.staged.schedule=this.state.documents.schedule;}return structuredClone(this.view(name)[name]??fallback);}
 /** Clone only the requested config branch. Copying all chat/configuration
  * for each scalar read dominates warm conversation preparation. The selected
  * value still cannot mutate authoritative or staged state without a commit. */
 getPath(name:string,parts:readonly string[],fallback?:any):any{
  this.refreshPending(name);
  let value=this.view(name)[name];
  for(const part of parts){if(value==null||!Object.hasOwn(value,part))return fallback;value=value[part];}
  return value===undefined?fallback:structuredClone(value);
 }
 /** 3520: a document's digest is cached, and the body is a getter, cloned only when the bridge actually sends it.
  *  3690: the digest is kept per document OBJECT, not per store revision: every commit to any document bumped the revision,
  *  so the 707 KB archive was re-hashed (~4 ms) on nearly every use though it changes once a day. Sound because a document
  *  object held by the store is never changed in place — set() stores a clone, commits and staging replace objects, reads
  *  return clones. The body getter clones the very object that was hashed, so a commit landing between docRef() and the
  *  send can no longer put new content under the old digest (the Core caches a body under the digest it is given). */
 private digestOf(name:string,fallback:any):{digest:string;doc:any}{
  this.refreshPending(name);
  const doc=this.view(name)[name];
  if(doc===undefined||doc===null||typeof doc!=='object')return {digest:docDigest(doc??fallback),doc};
  let digest=this.digests.get(doc);
  if(digest===undefined){digest=docDigest(doc);this.digests.set(doc,digest);}
  return {digest,doc};
 }
 docRef(name:string,fallback?:any):DocRef{const {digest,doc}=this.digestOf(name,fallback);return {$doc:name,digest,get body(){return structuredClone(doc??fallback);}};}
 sameDoc(name:string,expected:unknown,fallback?:any):boolean{return isDigestRef(expected)?this.digestOf(name,fallback).digest===expected.$digest:sameDocument(this.get(name,fallback),expected);}
 has(name:string):boolean{this.refreshPending(name);return Object.hasOwn(this.view(name),name);}
 /** 3710: a document's top-level keys and the .length of each value, read without cloning the document (the 707 KB archive
  *  was cloned three times a turn to learn its day names and sizes). Only fresh arrays leave the store. */
 sizesOf(name:string):{key:string;length:any}[]{
  this.refreshPending(name);const doc=this.view(name)[name];
  // A non-number .length (never written today) is cloned, so no internal object can leave; an absent document reads as [].
  return doc&&typeof doc==='object'?Object.entries(doc).map(([key,value])=>{const n=(value as any).length;return {key,length:typeof n==='number'?n:structuredClone(n)};}):[];
 }
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
   catch(error){if((!(error instanceof Error))||error.message!=='authority_revision_conflict'||attempt===3)throw error;this.rebaseSchedule();}
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
   const revision=this.state.revision;this.pendingAsync=true;this.pendingPatches=patches!;
   try{
    const result=await this.callCommit({id:randomUUID(),baseRevision:revision,patches:patches!});
    if(result.currentRevision!==result.revision)throw Error('core_authority_revision_conflict');
    // A synchronous caller may already have fenced and committed a newer
    // revision while this promise's continuation was waiting to run.
    if(this.state.revision<=result.revision)this.state={...this.state,revision:result.revision,documents:{...this.state.documents,...patches!}};
    return value!;
   }catch(error){this.broken=true;throw error;}finally{this.pendingAsync=false;this.pendingPatches=null;}
  });
  this.asyncTail=operation.catch(()=>{});return operation;
 }
 /** 3480: the transaction's value now, the commit behind it. Readers see the new state at once (view); the next write waits
  *  for the disk. A failed commit breaks the store as transactionAsync does, and is logged here because nobody awaits it. */
 transactionBehind<T>(fn:()=>T):T{
  if(this.depth)throw Error('core_async_transaction_cannot_nest');
  if(!this.options.service&&!this.options.asyncTransactions)return this.transaction(fn);
  this.refreshPending();
  if(this.broken)throw Error('core_authority_unavailable');
  this.captured={};let value:T,patches:Record<string,any>;
  try{value=this.transaction(fn);patches=this.captured;}finally{this.captured=undefined;}
  if(!Object.keys(patches!).length)return value!;
  const revision=this.state.revision;this.pendingAsync=true;this.pendingPatches=patches!;
  const operation=(async()=>{
   try{
    const result=await this.callCommit({id:randomUUID(),baseRevision:revision,patches:patches!});
    if(result.currentRevision!==result.revision)throw Error('core_authority_revision_conflict');
    if(this.state.revision<=result.revision)this.state={...this.state,revision:result.revision,documents:{...this.state.documents,...patches!}};
   }catch(error){this.broken=true;console.error('[core-store] write-behind commit failed:',error instanceof Error?error.message:String(error));throw error;}
   finally{this.pendingAsync=false;this.pendingPatches=null;}
  })();
  this.asyncTail=operation.catch(()=>{});return value!;
 }
 /** 3600: wait for a write-behind commit to land. The Core reads documents from the store itself for an affect plan; a plan read
  *  while this side's commit was still in flight names the old config and the commit is refused as stale (3 turns failed 2026-10-12/13). */
 fence(){this.refreshPending();}
 sourceRevision():string{this.refreshPending('config');this.refreshPending('memories');this.refreshPending('graph');const d=this.staged??(this.pendingAsync&&this.pendingPatches?{...this.state.documents,...this.pendingPatches}:this.state.documents);return memorySourceRevision(d.config,d.memories,d.graph);}
 health(){return this.call('health',{});}
 backup(reason:string):string{return this.call('backup',{reason});}
 clearExperiences(){this.transaction(()=>{const plan=corePolicySync<Record<string,unknown>>('memory-admin.assets',[Object.keys(this.staged!),this.get('dream-learning')]);for(const [key,value]of Object.entries(plan))this.set(key,value);});return;}
 close(){for(const [key,value]of registry)if(value===this)registry.delete(key);if(!this.broken)this.call('close',{});this.broken=true;this.worker.postMessage({stop:true});void this.worker.terminate();}
}

/** 3780: what a commit changed, for the write-timing line: the document names, and for config its changed top-level keys
 *  ('config:her.weather vitals'), so a full re-projection can be traced to its writer. Values never appear. */
export function changedKeys(patches:Record<string,any>|undefined,before:Record<string,any>):string{
 if(!patches)return '';
 return Object.keys(patches).map(name=>{
  if(name!=='config'||!patches.config||typeof patches.config!=='object')return name;
  const was=before.config??{};const now=patches.config;
  const differ=(a:any,b:any)=>[...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].filter(k=>JSON.stringify(a?.[k])!==JSON.stringify(b?.[k]));
  const keys=differ(was,now).flatMap(k=>k==='her'&&was.her&&now.her?differ(was.her,now.her).map(h=>'her.'+h):[k]);
  return 'config:'+keys.slice(0,12).join(' ');
 }).join(' ');
}
