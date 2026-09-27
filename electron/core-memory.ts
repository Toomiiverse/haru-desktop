// Optional process bridge to haru-core. Default off; errors keep desktop memory.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DerivedMemoryBlocks, CoreMemoryLabel } from './blocks';
import type { LinkedFact } from './factgraph';

export const CORE_MEMORY_LABELS: CoreMemoryLabel[] = ['human', 'preferences', 'relationship', 'shared_history'];
export type CoreMemoryConfig = {
  mode: 'off' | 'shadow' | 'on'; root: string; node: string; db: string;
  expectedEpochId?: string; endpoint: string; embedModel: string;
  timeoutMs: number; keywordOnly: boolean; captureDir?: string;
};
export type CoreMemoryRequest = { protocol: 1; query: string; now: string; expectedSlateAt: string | null; expectedEpochId?: string };
export type CoreMemoryResponse = { protocol: 1; epochId: string; slateAt: string | null; retrieval: 'semantic' | 'keyword'; blocks: DerivedMemoryBlocks };
export type CoreMemorySelection = { profile: string; oldProfile: string; coreProfile?: string; status: 'off' | 'shadow' | 'on' | 'fallback'; epochId?: string; elapsedMs: number };

export function readCoreMemoryConfig(env: NodeJS.ProcessEnv = process.env): CoreMemoryConfig {
  const root = env.HARU_CORE_ROOT ?? path.join(os.homedir(), 'haru-core');
  return {
    mode: env.HARU_CORE_MEMORY === 'shadow' || env.HARU_CORE_MEMORY === 'on' ? env.HARU_CORE_MEMORY : 'off',
    root, node: env.HARU_CORE_NODE ?? '/usr/bin/node', db: env.HARU_CORE_DB ?? path.join(root, 'data/haru-core.db'),
    expectedEpochId: env.HARU_CORE_EPOCH || undefined,
    endpoint: env.HARU_CORE_EMBED_ENDPOINT ?? 'http://127.0.0.1:11436', embedModel: env.HARU_CORE_EMBED_MODEL ?? 'nomic-embed-text',
    timeoutMs: 4000, keywordOnly: env.HARU_CORE_KEYWORD_ONLY === '1', captureDir: env.HARU_CORE_CAPTURE_DIR || undefined,
  };
}

export function parseCoreMemoryResponse(input: string, request: CoreMemoryRequest): CoreMemoryResponse {
  const data = JSON.parse(input) as CoreMemoryResponse;
  const slate = request.expectedSlateAt === null ? null : new Date(request.expectedSlateAt).toISOString();
  if (!data || data.protocol !== 1 || typeof data.epochId !== 'string' || !data.epochId
    || data.slateAt !== slate || request.expectedEpochId && data.epochId !== request.expectedEpochId
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

export function readCoreMemory(config: CoreMemoryConfig, request: CoreMemoryRequest): Promise<CoreMemoryResponse> {
  return new Promise((resolve, reject) => {
    if (![config.root, config.node, config.db].every(path.isAbsolute)) { reject(new Error('absolute_paths_required')); return; }
    const child = execFile(config.node, ['--import', pathToFileURL(path.join(config.root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(config.root, 'src/cli/render-memory.ts'),
      '--db', config.db, '--embed-endpoint', config.endpoint, '--embed-model', config.embedModel, ...(config.keywordOnly ? ['--keyword-only'] : [])],
    { cwd: config.root, timeout: config.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1_000_000, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) { reject(new Error('bridge_failed')); return; }
      try { resolve(parseCoreMemoryResponse(stdout, request)); } catch { reject(new Error('invalid_response')); }
    });
    child.stdin?.on('error', () => { /* process failure is reported by the callback */ });
    child.stdin?.end(JSON.stringify(request));
  });
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function withoutCoreGraphClaims(linked: LinkedFact[], graphIds: string[]): LinkedFact[] {
  const covered = new Set(graphIds);
  return linked.filter(entry => !covered.has(entry.fact.id));
}

let backgroundBusy = false;

export async function selectCoreMemory(options: {
  config: CoreMemoryConfig; query: string; now?: Date; slateAt: () => string | null;
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
    const response = await (options.read ?? readCoreMemory)(options.config, {
      protocol: 1, query: options.query, now: (options.now ?? new Date()).toISOString(), expectedSlateAt: slateAt,
      ...(options.config.expectedEpochId ? { expectedEpochId: options.config.expectedEpochId } : {}),
    });
    if (options.slateAt() !== slateAt) throw new Error('slate_changed');
    const coreProfile = options.render(response.blocks);
    const selection: CoreMemorySelection = { oldProfile, coreProfile, profile: options.config.mode === 'on' ? coreProfile : oldProfile,
      epochId: response.epochId, status: options.config.mode, elapsedMs: Date.now() - start };
    options.log?.({ mode: selection.status, epoch: response.epochId, retrieval: response.retrieval, ms: selection.elapsedMs,
      oldChars: oldProfile.length, coreChars: coreProfile.length, oldHash: digest(oldProfile), coreHash: digest(coreProfile) });
    return selection;
  } catch {
    const result = fallback('fallback');
    if (options.fallbackRender) result.profile = result.oldProfile = options.fallbackRender();
    options.log?.({ mode: options.config.mode, fallback: true, ms: result.elapsedMs });
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
