// Memory blocks: a Letta-inspired working-memory and context layer on top of
// Haru's existing deterministic memory engine.
//
// Blocks are views, not a second database. The block record persists only its
// configuration — label, description, character limit, read_only — plus an
// explicit value once a governed edit lands. Without an explicit value the
// block's content is derived at render time from the authoritative sources:
// character config, the profile, and the memory records selected by the
// existing deterministic engine. Edits from the model flow through the same
// governance as everything else — isWorthRemembering, confidence, dedup,
// supersession. LLM proposes. Haru decides.
//
// The one immutable block is the persona, which mirrors the character
// configuration the user controls; the agent can never modify it through a
// memory tool.

import { retrieveMemories, type MemoryKind, type MemoryRecord, type SessionSummary } from './memory';

export type MemoryBlock = {
  /** Stable per label — block-persona, block-human, … */
  id: string;
  /** Unique, lowercase snake_case; the key memory tools address. */
  label: string;
  /** How the model should interpret and use the block. The main guide for
   *  correct usage, not decorative metadata. */
  description: string;
  /**
   * Explicit contents, present only after a governed edit. Absent means the
   * block is derived from the engine at render time. Explicit values are
   * still governed at write time, so they never bypass Haru's memory.
   */
  value?: string;
  /** Character budget for the rendered value. Enforced, never silently cut. */
  limit: number;
  /** True → memory tools refuse; only the user (administrator) may edit. */
  read_only: boolean;
  /** True once an explicit value exists. */
  edited?: boolean;
};

/** What a derived block may draw on. Plain shapes, so blocks.ts stays pure and
 *  testable without main.ts. */
export type BlockSources = {
  character: { identity: string; style: string };
  profile: { nickname: string; occupation: string; about: string };
  memories: MemoryRecord[];
  sessions: SessionSummary[];
  /** Ongoing works the user consumes — the following list. */
  following?: { title: string; kind: string; progress?: number }[];
  /** Today's agenda, for the working-state block. */
  agenda?: { title: string; kind: string; done: boolean }[];
  /** The message being answered — makes the human block message-aware the
   *  same way the deterministic engine always was. */
  query?: string;
  now?: Date;
};

const LABEL_RE = /^[a-z][a-z0-9_]*$/;

export function blockLabelValid(label: string): boolean {
  return LABEL_RE.test(label);
}

/** The label's stable block id. */
export function blockIdFor(label: string): string {
  return `block-${label}`;
}

export function findBlock(blocks: MemoryBlock[], label: string): MemoryBlock | undefined {
  return blocks.find(block => block.label === label);
}

/** Whether the model-facing memory tools may touch this block. Read-only is
 *  enforced here, at the layer the tools call — never only in a prompt. */
export function canEditBlock(blocks: MemoryBlock[], label: string): boolean {
  const block = findBlock(blocks, label);
  return Boolean(block && !block.read_only);
}

/**
 * The default blocks, mapped onto what Haru already knows. `persona` mirrors
 * the user-controlled character configuration and is read-only; the rest are
 * editable views over the deterministic memory records.
 */
export function defaultMemoryBlocks(): MemoryBlock[] {
  return [
    {
      id: blockIdFor('persona'),
      label: 'persona',
      description: "Contains Haru's core identity, personality and behavioural guidance. This block is read-only: it cannot be modified by the agent or by memory tools.",
      limit: 5000,
      read_only: true,
    },
    {
      id: blockIdFor('human'),
      label: 'human',
      description: 'Contains stable information about the person Haru is interacting with — who they are, what matters to them. Use it to personalise responses when relevant. Do not infer facts that are not present.',
      limit: 5000,
      read_only: false,
    },
    {
      id: blockIdFor('preferences'),
      label: 'preferences',
      description: 'Standing preferences — how the user likes things done and how Haru should behave. Follow them even when they have not been mentioned recently.',
      limit: 3000,
      read_only: false,
    },
    {
      id: blockIdFor('relationship'),
      label: 'relationship',
      description: 'People and pets in the user\'s life and how they connect to them. Only what the user has actually said; never infer relationships.',
      limit: 2000,
      read_only: false,
    },
    {
      id: blockIdFor('current_project'),
      label: 'current_project',
      description: 'What the user is working on — long-term projects and active work. Reference it when it is relevant to what they are doing.',
      limit: 2000,
      read_only: false,
    },
    {
      id: blockIdFor('working_state'),
      label: 'working_state',
      description: 'What is going on right now — recent days, today\'s agenda, current context. Use it to stay aware of the present without re-asking.',
      limit: 2000,
      read_only: false,
    },
  ];
}

