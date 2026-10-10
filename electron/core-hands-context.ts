/** Transport-only binding of Core's persisted hands intent to its native task. */
import {AsyncLocalStorage} from 'node:async_hooks';
import type {TaskRPC} from './task-bridge';

export const activeHandsIntent=new AsyncLocalStorage<{taskId:string;assertCurrent:()=>void}>();

export function handsTaskRPC(rpc:TaskRPC):TaskRPC {
  if(process.env.HARU_CORE_HANDS_RECOVERY!=='on')return rpc;
  const intent=activeHandsIntent.getStore();
  if(!intent||typeof intent.taskId!=='string'||!intent.taskId)throw Error('hands_task_binding_required');
  return (method,params)=>{
    if(method==='create'){
      intent.assertCurrent();
      if(Object.hasOwn(params,'id')&&params.id!==intent.taskId)throw Error('hands_task_binding_mismatch');
      return rpc(method,{...params,id:intent.taskId});
    }
    return rpc(method,params);
  };
}
