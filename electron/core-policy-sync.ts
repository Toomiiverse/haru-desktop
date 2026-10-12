/** Pure decision transport; no domain choice, retry or enabled-mode fallback. */
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {coreServiceOptions} from './core-service-client';
const LIMIT=2097152;
let worker:Worker|undefined;
// Date carries the local fields the caller observed, including zonedNow's
// shifted date. ISO serialization alone would change sleep-window semantics.
function wire(value:unknown):unknown {
 if(value instanceof Date)return {$date:{epochMs:value.getTime(),year:value.getFullYear(),month:value.getMonth()+1,day:value.getDate(),hour:value.getHours(),minute:value.getMinutes()}};
 if(Array.isArray(value))return value.map(wire);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,wire(v)]));
 return value;
}
export function coreAdapterOwner(){
 const stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
 return {pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};
}
export function corePolicySync<T>(operation:string,args:unknown[]):T {
 const options=coreServiceOptions();
 if(!options||process.env.HARU_CORE_BRAIN_WORKER!=='on')throw Error('core_policy_owner_unavailable');
 if(!worker){
  const created=new Worker(path.join(__dirname,'core-policy-worker.js'),{workerData:options});worker=created;
  const lost=()=>{if(worker===created)worker=undefined;};created.on('error',lost);created.on('exit',lost);created.unref();
 }
 // A failed call is never replayed. A later fresh snapshot may open a new
 // transport worker; it still has to receive a fresh Core decision.
 const transport=worker;
 const packet={version:1,requestId:randomUUID(),owner:coreAdapterOwner(),nowMs:Date.now(),operation,args:wire(args)};
 const encoded=JSON.stringify(packet);
 const limit=process.env.HARU_CORE_KNOWLEDGE==='on'&&/^knowledge-(index|flow|chunks|vault)\./.test(operation)?8388608:LIMIT;
 if(Buffer.byteLength(encoded)>limit)throw Error('core_policy_payload_too_large');
 const buffer=new SharedArrayBuffer(limit+8),header=new Int32Array(buffer,0,2);
 transport.postMessage({encoded,buffer});
 const wait=Atomics.wait(header,0,0,1500);
 if(wait==='timed-out'||Atomics.load(header,0)!==1){if(worker===transport)worker=undefined;void transport.terminate();throw Error('core_policy_unconfirmed');}
 const reply=JSON.parse(Buffer.from(buffer,8,Atomics.load(header,1)).toString('utf8'));
 if(!reply.ok)throw Error('core_policy_unavailable');
 const value=reply.value;
 if(value.version!==1||value.requestId!==packet.requestId||value.operation!==operation||value.executes!==false
   ||JSON.stringify(value.owner)!==JSON.stringify(packet.owner)||typeof value.policyEpoch!=='string'
   ||!Object.hasOwn(value,'result')||Date.now()-packet.nowMs>1500)throw Error('core_policy_protocol_error');
 return value.result as T;
}
