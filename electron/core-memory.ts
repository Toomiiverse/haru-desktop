// Optional process bridge to haru-core. Default off; errors keep desktop memory.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DerivedMemoryBlocks, CoreMemoryLabel } from './blocks';
import type { LinkedFact } from './factgraph';
import { CoreServiceClient, coreServiceOptions } from './core-service-client';

export const CORE_MEMORY_LABELS: CoreMemoryLabel[] = ['human', 'preferences', 'relationship', 'shared_history'];
export type CoreMemoryConfig = {
  mode: 'off' | 'shadow' | 'on'; root: string; node: string; db: string;
  expectedEpochId?: string; endpoint: string; embedModel: string;
  timeoutMs: number; keywordOnly: boolean; captureDir?: string;
  transport?: 'process' | 'service';
};
export type CoreMemoryRequest = { protocol: 1; query: string; latest?: string; expectedSourceRevision?: string; now: string; expectedSlateAt: string | null; expectedEpochId?: string };
export type CoreMemoryResponse = { protocol: 1; epochId: string; slateAt: string | null; retrieval: 'semantic' | 'keyword'; sourceRevision?: string; blocks: DerivedMemoryBlocks };
export type CoreMemorySelection = { profile: string; oldProfile: string; coreProfile?: string; status: 'off' | 'shadow' | 'on' | 'fallback'; epochId?: string; elapsedMs: number };

export function readCoreMemoryConfig(env: NodeJS.ProcessEnv = process.env): CoreMemoryConfig {
  const root = env.HARU_CORE_ROOT ?? path.join(os.homedir(), 'haru-core');
  return {
    mode: 'on',   // frozen on (3000); shadow and off were migration modes
    root, node: env.HARU_CORE_NODE ?? '/usr/bin/node', db: env.HARU_CORE_DB ?? path.join(root, 'data/haru-core.db'),
    expectedEpochId: env.HARU_CORE_EPOCH || undefined,
    endpoint: env.HARU_CORE_EMBED_ENDPOINT ?? 'http://127.0.0.1:11436', embedModel: env.HARU_CORE_EMBED_MODEL ?? 'nomic-embed-text',
    timeoutMs: 4000, keywordOnly: env.HARU_CORE_KEYWORD_ONLY === '1', captureDir: env.HARU_CORE_CAPTURE_DIR || undefined,
    transport: env.HARU_CORE_MEMORY_TRANSPORT === 'service' ? 'service' : 'process',
  };
}

export function parseCoreMemoryResponse(input: string, request: CoreMemoryRequest): CoreMemoryResponse {
  const data = JSON.parse(input) as CoreMemoryResponse;
  const slate = request.expectedSlateAt === null ? null : new Date(request.expectedSlateAt).toISOString();
  if (!data || data.protocol !== 1 || typeof data.epochId !== 'string' || !data.epochId
    || data.slateAt !== slate || request.expectedEpochId && data.epochId !== request.expectedEpochId
    || request.expectedSourceRevision !== undefined && data.sourceRevision !== request.expectedSourceRevision
    || !['semantic', 'keyword'].includes(data.retrieval) || !data.blocks) throw new Error('invalid_response');
  for (const label of CORE_MEMORY_LABELS) {
    const block = data.blocks[label];
    if (!block || typeof block.value !== 'string' || block.value.length > 200_000
      || !Array.isArray(block.memoryIds) || block.memoryIds.length > 10_000
      || block.memoryIds.some(id => typeof id !== 'string' || id.length > 200)
      || block.graphIds !== undefined && (!Array.isArray(block.graphIds) || block.graphIds.length > 10_000 || block.graphIds.some(id => typeof id !== 'string' || id.length > 200))) throw new Error('invalid_response');
  }
  return data;
}

/** Fixed codes and numeric stages only; child stderr can otherwise contain
 * private paths, queries or configuration and must never reach app logs. */
export function coreBridgeDiagnostics(stderr: string, timedOut = false) {
  let reason = timedOut ? 'bridge_timeout' : 'bridge_failed';
  const stages: { stage: string; elapsedMs: number }[] = [];
  for (const line of stderr.split('\n')) {
    try {
      const row = JSON.parse(line);
      if (['embedding_timeout', 'source_not_ready', 'source_revision_mismatch', 'source_changed_during_read', 'epoch_changed', 'slate_mismatch', 'unsupported_schema'].includes(row.error)) reason = row.error;
      const value = row.coreTiming;
      if (value && ['input', 'opened', 'embedding_start', 'embedding_complete', 'rendered', 'closed'].includes(value.stage)
          && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 && stages.length < 16) stages.push({ stage: value.stage, elapsedMs: value.elapsedMs });
    } catch { /* no data-bearing stderr in diagnostics */ }
  }
  return { reason, stages };
}

