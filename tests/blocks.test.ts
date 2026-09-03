import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendToBlockValue, blockIdFor, blockLabelValid, canEditBlock, defaultMemoryBlocks,
  coveredByProfile, findBlock, fitToLimit, formatMemoryBlocks, linesFromRecords, mergeBlockDefaults,
  replaceInBlockValue, renderBlock, resolveBlockValue, blockMetadata,
  resetBlockToDerived, withEditedValue,
} from '../electron/blocks';
import type { MemoryRecord, SessionSummary } from '../electron/memory';

function record(overrides: Partial<MemoryRecord> & { id: string; text: string; kind: MemoryRecord['kind'] }): MemoryRecord {
  return {
    createdAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-10T00:00:00.000Z',
    mentions: 1,
    confidence: 0.8,
    importance: 0.5,
    source: 'conversation',
    status: 'active',
    memoryType: 'semantic',
    ...overrides,
  };
}

test('defaultMemoryBlocks has the standard set with unique lowercase labels', () => {
  const blocks = defaultMemoryBlocks();
  assert.deepEqual(blocks.map(b => b.label), ['persona', 'human', 'preferences', 'relationship', 'current_project', 'working_state', 'her_own']);
  assert.equal(new Set(blocks.map(b => b.label)).size, blocks.length);
  for (const block of blocks) {
    assert.equal(blockLabelValid(block.label), true);
    assert.equal(block.id, blockIdFor(block.label));
    assert.ok(block.description.length > 0);
    assert.ok(block.limit > 0);
  }
});

test('persona is the only read-only default', () => {
  const blocks = defaultMemoryBlocks();
  const persona = findBlock(blocks, 'persona')!;
  assert.equal(persona.read_only, true);
  assert.equal(persona.description.toLowerCase().includes('read-only'), true);
  for (const block of blocks.filter(b => b.label !== 'persona')) {
    assert.equal(block.read_only, false);
  }
});

test('canEditBlock refuses missing and read-only blocks', () => {
  const blocks = defaultMemoryBlocks();
  assert.equal(canEditBlock(blocks, 'human'), true);
  assert.equal(canEditBlock(blocks, 'persona'), false);
  assert.equal(canEditBlock(blocks, 'nonexistent'), false);
});

test('mergeBlockDefaults keeps custom blocks and adds missing defaults', () => {
  const saved = [{ label: 'custom', description: 'mine', limit: 1234, read_only: false }];
  const merged = mergeBlockDefaults(saved);
  assert.ok(findBlock(merged, 'custom'));
  assert.equal(findBlock(merged, 'custom')!.limit, 1234);
  for (const label of ['persona', 'human', 'preferences', 'relationship', 'current_project', 'working_state', 'her_own']) {
    assert.ok(findBlock(merged, label), `missing default ${label}`);
  }
});

test('mergeBlockDefaults drops malformed entries and returns defaults from junk', () => {
  assert.equal(mergeBlockDefaults('nonsense').length, defaultMemoryBlocks().length);
  assert.equal(mergeBlockDefaults([{ label: 'Has Spaces' }]).length, defaultMemoryBlocks().length);
  assert.equal(mergeBlockDefaults(null).length, defaultMemoryBlocks().length);
});

test('resolveBlockValue derives the persona from the character config', () => {
  const persona = findBlock(defaultMemoryBlocks(), 'persona')!;
  const value = resolveBlockValue(persona, {
    character: { identity: 'Hyperactive, loud, commanding.', style: 'Short, bossy, mean.' },
    profile: { nickname: '', occupation: '', about: '' },
    memories: [],
    sessions: [],
  });
  assert.ok(value.includes('Hyperactive, loud, commanding.'));
  assert.ok(value.includes('Short, bossy, mean.'));
});

