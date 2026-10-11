import {corePolicySync} from './core-policy-sync';
import { randomUUID } from 'node:crypto';
import type { ChatMessage,ChatTool,ToolCall } from './provider';
import type { ToolReceipt } from './tool-receipt';
import { toolCallProblem } from './tool-contract';

export type ReadOnlyInput = { task_id:string;revision:number;allowed_tools:string[] };
export type CoreReadOnlyBridge = {
  decide(input:ReadOnlyInput):Promise<unknown>;
  /** Recomputed from the current turn's real tool availability. */
  table():ChatTool[];
};
type PrefixDeps = CoreReadOnlyBridge & {
  priorOperations?:number;
  active():Promise<void>;
  permitted():boolean;
  runTool(call:ToolCall):Promise<string|ToolReceipt>;
  log?(line:string):void;
};

const STOP_REPLIES = {
  note_unavailable: "[neutral] I couldn't read that note. I haven't read its contents.",
  folder_unavailable: "[neutral] I couldn't list that folder, so I haven't selected a note to read.",
  partial_note: "[neutral] I only received part of that note, so I can't say I've read it in full.",
  partial_listing: "[neutral] I only received part of that folder's listing, so I can't reliably pick its newest note.",
  empty_folder: "[neutral] That folder has no notes for me to read.",
  ambiguous_newest: "[neutral] More than one note has the newest modification time. Which one should I read?",
} as const;
export class CoreReadStopped extends Error {
  readonly reply:string;
  constructor(readonly code:keyof typeof STOP_REPLIES,readonly ran:Set<string>) {
    super(`core_read_only_${code}`);this.reply=(corePolicySync<string>('task-settlement.stopReply',[code]));
  }
}

/** Core selects reads; the existing task owner executes/records and composes.
 * Never fall back after a read, and never dispatch model-proposed actions here.
 */
export async function prefetchCoreReads(messages:ChatMessage[],task:{task_id:string;revision:number;request:string},deps:PrefixDeps):Promise<Set<string>|null> {
  const contract=(corePolicySync<{admit:boolean;roundLimit:number}>('task-settlement.prefetchContract',[task.request,deps.priorOperations??0]));
  if(contract&&(typeof contract.admit!=='boolean'||!Number.isInteger(contract.roundLimit)||contract.roundLimit<1||contract.roundLimit>12))throw Error('core_read_only_contract_invalid');
  if (contract ? !contract.admit : !/^(?:Read .+?\.md\.|List .+?(?:, then| and) read the note with the newest modifiedAt value\.)$/i.test(task.request)) return null;
  if (!deps.permitted()) return null;
  const receipts:ToolReceipt[]=[],seen=new Set<string>(),ran=new Set<string>();
  for (let iteration=0;iteration<(contract?contract.roundLimit:3);iteration++) {
    await deps.active();
    const allowed=deps.table().filter(t=>['vault_read','vault_list'].includes(t.function.name)).map(t=>t.function.name);
    if (!allowed.length) {
      if (!receipts.length)return null;
      throw Error('core_read_only_permission_changed');
    }
    let raw:unknown;
    try { raw=await deps.decide({task_id:task.task_id,revision:task.revision,allowed_tools:allowed}); }
    catch {
      await deps.active();
      const unavailable=(corePolicySync<{kind:'refuse'|'fallback';reason?:string}>('task-settlement.prefetchUnavailable',[receipts.length]));
      if(unavailable&&!['refuse','fallback'].includes(unavailable.kind))throw Error('core_read_only_contract_invalid');
      if (unavailable ? unavailable.kind==='refuse' : receipts.length)throw Error(unavailable?.reason??'core_read_only_continuation_unavailable');
      deps.log?.('[core-read-only] fallback=unavailable_before_execution');return null;
    }
    await deps.active();
    const value=raw as any;
    if (!value || value.taskId!==task.task_id || value.revision!==task.revision
        || !['ready','complete','unsupported','blocked','stopped'].includes(value.status))throw Error('core_read_only_protocol_error');
    if (value.status==='unsupported') {
      if (receipts.length)throw Error('core_read_only_scope_changed');
      return null;
    }
    if (value.status==='blocked')throw Error('core_read_only_unverified');
    if (!Array.isArray(value.evidenceIds) || JSON.stringify(value.evidenceIds)!==JSON.stringify(receipts.map(r=>r.executionId)))throw Error('core_read_only_evidence_mismatch');
    if (value.status==='stopped') {
      const last=receipts.at(-1),facts=value.facts,code=facts?.replyCode;
      if (value.next!==null || !last || !facts || facts.workflowState!=='stopped' || facts.completeRead!==false
          || !Object.hasOwn(STOP_REPLIES,code) || value.reason!==code
          || JSON.stringify(facts.receiptIds)!==JSON.stringify(value.evidenceIds)
          || (last.tool==='vault_read' ? facts.path!==last.scope.path : facts.folder!==last.scope.folder))throw Error('core_read_only_stop_mismatch');
      if (code==='note_unavailable' && (last.tool!=='vault_read'||last.outcome!=='failed')
          || code==='folder_unavailable' && (last.tool!=='vault_list'||last.outcome!=='failed')
          || code==='partial_note' && (last.tool!=='vault_read'||last.outcome!=='succeeded'||!(last.data as any)?.cut&&!(last.data as any)?.more)
          || ['partial_listing','empty_folder','ambiguous_newest'].includes(code) && (last.tool!=='vault_list'||last.outcome!=='succeeded')
          || code==='partial_listing' && !(last.data as any)?.cut&&!(last.data as any)?.more
          || code==='empty_folder' && ((last.data as any)?.cut||(last.data as any)?.more||!Array.isArray((last.data as any)?.notes)||(last.data as any).notes.length))throw Error('core_read_only_stop_mismatch');
      throw new CoreReadStopped(code,new Set(ran));
    }
    if (value.status==='complete') {
      const last=receipts.at(-1);
      if (value.next!==null || !last || last.tool!=='vault_read' || value.facts?.completeRead!==true
          || value.facts.path!==last.scope.path || JSON.stringify(value.facts.receiptIds)!==JSON.stringify(value.evidenceIds))throw Error('core_read_only_completion_mismatch');
      deps.log?.(`[core-read-only] completed reads=${receipts.length}`);
      return ran;
    }
    const next=value.next;
    if (!next || !['vault_read','vault_list'].includes(next.name))throw Error('core_read_only_scope_violation');
    const call:ToolCall={id:`core_read_${randomUUID()}`,function:{name:next.name,arguments:next.arguments}};
    const table=deps.table().filter(t=>['vault_read','vault_list'].includes(t.function.name));
    if (!deps.permitted() || toolCallProblem(call,table))throw Error('core_read_only_permission_changed');
    const key=JSON.stringify([next.name,next.arguments]);
    if (seen.has(key))throw Error('core_read_only_repeated_read');
    seen.add(key);
    const output=await deps.runTool(call);
    if (typeof output==='string' || output.tool!==next.name || output.access!=='read'
        || JSON.stringify(output.scope)!==JSON.stringify(next.arguments))throw Error('core_read_only_receipt_mismatch');
    receipts.push(output);
    messages.push({role:'assistant',content:'',tool_calls:[call]});
    messages.push({role:'tool',tool_name:next.name,tool_call_id:call.id,content:JSON.stringify(output)});
    if (output.outcome==='succeeded')ran.add(next.name);
  }
  throw Error('core_read_only_round_limit');
}
