/** Worker-side loopback HTTP only. Inputs cannot choose an endpoint or execute policy. */
import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync,statSync} from 'node:fs';
import {Agent,request} from 'node:http';
const address=new URL(workerData.endpoint);
if(address.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(address.hostname)||address.username||address.password||address.search||address.hash||address.pathname!=='/')throw Error('core_policy_loopback_required');
if(statSync(workerData.tokenFile).mode&0o077)throw Error('core_policy_token_not_private');
const token=readFileSync(workerData.tokenFile,'utf8').trim();if(token.length<32)throw Error('core_policy_token_invalid');
// A single persistent loopback socket avoids fetch's per-request machinery.
// No retries or redirects: every policy call remains a distinct owned request.
const agent=new Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1});
function evaluate(encoded:string,limit:number):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const req=request(address.origin+'/v1/policy/evaluate',{method:'POST',agent,
   headers:{'content-type':'application/json','content-length':Buffer.byteLength(encoded),authorization:'Bearer '+token}},res=>{
   if(!res.statusCode||res.statusCode<200||res.statusCode>=300){res.destroy();reject(Error('policy_request_rejected'));return;}
   let size=0;const chunks:Buffer[]=[];
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){res.destroy(Error('policy_response_too_large'));return;}chunks.push(chunk);});
   res.on('error',reject);res.on('aborted',()=>reject(Error('policy_response_aborted')));
   res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks,size).toString('utf8')));}catch(error){reject(error);}});
  });
  // Absolute deadline includes queueing, headers and body. An idle-socket
  // timeout alone would incorrectly let a slow trickle extend the deadline.
  const deadline=setTimeout(()=>req.destroy(Error('policy_request_timeout')),1200);
  req.on('error',reject);req.on('close',()=>clearTimeout(deadline));req.end(encoded);
 });
}
parentPort!.on('message',async({encoded,buffer})=>{
 let reply:unknown;
 try{
  reply={ok:true,value:await evaluate(encoded,buffer.byteLength-8)};
 }catch{reply={ok:false};}
 const header=new Int32Array(buffer,0,2),data=Buffer.from(JSON.stringify(reply));
 if(data.length>buffer.byteLength-8){Atomics.store(header,0,-1);}
 else{new Uint8Array(buffer,8,data.length).set(data);Atomics.store(header,1,data.length);Atomics.store(header,0,1);}
 Atomics.notify(header,0);
});
