// Existing request/response codecs stay intact; Core owns outbound execution.
import {randomUUID} from 'node:crypto';
import {activeAttempt} from './task-controller';
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import {assertOutboundSafe} from './outbound';
import {directCredentialName} from './direct-providers';
import {providerPrivacyView} from './provider-state';
import {toolReceiptPrivacyText} from './tool-receipt';

export function cloudWirePrivacyView(body:any,wire:string){
  const view=structuredClone(body);
  const clean=(value:any):void=>{
    if(!value||typeof value!=='object')return;
    if(value.type==='image_url'||value.type==='input_image'||value.type==='image'){
      delete value.image_url;delete value.source;
    }
    for(const child of Object.values(value))clean(child);
  };clean(view);
  if(wire==='openai')for(const row of view.messages??[]){
    const content=row.content;
    Object.assign(row,providerPrivacyView({...row,content:typeof content==='string'?content:''}));
    if(Array.isArray(content))row.content=content;
  }
  if(wire==='anthropic')for(const row of view.messages??[]){
    row.content=providerPrivacyView({role:'assistant',provider_state:{model:body.model,content:row.content}}).provider_state!.content;
    for(const block of row.content)if(block.type==='tool_result'&&typeof block.content==='string')block.content=toolReceiptPrivacyText(block.content);
  }
  if(wire==='responses')for(const item of view.input??[]){
    if(['reasoning','function_call','function_call_output'].includes(item.type)){
      Object.assign(item,providerPrivacyView({role:'assistant',provider_state:{model:body.model,content:[item]}}).provider_state!.content[0]);
      if(item.type==='function_call_output'&&typeof item.output==='string')item.output=toolReceiptPrivacyText(item.output);
    }
  }
  return view;
}

export async function coreCloudFetch<T extends RequestInit>(fetcher:(url:string,init:T)=>Promise<Response>,url:string,init:T):Promise<Response>{
  
  const address=new URL(url),body=typeof init.body==='string'?JSON.parse(init.body):null;
  const formats=[['/chat/completions','openai'],['/messages','anthropic'],['/responses','responses']] as const;
  const route=formats.find(([suffix])=>address.pathname.endsWith(suffix));
  if(!route||init.method!=='POST'||address.protocol!=='https:'||address.username||address.password||address.search||address.hash
    ||(address.port&&address.port!=='443')||(!directCredentialName(url)&&address.hostname!=='api.venice.ai'))throw Error('core_cloud_endpoint_required');
  const attempt=activeAttempt.getStore();if(!attempt)throw Error('core_cloud_attempt_required');
  if(!body||body.model!==attempt.model||typeof body.stream!=='boolean')throw Error('core_cloud_attempt_mismatch');
  // Scan the final shaped body too. Images are binary evidence, not secret text.
  const textView=cloudWirePrivacyView(body,route[1]);
  assertOutboundSafe([{role:'system',content:JSON.stringify(textView)}]);
  const headers=new Headers(init.headers),credential=route[1]==='anthropic'?headers.get('x-api-key')??'':(headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
  const options=coreServiceOptions();if(!options)throw Error('core_cloud_service_required');
  return new CoreServiceClient(options).cloudModel({version:1,dispatch_id:randomUUID(),task_id:attempt.taskId,revision:attempt.revision,
    attempt_id:attempt.attemptId,model:attempt.model,endpoint:address.origin+address.pathname.slice(0,-route[0].length),input:{
      wire_format:route[1],body,credential,privacy_checked:true,priority:attempt.priority??'foreground',request_type:'conversation'}},init.signal??undefined);
}