function asBlock(saved: unknown): MemoryBlock | null {
  if (!saved || typeof saved !== 'object') return null;
  const record = saved as Partial<MemoryBlock>;
  if (typeof record.label !== 'string' || !blockLabelValid(record.label)) return null;
  return {
    id: typeof record.id === 'string' ? record.id : blockIdFor(record.label),
    label: record.label,
    description: typeof record.description === 'string' ? record.description : '',
    value: typeof record.value === 'string' ? record.value : undefined,
    limit: typeof record.limit === 'number' && Number.isFinite(record.limit) && record.limit > 0 ? record.limit : 5000,
    read_only: record.read_only === true,
    edited: record.edited === true || typeof record.value === 'string',
  };
}

/**
 * Read saved blocks forward: drop anything malformed, keep what the user has
 * configured, and add any default labels that are missing. Called at load and
 * by the schema migration, so an installation that never saw blocks still
 * gets the standard set without losing custom ones.
 */
export function mergeBlockDefaults(saved: unknown): MemoryBlock[] {
  const parsed = Array.isArray(saved) ? saved.map(asBlock).filter((block): block is MemoryBlock => block !== null) : [];
  const seen = new Set(parsed.map(block => block.label));
  const out = [...parsed];
  for (const block of defaultMemoryBlocks()) {
    if (!seen.has(block.label)) out.push(block);
  }
  return out;
}

// -- derivation ---------------------------------------------------------------

/** The kinds that shape how Haru talks regardless of the topic. */
const ALWAYS_KINDS: MemoryKind[] = ['preference', 'relationship'];

