/** Worker-side loopback HTTP only. Inputs cannot choose an endpoint or execute policy. */
import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync,statSync} from 'node:fs';
const address=new URL(workerData.endpoint);
if(address.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(address.hostname)||address.username||address.password||address.search||address.hash||address.pathname!=='/')throw Error('core_policy_loopback_required');
if(statSync(workerData.tokenFile).mode&0o077)throw Error('core_policy_token_not_private');
const token=readFileSync(workerData.tokenFile,'utf8').trim();if(token.length<32)throw Error('core_policy_token_invalid');
parentPort!.on('message',async({encoded,buffer})=>{
 let reply:unknown;
 try{
  const response=await fetch(address.origin+'/v1/policy/evaluate',{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:encoded,signal:AbortSignal.timeout(1200)});
  if(!response.ok)throw Error('policy_request_rejected');
  const bytes=await response.text();if(Buffer.byteLength(bytes)>buffer.byteLength-8)throw Error('policy_response_too_large');
  reply={ok:true,value:JSON.parse(bytes)};
 }catch{reply={ok:false};}
 const header=new Int32Array(buffer,0,2),data=Buffer.from(JSON.stringify(reply));
 if(data.length>buffer.byteLength-8){Atomics.store(header,0,-1);}
 else{new Uint8Array(buffer,8,data.length).set(data);Atomics.store(header,1,data.length);Atomics.store(header,0,1);}
 Atomics.notify(header,0);
});
