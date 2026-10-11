// The provider adapter observes residency; native Core bounds the allowance by
// the actual task deadline. Unknown state retains the existing warm limit.
import {activeTask} from './task-controller';
import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import type {ProviderConfig} from './model-registry';
import {isLocalConfig} from './model-registry';
type Fetcher=(url:string,init:{signal:AbortSignal})=>Promise<Response>;
export function modelResidency(payload:unknown,model:string,context:number):'warm'|'cold'|'unknown' {
  if(!payload||typeof payload!=='object'||!Array.isArray((payload as any).models))return 'unknown';
  const rows=(payload as any).models;
  if(rows.some((row:any)=>!row||typeof row!=='object'))return 'unknown';
  const present=rows.find((row:any)=>row.name===model||row.model===model);
  if(!present)return 'cold';
  return Number.isInteger(present.context_length)&&present.context_length>=context?'warm':Number.isInteger(present.context_length)?'cold':'unknown';
}
export async function coreLocalBudget(config:ProviderConfig,context:number,fetcher:Fetcher):Promise<number|undefined> {
  if((false as boolean))return;
  const task=activeTask.getStore();if(!task||!isLocalConfig(config))throw Error('core_local_budget_requires_local_task');
  const options=coreServiceOptions();if(!options)throw Error('core_local_budget_requires_service');
  let residency:'warm'|'cold'|'unknown'='unknown';
  const client=new CoreServiceClient(options);
  const started=performance.now();
  const [binding]=await Promise.all([task.binding(),(async()=>{
    try{
      if((true as boolean)){
        residency=(await client.modelResidency({version:1,model:config.model,endpoint:config.endpoint.replace(/\/+$/,'').replace('://localhost:', '://127.0.0.1:'),context_tokens:context},task.signal)).residency;
        return;
      }
      const response=await fetcher(config.endpoint.replace(/\/+$/,'')+'/api/ps',{signal:AbortSignal.any([task.signal,AbortSignal.timeout(1000)])});
      if(response.ok)residency=modelResidency(await response.json(),config.model,context);
    }catch{/* Unknown residency does not grant a cold-start extension. */}
  })()]);
  const result=await client.localBudget({version:1,task_id:binding.taskId,revision:binding.revision,model:config.model,context_tokens:context,residency});
  console.log('[local-budget] '+JSON.stringify({model:config.model,residency,limitMs:result.limit_ms,taskLimited:result.task_limited,totalMs:performance.now()-started}));
  return result.limit_ms;
}
