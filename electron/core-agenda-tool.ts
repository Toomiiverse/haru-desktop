/** Core selects agenda commands; this boundary retains existing mutation adapters. */
import {corePolicySync} from './core-policy-sync';
import {activeTask} from './task-controller';
import type {ToolDeps} from './tools';
export function runCoreAgendaTool(name:string,args:Record<string,unknown>,latest:string,now:Date,deps:ToolDeps){
  const assertCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();
  assertCurrent();const kept=deps.getKept();
  const packet=corePolicySync<any>('agenda-tool.prepare',[name,args,{latest,kept,now:{year:now.getFullYear(),month:now.getMonth()+1,day:now.getDate()}}]);
  if(Object.hasOwn(packet,'result'))return JSON.stringify(packet.result);
  assertCurrent();
  if(JSON.stringify(deps.getKept())!==JSON.stringify(packet.state.kept))throw Error('core_agenda_selection_stale');
  // Existing application tool authority/native writer still guards these effects.
  // No fallback, alternate match, automatic retry or claim about Google success.
  const command=packet.command;
  switch(command.kind){
    case 'add':deps.addKeptItem(command.item);break;
    case 'toggle':deps.toggleKept(command.id,command.done);break;
    case 'remove':deps.removeKept(command.id);break;
    case 'update':deps.updateKept(command.id,command.changes);break;
    default:throw Error('core_agenda_command_invalid');
  }
  assertCurrent();
  const result=corePolicySync('agenda-tool.confirm',[packet.state,command,deps.getKept()]);
  return JSON.stringify((corePolicySync('agenda-life.toolReceipt',[result])));
}
