// Adapt the existing provider request to a neutral Core ModelProvider command.
// Disabled mode forwards the exact original URL/options; no retries here.
import {randomUUID} from 'node:crypto';
import {activeAttempt} from './task-controller';
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
export async function coreModelCapabilities(config:{model:string;endpoint:string}){
  const options=coreServiceOptions();if(!options)throw Error('core_model_service_required');
  const address=new URL(config.endpoint);if(address.hostname==='localhost')address.hostname='127.0.0.1';
  return new CoreServiceClient(options).modelCapabilities({version:1,model:config.model,endpoint:address.origin});
}
export function neutralModelInput(body:any){
  if(!body||typeof body.model!=='string'||!Array.isArray(body.messages)||!body.options||typeof body.stream!=='boolean')throw Error('core_model_input_invalid');
  const allowed=new Set(['temperature','num_ctx','num_predict']);
  if(Object.keys(body.options).some(key=>!allowed.has(key))||Object.keys(body).some(key=>!['model','messages','tools','format','think','stream','keep_alive','options'].includes(key)))throw Error('core_model_option_unqualified');
  return {messages:body.messages,tools:body.tools??[],schema:body.format??null,temperature:body.options.temperature,
    context_tokens:body.options.num_ctx,max_tokens:body.options.num_predict??null,thinking:body.think??null,
    keep_alive:body.keep_alive??-1,stream:body.stream,request_type:body.messages.some((row:any)=>row.images?.length)?'perception':'conversation'};
}
export async function coreModelFetch<T extends RequestInit>(fetcher:(url:string,init:T)=>Promise<Response>,url:string,init:T):Promise<Response>{
  
  const address=new URL(url);
  if(address.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(address.hostname)||address.pathname!=='/api/chat'
    ||address.username||address.password||address.search||address.hash||init?.method!=='POST'||typeof init.body!=='string')throw Error('core_model_loopback_required');
  const attempt=activeAttempt.getStore();if(!attempt)throw Error('core_model_attempt_required');
  const options=coreServiceOptions();if(!options)throw Error('core_model_service_required');
  const body=JSON.parse(init.body);if(body.model!==attempt.model)throw Error('core_model_attempt_mismatch');
  if(address.hostname==='localhost')address.hostname='127.0.0.1';
  return new CoreServiceClient(options).model({version:1,dispatch_id:randomUUID(),task_id:attempt.taskId,revision:attempt.revision,
    attempt_id:attempt.attemptId,model:attempt.model,endpoint:address.origin,input:{...neutralModelInput(body),priority:attempt.priority??'foreground'}},init.signal??undefined);
}
