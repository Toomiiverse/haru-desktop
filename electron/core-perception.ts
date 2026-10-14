// Core owns one perception request; the existing local vision transport remains
// an adapter. Current foreground tasks keep their existing reservation owner.
import {coreModelFetch} from './core-model-provider';
import {look,visionConversation,type Sighting,type LookOptions} from './vision';
import {TaskController,activeTask} from './task-controller';
import {isLocalConfig,type ModelEntry,type ProviderConfig,type TaskPolicy} from './model-registry';
import {turnImages} from './core-harness-media';
import type {ChatMessage} from './provider';
import type {TaskRPC} from './task-bridge';
import {coreObservation} from './core-live-state';
import {randomUUID} from 'node:crypto';
export type PerceptionDeps={rpc:TaskRPC;registry:()=>ModelEntry[];policy:()=>TaskPolicy};
export async function coreLook(args:Parameters<typeof look>,deps:PerceptionDeps):ReturnType<typeof look> {
  
  const [image,vision,endpoint,headers,fetcher,provided={}]=args;
  const options=provided as typeof provided&{priority?:'foreground'|'background'};
  const config={provider:'ollama',model:vision.model,endpoint,temperature:options.temperature??.2};
  if(!isLocalConfig(config))throw Error('core_perception_loopback_required');
  const messages=visionConversation(image,options);let sighting:Sighting|undefined;
  const request=(task:TaskController)=>task.post(messages,config,[],options.numPredict,async(signal,_chunk,maxTokens)=>{
    sighting=await look(image,vision,endpoint,headers,(url,init)=>coreModelFetch(fetcher,url,init),{...options,numPredict:maxTokens,
      signal:options.signal?AbortSignal.any([options.signal,signal]):signal});
    return {role:'assistant',content:sighting.description};
  },undefined,undefined,options.signal);
  const existing=activeTask.getStore();
  {
    const priority=existing?.taskPriority??options.priority??'foreground';
    const observed=coreObservation('VisionFrame',priority==='background'?'background-vision':'foreground-vision',
      {media_id:randomUUID(),frames:Array.isArray(image)?image.length:1,priority});
    if(priority==='background') {
      if(!(await observed).allowed)throw Error('background_inference_deferred');
    } else void observed.catch(()=>console.log('[core-state] '+JSON.stringify({event:'observation_unavailable',kind:'VisionFrame'})));
  }
  if(existing){await request(existing);return sighting!;}
  
  const task=new TaskController(deps.rpc,deps.registry(),{...deps.policy(),taskBudgetMicros:0,dailyBudgetMicros:0,maxAttempts:1,
    maxToolCalls:0,maxEscalations:0,deadlineMs:options.timeoutMs??120000},false);
  await task.start('Local image perception (no actions)',vision.model,options.priority??'foreground');
  await task.compose(()=>request(task),messages);
  return sighting!;
}

/** 3820: a picture read by the Core's hosted reader entry (Baseten DeepSeek) for a chat model that can't see. It crosses the
 *  Core's calls as a reference (send puts the bytes back at the provider); one attempt, no tools, the reader's deadline. */
export async function coreHostedLook(images:string|string[],entry:ModelEntry,options:LookOptions&{timeoutMs?:number},deps:{rpc:TaskRPC;policy:()=>TaskPolicy;
  send:(messages:ChatMessage[],config:ProviderConfig,options:{tools:false;table:[];maxTokens?:number})=>Promise<ChatMessage>}):Promise<Sighting>{
  const messages=turnImages.toCore(visionConversation(images,options) as ChatMessage[]);
  const task=new TaskController(deps.rpc,[entry],{...deps.policy(),maxAttempts:1,maxToolCalls:0,maxEscalations:0,deadlineMs:options.timeoutMs??15000},true);
  await task.start('Picture reading (no actions)',entry.config.model,'foreground',options.signal);
  return {description:await task.compose(()=>deps.send(messages,entry.config,{tools:false,table:[],maxTokens:options.numPredict}),messages),model:entry.config.model};
}