test('resolveBlockValue builds the human block from the profile and the always-offered facts, leaving preferences and relationships to their own blocks', () => {
  const human = findBlock(defaultMemoryBlocks(), 'human')!;
  const memories: MemoryRecord[] = [
    record({ id: 'pref', text: 'Dislikes being nagged', kind: 'preference', importance: 0.85 }),
    record({ id: 'rel', text: 'Lives with Emma', kind: 'relationship', importance: 0.8 }),
    record({ id: 'health', text: 'Is allergic to shellfish', kind: 'fact', importance: 0.8 }),
    record({ id: 'trivia', text: 'Watched a YouTube clip', kind: 'fact', importance: 0.2 }),
  ];
  const value = resolveBlockValue(human, {
    character: { identity: '', style: '' },
    profile: { nickname: 'Tommy', occupation: 'Student', about: 'Founder of the PC Project.' },
    memories,
    sessions: [],
  });
  assert.ok(value.includes('Goes by Tommy'));
  assert.ok(value.includes('Student'));
  assert.ok(value.includes('Founder of the PC Project'));
  assert.ok(value.includes('Is allergic to shellfish'));
  assert.ok(!value.includes('Dislikes being nagged'));
  assert.ok(!value.includes('Lives with Emma'));
  assert.ok(!value.includes('Watched a YouTube clip'));
});

test('resolveBlockValue splits preferences and relationships into their blocks', () => {
  const blocks = defaultMemoryBlocks();
  const memories: MemoryRecord[] = [
    record({ id: 'pref', text: 'Prefers short replies', kind: 'preference', importance: 0.85 }),
    record({ id: 'rel', text: 'Best friend is Sudin', kind: 'relationship', importance: 0.8 }),
  ];
  const sources = { character: { identity: '', style: '' }, profile: { nickname: '', occupation: '', about: '' }, memories, sessions: [] as SessionSummary[] };
  const prefs = resolveBlockValue(findBlock(blocks, 'preferences')!, sources);
  const rels = resolveBlockValue(findBlock(blocks, 'relationship')!, sources);
  assert.ok(prefs.includes('Prefers short replies'));
  assert.ok(!prefs.includes('Sudin'));
  assert.ok(rels.includes('Best friend is Sudin'));
  assert.ok(!rels.includes('short replies'));
});

test('resolveBlockValue surfaces projects and recent working state', () => {
  const blocks = defaultMemoryBlocks();
  const memories: MemoryRecord[] = [
    record({ id: 'p', text: 'Works on the PC Project', kind: 'fact', importance: 0.8 }),
    record({ id: 'e', text: 'Finished the edit on Thursday', kind: 'event', importance: 0.45 }),
  ];
  const sessions: SessionSummary[] = [
    { day: '2026-08-18', summary: 'Wrestled with the TV power connector', createdAt: '2026-08-18T00:00:00.000Z' },
  ];
  const sources = {
    character: { identity: '', style: '' },
    profile: { nickname: '', occupation: '', about: '' },
    memories,
    sessions,
    following: [{ title: 'Oyasumi Punpun', kind: 'manga', progress: 18 }],
    agenda: [{ title: 'Rental inspection', kind: 'event', done: false }],
  };
  const project = resolveBlockValue(findBlock(blocks, 'current_project')!, sources);
  assert.ok(project.includes('PC Project'));
  assert.ok(project.includes('Oyasumi Punpun'));
  const working = resolveBlockValue(findBlock(blocks, 'working_state')!, sources);
  assert.ok(working.includes('TV power connector'));
  assert.ok(working.includes('Rental inspection'));
});

test('an explicit governed value wins over derivation', () => {
  const human = findBlock(defaultMemoryBlocks(), 'human')!;
  const edited = { ...human, value: 'Goes by Tommy.', edited: true };
  const value = resolveBlockValue(edited, {
    character: { identity: '', style: '' },
    profile: { nickname: 'Ignored', occupation: '', about: '' },
    memories: [],
    sessions: [],
  });
  assert.equal(value, 'Goes by Tommy.');
});

test('fitToLimit keeps lines until the budget and marks the cut', () => {
  const long = Array.from({ length: 40 }, (_, i) => `line number ${i} with some padding words`).join('\n');
  const { value, cut } = fitToLimit(long, { ...defaultMemoryBlocks()[0], limit: 300 });
  assert.equal(cut, true);
  assert.ok(value.length <= 300 + 2);
  assert.ok(value.endsWith('…'));
  const short = fitToLimit('short', { ...defaultMemoryBlocks()[0], limit: 300 });
  assert.equal(short.cut, false);
  assert.equal(short.value, 'short');
});

