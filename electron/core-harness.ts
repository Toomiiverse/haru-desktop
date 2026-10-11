import {currentAffect} from './core-affect';
// The Python Core drives rounds. Existing providers, tools and deterministic
// reply checks are adapters; a disconnected turn is never replayed locally.
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import {CoreServiceClient,type CoreServiceOptions} from './core-service-client';
import {HarnessMedia} from './core-harness-media';
import type {ChatMessage} from './provider';
import {toolContract} from './tool-contract';
import {makeToolReceipt} from './tool-receipt';
import {inspectCoreReply} from './core-reply-inspector';
import {textToolCall,ToolLoopFailure,type ToolLoopDeps,type ToolLoopResult} from './toolloop';
const LIMIT=1024*1024;
const QUALITY_FAILURES=new Set(['invalid_tool_call','empty_response','tools_withheld','unsupported_action','unsupported_tickoff','unsupported_lookup','evidence_mismatch','rounds_exhausted']);
export async function runCoreHarness(conversation:ChatMessage[],deps:ToolLoopDeps&{onPresentation?:(text:string)=>void},options:CoreServiceOptions,
  binding:()=>Promise<{taskId:string;revision:number}>,onDisconnect?:()=>void,mode:'conversation'|'composition'='conversation'):Promise<ToolLoopResult|null> {
  new CoreServiceClient(options); // Validate the existing loopback/private-token boundary.
  const token=readFileSync(options.tokenFile,'utf8').trim(),bound=await binding(),media=new HarnessMedia();
  const general=(deps.generalToolSplit===true);
  const programs=false;
  const workerRoles=programs&&deps.runWorker?[...new Set(deps.workerRoles??[])]:[];
  const start={version:1,...(currentAffect()?{affect_event_id:currentAffect()!.eventId}:{}),task_id:bound.taskId,revision:bound.revision,conversation:media.toCore(conversation),max_rounds:deps.maxRounds??4,
    ...(general?{cloud_allowed:deps.generalToolCloudAllowed===true}:{}),
    initial_ran:[...(deps.initialRan??[])],...(deps.maxToolCalls!==undefined?{max_tool_calls:deps.maxToolCalls}:{}),require_contract:!!deps.requireToolContract,...(mode==='composition'?{mode}:{}),
    ...(programs?{worker_roles:workerRoles,max_workflow_rounds:8}:{}),
    supported_profiles:[...(deps.onPresentation?['umbral-presentation-v1']:[]),...(deps.publicLookupPrepared?['public-lookup-prepared-v1']:[]),...(general?['general-tool-split-v1']:[]),...((['grounded-perception'])),...(deps.splitPlanning?['tool-planning']:[]),...((['reply-claims-v1'])),...(programs?['receipt-program-v1']:[])]};
  const encoded=JSON.stringify(start);if(Buffer.byteLength(encoded)>LIMIT)throw Error('core_harness_frame_too_large');
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(options.endpoint.replace(/^http:/,'ws:').replace(/\/$/,'')+'/v1/harness',
      {headers:{Authorization:`Bearer ${token}`},maxPayload:LIMIT,handshakeTimeout:3000});
    let selected=false,done=false,sequence=0,roundLimit=deps.maxRounds??4,programSelected=false,originalError:unknown,operationInFlight=false,pendingAbort:Error|undefined,deferredError:unknown;
    const finish=(error:unknown,result?:ToolLoopResult|null)=>{
      if(done)return;done=true;clearTimeout(timer);deps.signal?.removeEventListener('abort',aborted);
      socket.close();error?reject(error):resolve(result??null);
    };
    const timer=setTimeout(()=>finish(Error('core_harness_start_timeout')),3500);
    const aborted=()=>{const error=new Error('The task was cancelled.');error.name='AbortError';if(operationInFlight)pendingAbort=error;else finish(error);};
    const connectionFailed=(error:unknown)=>{
      if(operationInFlight){deferredError=error;onDisconnect?.();return;}
      finish(error);
    };
    socket.once('open',()=>socket.send(encoded));
    socket.on('error',()=>connectionFailed(originalError??Error('core_harness_unavailable')));
    socket.once('close',()=>{if(!done)connectionFailed(originalError??Error(selected?'core_harness_outcome_unconfirmed':'core_harness_unavailable'));});
    deps.signal?.addEventListener('abort',aborted,{once:true});if(deps.signal?.aborted)return aborted();
    socket.on('message',async raw=>{
      if(done)return;
      try{
        const event=JSON.parse(String(raw));if(event.version!==1)throw Error('core_harness_protocol_error');
        if(event.kind==='unsupported'){
          if(selected||sequence)throw Error('core_harness_scope_changed');return finish(null,null);
        }
        if(event.kind==='started'){
          if(selected||event.taskId!==bound.taskId||event.revision!==bound.revision)throw Error('core_harness_task_mismatch');
          if(event.mode==='general-tool-split'){
            if(!general||event.maxRounds!==8)throw Error('core_harness_profile_invalid');
            roundLimit=event.maxRounds;
          }else if(event.mode==='receipt-program'){
            if(!programs||!Number.isInteger(event.maxRounds)||event.maxRounds<1||event.maxRounds>8)throw Error('core_harness_workflow_invalid');
            programSelected=true;roundLimit=event.maxRounds;
          }else if(event.maxRounds!==undefined)throw Error('core_harness_workflow_invalid');
          selected=true;clearTimeout(timer);deps.log?.('[core-harness] '+JSON.stringify({event:'started',taskId:bound.taskId,revision:bound.revision,...(mode==='composition'?{mode}:{})}));return;
        }
        if(event.kind==='presentation'){
          if(!selected||!deps.onPresentation||event.taskId!==bound.taskId||event.stage!=='opening'
            ||typeof event.text!=='string'||!event.text||event.text.length>600)throw Error('core_presentation_invalid');
          await binding();if(done)return;
          deps.onPresentation(event.text);return;
        }
        if(event.kind==='failed')return connectionFailed(originalError??(QUALITY_FAILURES.has(event.code)
          ?new ToolLoopFailure(String(event.code),String(event.message)):Error('core_harness_'+String(event.code))));
        if(event.kind==='completed'){
          if(!selected)throw Error('core_harness_protocol_error');
          const result=event.result;
          if(!result||typeof result.content!=='string'||result.message?.role!=='assistant'||result.message.content!==result.content
            ||!Array.isArray(result.ran)||!result.ran.every((x:unknown)=>typeof x==='string')||!Array.isArray(result.conversation)
            ||!Number.isInteger(result.rounds)||result.rounds<1||result.rounds>roundLimit)throw Error('core_harness_result_invalid');
          conversation.splice(0,conversation.length,...media.fromCore(result.conversation));
          deps.log?.('[core-harness] '+JSON.stringify({event:'completed',taskId:bound.taskId,rounds:result.rounds,toolCount:result.ran.length,...(mode==='composition'?{mode}:{})}));
          return finish(null,{...result,ran:new Set(result.ran)});
        }
        if(!selected||event.kind!=='command'||event.seq!==sequence+1||event.seq>2048)throw Error('core_harness_sequence_error');
        sequence=event.seq;const payload=event.payload;let result:unknown=null;
        if(event.action!=='worker'&&Array.isArray(payload.conversation))conversation.splice(0,conversation.length,...media.fromCore(payload.conversation));
        try {
          if(event.action==='state'){
            await binding();result={pageWasRead:deps.pageWasRead(),toolsAllowed:deps.toolsAllowed?.()!==false,...(({handsAllowed:deps.handsAllowed(),hasOpenTask:deps.hasOpenTask()}))};
          }else if(event.action==='media'){
            await binding();
            if(!Array.isArray(payload.references)||payload.references.length>4||payload.references.some((x:any)=>typeof x!=='string'))throw Error('core_harness_media_invalid');
            result={images:media.fromCore([{role:'user',images:payload.references}])[0].images};
          }else if(event.action==='tool-snapshot'){
            if(!general||!deps.toolSnapshot)throw Error('core_harness_profile_invalid');
            await binding();result={table:deps.toolsAllowed?.()===false||deps.pageWasRead()?[]:deps.toolSnapshot()};
          }else if(event.action==='ask'){
            if(!Array.isArray(payload.conversation)||typeof payload.tools!=='boolean')throw Error('core_harness_protocol_error');
            if(payload.inputProfile==='general-tool-planning'||payload.inputProfile==='general-tool-response'){
              if(!general||!Number.isInteger(payload.maxTokens)||payload.maxTokens<1||payload.maxTokens>1024
                ||typeof payload.temperature!=='number'||payload.temperature<0||payload.temperature>2
                ||(payload.inputProfile==='general-tool-planning'?(!payload.tools||!['local-planner','conversation','foreground-tools'].includes(payload.candidateId)||!Array.isArray(payload.planningTable)):payload.tools))throw Error('core_harness_profile_invalid');
            }else if(payload.inputProfile==='tool-planning'){
              if(!deps.splitPlanning||!payload.tools||!Array.isArray(payload.planningTable)||payload.planningTable.some((t:any)=>t?.function?.name!=='vault_read'))throw Error('core_harness_profile_invalid');
            }else if(payload.inputProfile==='workflow-response'){
              if(!programSelected||payload.tools||!Number.isInteger(payload.maxTokens)||payload.maxTokens<1||payload.maxTokens>1024)throw Error('core_harness_profile_invalid');
            }else if(payload.inputProfile!==undefined&&(payload.inputProfile!=='grounded-perception'||(false as boolean)||payload.tools))throw Error('core_harness_profile_invalid');
            await binding();if(done)return;operationInFlight=true;let message:ChatMessage;
            try{message=await deps.ask(media.fromCore(payload.conversation),{tools:payload.tools,...(payload.inputProfile?{inputProfile:payload.inputProfile}:{}),...(payload.inputProfile==='tool-planning'?{planningTable:payload.planningTable}:{}),...(payload.inputProfile==='workflow-response'?{maxTokens:payload.maxTokens}:{}),...(payload.inputProfile?.startsWith('general-tool-')?{maxTokens:payload.maxTokens,temperature:payload.temperature,candidateId:payload.candidateId,planningTable:payload.planningTable}:{})});}finally{operationInFlight=false;}
            if(deferredError||pendingAbort)return finish(deferredError??pendingAbort);
            if('workflowResponseUnavailable' in message){
              if(!programSelected||payload.inputProfile!=='workflow-response'||message.workflowResponseUnavailable!==true
                ||message.role!=='assistant'||message.content!==''||message.tool_calls?.length)throw Error('core_harness_response_invalid');
              result={error:'workflow_response_unavailable'};
            }else result={message,...(toolContract(message)!==undefined?{table:toolContract(message)}:{}),
              ...(!message.tool_calls?.length&&message.content?{writtenCall:textToolCall(message.content)}:{})};
          }else if(event.action==='worker'){
            if(!programSelected||!deps.runWorker||!workerRoles.includes(payload.role)||payload.tools!==false
              ||!Array.isArray(payload.conversation)||payload.conversation.length!==2||payload.conversation[0]?.role!=='system'||payload.conversation[1]?.role!=='user'
              ||payload.conversation.some((m:any)=>typeof m.content!=='string'||m.images?.length||m.tool_calls?.length)
              ||!Number.isInteger(payload.maxTokens)||payload.maxTokens<1||payload.maxTokens>768)throw Error('core_harness_worker_invalid');
            await binding();if(done)return;operationInFlight=true;
            try{result=await deps.runWorker(media.fromCore(payload.conversation),{role:payload.role,maxTokens:payload.maxTokens});}finally{operationInFlight=false;}
            if(deferredError||pendingAbort)return finish(deferredError??pendingAbort);
          }else if(event.action==='tool'){
            await binding();if(done)return;operationInFlight=true;const startedAt=Date.now();
            try{result=await deps.runTool(payload.call);}finally{operationInFlight=false;}
            if(pendingAbort||deferredError){
              const call=payload.call,receipt=typeof result==='string'?makeToolReceipt(call.function?.name??'unknown',call.function?.arguments,result,startedAt,Date.now()):result;
              conversation.push({role:'tool',tool_name:call.function?.name,tool_call_id:call.id,content:JSON.stringify(receipt)});
              return finish(deferredError??pendingAbort);
            }
          }else if(event.action==='inspect'){
            await binding();result=inspectCoreReply({...payload,...(payload.conversation?{conversation:media.fromCore(payload.conversation)}:{})},deps);
          }else if(event.action==='reset')deps.resetStream?.();
          else if(event.action==='withdraw')deps.withdrawHands();
          else if(event.action==='failure'){
            try{deps.onCheckFailure?.({code:payload.code,message:payload.message});}catch{/* diagnostics never own completion */}
          }else if(event.action==='log')(deps.log??(()=>{}))(String(payload.line));
          else throw Error('core_harness_unknown_command');
          const answer=JSON.stringify({version:1,seq:sequence,ok:true,result});
          if(Buffer.byteLength(answer)>(event.action==='media'?16*LIMIT:LIMIT))throw Error('core_harness_frame_too_large');
          if(!done&&socket.readyState===WebSocket.OPEN)socket.send(answer);
        }catch(error){
          originalError=error;
          if(pendingAbort||deferredError)return finish(deferredError??pendingAbort??error);
          if(!done&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({version:1,seq:sequence,ok:false,error:'adapter_failed'}));
          else finish(error);
        }
      }catch(error){finish(error);}
    });
  });
}
