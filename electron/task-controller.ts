import {corePolicySync} from './core-policy-sync';
import {routePolicy} from './core-route-admission';
import { takeProviderUsage } from './provider-usage';
import {coreAdapterOwner} from './core-policy-sync';
import { AsyncLocalStorage } from 'node:async_hooks';
import {activeScheduledJob} from './core-scheduler';
import {runCoreHarness} from './core-harness';
import {coreServiceOptions} from './core-service-client';
import { createHash, randomUUID } from 'node:crypto';
import type { ChatMessage, ToolCall } from './provider';
import { promptUsage } from './provider';
import { runToolLoop, ToolLoopFailure, type ToolLoopDeps, type ToolLoopResult } from './toolloop';
import { isReadTool, makeToolReceipt, storedToolReceipt, type ToolReceipt } from './tool-receipt';
import { estimateReservation, isLocalConfig, usageCost, type ModelEntry, type ProviderConfig, type TaskPolicy } from './model-registry';
import { assertOutboundSafe, guardedRequest } from './outbound';
import type { TaskRPC } from './task-bridge';
import { prefetchCoreReads,CoreReadStopped } from './core-read-only';

export const activeAttempt = new AsyncLocalStorage<{taskId:string;revision:number;attemptId:string;model:string;deadlineAt:number;priority?:'foreground'|'background'}>();
export const activeTask = new AsyncLocalStorage<TaskController>();
export type HandoffContext = { messages: ChatMessage[]; failure: string; currentModel: string; remainingBudgetMicros: number };
export type TaskTiming = { stage: 'dispatch' | 'first_provider_text' | 'provider_complete' | 'settled' | 'provider_failed'; at: number;
  attempt: number; model: string; providerMs?: number; costMicros?: number; basis?: string; promptTokens?: number; cachedTokens?: number };