/** Wraps long lines so the block stays readable and the char count honest. */
function wrap(text: string, width: number): string {
  if (text.length <= width) return text;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

/** Line-wraps a list of record texts under a fixed per-item width. */
export function linesFromRecords(records: MemoryRecord[], width = 160): string {
  return records.map(record => `- ${wrap(record.text, width)}`).join('\n');
}

function selectedFor(query: string, sources: BlockSources, limit: number): MemoryRecord[] {
  return retrieveMemories(sources.memories, query, { limit, now: sources.now ?? new Date() })
    .map(entry => entry.memory);
}

const PROJECT_QUERY = 'project work company business job';

/**
 * Resolve what a block should show right now. Derived blocks are rebuilt from
 * the engine on every render, so they can never drift from the authoritative
 * records; blocks with an explicit governed value are shown as stored.
 */
export function resolveBlockValue(block: MemoryBlock, sources: BlockSources): string {
  if (block.edited && typeof block.value === 'string') return block.value;
  switch (block.label) {
    case 'persona': {
      const lines: string[] = [];
      if (sources.character.identity.trim()) lines.push(wrap(sources.character.identity.trim(), 160));
      if (sources.character.style.trim()) lines.push(wrap(sources.character.style.trim(), 160));
      return lines.join('\n');
    }
    case 'human': {
      // The standing picture (profile) plus whatever the deterministic engine
      // selects for this message — the always-included records plus anything
      // relevant to what was just said.
      const lines: string[] = [];
      if (sources.profile.nickname.trim()) lines.push(`- Goes by ${sources.profile.nickname.trim()}.`);
      if (sources.profile.occupation.trim()) lines.push(`- Work: ${sources.profile.occupation.trim()}.`);
      if (sources.profile.about.trim()) lines.push(`- ${wrap(sources.profile.about.trim(), 160)}`);
      const selected = sources.query?.trim()
        ? selectedFor(sources.query, sources, 12)
        : selectedFor('', sources, 12);
      if (selected.length) lines.push(linesFromRecords(selected));
      return lines.join('\n');
    }
    case 'preferences': {
      const records = sources.memories
        .filter(memory => memory.kind === 'preference' && !memory.supersededBy && memory.status !== 'archived')
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || b.mentions - a.mentions);
      return linesFromRecords(records);
    }
    case 'relationship': {
      const records = sources.memories
        .filter(memory => memory.kind === 'relationship' && !memory.supersededBy && memory.status !== 'archived')
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
      return linesFromRecords(records);
    }
    case 'current_project': {
      const lines: string[] = [];
      const projectRecords = selectedFor(PROJECT_QUERY, sources, 8)
        .filter(memory => memory.kind === 'fact' || memory.kind === 'event');
      if (projectRecords.length) lines.push(linesFromRecords(projectRecords));
      for (const work of sources.following ?? []) {
        lines.push(`- ${work.title}${work.progress ? ` (${work.progress})` : ''}`);
      }
      return lines.join('\n');
    }
    case 'working_state': {
      const lines: string[] = [];
      for (const session of sources.sessions.slice(-3)) {
        lines.push(`- ${session.day}: ${wrap(session.summary, 160)}`);
      }
      const agenda = (sources.agenda ?? []).filter(item => !item.done);
      if (agenda.length) {
        lines.push(`- Today's agenda: ${agenda.map(item => `${item.title} (${item.kind})`).join(', ')}`);
      }
      return lines.join('\n');
    }
    default:
      return typeof block.value === 'string' ? block.value : '';
  }
}

/** The rendered metadata line for a block. */
export function blockMetadata(value: string, block: MemoryBlock): string {
  return `- chars_current=${value.length}\n- chars_limit=${block.limit}`;
}

/**
 * Fit a derived value into its budget. Order matters: tighter selection and
 * consolidation first, trimming only as the last resort — and trimming is
 * never silent (the caller logs what was cut). Returns the value and whether
 * it was cut.
 */
export function fitToLimit(value: string, block: MemoryBlock): { value: string; cut: boolean } {
  if (value.length <= block.limit) return { value, cut: false };
  const lines = value.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const candidate = used + line.length + (kept.length ? 1 : 0);
    if (candidate > block.limit && kept.length) break;
    kept.push(line);
    used = candidate;
  }
  const tail = '\n…';
  if (used + tail.length <= block.limit && kept.length) {
    return { value: [...kept, tail].join('\n'), cut: true };
  }
  return { value: kept.join('\n'), cut: true };
}

// -- governed edits ------------------------------------------------------------

/** The model-facing edit operations, as pure logic. The callers in main.ts
 *  run these inside a transaction and route the content through Haru's memory
 *  governance before anything persists; these helpers only answer whether the
 *  block itself accepts the edit. */

export type BlockEditResult = { ok: boolean; reason?: string };

/**
 * Append one line to a block's value. Append is the safe concurrent primitive
 * — it only ever adds, so two writers cannot lose each other's work. Obvious
 * duplication of an existing line is refused, and the limit is enforced.
 */
export function appendToBlockValue(current: string, content: string, block: MemoryBlock): { ok: boolean; value?: string; reason?: string } {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: 'content is empty' };
  const normalise = (line: string) => line.replace(/^-\s*/, '').trim().toLowerCase().replace(/[.!]+$/, '');
  const existing = new Set(current.split('\n').map(normalise));
  if (existing.has(normalise(trimmed))) return { ok: false, reason: 'that is already in the block' };
  const next = current ? `${current}\n- ${trimmed}` : `- ${trimmed}`;
  if (next.length > block.limit) return { ok: false, reason: `that would exceed the ${block.limit}-character limit` };
  return { ok: true, value: next };
}

