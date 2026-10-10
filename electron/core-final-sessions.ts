import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import {applyRemainingPlan} from './core-remaining';
import type {CoreStore} from './core-store';
import type {DirLookup,Run} from './claudesession';
export function coreSessionLink(host:{core:CoreStore;home:string;systemdRun:string|null;dirs:DirLookup;run:Run;sleep:(ms:number)=>Promise<void>}){
 const read=()=>host.core.get('config',{}),now=()=>({ms:Date.now(),iso:new Date().toISOString()});
 const run=async(action:string,args:unknown)=>{
  const task=activeTask.getStore();if(!task)throw Error('session_task_required');await task.check();
  let packet=corePolicySync<any>('final-sessions.start',[action,args,read(),host.home,host.systemdRun,now()]);
  for(let n=0;n<256;n++){
   if(Object.hasOwn(packet,'result'))return packet.result;await task.check();const c=packet.command;let value:unknown;
   if(c.kind==='commit')applyRemainingPlan(host.core,c.plan);
   else if(c.kind==='inspect')value={isDir:host.dirs.isDir(c.path),real:host.dirs.real(c.path),realHome:host.dirs.real(c.home)};
   else if(c.kind==='sleep')await host.sleep(c.ms);
   else if(c.kind==='run'){
    // Immediate capability/config revocation is adapter enforcement, not selection.
    if(JSON.stringify(read().claudeCode)!==JSON.stringify(packet.state.raw))throw Error('session_configuration_changed');
    value=await host.run(c.file,c.args,c.options);
   }else throw Error('session_command_protocol');
   await task.check();packet=corePolicySync('final-sessions.observed',[packet.state,{ok:true,value},read(),now()]);
  }
  throw Error('session_program_bound');
 };
 return {open:(args:{folder:string;name:string})=>run('open',args),list:()=>run('list',{}),stop:(id:string)=>run('stop',{id})};
}
