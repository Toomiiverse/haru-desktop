import { runTimedTurn, timingFor } from './turn-timing';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { coreServiceOptions, type CoreServiceOptions } from './core-service-client';

export type IntakeTransport = { call(command: Record<string, unknown>): Promise<any> };
export type ChatInput = { text: string; files: unknown[]; mode: 'plain' | 'stream'; interrupted?: boolean; replyTo?: string; quoted?: string };
export type DeliveryReceipt = { id: string; state: 'pending' | 'done' | 'error'; execution: string; reply?: string; ignored?: boolean; expression?: string | null; emotion?: string | null; error?: string };
export class IntakeFailure extends Error {
  constructor(readonly status: number) { super('chat_intake_unavailable'); }
}
export class CoreIntakeClient implements IntakeTransport {
  private token: string; private endpoint: string;
  constructor(options: CoreServiceOptions) {
    const url = new URL(options.endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('intake_loopback_required');
    if (statSync(options.tokenFile).mode & 0o077) throw Error('intake_private_token_required');
    this.token = readFileSync(options.tokenFile,'utf8').trim();
    if (this.token.length < 32) throw Error('intake_private_token_required');
    this.endpoint = url.origin;
  }
  async call(command: Record<string,unknown>): Promise<any> {
    let response: Response;
    try { response = await fetch(this.endpoint+'/v1/chat',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(5000)}); }
    catch { throw new IntakeFailure(503); }
    if (!response.ok) throw new IntakeFailure([409,422,503].includes(response.status) ? response.status : 503);
    try { return await response.json(); } catch { throw new IntakeFailure(503); }
  }
}
export function intakeFromEnvironment(): IntakeTransport | undefined {
  if (process.env.HARU_DURABLE_CHAT !== 'on') return;
  const options = coreServiceOptions();
  if (!options) throw Error('durable_chat_requires_core_service');
  return new CoreIntakeClient(options);
}

type Answer = { reply: string; ignored?: boolean; expression?: string | null; emotion?: string | null };
type Runner = {
  scope(): string; enabled(): boolean;
  say(text: string, files?: unknown[]): Promise<Answer>;
  sayStream(text: string, chunk: (text: string) => void, files?: unknown[], options?: {interrupted?: boolean; replyTo?: string; quoted?: string}, sentence?: (text: string, emotion: string) => void): Promise<Answer>;
};