/**
 * Replace one exact substring. Refuses when the target is missing — and when
 * it appears more than once, because silently picking an occurrence is how the
 * wrong content gets changed.
 */
export function replaceInBlockValue(current: string, oldSubstring: string, newSubstring: string, block: MemoryBlock): { ok: boolean; value?: string; reason?: string } {
  const old = oldSubstring.trim();
  const replacement = newSubstring.trim();
  if (!old) return { ok: false, reason: 'old substring is empty' };
  const occurrences = current.split(old).length - 1;
  if (occurrences === 0) return { ok: false, reason: 'old substring not found in the block' };
  if (occurrences > 1) return { ok: false, reason: `old substring appears ${occurrences} times — too ambiguous to replace safely` };
  const next = current.replace(old, replacement);
  if (next.length > block.limit) return { ok: false, reason: `the replacement would exceed the ${block.limit}-character limit` };
  return { ok: true, value: next };
}

/** Mark a block as carrying an explicit governed value. */
export function withEditedValue(block: MemoryBlock, value: string): MemoryBlock {
  return { ...block, value, edited: true };
}

/** Drop the explicit value so the block derives from the engine again. */
export function resetBlockToDerived(block: MemoryBlock): MemoryBlock {
  const { value: _value, edited: _edited, ...rest } = block;
  return rest;
}

// -- prompt rendering ----------------------------------------------------------

/**
 * Renders one block in the Letta-inspired shape: the label as the tag, the
 * description the model should use the block by, the live character budget in
 * metadata, and the value. Empty blocks are skipped — a tag with nothing in
 * it teaches the model to invent contents. The value is expected to already
 * fit its budget; fitting happens in formatMemoryBlocks so the cut report is
 * a single source of truth.
 */
export function renderBlock(block: MemoryBlock, value: string): string {
  return [
    `<${block.label}>`,
    '<description>',
    block.description,
    '</description>',
    '<metadata>',
    blockMetadata(value, block),
    '</metadata>',
    '<value>',
    value,
    '</value>',
    `</${block.label}>`,
  ].join('\n');
}

export type BlockRenderResult = {
  text: string;
  cut: { label: string; before: number; after: number }[];
};

export type BlockRenderOptions = {
  /** Labels left out of this render. Their values still resolve everywhere
   *  else — the inspector, the tools — this only decides what the prompt says. */
  omit?: string[];
};

/**
 * The whole memory-blocks section for the system prompt. Values are resolved
 * from the engine and fitted to their budgets; anything cut is reported so the
 * caller can log it — consolidation before truncation is the caller's job, and
 * truncation is never silent.
 *
 * The chat prompt leaves the persona block out. chatSystemPrompt already
 * appends the same identity and style text at the very end, where a small
 * model still has it; rendering it here as well put the whole persona — some
 * 2,500 characters — into the prompt twice, once early where it is forgotten
 * and once late where it counts. The block still exists for the inspector.
 */
export function formatMemoryBlocks(blocks: MemoryBlock[], sources: BlockSources, options: BlockRenderOptions = {}): BlockRenderResult {
  const parts: string[] = [];
  const cut: BlockRenderResult['cut'] = [];
  const omitted = new Set(options.omit ?? []);
  for (const block of blocks) {
    if (omitted.has(block.label)) continue;
    const value = resolveBlockValue(block, sources);
    if (!value.trim()) continue;
    const fitted = fitToLimit(value, block);
    if (fitted.cut) cut.push({ label: block.label, before: value.length, after: fitted.value.length });
    parts.push(renderBlock(block, fitted.value));
  }
  const text = parts.length ? `<memory_blocks>\n${parts.join('\n')}\n</memory_blocks>` : '';
  return { text, cut };
}