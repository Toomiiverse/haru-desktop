/** Execute Core's memory edit plan; publish only after the commit is observed. */
import {randomUUID} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';
import {commitDayNightPlan} from './core-day-night';
import {activeTask} from './task-controller';
import type {CoreStore} from './core-store';
import type {BlockSources} from './blocks';

export function runCoreMemoryTool(name:string,args:Record<string,unknown>,message:string,adapter:{core:CoreStore;sources:()=>BlockSources;publish:(events:string[])=>void}){
  const assertCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();
  assertCurrent();
  const facts={config:adapter.core.get('config',{}),memoryFile:adapter.core.get('memories'),sources:adapter.sources(),id:randomUUID(),at:new Date().toISOString()};
  // Map/vector observations keep their explicit wire representation.
  const sources={...facts.sources,semantic:facts.sources.semantic?[...facts.sources.semantic]:undefined,latestSemantic:facts.sources.latestSemantic?[...facts.sources.latestSemantic]:undefined};
  const packet=corePolicySync<any>('memory-tools.prepare',[name,args,message,{...facts,sources}]);
  if(Object.hasOwn(packet,'result'))return packet.result;
  if(!packet.plan||!packet.state)throw Error('core_memory_tool_protocol');
  // An uncertain write or lost confirmation escapes to the native operation
  // ledger. There is no retry and no optimistic memory/cache publication.
  commitDayNightPlan(adapter.core,packet.plan,assertCurrent);
  assertCurrent();
  const observed=corePolicySync<{result:unknown;events:string[]}>('memory-tools.confirm',[packet.state,{config:adapter.core.docRef('config',{}),memoryFile:adapter.core.get('memories')}]);
  adapter.publish(observed.events);
  return observed.result;
}

export function runCoreMemoryAdmin(action:string,args:Record<string,unknown>,adapter:{core:CoreStore;sources:()=>BlockSources;publish:(events:string[])=>void}){
  const assertCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();assertCurrent();
  const source=adapter.sources();const facts={config:adapter.core.get('config',{}),memoryFile:adapter.core.get('memories'),graph:adapter.core.get('graph'),sources:{...source,semantic:source.semantic?[...source.semantic]:undefined,latestSemantic:source.latestSemantic?[...source.latestSemantic]:undefined},id:randomUUID(),at:new Date().toISOString()};
  const packet=corePolicySync<any>('memory-admin.prepare',[action,args,facts]);if(Object.hasOwn(packet,'result'))return packet.result;
  commitDayNightPlan(adapter.core,packet.plan,assertCurrent);assertCurrent();
  const observed=corePolicySync<{result:unknown;events:string[]}>('memory-admin.confirm',[packet.state,Object.fromEntries(Object.keys(packet.state.expected).map(key=>[key,adapter.core.get(key)]))]);
  adapter.publish(observed.events);return observed.result;
}

/** Explicit reset only: mandatory backup, one native transaction, observed file receipts. */
export function runCoreMemoryReset(body:boolean,at:string,adapter:{core:CoreStore;store:any;roots:{home:string;userData:string};publishSchedule:()=>void;renderGraph:(graph:any)=>string;exists:(file:string)=>boolean;move:(from:string,to:string)=>void;write:(file:string,text:string)=>void;join:(...parts:string[])=>string}){
  const assertCurrent=()=>activeTask.getStore()?.signal.throwIfAborted();assertCurrent();
  const program=corePolicySync<any>('memory-admin.resetProgram',[body,at,adapter.core.docRef('config',{}),adapter.store.getSchedule()]);
  const backups=adapter.store.backup(program.reason);assertCurrent();
  const setters=new Set(['setMemories','setSessions','setMonthNotes','setForgettingLog','setFactGraph','setArchive','setKnowledge','setThoughts','setActivityLog','setSchedule']);
  adapter.store.transaction(()=>{
    assertCurrent();if(JSON.stringify(adapter.core.get('config'))!==JSON.stringify(program.expectedConfig)||JSON.stringify(adapter.store.getSchedule())!==JSON.stringify(program.expectedSchedule))throw Error('core_memory_reset_stale');
    for(const command of program.commands){assertCurrent();if(setters.has(command.kind))adapter.store[command.kind](command.value);else if(command.kind==='delete')adapter.store.delete(command.key);else if(command.kind==='set')adapter.store.set(command.key,command.value);else if(command.kind==='resetMemoryAssets')adapter.store.resetMemoryAssets();else throw Error('core_memory_reset_protocol');}
  });
  // An uncertain native commit throws before any downstream file operation.
  adapter.publishSchedule();const issues:string[]=[];
  for(const move of program.moves){assertCurrent();const root=move.root==='vault'?program.vault:adapter.roots[move.root as 'home'|'userData'];if(typeof root!=='string')throw Error('core_memory_reset_root');const from=adapter.join(root,move.from),to=adapter.join(root,move.to);try{if(adapter.exists(from))adapter.move(from,to);}catch{issues.push(move.root+':'+move.from);}}
  if(program.clearGraphPage){assertCurrent();try{adapter.write(adapter.join(program.vault,'Who is who.md'),adapter.renderGraph(program.graph));}catch{issues.push('vault:Who is who.md');}}
  return corePolicySync<{at:string;body:boolean;backups:number}>('memory-admin.resetResult',[program,backups.length,issues]);
}
