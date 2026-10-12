/** Pure decision transport; no domain choice, retry or enabled-mode fallback. */
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {markTurn,currentTurn} from './turn-timing';
import {coreServiceOptions} from './core-service-client';
const LIMIT=2097152;
let worker:Worker|undefined;
// One caller blocks synchronously until the worker has completed its write.
// Reuse that worker's transport buffers, never its decisions or authority.
let buffers=new Map<number,SharedArrayBuffer>();
// 3290: within one turn these pure getters are asked again and again with the same value (mood.normalize and readSlate 18
// times each on 2026-10-12, 600+ round trips per turn in all); the answer is kept for the turn, serialised so no caller
// shares an object with another. A new turn starts a new memo; outside a turn nothing is kept.
export const MEMO_OPS=new Set(['mood.normalize','memory-admin.readSlate','memory-tools.normalizeFile','agenda-life.get','conversation-program.todaysExamples',
 // 3410: pure of their arguments, asked 4-12 times a turn each (final-system.config x12, self.explicitModeOn x9, credit-guard.conversationRoute x5 = 80 ms, ...)
 'credit-guard.conversationRoute','self.explicitModeOn','route-admission.local','natural-policy.contextDefault','memory-admin.known','final-system.config','final-search.config','manga-fetch.config','anime-downloads.config']);
let memoTurn:unknown=null;let memo=new Map<string,string>();
// Date carries the local fields the caller observed, including zonedNow's
// shifted date. ISO serialization alone would change sleep-window semantics.
// 3440: a document reference (CoreStore.docRef) crosses with its body only for a digest the Core has not acknowledged;
// the Core answers `needs` for a digest it lacks and the call is sent once more with that body.
const acked=new Set<string>();
type Carry={force:Set<string>|null;sent:string[]};
export function wire(value:unknown,carry:Carry={force:null,sent:[]}):unknown {
 if(value instanceof Date)return {$date:{epochMs:value.getTime(),year:value.getFullYear(),month:value.getMonth()+1,day:value.getDate(),hour:value.getHours(),minute:value.getMinutes()}};
 if(Array.isArray(value))return value.map(v=>wire(v,carry));
 if(value&&typeof value==='object'){
  const ref=value as {$doc?:unknown;digest?:unknown;body?:unknown};
  if(typeof ref.$doc==='string'&&typeof ref.digest==='string'&&Object.hasOwn(ref,'body')){
   if(!acked.has(ref.digest)||carry.force?.has(ref.digest)){carry.sent.push(ref.digest);return {$doc:ref.$doc,digest:ref.digest,body:wire(ref.body,carry)};}
   return {$doc:ref.$doc,digest:ref.digest};
  }
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,wire(v,carry)]));
 }
 return value;
}
export function coreAdapterOwner(){
 const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
 return {pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};
}
export function corePolicySync<T>(operation:string,args:unknown[]):T {
 const started=performance.now();let status:'ok'|'error'='error';
 try {
 const options=coreServiceOptions();
 if(!options||(false as boolean))throw Error('core_policy_owner_unavailable');
 if(!worker){
  const created=new Worker(path.join(__dirname,'core-policy-worker.js'),{workerData:options});worker=created;buffers=new Map();
  const lost=()=>{if(worker===created){worker=undefined;buffers=new Map();}};created.on('error',lost);created.on('exit',lost);created.unref();
 }
 // A failed call is never replayed. A later fresh snapshot may open a new
 // transport worker; it still has to receive a fresh Core decision.
 const transport=worker;
 let force:Set<string>|null=null;
 for(let round=0;round<2;round++){
 const carry:Carry={force,sent:[]};const wired=wire(args,carry);const turn=MEMO_OPS.has(operation)?currentTurn():undefined;
 const key=turn?operation+'\0'+JSON.stringify(wired):null;
 if(key){if(memoTurn!==turn){memoTurn=turn;memo=new Map();}const hit=memo.get(key);if(hit!==undefined){status='ok';return JSON.parse(hit) as T;}}
 const packet={version:1,requestId:randomUUID(),owner:coreAdapterOwner(),nowMs:Date.now(),operation,args:wired};
 const encoded=JSON.stringify(packet);
 const limit=(/^knowledge-(index|flow|chunks|vault)\./.test(operation))?8388608:LIMIT;
 if(Buffer.byteLength(encoded)>limit)throw Error('core_policy_payload_too_large');
 let buffer=buffers.get(limit);
 if(!buffer){buffer=new SharedArrayBuffer(limit+8);buffers.set(limit,buffer);}
 const header=new Int32Array(buffer,0,2);
 Atomics.store(header,0,0);Atomics.store(header,1,0);
 transport.postMessage({encoded,buffer});
 const wait=Atomics.wait(header,0,0,1500);
 if(wait==='timed-out'||Atomics.load(header,0)!==1){if(worker===transport){worker=undefined;buffers=new Map();}void transport.terminate();throw Error('core_policy_unconfirmed');}
 const reply=JSON.parse(Buffer.from(buffer,8,Atomics.load(header,1)).toString('utf8'));
 if(!reply.ok)throw Error('core_policy_unavailable');
 const value=reply.value;
 if(value.version!==1||value.requestId!==packet.requestId||value.operation!==operation||value.executes!==false
   ||JSON.stringify(value.owner)!==JSON.stringify(packet.owner)||typeof value.policyEpoch!=='string'
   ||Date.now()-packet.nowMs>1500)throw Error('core_policy_protocol_error');
 if(Array.isArray(value.needs)&&!Object.hasOwn(value,'result')){
  if(round===1||!value.needs.every((d:unknown)=>typeof d==='string'))throw Error('core_policy_doc_unknown');
  force=new Set(value.needs as string[]);continue;
 }
 if(!Object.hasOwn(value,'result'))throw Error('core_policy_protocol_error');
 if(acked.size>64)acked.clear();for(const digest of carry.sent)acked.add(digest);
 if(key)memo.set(key,JSON.stringify(value.result));
 status='ok';return value.result as T;
 }
 throw Error('core_policy_doc_unknown');
 } finally {markTurn('policy_span',{operation,durationMs:performance.now()-started,status});}
}
