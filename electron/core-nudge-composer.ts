/** Core controls two tool-free phases. Existing provider adapters own inference/accounting. */
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import {NUDGE_REVIEW_SCHEMA,readNudge,type NudgeSubject,type NudgeFeedback} from './nudges';
import type {NudgeTone} from './asides';
const LIMIT=262144;
export type ComposeInput={subject:NudgeSubject;model:string;contextAtMs:number;contextTokens:number;clock:string;mood:string;continuity:string;
  stranger:boolean;deliveryTone:NudgeTone;correction:NudgeFeedback|null};
export type NudgeComposeResult={line:string|null;reason:'accepted'|'invalid_draft'|'content_refused'|'review_refused';feedback:NudgeFeedback|null;system:string;modelCalls:number};
export type ComposerAsk=(conversation:{role:string;content:string}[],options:{tools:false;temperature:number;maxTokens:number;numCtx:number;format?:object;signal:AbortSignal})=>Promise<{role?:string;content?:string;tool_calls?:unknown[]}>;
export type ComposerAsides=()=>{atMs:number|null;text:string}[];
export async function coreComposeNudge(input:ComposeInput,ask:ComposerAsk,asides:ComposerAsides):Promise<NudgeComposeResult> {
  if(process.env.HARU_CORE_NUDGE_COMPOSER!=='on')throw Error('core_nudge_composer_disabled');
  const options=coreServiceOptions();if(!options||process.env.HARU_CORE_BRAIN_WORKER!=='on')throw Error('core_nudge_composer_owner_required');
  new CoreServiceClient(options);
  const token=readFileSync(options.tokenFile,'utf8').trim(),stat=readFileSync(`/proc/${process.pid}/stat`,'utf8');
  const start={version:1,op:'compose',owner:{pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]},nowMs:Date.now(),...input};
  const encoded=JSON.stringify(start);if(Buffer.byteLength(encoded)>LIMIT)throw Error('core_nudge_composer_frame_too_large');
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(options.endpoint.replace(/^http:/,'ws:').replace(/\/$/,'')+'/v1/nudges/compose',
      {headers:{authorization:`Bearer ${token}`},maxPayload:LIMIT,handshakeTimeout:3000});
    const abort=new AbortController();let selected=false,done=false,sequence=0,busy=false,deferred:Error|undefined;
    const finish=(error?:Error,result?:NudgeComposeResult)=>{
      if(done)return;abort.abort();
      if(busy){deferred=error??Error('core_nudge_composer_protocol_error');return;}
      done=true;clearTimeout(startTimer);clearTimeout(totalTimer);socket.close();error?reject(error):resolve(result!);
    };
    const startTimer=setTimeout(()=>finish(Error('core_nudge_composer_start_timeout')),3500);
    const totalTimer=setTimeout(()=>finish(Error('core_nudge_composer_deadline')),365000);
    socket.once('open',()=>socket.send(encoded));
    socket.on('error',()=>finish(Error('core_nudge_composer_unavailable')));
    socket.once('close',()=>{if(!done)finish(Error(selected?'core_nudge_composer_outcome_unconfirmed':'core_nudge_composer_unavailable'));});
    socket.on('message',async raw=>{
      if(done)return;
      try {
        const event=JSON.parse(String(raw));if(event.version!==1)throw Error('core_nudge_composer_protocol_error');
        if(event.kind==='started'){
          if(selected||busy||sequence||event.executes!==false)throw Error('core_nudge_composer_protocol_error');
          selected=true;clearTimeout(startTimer);return;
        }
        if(event.kind==='failed')return finish(Error('core_nudge_composer_failed'));
        if(event.kind==='completed'){
          const r=event.result;
          if(!selected||busy||event.executes!==false||!r||!['accepted','invalid_draft','content_refused','review_refused'].includes(r.reason)
            ||typeof r.system!=='string'||Buffer.byteLength(r.system)>131072||r.modelCalls!==sequence||sequence<1||sequence>2
            ||r.reason==='accepted'&&(typeof r.line!=='string'||readNudge(r.line)!==r.line||r.feedback!==null||sequence!==2)
            ||r.reason!=='accepted'&&(r.line!==null||!r.feedback||typeof r.feedback.line!=='string'||typeof r.feedback.reason!=='string'
              ||r.feedback.line.length>4096||r.feedback.reason.length>4096)
            ||r.reason==='review_refused'&&sequence!==2||['invalid_draft','content_refused'].includes(r.reason)&&sequence!==1)throw Error('core_nudge_composer_protocol_error');
          return finish(undefined,r);
        }
        if(!selected||busy||event.kind!=='command'||event.seq!==sequence+1||event.seq>2||event.phase!==(event.seq===1?'draft':'review')
          ||!Array.isArray(event.conversation)||event.conversation.length!==2||event.conversation[0]?.role!=='system'||event.conversation[1]?.role!=='user'
          ||event.conversation.some((m:any)=>typeof m.content!=='string'||Object.keys(m).sort().join(',')!=='content,role'))throw Error('core_nudge_composer_protocol_error');
        const o=event.options;
        if(!o||o.tools!==false||o.numCtx!==input.contextTokens||o.temperature!==(event.seq===1?1:0)||o.maxTokens!==(event.seq===1?160:320)
          ||Object.keys(o).sort().join(',')!==(event.seq===1?'maxTokens,numCtx,temperature,tools':'format,maxTokens,numCtx,temperature,tools')
          ||event.seq===2&&JSON.stringify(o.format)!==JSON.stringify(NUDGE_REVIEW_SCHEMA))throw Error('core_nudge_composer_options_invalid');
        sequence=event.seq;busy=true;
        try {
          const reply=await ask(event.conversation,{...o,signal:abort.signal});
          if(reply?.role!=='assistant'||typeof reply.content!=='string'||reply.tool_calls?.length)throw Error('core_nudge_composer_reply_invalid');
          const answer=JSON.stringify({version:1,seq:sequence,ok:true,result:{content:reply.content,...(sequence===1?{asides:asides()}:{})}});
          if(Buffer.byteLength(answer)>LIMIT)throw Error('core_nudge_composer_frame_too_large');
          if(!deferred&&socket.readyState===WebSocket.OPEN)socket.send(answer);
        } catch {
          if(!deferred&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({version:1,seq:sequence,ok:false,error:'adapter_failed'}));
          else if(!deferred)deferred=Error('core_nudge_composer_adapter_failed');
        } finally {busy=false;if(deferred)finish(deferred);}
      } catch {finish(Error('core_nudge_composer_protocol_error'));}
    });
  });
}