/** Exactly one claim at a time. Retrying claim/completion never repeats inference. */
export class ChatIntake {
  readonly owner = randomUUID();
  private active = false;
  private timer?: ReturnType<typeof setInterval>;
  private pumping?: Promise<void>;
  private wakeRequested = false;
  private claimId?: string;
  private completion?: Record<string,unknown>;
  private listeners = new Map<string,(event: unknown) => void>();
  private waiters = new Map<string,Set<() => void>>();
  constructor(private client: IntakeTransport, private runner: Runner) {}
  async start() {
    const birth = readFileSync(`/proc/${process.pid}/stat`,'utf8').split(')').slice(-1)[0].trim().split(/\s+/)[19];
    await this.client.call({op:'register',owner:this.owner,pid:process.pid,birth});
    this.active = true;
    this.timer = setInterval(() => this.kick(),1000); this.timer.unref();
    this.kick();
  }
  async admit(id: string, scope: string, input: ChatInput): Promise<{fresh: boolean; paused: boolean; receipt: DeliveryReceipt}> {
    if (!this.active) throw new IntakeFailure(503);
    return this.client.call({op:'admit',id,scope,input});
  }
  async get(id: string, scope: string): Promise<DeliveryReceipt | null> {
    return (await this.client.call({op:'get',id,scope})).receipt;
  }
  private kick() {
    if (!this.active) return;
    if (this.pumping) { this.wakeRequested = true; return; }
    this.pumping = this.pump().catch(() => {
      // Payloads and provider errors must not reach diagnostics. Queued work,
      // the current claim and a pending completion are retained for recovery.
    }).finally(() => {
      this.pumping = undefined;
      if (this.wakeRequested) { this.wakeRequested = false; this.kick(); }
    });
  }
  private async pump() {
    await this.finishCompletion();
    if (!this.active || !this.runner.enabled()) return;
    this.claimId ??= randomUUID();
    const {claim} = await this.client.call({op:'claim',owner:this.owner,scope:this.runner.scope(),claim_id:this.claimId});
    this.claimId = undefined;
    if (!claim) return;
    const emit = (event: unknown) => { this.listeners.get(claim.id)?.(event); };
    let completion: Record<string,unknown>;
    try {
      // A queued message may have belonged to a slate that was cleared while
      // the claim response was in flight. Never inject it into the new slate.
      if (claim.scope !== this.runner.scope() || !this.runner.enabled()) throw Error('chat_scope_changed');
      const input = claim.input as ChatInput;
      const answer = await runTimedTurn(claim.id, () => input.mode === 'plain' ? this.runner.say(input.text,input.files)
        : this.runner.sayStream(input.text,text => emit({text}),input.files,{interrupted:input.interrupted,...(input.replyTo ? {replyTo:input.replyTo} : {}),...(input.quoted ? {quoted:input.quoted} : {})},(sentence,emotion) => emit({sentence,emotion})));
      completion = {op:'finish',owner:this.owner,id:claim.id,result:{reply:answer.reply,ignored:Boolean(answer.ignored),expression:answer.expression ?? null,emotion:answer.emotion ?? null}};
    } catch { completion = {op:'finish',owner:this.owner,id:claim.id,failed:true}; }
    this.completion = completion;
    await this.finishCompletion();
  }
  private async finishCompletion() {
    const completion = this.completion;
    if (!completion) return;
    const mark = timingFor(completion.id as string);
    const started = performance.now();
    mark('completion_start');
    try { await this.client.call(completion); }
    catch (error) { mark('completion_failed',{status:'error',durationMs:performance.now()-started}); throw error; }
    mark('completion_saved',{status:completion.failed ? 'error' : 'ok',durationMs:performance.now()-started});
    this.completion = undefined;
    // Core has committed the result. Wake readers to fetch the scoped durable
    // receipt; never manufacture a successful receipt from an in-memory reply.
    for (const wake of this.waiters.get(completion.id as string) ?? []) wake();
  }
  async wait(id: string, scope: string, emit: (event: unknown) => void = () => {}): Promise<DeliveryReceipt | null> {
    let signal: (() => void) | undefined;
    const wake = () => signal?.();
    const waiters = this.waiters.get(id) ?? new Set<() => void>();
    waiters.add(wake); this.waiters.set(id,waiters);
    this.listeners.set(id,emit);
    this.kick();
    try {
      const until = Date.now()+240000;
      while (this.active && Date.now()<until) {
        // Arm before the read so completion during an in-flight pending read
        // cannot be lost. Polling remains a fallback for lost acknowledgements.
        const notified = new Promise<void>(resolve => { signal = resolve; });
        const receipt = await this.get(id,scope);
        if (!receipt || receipt.state !== 'pending') return receipt;
        if (!this.active) return null;
        const timer = setTimeout(wake,250);
        try { await notified; } finally { clearTimeout(timer); }
      }
      return null;
    } catch { return null; }
    finally {
      signal = undefined;
      waiters.delete(wake);
      if (!waiters.size) this.waiters.delete(id);
      if (this.listeners.get(id) === emit) this.listeners.delete(id);
    }
  }
  async stop() {
    this.active = false;
    clearInterval(this.timer);
    for (const waiters of this.waiters.values()) for (const wake of waiters) wake();
    await this.pumping;
    // A lost completion ack leaves a durable running receipt. Keep it unknown
    // on process death instead of opening the gate to another execution.
    await this.finishCompletion();
    await this.client.call({op:'release',owner:this.owner});
  }
}
