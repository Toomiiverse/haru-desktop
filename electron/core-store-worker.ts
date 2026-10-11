// Electron's JS worker bridges synchronous store commits to a separate Node
// process. SQLite's native module never loads into Electron's ABI.
import { parentPort, workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { CoreServiceClient, CoreServiceError, type CoreServiceOptions } from './core-service-client';
const config=workerData as {root:string;db:string;node:string;desktop:string;service?:CoreServiceOptions};
const pending=new Map<string,SharedArrayBuffer>();let failed=false;
function finish(buffer:SharedArrayBuffer,value:unknown){
 const header=new Int32Array(buffer,0,2),bytes=Buffer.from(JSON.stringify(value));
 if(bytes.length>buffer.byteLength-8){Atomics.store(header,1,0);Atomics.store(header,0,-1);}
 else{new Uint8Array(buffer,8,bytes.length).set(bytes);Atomics.store(header,1,bytes.length);Atomics.store(header,0,1);}
 Atomics.notify(header,0);
}
if(config.service){
 const client=new CoreServiceClient(config.service);
 let queue=Promise.resolve();
 parentPort!.on('message',({request,buffer,stop})=>{
  if(stop)return;
  // Preserve parent-port order across async commits and synchronous read fences.
  queue=queue.then(async()=>{
   // Closing a desktop client must never close the independent authority.
   if(request.method==='close'){finish(buffer,{id:request.id,ok:true,result:{closed:true}});return;}
   try{const result=await client.call('storage',request.method,request.params,request.id);finish(buffer,{id:request.id,ok:true,result});}
   catch(error){finish(buffer,{id:request.id,ok:false,error:(error instanceof CoreServiceError)&&error.code==='authority_revision_conflict'?'authority_revision_conflict':'authority_remote_unconfirmed'});}
  });
 });
}else{
const child=spawn(config.node,['--import',pathToFileURL(path.join(config.root,'node_modules/tsx/dist/loader.mjs')).href,path.join(config.root,'src/cli/storage-worker.ts'),'--db',config.db,'--desktop',config.desktop],{stdio:['pipe','pipe','pipe'],windowsHide:true});
const fail=()=>{failed=true;for(const [id,buffer] of pending){finish(buffer,{id,ok:false,error:'authority_worker_unavailable'});}pending.clear();};
child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{/* Never forward data-bearing diagnostics into application logs. */});
createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{try{const r=JSON.parse(line),buffer=pending.get(r.id);if(buffer){pending.delete(r.id);finish(buffer,r);}}catch{fail();child.kill();}});
parentPort!.on('message',({request,buffer,stop})=>{
 if(stop){child.stdin.end();return;}
 if(failed){finish(buffer,{id:request.id,ok:false,error:'authority_worker_unavailable'});return;}
 pending.set(request.id,buffer);child.stdin.write(JSON.stringify(request)+'\n');
});
parentPort!.on('close',()=>child.stdin.end());
}
