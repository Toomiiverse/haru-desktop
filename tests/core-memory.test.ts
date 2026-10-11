import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureCorePromptComparison, parseCoreMemoryResponse, readCoreMemory, readCoreMemoryConfig, replacePromptProfile, selectCoreMemory, withoutCoreGraphClaims, type CoreMemoryResponse } from '../electron/core-memory';
import { defaultMemoryBlocks as defaultBlocks, formatMemoryBlocks, type BlockSources, type DerivedMemoryBlocks } from '../electron/blocks';
import { chatDynamicContext, chatSystemPrompt, type PromptState } from '../electron/prompt';
import { readSearchConfig } from '../electron/search';
import { emptyGraph, linkedFacts, linkedNote } from '../electron/factgraph';

const slate = '2026-09-21T00:00:00.000Z';
const derived: DerivedMemoryBlocks = {
  human: { value: '- CORE HUMAN', memoryIds: ['plan'] }, preferences: { value: '- CORE TEA', memoryIds: [] },
  relationship: { value: '- CORE EMMA', memoryIds: [] }, shared_history: { value: '- CORE JOKE', memoryIds: [] },
};
const response: CoreMemoryResponse = { protocol: 1, epochId: 'epoch', slateAt: slate, retrieval: 'semantic', blocks: derived };
const sources: BlockSources = {
  character: { identity: 'IDENTITY', style: 'STYLE' }, profile: { nickname: 'OLD HUMAN', occupation: '', about: '' },
  memories: [], sessions: [{ day: '2026-09-20', summary: 'UNCHANGED WORKING STATE', createdAt: slate }],
  herOwn: 'UNCHANGED HER OWN', now: new Date(slate),
};
const render = (replacement?: DerivedMemoryBlocks) => formatMemoryBlocks(defaultBlocks(), sources, { compact: true, omit: ['persona'], derived: replacement }).text;
const config = readCoreMemoryConfig({ HARU_CORE_MEMORY: 'shadow' });

test('protocol rejects partial blocks, unexpected slate, and pinned epoch mismatch', () => {
  const request = { protocol: 1 as const, expectedSlateAt: slate, expectedEpochId: 'epoch', query: '', now: slate };
  assert.deepEqual(parseCoreMemoryResponse(JSON.stringify(response), request), response);
  for (const value of [{ ...response, slateAt: null }, { ...response, epochId: 'other' }, { ...response, blocks: { human: derived.human } }]) {
    assert.throws(() => parseCoreMemoryResponse(JSON.stringify(value), request));
  }
});

test('missing executable is a bounded bridge failure', async () => {
  await assert.rejects(readCoreMemory({ ...config, node: '/no-such-haru-node' }, { protocol: 1, expectedSlateAt: slate, query: '', now: slate }), /bridge_failed/);
});

test('full text capture requires explicit opt-in and creates a private artifact', () => {
  const comparison = { mode: 'shadow', old: [{ role: 'user', content: 'private' }], core: [] };
  assert.equal(captureCorePromptComparison(config, comparison), null);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'haru-prompt-capture-'));
  try {
    const file = captureCorePromptComparison({ ...config, captureDir: dir }, comparison)!;
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).old, comparison.old);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