test('blockMetadata reports current and limit characters', () => {
  const block = defaultMemoryBlocks()[0];
  const meta = blockMetadata('hello', block);
  assert.ok(meta.includes('chars_current=5'));
  assert.ok(meta.includes(`chars_limit=${block.limit}`));
});

test('linesFromRecords bullet-lists records', () => {
  const out = linesFromRecords([record({ id: 'a', text: 'First', kind: 'fact' }), record({ id: 'b', text: 'Second', kind: 'fact' })]);
  assert.equal(out, '- First\n- Second');
});

test('renderBlock produces the Letta-shaped structure with description and metadata', () => {
  const block = findBlock(defaultMemoryBlocks(), 'human')!;
  const value = 'Goes by Tommy.';
  const rendered = renderBlock(block, value);
  assert.ok(rendered.startsWith('<human>'));
  assert.ok(rendered.includes('<description>'));
  assert.ok(rendered.includes(block.description));
  assert.ok(rendered.includes('<metadata>'));
  assert.ok(rendered.includes('chars_current=14'));
  assert.ok(rendered.includes(`chars_limit=${block.limit}`));
  assert.ok(rendered.includes('<value>'));
  assert.ok(rendered.includes(value));
  assert.ok(rendered.endsWith('</human>'));
});

test('formatMemoryBlocks renders the whole section and skips empty blocks', () => {
  const blocks = defaultMemoryBlocks();
  const sources = {
    character: { identity: 'Hyperactive, loud.', style: 'Bossy.' },
    profile: { nickname: 'Tommy', occupation: '', about: '' },
    memories: [record({ id: 'pref', text: 'Dislikes being nagged', kind: 'preference', importance: 0.85 })],
    sessions: [] as SessionSummary[],
  };
  const { text, cut } = formatMemoryBlocks(blocks, sources);
  assert.ok(text.startsWith('<memory_blocks>'));
  assert.ok(text.endsWith('</memory_blocks>'));
  assert.ok(text.includes('<persona>'));
  assert.ok(text.includes('<human>'));
  assert.ok(text.includes('<preferences>'));
  assert.ok(!text.includes('<working_state>'));
  assert.ok(!text.includes('<relationship>'));
  assert.deepEqual(cut, []);
});

test('formatMemoryBlocks leaves out omitted blocks, and the persona is what the chat render omits', () => {
  const blocks = defaultMemoryBlocks();
  const sources = {
    character: { identity: 'Hyperactive, loud.', style: 'Bossy.' },
    profile: { nickname: 'Tommy', occupation: '', about: '' },
    memories: [record({ id: 'pref', text: 'Dislikes being nagged', kind: 'preference', importance: 0.85 })],
    sessions: [] as SessionSummary[],
  };
  const { text } = formatMemoryBlocks(blocks, sources, { omit: ['persona'] });
  assert.ok(!text.includes('<persona>'));
  assert.ok(!text.includes('Hyperactive, loud.'));
  assert.ok(text.includes('<human>'));
  assert.ok(text.includes('<preferences>'));
  // The block itself is untouched — it still resolves for the inspector.
  assert.equal(resolveBlockValue(findBlock(blocks, 'persona')!, sources), 'Hyperactive, loud.\nBossy.');
});

test('formatMemoryBlocks compact render is tag and value only, and still fits and reports cuts', () => {
  const blocks = defaultMemoryBlocks().map(block => block.label === 'preferences' ? { ...block, limit: 40 } : block);
  const sources = {
    character: { identity: 'Hyperactive, loud.', style: 'Bossy.' },
    profile: { nickname: 'Tommy', occupation: '', about: '' },
    memories: [
      record({ id: 'pref', text: 'Dislikes being nagged', kind: 'preference', importance: 0.85 }),
      record({ id: 'pref2', text: 'Wants every single reply kept to one short paragraph at most', kind: 'preference', importance: 0.85 }),
    ],
    sessions: [] as SessionSummary[],
  };
  const { text, cut } = formatMemoryBlocks(blocks, sources, { omit: ['persona'], compact: true });
  assert.ok(text.startsWith('<memory_blocks>'));
  assert.ok(!text.includes('<description>'));
  assert.ok(!text.includes('<metadata>'));
  assert.ok(!text.includes('chars_current='));
  assert.ok(!text.includes('<value>'));
  assert.ok(text.includes('<human>\n- Goes by Tommy.\n'));
  assert.ok(text.includes('<preferences>'));
  assert.ok(cut.some(entry => entry.label === 'preferences'));
});

