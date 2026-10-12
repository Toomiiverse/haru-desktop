import {corePolicySync} from './core-policy-sync';
import { randomUUID } from 'node:crypto';

const receiptMetadata = new Set<string>();
const metadataKey = (r: ToolReceipt) => JSON.stringify([r.executionId, r.startedAt, r.receivedAt, r.observedAt]);
function trustedReceipt(r: ToolReceipt): ToolReceipt {
  receiptMetadata.add(metadataKey(r));
  while (receiptMetadata.size > 10_000) receiptMetadata.delete(receiptMetadata.values().next().value!);
  return r;
}
/** Generated UUID groups and epoch milliseconds can accidentally pass Luhn.
 * Project only metadata created here; scope and external data remain intact. */
export function toolReceiptPrivacyText(raw: string): string {
  try {
    const r = JSON.parse(raw);
    if (r?.receiptVersion !== 1 || !receiptMetadata.has(metadataKey(r))) return raw;
    const view = { ...r };
    view.executionId = '[application receipt identifier]';
    for (const key of ['startedAt', 'receivedAt', 'observedAt']) if (typeof view[key] === 'number') view[key] = new Date(view[key]).toISOString();
    return JSON.stringify(view);
  } catch { return raw; }
}

/** Application-owned execution metadata. Tool text is data, never this envelope. */
export type ToolReceipt = {
  receiptVersion: 1;
  executionId: string;
  tool: string;
  scope: Record<string, unknown>;
  access: 'read' | 'mutation';
  outcome: 'succeeded' | 'failed' | 'pending' | 'unknown';
  startedAt: number | null;
  receivedAt: number | null;
  observedAt: number | null;
  data: unknown;
};

