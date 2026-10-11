import { corePolicySync } from './core-policy-sync';
import { AsyncLocalStorage } from 'node:async_hooks';

export const CONVERSATION_QUIET_MS = 3 * 60_000;
export const LOCAL_REPLY_LIMIT_MS = 35_000;

/** Deferral is scheduling, not evidence that a screenshot or page is bad. */
export class BackgroundInferenceDeferred extends Error {
  constructor(readonly reason: 'conversation' | 'recent_conversation' | 'background_busy' | 'interrupted') {
    super(`background_inference_deferred:${reason}`);
  }
}

export function inferenceEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = '127.0.0.1';
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch { return endpoint.replace(/\/+$/, ''); }
}

type Timing = { event: 'background_deferred' | 'background_preempted' | 'local_reply_timeout'; reason?: string; elapsedMs?: number };
type Foreground = { active: boolean };

/** Process-local admission and cancellation; never warms a model or changes routes. */
export class InferencePriority {
  private readonly foreground = new AsyncLocalStorage<Foreground>();
  private readonly reply = new AsyncLocalStorage<AbortSignal>();
  private foregroundCount = 0;
  private lastInteraction: number;
  private readonly background = new Map<string, { abort: AbortController; protected: boolean; started: number }>();

  constructor(private readonly options: { now?: () => number; quietMs?: number; replyMs?: number; timing?: (event: Timing) => void } = {}) {
    // Give clients a chance to reconnect before a boot-time backlog takes the GPU.
    this.lastInteraction = this.now();
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private mark(event: Timing) { try { this.options.timing?.(event); } catch { /* optional diagnostics */ } }
  get inForeground() { return this.foreground.getStore()?.active === true; }
  get replySignal() { return this.reply.getStore(); }

  private observed() {
    return { foregroundCount:this.foregroundCount,lastInteraction:this.lastInteraction,
      jobs:[...this.background].map(([key,job])=>({key,protected:job.protected,aborted:job.abort.signal.aborted,started:job.started})) };
  }
  private decision<T>(operation:string,args:unknown[]=[]):T {
    const facts=this.observed(),stamp=JSON.stringify(facts);
    const result=corePolicySync<T>('inference-priority.'+operation,[facts,...args]);
    // Synchronous transport cannot interleave the Node event loop. Rechecking
    // also refuses changed synchronous callbacks or a changed test transport.
    if(JSON.stringify(this.observed())!==stamp)throw Error('inference_priority_state_changed');
    return result;
  }
  interaction() {
    {
      const keys=this.decision<string[]>('interaction');
      if(!Array.isArray(keys)||new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string'||!this.background.has(key)))throw Error('inference_priority_protocol_error');
      this.lastInteraction=this.now();
      for(const key of keys){const job=this.background.get(key)!;if(job.abort.signal.aborted)continue;
        this.mark({event:'background_preempted',elapsedMs:this.now()-job.started});job.abort.abort();}
      return;
    }
  }

  async runForeground<T>(run: () => Promise<T>): Promise<T> {
    const scope = { active: true };
    this.foregroundCount++;
    try { this.interaction(); return await this.foreground.run(scope, run); }
    finally {
      scope.active = false; // Detached callbacks must not inherit foreground privileges.
      this.foregroundCount--;
      this.lastInteraction = this.now();
    }
  }

  /** A separate Ollama endpoint may continue; it does not evict this instance's model. */
  backgroundReason(endpoint: string, protectedEndpoint: string): BackgroundInferenceDeferred['reason'] | null {
    return this.backgroundDecision(endpoint,protectedEndpoint).reason;
  }

  private backgroundDecision(endpoint:string,protectedEndpoint:string):{reason:BackgroundInferenceDeferred['reason']|null;protected:boolean} {
    const result=this.decision<{reason:BackgroundInferenceDeferred['reason']|null;protected:boolean}>('background',[inferenceEndpoint(endpoint),inferenceEndpoint(protectedEndpoint),this.now(),this.options.quietMs??null]);
    if(!result||!['conversation','recent_conversation','background_busy',null].includes(result.reason)||typeof result.protected!=='boolean')throw Error('inference_priority_protocol_error');
    return result;
  }
  async runBackground<T>(endpoint: string, protectedEndpoint: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const admitted=(this.backgroundDecision(endpoint,protectedEndpoint));
    const reason = admitted?admitted.reason:this.backgroundReason(endpoint, protectedEndpoint);
    if (reason) {
      this.mark({ event: 'background_deferred', reason });
      throw new BackgroundInferenceDeferred(reason);
    }
    const key = inferenceEndpoint(endpoint);
    const job = { abort: new AbortController(), protected: admitted?admitted.protected:key === inferenceEndpoint(protectedEndpoint), started: this.now() };
    this.background.set(key, job);
    try {
      const result = await run(job.abort.signal);
      // Ignore a late result even from a transport that disregards cancellation.
      if (job.abort.signal.aborted) throw new BackgroundInferenceDeferred('interrupted');
      return result;
    } catch (error) {
      if (job.abort.signal.aborted) throw new BackgroundInferenceDeferred('interrupted');
      throw error;
    } finally { this.background.delete(key); }
  }

  /** One budget shared by a draft and its private validation/repair requests.
   * The provider's guardedRequest observes this signal and settles its attempt
   * before the failure leaves the composition. Tool execution retains its own
   * durable task deadline; no side effect is raced or retried here.
   */
  async localReply<T>(run: () => Promise<T>,limitMs?:number): Promise<T> {
    if(limitMs!==undefined&&(!Number.isInteger(limitMs)||limitMs<1||limitMs>180000))throw Error('invalid_local_reply_limit');
    const reply=(corePolicySync<{reuse:boolean;limit?:number;message?:string}>('inference-priority.reply',[Boolean(this.reply.getStore()),limitMs??null,this.options.replyMs??null]));
    if(reply&&(typeof reply.reuse!=='boolean'||!reply.reuse&&(typeof reply.limit!=='number'||!Number.isFinite(reply.limit)||typeof reply.message!=='string')))throw Error('inference_priority_protocol_error');
    if (reply?reply.reuse:this.reply.getStore()) return run();
    const abort = new AbortController();
    const started = this.now();
    const limit = reply?reply.limit!:limitMs ?? this.options.replyMs ?? LOCAL_REPLY_LIMIT_MS;
    const timer = setTimeout(() => abort.abort(), limit);
    try {
      const result = await this.reply.run(abort.signal, run);
      abort.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (!abort.signal.aborted) throw error;
      this.mark({ event: 'local_reply_timeout', elapsedMs: this.now() - started });
      throw new Error(reply?reply.message!:`local_reply_timeout: Local reply exceeded its ${limit / 1000}-second limit. Please try again.`);
    } finally { clearTimeout(timer); abort.abort(); }
  }
}
