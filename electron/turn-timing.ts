import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export type TurnStage = 'received' | 'admitted' | 'admission_failed' | 'runner_start' | 'runner_end'
  | 'foreground_queued' | 'harness_start' | 'preparation_checkpoint'
  | 'policy_span' | 'storage_span' | 'routing_candidates'
  | 'retrieval_start' | 'retrieval_end' | 'retrieval_skipped' | 'memory_early'
  | 'dispatch' | 'first_provider_text' | 'provider_complete' | 'settled' | 'provider_failed'
  | 'review_start' | 'review_end' | 'published' | 'harness_end'
  | 'completion_start' | 'completion_saved' | 'completion_failed'
  | 'first_text_write' | 'response_finish' | 'response_close';
type Fields = { operation?: string; candidates?: number; step?: string; model?: string; attempt?: number; durationMs?: number; coreMs?: number; bytes?: number; replyBytes?: number;
  status?: 'ok' | 'error' | 'pending'; mode?: 'plain' | 'stream'; fresh?: boolean; connected?: boolean };
export type TimingEvent = { version: 1; trace: string; pid: number; at: number; monoMs: number; stage: TurnStage; phase: 'turn' | 'review' } & Fields;
type Context = { mark: (stage: TurnStage, fields?: Fields, phase?: 'turn' | 'review') => void; active: boolean; phase: 'turn' | 'review'; turn?: Context };
const context = new AsyncLocalStorage<Context>();
const defaultSink = (event: TimingEvent) => console.log(`[turn-timing] ${JSON.stringify(event)}`);

/** No prompts, replies, paths, errors or raw request IDs enter this schema.
 * Hash IDs so accepted retries can be joined without logging caller-supplied text.
 * Logs use the existing service log; no additional authority/database writes. */
export function timingFor(id: string, sink: (event: TimingEvent) => void = defaultSink) {
  const trace = createHash('sha256').update(id).digest('hex').slice(0,24);
  let count = 0, spans = 0;
  // 3520: the ~500 span lines a turn are written together at its end (same lines, same monoMs), not one by one while the
  // Core parses each off the brain's stdout between the policy calls they describe.
  const held: TimingEvent[] = [];
  let ended = false;   // a span after the turn ended (write-behind commits) goes straight out
  const flush = () => { ended = true; for (const event of held.splice(0)) sink(event); };
  return (stage: TurnStage, fields: Fields = {}, phase: 'turn' | 'review' = 'turn') => {
    try {
      const span = stage === 'policy_span' || stage === 'storage_span';
      if (span) { if (++spans > 768) return; }
      else if (++count > 256) return;
      const safe: Fields = {};
      // Only explicitly selected fields are serialized, even if a caller passes
      // an oversized object at runtime. Free-form error messages are excluded.
      if (fields.operation && /^[a-zA-Z0-9_.-]{1,100}$/.test(fields.operation)) safe.operation = fields.operation;
      if (typeof fields.candidates === 'number' && Number.isSafeInteger(fields.candidates) && fields.candidates >= 0 && fields.candidates <= 128) safe.candidates = fields.candidates;
      if (fields.step && /^[a-zA-Z]{1,40}$/.test(fields.step)) safe.step = fields.step;
      if (fields.model && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(fields.model)) safe.model = fields.model;
      // 3650: coreMs (the Core's own clock), bytes / replyBytes (the wire both ways) split a policy span into compute and payload.
      for (const key of ['attempt','durationMs','coreMs','bytes','replyBytes'] as const) if (typeof fields[key] === 'number' && Number.isFinite(fields[key]) && fields[key]! >= 0) safe[key] = fields[key];
      if (['ok','error','pending'].includes(fields.status ?? '')) safe.status = fields.status;
      if (fields.mode === 'plain' || fields.mode === 'stream') safe.mode = fields.mode;
      if (typeof fields.fresh === 'boolean') safe.fresh = fields.fresh;
      if (typeof fields.connected === 'boolean') safe.connected = fields.connected;
      const event: TimingEvent = {version:1,trace,pid:process.pid,at:Date.now(),monoMs:performance.now(),stage,phase,...safe};
      if (span && !ended) held.push(event);
      else { sink(event); if (stage === 'runner_end' || stage === 'review_end' || stage === 'completion_saved' || stage === 'completion_failed') flush(); }
    } catch { /* diagnostics must never change delivery or task settlement */ }
  };
}
/** 3760: a sink for call turns: stage marks are written as usual, but the ~400-500 policy/storage spans are only counted (written
 *  in one burst at the turn's end they would land on her first sentence) and summed once, at runner_end. */
export function spanCountingSink(summary:(counts:{coreCalls:number;memoHits:number;failed:number;storageCalls:number;coreMs:number;policyWallMs:number;capped?:boolean})=>void, write:(event:TimingEvent)=>void=defaultSink) {
  let core=0,memo=0,failed=0,storage=0,coreMs=0,wallMs=0;
  return (event:TimingEvent) => {
    const e=event as any;
    if(e.stage==='storage_span'){storage++;return;}
    if(e.stage==='policy_span'){
      if(typeof e.durationMs==='number')wallMs+=e.durationMs;
      if(typeof e.coreMs==='number'){core++;coreMs+=e.coreMs;}else if(e.status==='ok')memo++;else failed++;   // a memo hit: ok, no Core clock
      return;
    }
    write(event);
    // the held spans are handed over right after runner_end, in the same synchronous flush: count them first
    if(e.stage==='runner_end')queueMicrotask(()=>summary({coreCalls:core,memoHits:memo,failed,storageCalls:storage,coreMs:Math.round(coreMs),policyWallMs:Math.round(wallMs),
      ...(core+memo+failed+storage>=768?{capped:true}:{})}));   // timingFor keeps at most 768 spans a turn
  };
}
/** The active turn, as an identity token for per-turn caches (core-policy-sync); undefined outside a turn. */
// 3760: only while the turn runs (work it started and that outlives it must not use or wipe the next turn's memo); a review inside
// the turn shares the turn's token, so it shares its memo.
export function currentTurn(): unknown { const s = context.getStore(); return s?.active ? (s.turn ?? s) : undefined; }
export function markTurn(stage: TurnStage, fields?: Fields) {
  const current = context.getStore();
  if (current?.active) current.mark(stage,fields,current.phase);
}
export async function runTimedTurn<T>(id: string, run: () => Promise<T>, sink?: (event: TimingEvent) => void): Promise<T> {
  const current: Context = {mark:timingFor(id,sink),active:true,phase:'turn'};
  return context.run(current,async()=>{
    const started=performance.now();markTurn('runner_start');
    try { const result=await run();markTurn('runner_end',{status:'ok',durationMs:performance.now()-started});return result; }
    catch(error){markTurn('runner_end',{status:'error',durationMs:performance.now()-started});throw error;}
    finally {current.active=false;}
  });
}
export async function timeTurnReview<T>(run: () => Promise<T>): Promise<T> {
  const parent=context.getStore();
  if (!parent?.active) return run();
  // The shared active flag belongs to the runner; detached post-reply work
  // must not add new stages to a completed turn.
  const child: Context={mark:parent.mark,get active(){return parent.active;},phase:'review',turn:parent.turn??parent};
  return context.run(child,async()=>{
    const started=performance.now();markTurn('review_start');
    try {const result=await run();markTurn('review_end',{status:'ok',durationMs:performance.now()-started});return result;}
    catch(error){markTurn('review_end',{status:'error',durationMs:performance.now()-started});throw error;}
  });
}
