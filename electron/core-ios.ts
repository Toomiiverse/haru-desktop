import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';
import WebSocket from 'ws';
import {coreServiceOptions,CoreServiceClient} from './core-service-client';
import {coreAdapterOwner} from './core-policy-sync';

const origin=new AsyncLocalStorage<string|undefined>();
export function withIOSOrigin<T>(deviceId:string|undefined,run:()=>T):T{return origin.run(deviceId,run);}
// Transport only. Core validates the retained task command, chooses the device
// and authorizes effects. This adapter never chooses a fallback or resends work.
function options(){
 const value=coreServiceOptions();if(!value)throw Error('ios_core_unavailable');
 new CoreServiceClient(value);
 return {...value,token:fs.readFileSync(value.tokenFile,'utf8').trim()};
}
export async function runIOSTool(name:string|undefined,args:unknown,binding:unknown){
 if(!name?.startsWith('ios_'))return null;
 if(!binding)return JSON.stringify({ok:false,error:'ios_native_binding_required',executed:false});
 const o=options();
 const response=await fetch(o.endpoint.replace(/\/$/,'')+'/v1/ios/adapter',{
  method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+o.token},
  body:JSON.stringify({owner:coreAdapterOwner(),nowMs:Date.now(),command:binding,originDeviceId:origin.getStore()}),signal:AbortSignal.timeout(45000)});
 const result=await response.json();if(!response.ok)throw Error(result.detail??'ios_core_unavailable');
 return JSON.stringify(result);
}
export function bridgeIOS(socket:WebSocket,deviceId:string,authenticated:()=>boolean){
 const o=options();
 const peer=new WebSocket(o.endpoint.replace(/^http:/,'ws:').replace(/\/$/,'')+'/v1/ios/device',{
  headers:{authorization:'Bearer '+o.token},maxPayload:262144,handshakeTimeout:3000});
 const held:string[]=[];let opened=false,closed=false;
 const close=()=>{if(closed)return;closed=true;peer.close();socket.close();};
 peer.once('open',()=>{peer.send(JSON.stringify({deviceId,owner:coreAdapterOwner(),nowMs:Date.now()}));opened=true;for(const frame of held)peer.send(frame);held.length=0;});
 socket.on('message',(bytes,binary)=>{
  if(!authenticated()){close();return;}
  if(binary||Buffer.byteLength(bytes.toString())>262144){socket.close(1009);close();return;}
  const frame=bytes.toString();if(opened)peer.send(frame);else if(held.length<4)held.push(frame);else close();});
 peer.on('message',(bytes,binary)=>{if(!binary&&socket.readyState===WebSocket.OPEN)socket.send(bytes.toString());else close();});
 peer.on('error',close);socket.on('error',close);peer.once('close',close);socket.once('close',close);
}
