/** Authenticated audio/evidence transport. Core owns identity, thresholds and notices. */
import {randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {coreAdapterOwner} from './core-policy-sync';
import {coreServiceOptions} from './core-service-client';

export type SpeakerDecision={allow:boolean;enforcing?:boolean;speaker?:string;reason?:string;notice?:string|null;audio?:string};
export const speakerEnabled=()=>process.env.HARU_CORE_SPEAKER_IDENTITY==='on';
export async function speakerRequest(op:string,args:Record<string,unknown>={},signal?:AbortSignal):Promise<any>{
 const opts=coreServiceOptions();if(!opts)throw Error('speaker_service_unavailable');
 const url=new URL(opts.endpoint);
 if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('speaker_loopback_required');
 if(statSync(opts.tokenFile).mode&0o077)throw Error('speaker_token_must_be_private');
 const packet={...args,version:1,op,owner:coreAdapterOwner(),requestId:randomUUID(),nowMs:Date.now()};
 const response=await fetch(url.origin+'/v1/speaker',{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+readFileSync(opts.tokenFile,'utf8').trim()},body:JSON.stringify(packet),signal:AbortSignal.any([AbortSignal.timeout(25000),...(signal?[signal]:[])])});
 if(!response.ok){const body=await response.json().catch(()=>null);throw Error(typeof body?.detail==='string'?body.detail:'speaker_service_unavailable');}
 const result=await response.json();
 if(result.version!==1||result.requestId!==packet.requestId||result.op!==op||!result.result||typeof result.result!=='object')throw Error('speaker_protocol_error');
 signal?.throwIfAborted();return result.result;
}
export async function openSpeaker(){
 const opened=await speakerRequest('open');
 if(typeof opened.sessionId!=='string')throw Error('speaker_session_invalid');
 let sequence=0,closed=false;
 const abort=new AbortController();
 const check=async(audio:Uint8Array,final:boolean,busy:boolean,signal?:AbortSignal):Promise<SpeakerDecision>=>{
  if(closed)throw Error('speaker_session_closed');
  const result=await speakerRequest('assess',{sessionId:opened.sessionId,sequence:++sequence,audio:Buffer.from(audio).toString('base64'),final,busy},AbortSignal.any([abort.signal,...(signal?[signal]:[])]));
  if(typeof result.allow!=='boolean'||result.notice!=null&&typeof result.notice!=='string')throw Error('speaker_decision_invalid');
  return result;
 };
 return {enabled:opened.enabled===true,check,
  async confirm(signal?:AbortSignal){if(closed)throw Error('speaker_session_closed');return speakerRequest('confirm',{sessionId:opened.sessionId,sequence:++sequence},AbortSignal.any([abort.signal,...(signal?[signal]:[])]));},
  async notice(busy:boolean){if(closed)return {notice:null};return speakerRequest('notice',{sessionId:opened.sessionId,sequence:++sequence,busy},abort.signal);},
  async frame(audio:Uint8Array,busy:boolean):Promise<SpeakerDecision>{
   if(closed)throw Error('speaker_session_closed');
   const result=await speakerRequest('frame',{sessionId:opened.sessionId,sequence:++sequence,audio:Buffer.from(audio).toString('base64'),busy},abort.signal);
   if(typeof result.audio!=='string'||typeof result.allow!=='boolean')throw Error('speaker_frame_invalid');
   return result;
  },frameBytes:opened.frameBytes as number,maxPendingBytes:opened.maxPendingBytes as number,
  close(){if(closed)return;closed=true;abort.abort();void speakerRequest('close',{sessionId:opened.sessionId}).catch(()=>{});}
 };
}
export type SpeakerSession=Awaited<ReturnType<typeof openSpeaker>>;
/** Dictation is checked before transcription and before hearing/memory side effects. */
export async function verifyDictation(audio:Uint8Array,signal?:AbortSignal){
 const session=await openSpeaker();try{if(!session.enabled)return {allow:true,notice:null};return await session.check(audio,true,false,signal);}finally{session.close();}
}
/** EVI has no local utterance hook. Execute Core-returned PCM only, in exact order. */
export function speakerEviTransport(session:SpeakerSession,target:{sendAudio(pcm:Uint8Array):void;close(reason?:string):void},notice:(text:string)=>void){
 let pending=Buffer.alloc(0),queued=0,busy=false,closed=false,chain=Promise.resolve();
 if(!Number.isInteger(session.frameBytes)||session.frameBytes<640||session.frameBytes>12800||!Number.isInteger(session.maxPendingBytes)||session.maxPendingBytes>256000)throw Error('speaker_buffer_invalid');
 const close=(reason?:string)=>{if(closed)return;closed=true;pending=Buffer.alloc(0);session.close();target.close(reason);};
 return {sendAudio(pcm:Uint8Array){
  if(closed)return;
  if(pcm.length%2){close('Invalid microphone audio.');return;}
  pending=Buffer.concat([pending,pcm]);
  if(pending.length+queued>session.maxPendingBytes){close('Voice recognition could not keep up. Please reconnect.');return;}
  while(pending.length>=session.frameBytes){
   const part=pending.subarray(0,session.frameBytes);pending=pending.subarray(session.frameBytes);queued+=part.length;
   chain=chain.then(async()=>{if(closed)return;const result=await session.frame(part,busy);if(closed)return;if(result.audio)target.sendAudio(Buffer.from(result.audio,'base64'));if(result.notice)notice(result.notice);}).catch(()=>close('Voice recognition is unavailable. Please reconnect.')).finally(()=>{queued-=part.length;});
  }
 },herSpeaking(on:boolean){busy=on;if(!on)chain=chain.then(async()=>{if(closed)return;const result=await session.notice(busy);if(!closed&&result.notice)notice(result.notice);}).catch(()=>close('Voice recognition is unavailable. Please reconnect.'));},close};
}
