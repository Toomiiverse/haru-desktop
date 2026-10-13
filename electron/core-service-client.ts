import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { ReadOnlyInput } from './core-read-only';

export type CoreServiceOptions = { endpoint: string; tokenFile: string; timeoutMs?: number; socket?: string };
export class CoreServiceError extends Error {
  constructor(readonly code: string, readonly requestId: string) { super(code); }
}
export function coreServiceOptions(env: NodeJS.ProcessEnv = process.env): CoreServiceOptions | undefined {
  if (!env.HARU_CORE_SERVICE_ENDPOINT) return;
  if (!env.HARU_CORE_SERVICE_TOKEN_FILE) throw Error('core_service_token_required');
  return { endpoint: env.HARU_CORE_SERVICE_ENDPOINT, tokenFile: env.HARU_CORE_SERVICE_TOKEN_FILE,
    ...(env.HARU_CORE_POLICY_SOCKET ? { socket: env.HARU_CORE_POLICY_SOCKET } : {}) };   // 3720: policy calls only; everything else stays HTTP
}

/** Internal loopback transport. No retry, local-worker fallback, or service shutdown. */
export class CoreServiceClient {
  private token: string;
  private endpoint: string;
  constructor(private options: CoreServiceOptions) {
    const url = new URL(options.endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('core_service_loopback_required');
    if (statSync(options.tokenFile).mode & 0o077) throw Error('core_service_token_must_be_private');
    this.token = readFileSync(options.tokenFile, 'utf8').trim();
    if (this.token.length < 32) throw Error('core_service_token_invalid');
    this.endpoint = url.origin;
  }
  async readOnlyWorkflow(input:ReadOnlyInput):Promise<unknown> {
    let response:Response;
    try {
      response=await fetch(`${this.endpoint}/v1/workflows/read-only`,{method:'POST',redirect:'error',
        headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),
        signal:AbortSignal.timeout(Math.min(this.options.timeoutMs??1000,1000))});
    } catch { throw Error('core_read_only_unavailable'); }
    if (!response.ok)throw Error('core_read_only_unavailable');
    try { return await response.json(); } catch { throw Error('core_read_only_protocol_error'); }
  }
  async route(input:Record<string,unknown>):Promise<any> {
    try {
      const response=await fetch(`${this.endpoint}/v1/router`,{method:'POST',redirect:'error',
        headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),
        signal:AbortSignal.timeout(Math.min(this.options.timeoutMs ?? 3000, 3000))});
      if(!response.ok)throw Error('core_router_unavailable');
      const result=await response.json();
      if(result.version!==1||result.op!==input.op)throw Error('core_router_protocol_error');
      return result;
    }catch(error){if(error instanceof Error&&error.message.startsWith('core_router_'))throw error;throw Error('core_router_unavailable');}
  }
  /** Fixed character transport; Core owns sessions, catalog and model dispatch. */
  async roleplay(input:Record<string,unknown>):Promise<Response> {
    return fetch(`${this.endpoint}/v1/roleplay`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},
      body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});
  }
  /** Authenticated phone task courier. Core owns interpretation and execution. */
  async phoneTask(input:Record<string,unknown>,signal:AbortSignal):Promise<Response> {
    return fetch(`${this.endpoint}/v1/phone/task`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},
      body:JSON.stringify(input),signal:AbortSignal.any([signal,AbortSignal.timeout(165000)])});
  }
  async phoneProfile(input:Record<string,unknown>):Promise<Response> {
    return fetch(`${this.endpoint}/v1/phone/profile`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},
      body:JSON.stringify(input),signal:AbortSignal.timeout(5000)});
  }
  async roleplayPage():Promise<Response> {
    return fetch(`${this.endpoint}/v1/roleplay/page`,{redirect:'error',
      headers:{authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(5000)});
  }
  async cloudModel(input:Record<string,unknown>,signal?:AbortSignal):Promise<Response> {
    return fetch(`${this.endpoint}/v1/models/cloud`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),...(signal?{signal}:{})});
  }
  async assemblePrompt(input:Record<string,unknown>):Promise<any> {
    const response=await fetch(`${this.endpoint}/v1/prompts/assemble`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(3000)});
    if(!response.ok){
      const detail=await response.json().catch(()=>null);
      if(response.status===422&&detail?.detail==='natural_identity_overflow')throw Error('natural_context_overflow:identity');
      throw Error('core_prompt_unavailable');
    }
    const result=await response.json();
    if(result.version!==1||result.mode!==input.mode)throw Error('core_prompt_protocol_error');
    return result;
  }
  async prepareMemory(input:Record<string,unknown>,signal?:AbortSignal):Promise<any> {
    const response=await fetch(`${this.endpoint}/v1/memory/prepare`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),
      signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(4000)])});
    if(!response.ok)throw Error('memory_service_unavailable');
    return response.json();
  }
  async model(input:Record<string,unknown>,signal?:AbortSignal):Promise<Response> {
    return fetch(`${this.endpoint}/v1/models/chat`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),...(signal?{signal}:{})});
  }
  async modelAdmission():Promise<any> {
    const response=await fetch(`${this.endpoint}/v1/models/admission`,{redirect:'error',
      headers:{authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(1000)});
    if(!response.ok)throw Error('core_model_admission_unavailable');
    return response.json();
  }
  async modelCapabilities(input:{version:1;model:string;endpoint:string}):Promise<any> {
    const response=await fetch(`${this.endpoint}/v1/models/capabilities`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('core_model_capabilities_unavailable');
    const result=await response.json();
    if(result.version!==1||result.model!==input.model||!['ollama','llamacpp'].includes(result.provider)||typeof result.available!=='boolean'
      ||!['vision','tools'].every(key=>result[key]===null||typeof result[key]==='boolean')
      ||(result.context_tokens!==null&&(!Number.isInteger(result.context_tokens)||result.context_tokens<1)))throw Error('core_model_capabilities_protocol_error');
    return result;
  }
  async modelResidency(input:{version:1;model:string;endpoint:string;context_tokens:number},signal?:AbortSignal):Promise<any> {
    const response=await fetch(`${this.endpoint}/v1/models/residency`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),
      signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(1000)])});
    if(!response.ok)throw Error('core_model_residency_unavailable');
    const result=await response.json();
    if(result.version!==1||result.model!==input.model||!['ollama','llamacpp'].includes(result.provider)||!['warm','cold','unknown'].includes(result.residency)
      ||(result.context_tokens!==null&&(!Number.isInteger(result.context_tokens)||result.context_tokens<1)))throw Error('core_model_residency_protocol_error');
    return result;
  }
  async attention(input:Record<string,unknown>):Promise<any> {
    try{
      const response=await fetch(`${this.endpoint}/v1/attention`,{method:'POST',redirect:'error',
        headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(1000)});
      if(!response.ok)throw Error('core_attention_unavailable');
      const result=await response.json();
      if(result.version!==1||result.op!==input.op)throw Error('core_attention_protocol_error');
      return result;
    }catch(error){if(error instanceof Error&&error.message.startsWith('core_attention_'))throw error;throw Error('core_attention_unavailable');}
  }
  async localBudget(input:Record<string,unknown>):Promise<any> {
    let response:Response;
    try{response=await fetch(`${this.endpoint}/v1/inference/budget`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(1000)});}
    catch{throw Error('core_local_budget_unavailable');}
    if(!response.ok)throw Error('core_local_budget_unavailable');
    const result=await response.json();
    if(result.version!==1||result.task_id!==input.task_id||result.revision!==input.revision||!Number.isInteger(result.limit_ms)||result.limit_ms<1||result.limit_ms>80000||result.residency!==input.residency)throw Error('core_local_budget_protocol_error');
    return result;
  }
  async call(target: 'storage' | 'tasks', method: string, params: Record<string, unknown>, id: string = randomUUID()): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/v1/compat/${target}`, {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ protocol: 1, id, method, params }), signal: AbortSignal.timeout(this.options.timeoutMs ?? 12_000),
      });
    } catch { throw new CoreServiceError('core_service_outcome_unknown', id); }
    let body: any;
    try { body = await response.json(); } catch { throw new CoreServiceError('core_service_outcome_unknown', id); }
    if (!response.ok) {
      const code = typeof body?.detail === 'string' && /^[a-z_]{1,100}$/.test(body.detail) ? body.detail : 'core_service_unavailable';
      throw new CoreServiceError(code, id);
    }
    if (body?.protocol !== 1 || body.id !== id || typeof body.ok !== 'boolean') throw new CoreServiceError('core_service_protocol_error', id);
    if (!body.ok) {
      const code = typeof body.error?.code === 'string' && /^[a-z_]{1,100}$/.test(body.error.code) ? body.error.code : 'core_service_failed';
      throw new CoreServiceError(code, id);
    }
    return body.result;
  }
}
