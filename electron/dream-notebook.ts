import {corePolicySync} from './core-policy-sync';
import {runCoreDream} from './core-dreams';
import { coreStoreFor } from './core-store';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from './provider';
import { estimateReservation, type ModelEntry } from './model-registry';
import { assertOutboundSafe } from './outbound';
import { acquireDreamLock, disabledLessons, loadLearning, parseObject, reserveDream, saveLearning } from './dream-learning';
import type { Night } from './nightlife';
export type NotebookEntry = { day:string; at:number; status:'running'|'complete'|'failed'; reason?:string; fiction?:string; followup?:{interest:string;query:string;sourceAt:string}; review:{duplicateIds:string[][]; conflictIds:string[]}; spentMicros:number };
export function readNotebook(root:string):NotebookEntry[] {
  const core=coreStoreFor(root);if(core)return core.get('dream-notebook',[]);
  const file=path.join(root,'dream-notebook.json');
  if(!existsSync(file))return [];
  const v=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(v))throw Error('invalid_dream_notebook');return v;
}
function save(root:string,entries:NotebookEntry[]){const core=coreStoreFor(root);if(core){core.set('dream-notebook',entries);return;}const f=path.join(root,'dream-notebook.json');writeFileSync(f+'.tmp',JSON.stringify(entries,null,2),{mode:0o600});renameSync(f+'.tmp',f);}
export function reviewMemories(memories:readonly {id:string;text:string;status?:string;conflictsWith?:string[];supersededBy?:string}[]) {
  return corePolicySync<{duplicateIds:string[][];conflictIds:string[]}>('dream-notebook.reviewMemories',[memories]);
}
export function followupQuery(root:string,interest:string,nights:Night[],now=Date.now()):string|null {
  try {
    return corePolicySync('dream-notebook.followup',[readNotebook(root),interest,nights,now]);
  }catch{return null;}
}
export function imaginationNote(root:string,latest:string):string {
  try{return corePolicySync('dream-notebook.imagination',[readNotebook(root),latest]);}catch{return '';}
}
export async function runDreamNotebook(d:{root:string;day:string;now:number;entry:ModelEntry;nights:Night[];memories:{id:string;text:string;status?:string;conflictsWith?:string[];supersededBy?:string}[];ask(messages:ChatMessage[],maxTokens:number):Promise<string>;idle():boolean}):Promise<NotebookEntry|null> {
  const release=acquireDreamLock(d.root);if(!release)return null;
  try {
  return await runCoreDream('dream-notebook',d) as NotebookEntry|null;
  } finally {release();}
}
