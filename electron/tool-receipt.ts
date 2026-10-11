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
  return corePolicySync<boolean>('receipt-policy.isRead',[name,args]);
}
export function toolArgs(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function outcome(data: unknown, read: boolean): ToolReceipt['outcome'] {
  return corePolicySync<ToolReceipt['outcome']>('receipt-policy.outcome',[data,read]);
}
export function sourceTime(data: unknown, fallback: number | null): number | null {
  {
    const observations=data&&typeof data==='object'&&!Array.isArray(data)?['observedAt','observed_at','timestamp','collectedAt','collected_at'].filter(k=>k in data).map(k=>{
      const value=(data as Record<string,unknown>)[k];const parsed=typeof value==='number'?value:Date.parse(String(value));return Number.isFinite(parsed)?parsed:null;
    }):null;
    return corePolicySync('final-tool-values.sourceTime',[observations,fallback]);
  }
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