test('coveredByProfile is true for a restatement and false for a record that adds a detail', () => {
  const profile = { nickname: 'Tommy', occupation: 'Student', about: 'I am in a relationship with Emma Wilson since 18th of June, 2024. I have been diagnosed with ADHD and see a psychologist named Sam.' };
  assert.equal(coveredByProfile(record({ id: 'a', text: 'Is in a relationship with Emma Wilson since 18th of June, 2024', kind: 'relationship' }), profile), true);
  assert.equal(coveredByProfile(record({ id: 'b', text: 'Lives with girlfriend Emma in the Murdoch University student lodgings', kind: 'relationship' }), profile), false);
  assert.equal(coveredByProfile(record({ id: 'c', text: 'Wants 6 mailboxes for The PC Project', kind: 'fact' }), { nickname: '', occupation: '', about: '' }), false);
});

test('each record renders once, in its most specific block, and never when the profile already says it', () => {
  const blocks = defaultMemoryBlocks();
  const sources = {
    character: { identity: '', style: '' },
    profile: { nickname: 'Tommy', occupation: '', about: 'Founder of a company called The PC Project in Northbridge.' },
    memories: [
      record({ id: 'pref', text: 'Dislikes being nagged', kind: 'preference', importance: 0.85 }),
      record({ id: 'rel', text: 'Emma is their girlfriend', kind: 'relationship', importance: 0.8 }),
      record({ id: 'founder', text: 'Is the founder of a company called The PC Project in Northbridge', kind: 'fact', importance: 0.8 }),
      record({ id: 'mail', text: 'Wants 6 mailboxes for the company project', kind: 'fact', importance: 0.8 }),
    ],
    sessions: [] as SessionSummary[],
    query: 'how many mailboxes for the project',
  };
  const { text } = formatMemoryBlocks(blocks, sources, { omit: ['persona'], compact: true });
  const section = (label: string) => text.match(new RegExp(`<${label}>[\\s\\S]*?</${label}>`))?.[0] ?? '';
  assert.ok(section('preferences').includes('Dislikes being nagged'));
  assert.ok(!section('human').includes('Dislikes being nagged'));
  assert.ok(section('relationship').includes('Emma is their girlfriend'));
  assert.ok(!section('human').includes('Emma is their girlfriend'));
  assert.ok(section('human').includes('Wants 6 mailboxes'));
  assert.ok(!section('current_project').includes('Wants 6 mailboxes'));
  assert.ok(!text.includes('Is the founder of a company'));
  // Resolved on its own, the block is whole — the tools and inspector see everything.
  assert.ok(resolveBlockValue(findBlock(blocks, 'current_project')!, sources).includes('Wants 6 mailboxes'));
});

test('the human block uses the semantic map when one is supplied', () => {
  const blocks = defaultMemoryBlocks();
  const memories = [record({ id: 'gpu', text: 'Put an RTX 3060 in the server', kind: 'fact', importance: 0.4 })];
  const base = { character: { identity: '', style: '' }, profile: { nickname: '', occupation: '', about: '' }, memories, sessions: [] as SessionSummary[], query: 'how is the graphics card doing' };
  const without = formatMemoryBlocks(blocks, base, { omit: ['persona'], compact: true }).text;
  assert.ok(!without.includes('RTX 3060'));
  const withMap = formatMemoryBlocks(blocks, { ...base, semantic: new Map([['gpu', 0.6]]) }, { omit: ['persona'], compact: true }).text;
  assert.ok(withMap.includes('RTX 3060'));
});

