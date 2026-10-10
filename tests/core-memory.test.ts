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

test('background shadow never waits for Core, bounds concurrency and cannot select its result', async () => {
  let release!: (value: CoreMemoryResponse) => void;
  let reads = 0;
  const waiting = new Promise<CoreMemoryResponse>(resolve => { release = resolve; });
  const options = { config, query: 'tea', slateAt: () => slate, render, background: true,
    read: () => { reads++; return waiting; } };
  const selected = await selectCoreMemory(options);
  assert.equal(selected.profile, render());
  assert.equal(selected.coreProfile, undefined);
  await selectCoreMemory(options);
  assert.equal(reads, 1);
  release(response);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selected.profile, render());
  const active = await selectCoreMemory({ ...options, config: { ...config, mode: 'on' }, read: async () => response });
  assert.match(active.profile, /CORE HUMAN/);
});

test('off never starts the bridge; shadow compares and on selects Core', async () => {
  let reads = 0;
  const read = async () => { reads++; return response; };
  const run = (mode: 'off' | 'shadow' | 'on') => selectCoreMemory({ config: { ...config, mode }, query: 'tea', slateAt: () => slate, render, read });
  const off = await run('off');
  assert.equal(reads, 0); assert.equal(off.profile, render());
  const shadow = await run('shadow');
  assert.equal(shadow.profile, render()); assert.match(shadow.coreProfile!, /CORE HUMAN/);
  const on = await run('on');
  assert.equal(on.profile, shadow.coreProfile); assert.equal(reads, 2);
});

test('process errors and resets fall back; diagnostics contain no raw memories', async () => {
  const entries: object[] = [];
  const fallback = await selectCoreMemory({ config, query: 'PRIVATE QUERY', slateAt: () => slate, render,
    read: async () => { throw new Error('PRIVATE ERROR'); }, log: entry => entries.push(entry) });
  assert.equal(fallback.status, 'fallback'); assert.equal(fallback.profile, render());
  let current = slate;
  const reset = await selectCoreMemory({ config: { ...config, mode: 'on' }, query: '', slateAt: () => current, render,
    fallbackRender: () => 'FRESH AFTER RESET', read: async () => { current = '2026-09-22T00:00:00Z'; return response; } });
  assert.equal(reset.profile, 'FRESH AFTER RESET'); assert.equal(reset.status, 'fallback');
  await selectCoreMemory({ config, query: 'PRIVATE QUERY', slateAt: () => slate, render, read: async () => response, log: entry => entries.push(entry) });
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE|OLD HUMAN|CORE HUMAN/);
});

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

test('governed edits, unaffected blocks, and scaled budgets survive replacement', () => {
  const blocks = defaultBlocks();
  const preferences = blocks.find(block => block.label === 'preferences')!;
  preferences.edited = true; preferences.value = 'HIS GOVERNED EDIT';
  const human = blocks.find(block => block.label === 'human')!;
  human.limit = 200;
  const result = formatMemoryBlocks(blocks, sources, { compact: true, scale: 0.5,
    derived: { ...derived, human: { value: '- CORE HUMAN\n'.repeat(70), memoryIds: [] } } });
  assert.match(result.text, /HIS GOVERNED EDIT/); assert.doesNotMatch(result.text, /CORE TEA/);
  assert.match(result.text, /UNCHANGED WORKING STATE/); assert.match(result.text, /UNCHANGED HER OWN/);
  assert.ok(result.cut.some(cut => cut.label === 'human' && cut.after <= 100));
});

test('Core source claims keep a plan out of current_project after human used it', () => {
  const local = { ...sources, memories: [{ id: 'plan', text: 'Finish the chemistry assignment', kind: 'fact' as const, category: 'plan' as const,
    createdAt: slate, lastSeenAt: slate, status: 'active' as const, confidence: 1, importance: 1, mentions: 1, source: 'conversation' as const }] };
  const result = formatMemoryBlocks(defaultBlocks(), local, { compact: true, derived });
  assert.doesNotMatch(result.text, /Finish the chemistry assignment/);
});