export class TaskController {
  private snapshot: any;
  private readonly abort = new AbortController();
  private operations = 0;
  private deadline = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private outcomes = new Set<string>();
  private requests = 0;
  private priority:'foreground'|'background'='foreground';
  private detachParent?: () => void;
  private cancelling?: Promise<void>;
  constructor(private rpc: TaskRPC, private entries: ModelEntry[], private policy: TaskPolicy, private cloudAllowed: boolean,
    private observe?: (model: string, succeeded: boolean) => void, private timing?: (event: TaskTiming) => void) { this.cloudAllowed = cloudAllowed && policy.enabled; }
  keepLocal() { this.cloudAllowed = false; }
  /** An honest worker-failure reply does not make its provider successful. */
  recordWorkerFailure() { this.observed(false); }
  get signal() { return this.abort.signal; }
  get taskPriority() { return this.priority; }
  get remainingBudgetMicros() { return Math.max(0, this.policy.taskBudgetMicros - (this.snapshot?.spentMicros ?? 0) - (this.snapshot?.reservedMicros ?? 0)); }
  private observed(succeeded: boolean) {
    const model = this.snapshot?.model;
    if (!model || !this.requests || this.outcomes.has(model)) return;
    this.outcomes.add(model);
    try { this.observe?.(model, succeeded); } catch { /* telemetry never owns completion */ }
  }
  private get input() { return { taskId: this.snapshot.id as string, revision: this.snapshot.revision as number }; }
  async start(request: string, model: string,priority:'foreground'|'background'='foreground', parent?: AbortSignal) {
    parent?.throwIfAborted();
    priority=corePolicySync<'foreground'|'background'>('task-settlement.startPriority',[priority,(!!activeScheduledJob.getStore())]);
    this.priority=priority;
    this.deadline = Date.now() + this.policy.deadlineMs;
    this.snapshot = await this.rpc('create', { request: request || '(empty turn)', model, deadlineAt: this.deadline,
      maxCostMicros: this.policy.taskBudgetMicros, dailyMaxCostMicros: this.policy.dailyBudgetMicros, maxAttempts: this.policy.maxAttempts,
      ...(({priority})) });
    if (parent) {
      const cancel = () => { void this.cancel().catch(() => {}); };
      parent.addEventListener('abort', cancel, {once:true});
      this.detachParent = () => parent.removeEventListener('abort', cancel);
      if (parent.aborted) {
        try { await this.cancel(); } finally { this.detachParent(); }
        throw new Error('task_cancelled_or_deadline');
      }
    }
    this.timer = setTimeout(() => this.abort.abort(), Math.max(1, this.deadline - Date.now()));
  }
  async cancel() {
    this.abort.abort();
    if (this.snapshot) await (this.cancelling ??= this.rpc('cancel', { taskId: this.snapshot.id }).then(() => {}));
  }
  async check() {
    if (this.signal.aborted) throw new Error('task_cancelled_or_deadline');
    this.snapshot = await this.rpc('assertActive', this.input);
    if (this.signal.aborted) throw new Error('task_cancelled_or_deadline');
  }
  async binding() {await this.check();return this.input;}
  async post(messages: ChatMessage[], config: ProviderConfig, tools: readonly unknown[], maxTokens: number | undefined,
    run: (signal: AbortSignal, chunk: (text: string) => void, maxTokens: number) => Promise<ChatMessage>, onChunk?: (text: string) => void, firstWordMs?: number, signal?: AbortSignal): Promise<ChatMessage> {
    await this.check();
    const local = isLocalConfig(config);
    if (!local) {
      if (!this.cloudAllowed || !this.policy.taskBudgetMicros || !this.policy.dailyBudgetMicros) throw new Error('cloud_allowance_required');
      try { assertOutboundSafe(messages, tools); } catch (error) { this.keepLocal(); throw error; }
    }
    const entry = this.entries.find(e => e.enabled && e.config.model === config.model && e.config.provider === config.provider && e.config.endpoint.replace(/\/+$/, '') === config.endpoint.replace(/\/+$/, ''));
    if (!entry) throw new Error('model_not_registered');
    const limit = (corePolicySync<number>('task-settlement.requestLimit',[maxTokens??null,entry.capabilities.maxOutputTokens]));
    // Local requests are free; byte upper bounds for pricing need not reject a valid local context.
    const cost = local ? 0 : estimateReservation(entry, messages, limit, tools)?.costMicros;
    if (cost === undefined) throw new Error('unpriced_or_oversized_request');
    if (this.snapshot.model !== config.model) this.snapshot = await this.rpc('selectModel', { ...this.input, model: config.model, reason: 'transport_route', escalate: false });
    const attempt = await this.rpc('reserve', { ...this.input, model: config.model, maxCostMicros: cost,
      ...(!local && (true as boolean) ? {cloudScope:{endpoint:config.endpoint.replace(/\/+$/, ''),privacyChecked:true,maxOutputTokens:limit}} : {}) });
    const requestNumber = ++this.requests;
    let dispatchedAt = 0, firstText = false;
    const mark = (stage: TaskTiming['stage'], fields: Partial<TaskTiming> = {}) => {
      try { this.timing?.({ stage, at: Date.now(), attempt: requestNumber, model: config.model, ...fields }); } catch { /* telemetry is optional */ }
    };
    try {
      const answer = await guardedRequest((signal, chunk) => {
        dispatchedAt = Date.now(); mark('dispatch');
        return activeAttempt.run({...this.input,attemptId:attempt.attemptId,model:config.model,deadlineAt:this.deadline,priority:this.priority},()=>run(signal, chunk, limit));
      }, {
        signal: signal ? AbortSignal.any([this.signal, signal]) : this.signal, firstWordMs, totalMs: Math.max(1, this.deadline - Date.now()),
        onChunk: text => {
          if (text && !firstText) { firstText = true; mark('first_provider_text', { providerMs: Date.now() - dispatchedAt }); }
          onChunk?.(text);
        },
      });
      mark('provider_complete', { providerMs: Date.now() - dispatchedAt });
      // Retain the conservative reservation if the transport has no reliable usage receipt.
      const receipt = takeProviderUsage(answer);
      const actual = local ? 0 : receipt ? usageCost(entry, receipt.usage, receipt.format) : undefined;
      await this.rpc('settle', { attemptId: attempt.attemptId, status: 'succeeded',
        ...(actual !== undefined ? { costMicros: actual } : {}),
        usage: { basis: actual !== undefined ? (local ? 'local' : 'provider_usage') : 'reservation',
          ...(receipt ?? {}), pricing: entry.pricing } });
      await this.check();
      const tokens = receipt?.format === 'openai' ? promptUsage(receipt.usage) : null;
      mark('settled', { costMicros: actual ?? cost, basis: actual === undefined ? 'reservation' : 'provider_usage',
        ...(tokens ? { promptTokens: tokens.prompt, cachedTokens: tokens.cached } : {}) });
      return answer;
    } catch (error) {
      // Settlement is idempotent only for the same outcome; a post-settlement stale check is separate.
      const settled = await this.rpc('get', { taskId: this.snapshot.id });
      if (settled.reservedMicros || cost === 0) {
        await this.rpc('settle', { attemptId: attempt.attemptId, status: 'unknown' }).catch(() => {});
      }
      mark('provider_failed', { costMicros: cost, basis: 'reservation', providerMs: dispatchedAt ? Date.now() - dispatchedAt : undefined });
      throw error;
    }
  }
  /** A bounded, tool-free background composition; never executes a proposed action. */
  async compose(ask: () => Promise<ChatMessage>,messages?:ChatMessage[]): Promise<string> {
    try {
      const reply = await activeTask.run(this, async()=>{
        
        const options=coreServiceOptions();if(!options)throw Error('core_composition_requires_service');
        const result=await runCoreHarness(messages??[{role:'user',content:this.snapshot.request}],{
          ask:async()=>ask(),runTool:async()=>{throw Error('composition_tools_forbidden');},
          pageWasRead:()=>false,handsAllowed:()=>false,withdrawHands(){},hasOpenTask:()=>false,canSearch:()=>false,
          signal:this.signal,maxRounds:1,log:line=>console.log(line),
        },options,async()=>{await this.check();return this.input;},()=>this.abort.abort(),'composition');
        if(!result)throw Error('core_composition_not_selected');
        return result.message;
      });
      await this.check();
      if (reply.tool_calls?.length || !reply.content?.trim()) throw new Error('invalid_background_reply');
      await this.rpc('finish', { ...this.input, status: 'completed', result: reply.content });
      return reply.content;
    } catch (error) {
      await this.rpc('finish', { ...this.input, status: 'failed', reason: error instanceof Error ? error.message : 'composition_failed' }).catch(() => {});
      throw error;
    } finally { this.detachParent?.(); if (this.timer) clearTimeout(this.timer); this.abort.abort(); await this.cancelling?.catch(() => {}); }
  }
  async operation(call: ToolCall, run: (command:ToolCall) => Promise<string | ToolReceipt>): Promise<ToolReceipt> {
    await this.check();
    const name = call.function?.name ?? 'unknown';
    let args: unknown = call.function?.arguments ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { throw new Error('invalid_tool_arguments'); } }
    const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
    const key = isReadTool(name, args as Record<string, unknown>) ? randomUUID()
      : createHash('sha256').update(JSON.stringify([name, canonical(args)])).digest('hex');
    const prior = this.snapshot.operations.find((op: any) => op.key === key);
    if (!prior && ++this.operations > this.policy.maxToolCalls) throw new Error('tool_call_limit');
    const bound=(true as boolean);
    const op = await this.rpc('beginOperation', { ...this.input, key, name, args,...(bound?{adapterOwner:coreAdapterOwner()}:{}) });
    if (!op.execute) {
      if((bound)&&op.status==='unknown'&&!storedToolReceipt(op.result??''))
        return makeToolReceipt(name,args,JSON.stringify(corePolicySync('receipt-policy.retainedUnknown',[])),null,null);
      return storedToolReceipt(op.result ?? '') ?? makeToolReceipt(name, args,
        op.status === 'running' || op.status === 'unknown' ? '{"status":"unknown"}' : op.result ?? '{"error":"previous_operation_failed"}', null, null);
    }
    const command=op.adapterCommand;
    if(bound){
      if(!command||command.contractVersion!==1||typeof command.commandId!=='string'||typeof command.authorityEpoch!=='string'
        ||command.operationId!==op.operationId||command.taskId!==this.input.taskId||command.taskRevision!==this.input.revision
        ||command.stateRevision!==this.input.revision||JSON.stringify(command.adapterOwner)!==JSON.stringify(coreAdapterOwner())
        ||command.tool!==name||JSON.stringify(canonical(command.arguments))!==JSON.stringify(canonical(args))
        ||command.access!==(isReadTool(name,args as Record<string,unknown>)?'read':'mutation')
        ||!Number.isSafeInteger(command.issuedAt)||!Number.isSafeInteger(command.deadlineAt)
        ||command.issuedAt>Date.now()||command.deadlineAt<=Date.now()||command.deadlineAt>this.deadline)throw Error('adapter_command_scope_mismatch');
      await this.check();
    }
    const dispatchedCall:ToolCall=bound?{...call,function:{...call.function,name:command.tool,arguments:JSON.parse(JSON.stringify(command.arguments))}}:call;
    if(bound)Object.defineProperty(dispatchedCall,'__haruAdapterCommand',{value:command,enumerable:false});
    const receiptArgs=bound?JSON.parse(JSON.stringify(command.arguments)):args;
    const acknowledgement=(receipt?:ToolReceipt)=>({...command,tool:undefined,arguments:undefined,access:undefined,issuedAt:undefined,deadlineAt:undefined,
      disposition:receipt?'reported':'rejected_before_dispatch',...(receipt?{receipt}:{rejection:'cancelled'})});
    if (this.signal.aborted) {
      await this.rpc('finishOperation', {operationId:op.operationId,status:'failed',result:'Cancelled before execution.',...(bound?{adapterAck:acknowledgement()}: {})});
      throw new Error('task_cancelled_or_deadline');
    }
    try {
      // Never race side effects: record their actual outcome, then refuse late completion.
      const startedAt = Date.now();
      const pending = run(dispatchedCall).then(result => typeof result === 'string' ? makeToolReceipt(name, receiptArgs, result, startedAt, Date.now()) : result);
      const record = (receipt: ToolReceipt) => this.rpc('finishOperation', { operationId: op.operationId,
        status: receipt.outcome === 'succeeded' ? 'succeeded' : receipt.outcome === 'failed' || receipt.access === 'read' ? 'failed' : 'unknown',
        result: JSON.stringify(receipt),...(bound?{adapterAck:acknowledgement(receipt)}:{}) });
      // An uninterruptible tool may finish later: retain its receipt for reconciliation,
      // but never let a late result resume the expired/cancelled turn.
      void pending.then(record).catch(() => {});
      const result = await guardedRequest(() => pending, { signal: this.signal, totalMs: Math.max(1, this.deadline - Date.now()) });
      await record(result);
      await this.check();
      return result;
    } catch (error) {
      await this.rpc('finishOperation', { operationId: op.operationId, status: 'unknown', result: 'Operation outcome requires reconciliation.' }).catch(() => {});
      throw error;
    }
  }
  async loop(messages: ChatMessage[], deps: ToolLoopDeps, escalation?: (context: HandoffContext) => ProviderConfig | null | Promise<ProviderConfig | null>) {
    const wrapped: ToolLoopDeps = { ...deps, signal: this.signal, runTool: call => this.operation(call,command=>deps.runTool(command)) };
    const harnessPrefix=process.env.HARU_CORE_HARNESS_PATH_PREFIX;
    const harnessScoped=!harnessPrefix||(typeof this.snapshot?.request==='string'&&this.snapshot.request.startsWith(`Read ${harnessPrefix}/`));
    if((harnessScoped)){
      const options=coreServiceOptions();if(!options)throw Error('core_harness_requires_service');
      wrapped.coreHarness=(conversation,loopDeps)=>runCoreHarness(conversation,loopDeps,options,async()=>{await this.check();return this.input;},()=>this.abort.abort());
    }
    try {
      let result;
      try { result = await activeTask.run(this, async () => {
        if (deps.coreReadOnly) {
          await this.check();
          {
            const reads=await prefetchCoreReads(messages,{task_id:this.snapshot.id,revision:this.snapshot.revision,request:this.snapshot.request},
              {...deps.coreReadOnly,priorOperations:this.snapshot.operations.length,active:()=>this.check(),permitted:()=>!deps.pageWasRead(),runTool:wrapped.runTool,log:deps.log});
            if (reads) { wrapped.toolsAllowed=()=>false;wrapped.initialRan=new Set([...(wrapped.initialRan??[]),...reads]); }
          }
        }
        return runToolLoop(messages, wrapped);
      }); }
      catch (error) {
        if (error instanceof CoreReadStopped) {
          await this.check();
          const readSettlement=(corePolicySync<any>('task-settlement.readStopped',[this.settlementOperations(),error.message,error.reply]));
          if(readSettlement ? readSettlement.kind==='refuse' : this.snapshot.operations.some((op:any)=>['running','unknown'].includes(op.status)))throw Error(readSettlement?.reason??'core_read_only_stop_unresolved');
          deps.resetStream?.();
          await this.rpc('finish',{...this.input,status:'failed',reason:readSettlement?readSettlement.reason:error.message,result:readSettlement?readSettlement.content:error.reply});
          return {message:{role:'assistant' as const,content:error.reply},content:error.reply,ran:error.ran,rounds:0};
        }
        // Only observable answer-quality failures qualify. Transport, cancellation,
        // private content and uncertain operations never buy a second model.
        await this.check();
          if(!routePolicy<boolean>('outerEscalation',[error instanceof ToolLoopFailure,this.cloudAllowed,this.policy,this.snapshot]))throw error;
        // The typed quality failure is required by the supervised handoff contract.
        if(!(error instanceof ToolLoopFailure))throw error;
        assertOutboundSafe(messages);
        const next = await escalation?.({ messages, failure: error.code, currentModel: this.snapshot.model, remainingBudgetMicros: this.remainingBudgetMicros });
        await this.check();
        if (!next) throw error;
        if(!routePolicy<boolean>('escalationDispatch',[this.entries,next,messages,this.policy,this.snapshot]))throw error;
        this.observed(false);
        await this.rpc('checkpoint', { ...this.input, packet: { messages, failure: error.code } });
        this.snapshot = await this.rpc('selectModel', { ...this.input, model: next.model, reason: error.code, escalate: true });
        deps.resetStream?.();
        const initialRan = new Set<string>((corePolicySync<string[]>('task-settlement.escalationRan',[this.settlementOperations()])));
        result = await activeTask.run(this, () => runToolLoop(messages, { ...wrapped, initialRan }));
      }
      await this.check();
      const settlement=(corePolicySync<any>('task-settlement.completed',[this.settlementOperations(),result.content]));
      if (settlement ? settlement.kind==='defer' : this.snapshot.operations.some((op: any) => ['running', 'unknown'].includes(op.status))) return await this.deferResult(result,settlement?.content);
      await this.rpc('finish', { ...this.input, status: 'completed', result: settlement?settlement.content:result.content });
      this.observed(true);
      return result;
    } catch (error) {
      if (error instanceof ToolLoopFailure) await this.check();
      const settlement=(corePolicySync<any>('task-settlement.failed',[this.settlementOperations(),error instanceof ToolLoopFailure,error instanceof Error?error.message:null]));
      if (settlement ? settlement.kind==='defer' : error instanceof ToolLoopFailure&&this.snapshot.operations.some((op: any) => ['running', 'unknown'].includes(op.status))) return await this.deferResult(undefined,settlement?.content);
      await this.rpc('finish', { ...this.input, status: 'failed', reason: settlement?settlement.reason:error instanceof Error ? error.message.slice(0, 1000) : 'task_failed' }).catch(() => {});
      this.observed(false);
      throw error;
    } finally { this.detachParent?.(); if (this.timer) clearTimeout(this.timer); this.abort.abort(); await this.cancelling?.catch(() => {}); }
  }
  private settlementOperations() { return this.snapshot.operations.map((op:any)=>({name:op.name,status:op.status})); }
  private async deferResult(result?: ToolLoopResult,policyContent?:string): Promise<ToolLoopResult> {
    if(typeof policyContent!=='string')throw Error('core_task_settlement_protocol');
      await this.rpc('defer',{...this.input,result:policyContent});
      return {message:{role:'assistant',content:policyContent},content:policyContent,ran:result?.ran??new Set<string>(),rounds:result?.rounds??0};
  }
}