const READS = new Set([
  'get_system_info', 'get_gpu_info', 'get_processes', 'get_docker_status', 'get_service_status',
  'diagnose_system', 'minecraft_status', 'vault_read', 'vault_list', 'look_up_knowledge',
  'search_chats', 'search_web', 'read_web_page', 'read_video_transcript',
  'look_up_anime', 'describe_myself',
]);
export function isReadTool(name: string, args: Record<string, unknown> = {}): boolean {
  if(process.env.HARU_CORE_RECEIPT_POLICY==='on')return corePolicySync<boolean>('receipt-policy.isRead',[name,args]);
  return READS.has(name) || name === 'browser_control' && ['read', 'list'].includes(String(args.action))
    || name === 'claude_session' && args.action === 'list'
    || name === 'downloads' && !['pause', 'resume'].includes(String(args.action))
    || ['get_manga', 'watch_anime'].includes(name) && args.action === 'status';
}
export function toolArgs(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function outcome(data: unknown, read: boolean): ToolReceipt['outcome'] {
  if(process.env.HARU_CORE_RECEIPT_POLICY==='on')return corePolicySync<ToolReceipt['outcome']>('receipt-policy.outcome',[data,read]);
  if (typeof data === 'string') return /(?:permission denied|failed to|traceback|could not|unknown tool|\berror\b)/i.test(data) ? 'failed' : 'unknown';
  if (Array.isArray(data)) return read ? 'succeeded' : 'unknown';
  if (!data || typeof data !== 'object') return 'unknown';
  const v = data as Record<string, unknown>;
  // Do not accept a tool's imitation of application metadata.
  if ('receiptVersion' in v) return 'unknown';
  if (v.error != null && v.error !== false && v.error !== '') return 'failed';
  if (['ok', 'done', 'saved', 'created', 'success', 'executed', 'shown', 'opened', 'closed', 'changed'].some(k => v[k] === false)) return 'failed';
  if (v.timedOut === true || ['exit', 'exit_code', 'exitCode', 'returncode'].some(k => k in v && v[k] === null)) return 'unknown';
  if (['exit', 'exit_code', 'exitCode', 'returncode'].some(k => k in v && v[k] !== 0)) return 'failed';
  const state = String(v.outcome ?? v.status ?? (read ? '' : v.state) ?? '');
  if (/^(?:error|failed|failure|cancelled|canceled|blocked|denied)$/i.test(state)) return 'failed';
  if (v.cancelled === true || v.canceled === true) return 'failed';
  // A running service is a successfully observed state; a running job is not completion.
  if (!read && (['unknown', 'pending', 'queued', 'accepted', 'scheduled', 'confirm', 'restarting'].some(k => v[k] === true)
    || /^(?:unknown|outcome[_ -]unknown|pending|queued|accepted|scheduled|started|in[_ -]progress|running|confirmation[_ -]required)$/i.test(state))) return 'pending';
  if (read) return Object.keys(v).some(k => !['note', 'message', 'timestamp', 'observedAt', 'observed_at'].includes(k)) ? 'succeeded' : 'unknown';
  if (['ok', 'done', 'saved', 'success', 'executed', 'shown', 'booked', 'opened', 'closed', 'stopped', 'changed', 'unchanged', 'navigated', 'activated'].some(k => v[k] === true)
    || ['exit', 'exit_code', 'exitCode', 'returncode'].some(k => v[k] === 0)
    || /^(?:completed|succeeded|success)$/i.test(state)
    || ['opened', 'closed', 'deleted', 'done', 'saved', 'restarted', 'stopped'].some(k => typeof v[k] === 'string' && !!v[k])) return 'succeeded';
  if ('started' in v) return 'pending';
  return 'unknown';
}
export function sourceTime(data: unknown, fallback: number | null): number | null {
  if(process.env.HARU_CORE_FINAL_TOOLS==='on'){
    const observations=data&&typeof data==='object'&&!Array.isArray(data)?['observedAt','observed_at','timestamp','collectedAt','collected_at'].filter(k=>k in data).map(k=>{
      const value=(data as Record<string,unknown>)[k];const parsed=typeof value==='number'?value:Date.parse(String(value));return Number.isFinite(parsed)?parsed:null;
    }):null;
    return corePolicySync('final-tool-values.sourceTime',[observations,fallback]);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fallback;
  const v = data as Record<string, unknown>;
  const times = ['observedAt', 'observed_at', 'timestamp', 'collectedAt', 'collected_at'].filter(k => k in v).map(k => {
    const t = typeof v[k] === 'number' ? v[k] as number : Date.parse(String(v[k]));
    return Number.isFinite(t) ? t : null;
  });
  if (times.includes(null) || fallback !== null && times.some(t => t! > fallback + 5000)) return null;
  return times.length ? Math.min(...times as number[], ...(fallback === null ? [] : [fallback])) : fallback;
}
export function makeToolReceipt(tool: string, args: unknown, raw: string, startedAt: number | null, receivedAt: number | null): ToolReceipt {
  let data: unknown; try { data = JSON.parse(raw); } catch { data = raw; }
  const scope = toolArgs(args), read = isReadTool(tool, scope);
  return trustedReceipt({ receiptVersion: 1, executionId: randomUUID(), tool, scope, access: read ? 'read' : 'mutation', outcome: outcome(data, read),
    startedAt, receivedAt, observedAt: sourceTime(data, startedAt), data });
}
/** Only for application-owned ledger/history, never for raw external tool output. */
export function storedToolReceipt(raw: string): ToolReceipt | null {
  try {
    const r = JSON.parse(raw);
    return r?.receiptVersion === 1 && typeof r.executionId === 'string' && typeof r.tool === 'string' && r.scope && typeof r.scope === 'object'
      && ['read', 'mutation'].includes(r.access) && ['succeeded', 'failed', 'pending', 'unknown'].includes(r.outcome)
      && [r.startedAt, r.receivedAt, r.observedAt].every(t => t === null || typeof t === 'number' && Number.isFinite(t))
      && 'data' in r ? trustedReceipt(r) : null;
  } catch { return null; }
}
/** Compatibility for callers inspecting a raw result, not an execution receipt. */
export function toolResultSucceeded(raw: string, name = ''): boolean {
  // An anonymous array can describe a successful lookup, but no named mutation can.
  return makeToolReceipt(name || (raw.trim().startsWith('[') ? 'search_web' : 'unknown'), {}, raw, null, null).outcome === 'succeeded';
}
