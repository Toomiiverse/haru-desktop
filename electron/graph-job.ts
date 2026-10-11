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
  return corePolicySync('graph-mutation.job',[value ?? null,fingerprint]);
}
export function graphFailure(job:GraphJob,kind:'unanswered'|'unreadable',now:number):GraphJob {
  return corePolicySync('graph-mutation.failure',[job,kind,now]);
}
export function graphPolicy(policy:TaskPolicy):TaskPolicy {
  return corePolicySync('graph-mutation.policy',[policy]);
}