export function readCoreMemory(config: CoreMemoryConfig, request: CoreMemoryRequest): Promise<CoreMemoryResponse> {
  if (config.transport === 'service') return prepareCoreMemory(config, request, [], config.embedModel).then(r => r.memory);
  return new Promise((resolve, reject) => {
    if (![config.root, config.node, config.db].every(path.isAbsolute)) { reject(new Error('absolute_paths_required')); return; }
    const started = performance.now();
    const child = execFile(config.node, ['--import', pathToFileURL(path.join(config.root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(config.root, 'src/cli/render-memory.ts'),
      '--db', config.db, '--embed-endpoint', config.endpoint, '--embed-model', config.embedModel, ...(config.keywordOnly ? ['--keyword-only'] : [])],
    { cwd: config.root, env: { ...process.env, HARU_CORE_MEMORY_TIMING: '1' }, timeout: config.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1_000_000, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      const diagnostics = coreBridgeDiagnostics(stderr, error?.killed === true && error?.signal === 'SIGKILL');
      console.log(`[core-bridge-timing] ${JSON.stringify({ elapsedMs: performance.now() - started, ok: !error,
        ...(error ? { reason: diagnostics.reason } : {}), stdoutBytes: Buffer.byteLength(stdout), stages: diagnostics.stages })}`);
      if (error) {
        reject(new Error(diagnostics.reason)); return;
      }
      try { resolve(parseCoreMemoryResponse(stdout, request)); } catch { reject(new Error('invalid_response')); }
    });
    child.stdin?.on('error', () => { /* process failure is reported by the callback */ });
    child.stdin?.end(JSON.stringify(request));
  });
}

let memoryClient: CoreServiceClient | undefined;
/** The service owns its embedder and DB; only text requests cross this boundary. */
export async function prepareCoreMemory(config: CoreMemoryConfig, request: CoreMemoryRequest,
  auxiliaryQueries: { id: string; text: string }[], auxiliaryModel: string,
  send?: (input: Record<string, unknown>) => Promise<any>) {
  if (!send) {
    const options = coreServiceOptions(); if (!options) throw Error('memory_service_unavailable');
    memoryClient ??= new CoreServiceClient(options);
    send = input => memoryClient!.prepareMemory(input);
  }
  const result = await send({ memory: request, auxiliaryQueries, auxiliaryModel });
  const memory = parseCoreMemoryResponse(JSON.stringify(result.memory), request);
  if (!result.auxiliaryVectors || typeof result.auxiliaryVectors !== 'object') throw Error('invalid_response');
  const vectors: Record<string, number[] | null> = {};
  for (const query of auxiliaryQueries) {
    const vector = result.auxiliaryVectors[query.id];
    if (vector !== null && (!Array.isArray(vector) || !vector.length || vector.length > 16384 || vector.some(v => !Number.isFinite(v)))) throw Error('invalid_response');
    if (vector === null && memory.retrieval !== 'keyword') throw Error('invalid_response');
    vectors[query.id] = vector;
  }
  const metrics = Object.fromEntries(['totalMs','embeddingMs','uniqueQueries','cacheHits','embeddingRequests','batchSize']
    .filter(key => Number.isFinite(result.metrics?.[key]) && result.metrics[key] >= 0).map(key => [key, result.metrics[key]]));
  console.log(`[memory-preparation] ${JSON.stringify({ transport: 'service', ...metrics })}`);
  return { memory, vectors };
}

/** Start a turn-local read while the desktop obtains its own vectors. Only an
 * identical request can consume it. Edits, deletions, resets or changed inputs
 * get a fresh read and the usual post-read revision checks. No results survive
 * the turn, and early rejection is observed even if preparation exits early.
 */
export function prefetchCoreMemory(config: CoreMemoryConfig, request: CoreMemoryRequest,
  read: typeof readCoreMemory = readCoreMemory): typeof readCoreMemory {
  if(config.mode !== 'on' && !(config.mode === 'shadow' && config.captureDir))return read;
  if(config.mode === 'on' && !request.expectedSourceRevision)return read;
  config={...config};request={...request};
  // These records contain only scalar fields. Property insertion order must
  // not turn the same request into a second bridge call.
  const key = (value: object) => JSON.stringify(value, Object.keys(value).sort());
  const configKey=key(config), requestKey=key(request);
  const pending=Promise.resolve().then(()=>read(config,request)).then(
    value=>({ok:true as const,value}), error=>({ok:false as const,error}));
  return async (currentConfig,currentRequest)=>{
    if(key(currentConfig)!==configKey || key(currentRequest)!==requestKey)return read(currentConfig,currentRequest);
    const outcome=await pending;
    if(!outcome.ok)throw outcome.error;
    return outcome.value;
  };
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function withoutCoreGraphClaims(linked: LinkedFact[], graphIds: string[]): LinkedFact[] {
  const covered = new Set(graphIds);
  return linked.filter(entry => !covered.has(entry.fact.id));
}

let backgroundBusy = false;

export async function selectCoreMemory(options: {
  config: CoreMemoryConfig; query: string; latest?: string; now?: Date; sourceRevision?: () => string; slateAt: () => string | null;
  /** Shadow diagnostics need not delay replies. Explicit full captures remain awaited. */
  background?: boolean;
  render: (derived?: DerivedMemoryBlocks) => string;
  fallbackRender?: () => string;
  read?: typeof readCoreMemory; log?: (entry: object) => void;
}): Promise<CoreMemorySelection> {
  const oldProfile = options.render();
  const start = Date.now();
  const fallback = (status: 'off' | 'fallback'): CoreMemorySelection => ({ profile: oldProfile, oldProfile, status, elapsedMs: Date.now() - start });
  if (options.config.mode === 'off') return fallback('off');
  if (options.config.mode === 'shadow' && options.background && !options.config.captureDir) {
    if (!backgroundBusy) {
      backgroundBusy = true;
      void selectCoreMemory({ ...options, background: false, fallbackRender: undefined,
        render: derived => derived ? options.render(derived) : oldProfile,
        log: entry => options.log?.({ ...entry, background: true }),
      }).catch(() => {}).finally(() => { backgroundBusy = false; });
    } else options.log?.({ mode: 'shadow', skipped: true, reason: 'comparison_busy' });
    return { profile: oldProfile, oldProfile, status: 'shadow', elapsedMs: Date.now() - start };
  }
  const slateAt = options.slateAt();
  try {
    const expectedSourceRevision = options.sourceRevision?.();
    if (options.config.mode === 'on' && !expectedSourceRevision) throw new Error('source_revision_required');
    const response = await (options.read ?? readCoreMemory)(options.config, {
      protocol: 1, query: options.query, latest: options.latest, ...(expectedSourceRevision ? { expectedSourceRevision } : {}), now: (options.now ?? new Date()).toISOString(), expectedSlateAt: slateAt,
      ...(options.config.expectedEpochId ? { expectedEpochId: options.config.expectedEpochId } : {}),
    });
    if (options.slateAt() !== slateAt) throw new Error('slate_changed');
    if (expectedSourceRevision && response.sourceRevision !== expectedSourceRevision) throw new Error('source_revision_mismatch');
    if (options.sourceRevision?.() !== expectedSourceRevision) throw new Error('desktop_source_changed');
    const coreProfile = options.render(response.blocks);
    const selection: CoreMemorySelection = { oldProfile, coreProfile, profile: options.config.mode === 'on' ? coreProfile : oldProfile,
      epochId: response.epochId, status: options.config.mode, elapsedMs: Date.now() - start };
    options.log?.({ mode: selection.status, epoch: response.epochId, retrieval: response.retrieval, ms: selection.elapsedMs,
      oldChars: oldProfile.length, coreChars: coreProfile.length, oldHash: digest(oldProfile), coreHash: digest(coreProfile) });
    return selection;
  } catch (error) {
    const result = fallback('fallback');
    if (options.fallbackRender) result.profile = result.oldProfile = options.fallbackRender();
    const reason = error instanceof Error && ['embedding_timeout', 'bridge_timeout', 'source_revision_required', 'source_not_ready', 'source_revision_mismatch', 'source_changed_during_read', 'desktop_source_changed', 'slate_changed', 'unsupported_schema'].includes(error.message) ? error.message : 'bridge_failed';
    options.log?.({ mode: options.config.mode, fallback: true, reason, ms: result.elapsedMs });
    return result;
  }
}

/** Locate the single memory profile inside its existing system-message slot. */
export function replacePromptProfile<T extends { role: string; content?: unknown }>(conversation: T[], from: string, to: string): T[] {
  if (!from) throw new Error('missing_profile');
  let occurrences = 0;
  const result = conversation.map(message => {
    if (message.role !== 'system' || typeof message.content !== 'string') return message;
    const count = message.content.split(from).length - 1;
    occurrences += count;
    return count ? { ...message, content: message.content.replace(from, () => to) } : message;
  });
  if (occurrences !== 1) throw new Error('ambiguous_profile');
  return result;
}

/** Explicit debug opt-in only: complete assembled old/Core prompts, mode 0600. */
export function captureCorePromptComparison(config: CoreMemoryConfig, comparison: {
  epochId?: string; mode: string; old: unknown; core: unknown;
}): string | null {
  if (!config.captureDir) return null;
  try {
    if (!path.isAbsolute(config.captureDir)) return null;
    mkdirSync(config.captureDir, { recursive: true, mode: 0o700 });
    const file = path.join(config.captureDir, `prompt-${Date.now()}-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...comparison }, null, 2), { mode: 0o600, flag: 'wx' });
    return file;
  } catch { return null; }
}
