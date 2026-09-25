#!/usr/bin/env node
// Offline replay of an already captured full conversation: no completion request.
// Compile first: ./node_modules/.bin/tsc -p tests/tsconfig.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const build = path.resolve(arg('--compiled-root', path.join(__dirname, '../dist-test/electron')));
const { readCoreMemoryConfig, readCoreMemory, CORE_MEMORY_LABELS, replacePromptProfile, withoutCoreGraphClaims } = require(path.join(build, 'core-memory.js'));
const { mergeBlockDefaults, fitToLimit, renderBlockCompact, formatMemoryBlocks } = require(path.join(build, 'blocks.js'));
const { migrateMemories, semanticSimilarities } = require(path.join(build, 'memory.js'));
const { ollamaEmbedder } = require(path.join(build, 'embeddings.js'));
const { readFollowing } = require(path.join(build, 'following.js'));
const { normalizeGraph, linkedFacts, linkedNote } = require(path.join(build, 'factgraph.js'));

async function main() {
  const input = arg('--input');
  const configFile = arg('--config');
  const output = arg('--out');
  if (!input || !configFile || !output) throw new Error('Usage: node scripts/core-memory-compare.cjs --input last-prompt.json --config config.json --out comparison.json [--db copy.db] [--memories memories.json] [--scale 0.6] [--keyword-only]');
  const captured = JSON.parse(fs.readFileSync(input, 'utf8'));
  const desktop = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!Array.isArray(captured.conversation)) throw new Error('capture_missing_conversation');
  let conversation = captured.conversation;
  const sections = conversation.filter(message => message.role === 'system' && typeof message.content === 'string')
    .flatMap(message => [...message.content.matchAll(/<memory_blocks>\n[\s\S]*?\n<\/memory_blocks>/g)].map(match => match[0]));
  if (sections.length !== 1) throw new Error('capture_needs_one_memory_section');
  const config = readCoreMemoryConfig();
  config.mode = 'shadow';
  if (arg('--db')) config.db = path.resolve(arg('--db'));
  if (process.argv.includes('--keyword-only')) config.keywordOnly = true;
  const now = arg('--now', new Date().toISOString());
  const userTexts = conversation.filter(message => message.role === 'user' && typeof message.content === 'string').map(message => message.content);
  const latest = arg('--query', userTexts.at(-1) ?? '');
  const recentContext = userTexts.slice(0, -1).slice(-3).join(' ');
  const query = [recentContext, latest].filter(Boolean).join(' ');
  if (arg('--query')) {
    const lastUser = conversation.map(message => message.role).lastIndexOf('user');
    conversation = conversation.map((message, index) => index === lastUser ? { ...message, content: latest } : message);
  }
  const response = await readCoreMemory(config, {
    protocol: 1, expectedSlateAt: desktop.her?.slate?.at ?? null,
    ...(config.expectedEpochId ? { expectedEpochId: config.expectedEpochId } : {}), query, now,
  });
  const scale = Number(arg('--scale', '1'));
  if (!Number.isFinite(scale) || scale < 0.2 || scale > 1) throw new Error('invalid_scale');
  const configured = mergeBlockDefaults(desktop.memory?.blocks);
  const coreLabels = new Set(CORE_MEMORY_LABELS);
  const seen = new Set();
  const cuts = [];
  const fragment = label => {
    const block = configured.find(block => block.label === label);
    if (!block) throw new Error('missing_block_configuration');
    const value = block.edited && typeof block.value === 'string' ? block.value : response.blocks[label].value;
    if (!value.trim()) return '';
    const fitted = fitToLimit(value, block, scale);
    if (fitted.cut) cuts.push({ label, before: value.length, after: fitted.value.length });
    return renderBlockCompact(block, fitted.value);
  };
  const previous = sections[0];
  // Preserve the other blocks byte-for-byte, including any old truncation.
  const body = previous.slice('<memory_blocks>\n'.length, -'\n</memory_blocks>'.length);
  const replacedBody = body.replace(/<([a-z][a-z0-9_]*)>\n[\s\S]*?\n<\/\1>/g, (match, label) => {
    if (!coreLabels.has(label)) return match;
    seen.add(label);
    const block = configured.find(block => block.label === label);
    return block?.edited && typeof block.value === 'string' ? match : fragment(label);
  });
  const added = CORE_MEMORY_LABELS.filter(label => !seen.has(label)).map(fragment).filter(Boolean);
  let next = `<memory_blocks>\n${[replacedBody, ...added].filter(Boolean).join('\n')}\n</memory_blocks>`;
  let oldMemory = previous;
  let appliedGraphIds = [];
  const memoriesFile = arg('--memories');
  if (memoriesFile) {
    const memoryFile = JSON.parse(fs.readFileSync(memoriesFile, 'utf8'));
    const memories = migrateMemories(memoryFile.memories ?? [], now);
    const capturedValues = new Map([...body.matchAll(/<([a-z][a-z0-9_]*)>\n([\s\S]*?)\n<\/\1>/g)].map(match => [match[1], match[2]]));
    // The existing prompt supplies context outside memory's scope. Both paths
    // regenerate current_project too, exercising the shared source-ID claims.
    const rebuilt = new Set([...CORE_MEMORY_LABELS, 'current_project', 'her_standing']);
    const blocks = configured.map(block => rebuilt.has(block.label) ? block : { ...block, edited: true, value: capturedValues.get(block.label) ?? '' });
    let semantic; let latestSemantic;
    if (!config.keywordOnly) {
      const embedder = ollamaEmbedder(config.endpoint, config.embedModel, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
      const texts = memories.filter(memory => !memory.supersededBy);
      const embeddings = await embedder.embedBatch([...texts.map(memory => memory.text), query, latest]);
      const vectors = new Map(texts.map((memory, index) => [memory.id, embeddings[index]]));
      semantic = semanticSimilarities(memories, embeddings[texts.length], vectors);
      latestSemantic = semanticSimilarities(memories, embeddings[texts.length + 1], vectors);
    }
    const sources = {
      character: { identity: '', style: '' }, profile: { nickname: '', occupation: '', about: '', ...desktop.profile },
      memories, sessions: memoryFile.sessions ?? [], query, latest, semantic, latestSemantic, now: new Date(now),
      following: Object.values(readFollowing(desktop.following)).map(work => ({ title: work.title, kind: work.kind, progress: work.progress })),
    };
    const oldRender = formatMemoryBlocks(blocks, sources, { compact: true, omit: ['persona'], scale });
    const coreRender = formatMemoryBlocks(blocks, sources, { compact: true, omit: ['persona'], scale, derived: response.blocks });
    oldMemory = oldRender.text;
    next = coreRender.text;
    appliedGraphIds = coreRender.coreGraphIds;
    cuts.splice(0, cuts.length, ...oldRender.cut.map(cut => ({ path: 'old', ...cut })), ...coreRender.cut.map(cut => ({ path: 'core', ...cut })));
  }
  let oldLinked = ''; let coreLinked = ''; let graphSummary;
  const graphFile = arg('--graph');
  if (graphFile) {
    if (!memoriesFile) throw new Error('graph_comparison_requires_memories_snapshot');
    // Captures with an old graph note require its original structured state;
    // refuse to guess its boundary or silently keep duplicate context.
    if (conversation.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes('Who and what that message names, as it has come up in your talks over time'))) throw new Error('capture_already_contains_graph_context');
    const graph = normalizeGraph(JSON.parse(fs.readFileSync(graphFile, 'utf8')));
    const linked = linkedFacts(graph, latest, { context: recentContext, userName: desktop.profile?.nickname ?? '' });
    const remaining = withoutCoreGraphClaims(linked, appliedGraphIds);
    oldLinked = linkedNote(graph, linked); coreLinked = linkedNote(graph, remaining);
    graphSummary = { selected: linked.length, covered: linked.length - remaining.length, remaining: remaining.length };
  }
  const baseline = replacePromptProfile(conversation, previous, oldMemory);
  const replacement = replacePromptProfile(conversation, previous, next);
  // Put the optional regenerated graph context in the same changing message,
  // immediately before the memory profile. Every other captured slot stays put.
  const insertLinked = (messages, memory, note) => note ? replacePromptProfile(messages, `About the user: ${memory}`, `${note} About the user: ${memory}`) : messages;
  const oldConversation = insertLinked(baseline, oldMemory, oldLinked);
  const coreConversation = insertLinked(replacement, next, coreLinked);
  const changedMessages = coreConversation.flatMap((message, index) => message.content === oldConversation[index].content ? [] : [index]);
  const summary = {
    capturedAt: captured.at, comparedAt: now, epochId: response.epochId, slateAt: response.slateAt, retrieval: response.retrieval,
    scale, changedMessages, oldMemoryChars: oldMemory.length, coreMemoryChars: next.length,
    oldMemoryHash: crypto.createHash('sha256').update(oldMemory).digest('hex'), coreMemoryHash: crypto.createHash('sha256').update(next).digest('hex'), cuts,
    ...(memoriesFile ? { sourceSnapshot: { config: path.resolve(configFile), memories: path.resolve(memoriesFile), coreDb: config.db } } : {}),
    ...(graphSummary ? { graph: graphSummary } : {}),
    note: (memoriesFile
      ? 'Both memory paths use the supplied snapshot, same query and time. current_project and her_standing also regenerate; working_state, her_own, custom blocks and other conversation context remain captured. Desktop raw-text embeddings and Core prefixed embeddings follow their respective production paths.'
      : 'Current Core memory inserted into a previously captured desktop conversation. Other blocks/messages remain captured; this is not a reconstruction of historical Core state.')
      + (graphFile ? ' Graph context regenerates from the same frozen graph, with Core claims limited to complete displayed blocks.' : '')
      + (arg('--query') ? ' The last user message is replaced by the supplied query in both variants.' : '')
      + ' No completion requested. Scale is supplied explicitly; latest-message focus scoring is not yet implemented by Core.',
  };
  fs.writeFileSync(output, JSON.stringify({ ...summary, old: { ...captured, conversation: oldConversation }, core: { ...captured, conversation: coreConversation } }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ...summary, artifact: path.resolve(output) }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