test('full prompt comparison keeps hosted cache head and all other messages byte-identical', () => {
  const state: PromptState = {
    now: new Date(slate), timezone: 'Australia/Perth', character: sources.character, profile: render(), aniList: '',
    journalConfig: { enabled: false, askHour: 20, askUnprompted: false }, journal: [], checkInsToday: [], screen: {}, asides: [], rated: [], kept: [],
    search: readSearchConfig({ enabled: false }), knowledgeEnabled: false, systemEnabled: false, machineNote: '', following: {},
    irritation: 0, ego: 0, goodnight: 'none', shout: 'none', latestMessage: 'hello', fresh: null, herRecentReplies: [], movedJustNow: null, pushback: undefined,
  };
  for (const hosted of [false, true]) {
    const old = [{ role: 'system', content: chatSystemPrompt(state, hosted) },
      ...(hosted ? [{ role: 'system', content: chatDynamicContext(state) }] : []), { role: 'user', content: 'hello' }];
    const core = replacePromptProfile(old, render(), render(derived));
    assert.equal(core[0].content, chatSystemPrompt({ ...state, profile: render(derived) }, hosted));
    if (hosted) assert.equal(core[0].content, old[0].content);
    assert.deepEqual(core.at(-1), old.at(-1));
  }
  assert.throws(() => replacePromptProfile([], '', 'anything'), /missing_profile/);
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

test('a full Emma prompt suppresses covered graph facts only after her complete Core block renders', () => {
  const graph = emptyGraph();
  graph.entities.push({ id: 'emma', name: 'Emma', kind: 'person', aliases: [], firstSeen: '2026-09-20', lastSeen: '2026-09-21' });
  graph.facts.push({ id: 'girlfriend', subject: 'emma', relation: 'girlfriend of', object: 'e0', sentence: 'Emma is the girlfriend of the user.', learned: '2026-09-20', confirmed: '2026-09-21', days: 1 });
  graph.facts.push({ id: 'grc', subject: 'emma', relation: 'works in', value: 'GRC', sentence: 'Emma works in GRC.', learned: '2026-09-20', confirmed: '2026-09-21', days: 1 });
  const linked = linkedFacts(graph, 'Tell me about Emma');
  assert.equal(linked.length, 2);
  const replacement = { ...derived, relationship: { value: '- Emma is his girlfriend; she works in GRC and is learning to climb.', memoryIds: ['emma-memory'], graphIds: ['girlfriend', 'grc'] } };
  const check = (blocks: ReturnType<typeof defaultBlocks>, omit: string[] = []) => {
    const result = formatMemoryBlocks(blocks, sources, { compact: true, omit, derived: replacement });
    const note = linkedNote(graph, withoutCoreGraphClaims(linked, result.coreGraphIds));
    const state: PromptState = {
      now: new Date(slate), timezone: 'Australia/Perth', character: sources.character, profile: result.text, linked: note, aniList: '',
      journalConfig: { enabled: false, askHour: 20, askUnprompted: false }, journal: [], checkInsToday: [], screen: {}, asides: [], rated: [], kept: [],
      search: readSearchConfig({ enabled: false }), knowledgeEnabled: false, systemEnabled: false, machineNote: '', following: {},
      irritation: 0, ego: 0, goodnight: 'none', shout: 'none', latestMessage: 'Tell me about Emma', fresh: null, herRecentReplies: [], movedJustNow: null, pushback: undefined,
    };
    return { result, prompt: chatSystemPrompt(state), hosted: chatDynamicContext(state) };
  };
  const complete = check(defaultBlocks());
  for (const prompt of [complete.prompt, complete.hosted]) {
    assert.match(prompt, /Emma is his girlfriend/);
    assert.doesNotMatch(prompt, /Emma is the girlfriend of the user\.|Emma works in GRC\./);
  }
  const edited = defaultBlocks();
  Object.assign(edited.find(block => block.label === 'relationship')!, { edited: true, value: 'A governed replacement without Emma' });
  assert.match(check(edited).prompt, /Emma is the girlfriend of the user\./);
  assert.match(check(defaultBlocks(), ['relationship']).prompt, /Emma is the girlfriend of the user\./);
  const tiny = defaultBlocks(); tiny.find(block => block.label === 'relationship')!.limit = 10;
  assert.equal(check(tiny).result.coreGraphIds.length, 0);
});

test('custom block reordering fails back instead of duplicating a plan', async () => {
  const reordered = defaultBlocks().sort((a, b) => Number(b.label === 'current_project') - Number(a.label === 'current_project'));
  const renderReordered = (replacement?: DerivedMemoryBlocks) => formatMemoryBlocks(reordered, sources, { compact: true, derived: replacement }).text;
  const result = await selectCoreMemory({ config: { ...config, mode: 'on' }, query: 'plan', slateAt: () => slate, render: renderReordered, read: async () => response });
  assert.equal(result.status, 'fallback'); assert.equal(result.profile, renderReordered());
});