test('formatMemoryBlocks reports what was cut to fit budgets', () => {
  const blocks = defaultMemoryBlocks().map(block => block.label === 'human' ? { ...block, limit: 80 } : block);
  const sources = {
    character: { identity: '', style: '' },
    profile: { nickname: 'Tommy', occupation: 'Student, Creative Director, Boyfriend', about: 'Founder of the PC Project. Diagnosed with ADHD, sees a psychologist once a month. Lives with girlfriend Emma in Murdoch University student lodgings. Works on DaVinci Resolve edits and voice projects.' },
    memories: [record({ id: 'pref', text: 'Dislikes being nagged and corrected without being told how to improve. Prefers not to be constantly reminded of tasks when not asked.', kind: 'preference', importance: 0.85 })],
    sessions: [] as SessionSummary[],
  };
  const { text, cut } = formatMemoryBlocks(blocks, sources);
  assert.ok(cut.length >= 1);
  const humanCut = cut.find(entry => entry.label === 'human')!;
  assert.ok(humanCut.before > humanCut.after);
  const humanRender = text.match(/<human>[\s\S]*?<\/human>/)?.[0] ?? '';
  assert.ok(humanRender.includes('chars_current='));
  assert.ok(humanRender.includes('chars_limit=80'));
});

// -- governed edits ------------------------------------------------------------

test('appendToBlockValue adds a bulleted line and preserves existing content', () => {
  const block = findBlock(defaultMemoryBlocks(), 'human')!;
  const first = appendToBlockValue('Goes by Tommy.', 'Works on the PC Project', block);
  assert.equal(first.ok, true);
  assert.equal(first.value, 'Goes by Tommy.\n- Works on the PC Project');
  const second = appendToBlockValue(first.value!, 'Lives in Perth', block);
  assert.equal(second.value, 'Goes by Tommy.\n- Works on the PC Project\n- Lives in Perth');
});

test('appendToBlockValue refuses empty, duplicate and oversized content', () => {
  const block = findBlock(defaultMemoryBlocks(), 'human')!;
  assert.equal(appendToBlockValue('', '  ', block).ok, false);
  assert.equal(appendToBlockValue('Goes by Tommy.', 'Goes by Tommy.', block).ok, false);
  assert.equal(appendToBlockValue('- Goes by Tommy.', 'goes by tommy', block).ok, false);
  const tiny = { ...block, limit: 30 };
  assert.equal(appendToBlockValue('Goes by Tommy.', 'Works on the PC Project every evening without fail', tiny).ok, false);
});

test('replaceInBlockValue replaces exactly once', () => {
  const block = findBlock(defaultMemoryBlocks(), 'human')!;
  const edit = replaceInBlockValue('Uses Ubuntu on the server.', 'Ubuntu', 'Debian', block);
  assert.equal(edit.ok, true);
  assert.equal(edit.value, 'Uses Debian on the server.');
});

test('replaceInBlockValue refuses missing and ambiguous targets', () => {
  const block = findBlock(defaultMemoryBlocks(), 'human')!;
  assert.equal(replaceInBlockValue('Uses Ubuntu.', 'Fedora', 'Debian', block).ok, false);
  const ambiguous = replaceInBlockValue('likes tea and likes coffee', 'likes', 'hates', block);
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.reason ?? '', /ambiguous/i);
  assert.equal(replaceInBlockValue('Uses Ubuntu.', '  ', 'Debian', block).ok, false);
});

test('replaceInBlockValue enforces the limit', () => {
  const tiny = { ...findBlock(defaultMemoryBlocks(), 'human')!, limit: 20 };
  const edit = replaceInBlockValue('Uses Ubuntu.', 'Ubuntu', 'a much longer operating system name here', tiny);
  assert.equal(edit.ok, false);
});

test('withEditedValue marks the block edited; resetBlockToDerived clears it', () => {
  const human = findBlock(defaultMemoryBlocks(), 'human')!;
  const edited = withEditedValue(human, 'Goes by Tommy.');
  assert.equal(edited.edited, true);
  assert.equal(edited.value, 'Goes by Tommy.');
  const reset = resetBlockToDerived(edited);
  assert.equal(reset.edited, undefined);
  assert.equal(reset.value, undefined);
  assert.deepEqual(reset, human);
});
test('fitToLimit scale shrinks the effective budget', () => {
  const long = Array.from({ length: 40 }, (_, i) => `line number ${i} with some padding words`).join('\n');
  const block = { ...defaultMemoryBlocks()[0], limit: 400 };
  const full = fitToLimit(long, block);
  const scaled = fitToLimit(long, block, 0.5);
  assert.equal(full.cut, true);
  assert.equal(scaled.cut, true);
  assert.ok(scaled.value.length < full.value.length, 'half the budget means fewer lines survive');
  assert.ok(scaled.value.length <= 200 + 2);
});
