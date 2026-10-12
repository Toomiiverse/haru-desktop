import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
export async function runCorePicture(prompt:string,host:{hasKey:()=>boolean;generate:(prompt:string)=>Promise<{made:unknown;url:string}>;push:(c:any)=>Promise<boolean>;windows:(c:any)=>void;sweep:()=>void}):Promise<any>{
 const task=activeTask.getStore();if(!task)throw Error('picture_task_required');await task.check();
 let packet=corePolicySync<any>('final-picture.start',[prompt,host.hasKey()]);
 for(let n=0;n<8;n++){
  if(Object.hasOwn(packet,'result'))return packet.result;await task.check();const c=packet.command;let value:unknown;
  if(c.kind==='generate'){if(!host.hasKey())throw Error('picture_capability_revoked');value=await host.generate(c.prompt);}
  else if(c.kind==='push')value=await host.push(c);
  else if(c.kind==='windows')host.windows(c);
  else if(c.kind==='sweep')host.sweep();else throw Error('picture_command_protocol');
  await task.check();packet=corePolicySync('final-picture.observed',[packet.state,{ok:true,value}]);
 }
 throw Error('picture_program_bound');
}
