import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
export async function runCorePicture(prompt:string,host:{hasKey:()=>boolean;explicit:()=>boolean;generate:(prompt:string,safeMode:boolean)=>Promise<{made:unknown}>;keep:(id:string)=>boolean;attach:(picture:any)=>void;sweep:()=>void}):Promise<any>{
 const task=activeTask.getStore();if(!task)throw Error('picture_task_required');await task.check();
 let packet=corePolicySync<any>('final-picture.start',[prompt,host.hasKey(),host.explicit()]);
 for(let n=0;n<8;n++){
  if(Object.hasOwn(packet,'result'))return packet.result;await task.check();const c=packet.command;let value:unknown;
  if(c.kind==='generate'){if(!host.hasKey())throw Error('picture_capability_revoked');value=await host.generate(c.prompt,c.safeMode!==false);}
  else if(c.kind==='keep')value=host.keep(c.id);
  else if(c.kind==='attach')host.attach(c.picture);
  else if(c.kind==='sweep')host.sweep();else throw Error('picture_command_protocol');
  await task.check();packet=corePolicySync('final-picture.observed',[packet.state,{ok:true,value}]);
 }
 throw Error('picture_program_bound');
}
