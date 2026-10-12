import {corePolicySync} from './core-policy-sync';
import {createHash} from 'node:crypto';
import type {TaskPolicy} from './model-registry';
import type {FactGraph} from './factgraph';
export function assertGraphCounter(graph:FactGraph):FactGraph {
  const ids=[...graph.entities,...graph.facts].map(row=>row.id);
  const highest=ids.filter(id=>/^[ef]\d+$/.test(id)).reduce((n,id)=>Math.max(n,Number(id.slice(1))),0);
  if(!Number.isSafeInteger(graph.nextId)||graph.nextId<=highest||!graph.read
    ||ids.some(id=>!/^[ef]\d+$/.test(id))||new Set(ids).size!==ids.length)throw Error('graph_metadata_requires_repair');
  return graph;
}
// Stored with graph mutations in the same Core authority transaction. Only
// hashes/progress/error classes are held here, never another transcript copy.
export type GraphJob={fingerprint:string;pieces:number;failures:number;unanswered:number;retryAt:number;status:'pending'|'blocked'|'done'};
export function graphFingerprint(messages:unknown[],userName:string):string {
  return createHash('sha256').update(JSON.stringify([messages,userName])).digest('hex');
}
export function graphJob(value:unknown,fingerprint:string):GraphJob {
  if(process.env.HARU_CORE_GRAPH_MUTATION==='on')return corePolicySync('graph-mutation.job',[value ?? null,fingerprint]);
  const held=value as Partial<GraphJob>|null;
  if(held?.fingerprint===fingerprint&&['pending','blocked','done'].includes(held.status??'')
    &&[held.pieces,held.failures,held.unanswered,held.retryAt].every(n=>Number.isSafeInteger(n)&&n!>=0))return {...held} as GraphJob;
  return {fingerprint,pieces:0,failures:0,unanswered:0,retryAt:0,status:'pending'};
}
export function graphFailure(job:GraphJob,kind:'unanswered'|'unreadable',now:number):GraphJob {
  if(process.env.HARU_CORE_GRAPH_MUTATION==='on')return corePolicySync('graph-mutation.failure',[job,kind,now]);
  if(kind==='unanswered'){
    const unanswered=Math.min(1000000,job.unanswered+1);
    return {...job,unanswered,retryAt:now+Math.min(30,2**Math.min(unanswered-1,5))*60000};
  }
  const failures=job.failures+1;
  return {...job,failures,unanswered:0,retryAt:now+60000,status:failures>=3?'blocked':'pending'};
}
export function graphPolicy(policy:TaskPolicy):TaskPolicy {
  if(process.env.HARU_CORE_GRAPH_MUTATION==='on')return corePolicySync('graph-mutation.policy',[policy]);
  // This is a stricter cap on the existing ledger, not an extra allowance.
  // Foreground spending counts against it too; backfill can wait for a day
  // with headroom instead of silently consuming a newly topped-up account.
  return {...policy,taskBudgetMicros:Math.min(100000,policy.taskBudgetMicros),
    dailyBudgetMicros:Math.min(100000,policy.dailyBudgetMicros),maxAttempts:1,
    maxToolCalls:0,maxEscalations:0,deadlineMs:Math.min(180000,policy.deadlineMs)};
}
