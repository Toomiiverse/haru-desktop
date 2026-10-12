import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import {applyRemainingPlan} from './core-remaining';
import type {CoreStore} from './core-store';
import type {ShellConfig,Ran} from './shell';
export async function runCoreShell(input:{command:string;said:string;door:string},host:{core:CoreStore;system:()=>unknown;home:string;run:(command:string,config:ShellConfig)=>Promise<Ran>;ledger:(text:string)=>void}){
 const task=activeTask.getStore();if(!task)throw Error('shell_task_required');await task.check();
 const read=()=>host.core.get('config',{});
 let packet=corePolicySync<any>('final-shell.start',[read(),host.system(),host.home,{...input,now:Date.now()}]);
 for(let n=0;n<4;n++){
  if(Object.hasOwn(packet,'result')){if(packet.ledger){try{host.ledger(packet.ledger)}catch(error){console.warn('[shell] ledger not written',error)}}return packet.result;}
  await task.check();const c=packet.command;
  if(c.kind==='commit'){
   applyRemainingPlan(host.core,c.plan);packet=corePolicySync('final-shell.observed',[packet.state,{ok:true,phase:'commit'}]);
  }else if(c.kind==='run'){
   if(JSON.stringify(read())!==JSON.stringify(c.expected))throw Error('shell_snapshot_stale');
   // External effects are never retried after exceptions or lost acknowledgements.
   const ran=await host.run(c.command,c.config);await task.check();
   packet=corePolicySync('final-shell.observed',[packet.state,{ok:true,ran,at:new Date().toISOString()}]);
  }else throw Error('shell_command_protocol');
 }
 throw Error('shell_program_bound');
}
