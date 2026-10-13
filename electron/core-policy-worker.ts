/** Worker-side loopback HTTP or the Core's private policy socket only. Inputs cannot choose an endpoint or execute policy. */
import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync,statSync,realpathSync} from 'node:fs';
import {Agent,request} from 'node:http';
import {connect,type Socket} from 'node:net';
import path from 'node:path';
const address=new URL(workerData.endpoint);
if(address.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(address.hostname)||address.username||address.password||address.search||address.hash||address.pathname!=='/')throw Error('core_policy_loopback_required');
if(statSync(workerData.tokenFile).mode&0o077)throw Error('core_policy_token_not_private');
const token=readFileSync(workerData.tokenFile,'utf8').trim();if(token.length<32)throw Error('core_policy_token_invalid');
// 3720: the token goes only to a socket in a directory this user owns and nobody else can enter, checked (symlinks
// resolved) before every connect; anything else means HTTP for that call, never the token to an unknown place.
function privateDir():boolean{
 try{
  const dir=path.dirname(workerData.socket);if(!path.isAbsolute(workerData.socket)||realpathSync(dir)!==dir)return false;
  const place=statSync(dir);return place.isDirectory()&&place.uid===process.getuid!()&&!(place.mode&0o077);
 }catch{return false;}
}
// A single persistent loopback socket avoids fetch's per-request machinery.
// No retries or redirects: every policy call remains a distinct owned request.
const agent=new Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1});
function viaHttp(encoded:string,limit:number,within=1200):Promise<unknown>{
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
  const deadline=setTimeout(()=>req.destroy(Error('policy_request_timeout')),Math.max(1,within));
  req.on('error',reject);req.on('close',()=>clearTimeout(deadline));req.end(encoded);
 });
}
// 3720: the Core's private socket (same decide() as POST /v1/policy/evaluate; ~0.2 ms less a call than HTTP). Frames: u32
// big-endian length + bytes; 'Bearer <token>' once per connection, then one packet per call; answers are u32 length + u16
// status + body. A connection that cannot be opened means nothing reached the Core, so that call goes over HTTP; once a
// packet is written, any failure is a failure (never replayed) and the connection is dropped, so a late answer can never be
// read as the next call's.
let socket:Socket|undefined,opening:Promise<Socket|undefined>|undefined;
function frame(text:string){const n=Buffer.byteLength(text),out=Buffer.allocUnsafe(4+n);out.writeUInt32BE(n,0);out.write(text,4,'utf8');return out;}
function open():Promise<Socket|undefined>{
 if(socket)return Promise.resolve(socket);
 if(!privateDir())return Promise.resolve(undefined);
 return opening??=new Promise<Socket|undefined>(resolve=>{
  const s=connect(workerData.socket);const timer=setTimeout(()=>{s.destroy();resolve(undefined);},300);
  s.once('connect',()=>{clearTimeout(timer);s.on('error',()=>{});s.on('close',()=>{if(socket===s)socket=undefined;});s.write(frame('Bearer '+token));socket=s;resolve(s);});
  s.once('error',()=>{clearTimeout(timer);s.destroy();resolve(undefined);});
 }).finally(()=>{opening=undefined;});
}
async function evaluate(encoded:string,limit:number):Promise<unknown>{
 if(!workerData.socket)return viaHttp(encoded,limit);
 const started=performance.now();const s=await open();
 if(!s)return viaHttp(encoded,limit,1200-(performance.now()-started));   // the same absolute deadline
 return new Promise((resolve,reject)=>{
  let chunks:Buffer[]=[],size=0,length=-1,status=0;
  const finish=(error:Error|null,value?:unknown)=>{
   clearTimeout(deadline);s.off('data',data);s.off('close',closed);
   if(error){s.destroy();if(socket===s)socket=undefined;reject(error);}else resolve(value);
  };
  const data=(chunk:Buffer)=>{
   chunks.push(chunk);size+=chunk.length;
   if(length<0){
    if(size<6)return;
    const head=Buffer.concat(chunks,size);chunks=[head];length=head.readUInt32BE(0);status=head.readUInt16BE(4);
    if(length>limit)return finish(Error('policy_response_too_large'));
   }
   if(size<6+length)return;
   if(size>6+length||status<200||status>=300)return finish(Error('policy_request_rejected'));
   try{finish(null,JSON.parse(Buffer.concat(chunks,size).toString('utf8',6)));}catch(error){finish(error as Error);}
  };
  const closed=()=>finish(Error('policy_socket_closed'));
  const deadline=setTimeout(()=>finish(Error('policy_request_timeout')),Math.max(1,1200-(performance.now()-started)));   // same absolute deadline, connect included
  s.on('data',data);s.on('close',closed);s.write(frame(encoded));
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
