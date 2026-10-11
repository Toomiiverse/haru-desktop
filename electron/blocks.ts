import {corePolicySync} from './core-policy-sync';
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

import { importanceOf, keywords, retrieveMemories, type MemoryRecord, type SessionSummary } from './memory';
import { herStandingInstruction, herStandings, isHerStanding } from './herstanding';
import { categoryOf, isDay, type Category } from './categories';

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
  /** The list, for the working-state block: what is due today and what is coming up. */
  agenda?: { title: string; kind: string; done: boolean; date?: string; time?: string | null; daysAway?: number }[];
  /**
   * Her own life, already framed: what she is into and what she thinks of it,
   * what she read in the small hours, what she wrote in her diary (tastes.ts,
   * nightlife.ts, diary.ts). Rendered as a block so the same content lives in
   * one place rather than as scattered lines in the prompt.
   */
  herOwn?: string;
  /** The message being answered — makes the human block message-aware the
   *  same way the deterministic engine always was. */
  query?: string;
  /** id → semantic similarity to `query`, from the same embedder retrieval
   *  uses. Without it the human block was keyword-only while the inspector
   *  showed a semantic selection — two answers to "what does she know right
   *  now", and the prompt got the blunter one. */
  semantic?: Map<string, number>;
  /**
   * The latest message alone, when `query` has earlier lines run in front of
   * it, and its own semantic map. Matched as well as the query, never instead
   * (RetrieveOptions.focus).
   */
  latest?: string;
  latestSemantic?: Map<string, number>;
  now?: Date;
};

const LABEL_RE = /^[a-z][a-z0-9_]*$/;

export function blockLabelValid(label: string): boolean {
  return corePolicySync<boolean>('block-governance.blockLabelValid',[label]);
}

/** The label's stable block id. */
export function blockIdFor(label: string): string {
  return corePolicySync<string>('block-governance.blockIdFor',[label]);
}

export function findBlock(blocks: MemoryBlock[], label: string): MemoryBlock | undefined {
  return corePolicySync<MemoryBlock | null>('block-governance.findBlock',[blocks,label]) ?? undefined;
}

/** Whether the model-facing memory tools may touch this block. Read-only is
 *  enforced here, at the layer the tools call — never only in a prompt. */
export function canEditBlock(blocks: MemoryBlock[], label: string): boolean {
  return corePolicySync<boolean>('block-governance.canEditBlock',[blocks,label]);
}

/**
 * The default blocks, mapped onto what Haru already knows. `persona` mirrors
 * the user-controlled character configuration and is read-only; the rest are
 * editable views over the deterministic memory records.
 */
export function defaultMemoryBlocks(): MemoryBlock[] {
  return corePolicySync<MemoryBlock[]>('block-governance.defaultMemoryBlocks',[]);
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
  return corePolicySync<MemoryBlock[]>('block-governance.mergeBlockDefaults',[saved]);
}

// -- derivation ---------------------------------------------------------------

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
  return corePolicySync<string>('block-governance.linesFromRecords',[records,width]);
}

// -- which records each block draws on ------------------------------------------
//
// Each block asks for its own categories (categories.ts), so no block's
// selection can be spent on records another block renders. The human block
// used to retrieve twelve from everything and then drop the preferences and
// relationships, which have blocks of their own — and with twenty of those on
// record, the twelve were all of them, and it rendered no memories at all
// (2026-09-17, on the live store and in the real last prompt).

/** Who he is: shown every turn, the best of them when there are more than this. */
export const IDENTITY_LIMIT = 15;
/** The two of them — running jokes, house rules, moments — shown every turn, the best few. */
export const SHARED_LIMIT = 6;
/** What the message is about: events, plans, things under way, what he taught her. */
export const MOMENT_LIMIT = 10;
/** Plans ahead and things under way, for current_project. */
export const PROJECT_LIMIT = 8;
/** People: everyone while there are few, and once there are many, those this message is most about. */
export const PEOPLE_LIMIT = 12;
/** His own tastes, beside his rules for her: the best few for this message, not every opinion he has voiced. */
export const TASTE_LIMIT = 8;
/** Something under way not raised in this long is not current enough for current_project. */
export const ONGOING_DAYS = 45;
/**
 * How related an event, plan or piece of knowledge has to be to the message to
 * be shown in the human block: the best of its calibrated semantic, keyword
 * and entity match. Measured on the live store (see the memory eval of
 * 2026-09-17): below it, small talk pulled in a record or two about nothing it
 * said; above it, questions about a remembered thing started missing it.
 */
export const MOMENT_FLOOR = 0.3;

const MOMENT: Category[] = ['event', 'plan', 'ongoing', 'knowledge'];

/** Records a block may show at all: current, not hers, not set aside. */
function live(sources: BlockSources): MemoryRecord[] {
  const now = sources.now ?? new Date();
  return sources.memories.filter(memory => !memory.supersededBy
    && memory.status !== 'archived'
    && !isHerStanding(memory)
    && categoryOf(memory, now) !== 'passing');
}

function ofCategory(sources: BlockSources, ...wanted: Category[]): MemoryRecord[] {
  const now = sources.now ?? new Date();
  return live(sources).filter(memory => wanted.includes(categoryOf(memory, now)));
}

function retrieved(records: MemoryRecord[], sources: BlockSources, limit: number, floor?: number): MemoryRecord[] {
  const focus = sources.latest?.trim() ? { message: sources.latest.trim(), semantic: sources.latestSemantic } : undefined;
  return retrieveMemories(records, sources.query?.trim() ?? '', { limit, now: sources.now ?? new Date(), semantic: sources.semantic, ...(floor !== undefined ? { floor } : {}), ...(focus ? { focus } : {}) })
    .map(entry => entry.memory);
}

/** Share of a record's content words another record in the same block already says. */
const RESTATED = 0.75;

/**
 * One line per thing. The vault page and the conversation both write about
 * the same people, so "Johnny — Tommy's stepfather; his mom's second husband"
 * sat above "Tommy's stepfather is named Johnny" in every prompt. The longer
 * line stays; one whose words the other already carries goes.
 */
export function withoutRestatements(records: MemoryRecord[]): MemoryRecord[] {
  return corePolicySync<MemoryRecord[]>('block-governance.withoutRestatements',[records]);
}

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * A plan, an event or something under way with the day it belongs to. An
 * undated one says when it was said instead: "decided on a 1000W PSU" read as
 * this week's news two weeks on, with nothing on the line to say otherwise.
 */
function dated(record: MemoryRecord, now: Date): string {
  const text = record.text.replace(/[.\s]+$/, '');
  if (isDay(record.when)) return record.text.includes(record.when) ? record.text : `${text} (${shortDay(record.when)})`;
  const category = categoryOf(record, now);
  if (category !== 'plan' && category !== 'event' && category !== 'ongoing') return record.text;
  const said = record.createdAt.slice(0, 10);
  if (!isDay(said)) return record.text;
  return `${text} (${category === 'event' ? '' : 'said '}${shortDay(said)})`;
}

function datedLines(records: MemoryRecord[], now: Date): string {
  return linesFromRecords(records.map(record => ({ ...record, text: dated(record, now) })));
}

/**
 * Share of a record's content words the profile has to contain before the
 * record is saying what the profile already said. High, because a record
 * that adds one detail — the Murdoch lodgings to "lives with Emma" — is
 * worth its line; only a restatement is not.
 */
const PROFILE_COVERAGE = 0.8;

/**
 * Whether the profile paragraph already says this.
 *
 * The profile is in every prompt in full, and four of the records — the
 * founder line, ADHD and the psychologist, Emma twice — were the same
 * sentences again a few lines down, some 200 tokens a turn of her reading
 * back what was just above. The records stay: they carry the mentions, the
 * evidence and the retrieval score, and the profile can be edited away
 * tomorrow. They are only not rendered while the profile covers them.
 */
export function coveredByProfile(record: MemoryRecord, profile: BlockSources['profile']): boolean {
  return corePolicySync<boolean>('block-governance.coveredByProfile',[record,profile]);
}

/** The records a block renders, after the two rules every block shares:
 *  nothing the profile already says, and nothing a block above has shown. */
function fresh(records: MemoryRecord[], sources: BlockSources, shown: Set<string>): MemoryRecord[] {
  const out = records.filter(record => !shown.has(record.id) && !coveredByProfile(record, sources.profile));
  for (const record of out) shown.add(record.id);
  return out;
}

/**
 * Resolve what a block should show right now. Derived blocks are rebuilt from
 * the engine on every render, so they can never drift from the authoritative
 * records; blocks with an explicit governed value are shown as stored.
 *
 * `shown` is the ids already rendered by the blocks before this one, so each
 * record appears once, in the most specific block that wants it. Rendered in
 * default order that is: preferences and relationships in their own blocks
 * (the human block leaves those kinds alone), anything else the message
 * called for in human, and current_project gets what human did not take.
 * Callers resolving a single block — the tools, the inspector — pass nothing
 * and see the block whole.
 */
export function resolveBlockValue(block: MemoryBlock, sources: BlockSources, shown: Set<string> = new Set()): string {
  {
    const result = corePolicySync<{value:string;shown:string[]}>('memory-block.resolveBlockValue', [block, {...sources, now:sources.now ?? new Date(), semantic:sources.semantic ? [...sources.semantic] : undefined, latestSemantic:sources.latestSemantic ? [...sources.latestSemantic] : undefined}, [...shown]]);
    for (const id of result.shown) shown.add(id);
    return result.value;
  }
}

/** The rendered metadata line for a block. */
export function blockMetadata(value: string, block: MemoryBlock): string {
  return corePolicySync<string>('block-governance.blockMetadata',[value,block]);
}

/**
 * Fit a derived value into its budget. Order matters: tighter selection and
 * consolidation first, trimming only as the last resort — and trimming is
 * never silent (the caller logs what was cut). Returns the value and whether
 * it was cut.
 */
export function fitToLimit(value: string, block: MemoryBlock, scale = 1): { value: string; cut: boolean } {
  return corePolicySync<{value:string;cut:boolean}>('block-governance.fitToLimit',[value,block,scale]);
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
  return corePolicySync<{ok:boolean;value?:string;reason?:string}>('block-governance.appendToBlockValue',[current,content,block]);
}

/**
 * Replace one exact substring. Refuses when the target is missing — and when
 * it appears more than once, because silently picking an occurrence is how the
 * wrong content gets changed.
 */
export function replaceInBlockValue(current: string, oldSubstring: string, newSubstring: string, block: MemoryBlock): { ok: boolean; value?: string; reason?: string } {
  return corePolicySync<{ok:boolean;value?:string;reason?:string}>('block-governance.replaceInBlockValue',[current,oldSubstring,newSubstring,block]);
}

/** Mark a block as carrying an explicit governed value. */
export function withEditedValue(block: MemoryBlock, value: string): MemoryBlock {
  return corePolicySync<MemoryBlock>('block-governance.withEditedValue',[block,value]);
}

/** Drop the explicit value so the block derives from the engine again. */
export function resetBlockToDerived(block: MemoryBlock): MemoryBlock {
  return corePolicySync<MemoryBlock>('block-governance.resetBlockToDerived',[block]);
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
  return corePolicySync<string>('block-governance.renderBlock',[block,value]);
}

export type BlockRenderResult = {
  text: string;
  cut: { label: string; before: number; after: number }[];
  /** Only complete, actually displayed Core values may cover a graph note. */
  coreGraphIds: string[];
};

export type BlockRenderOptions = {
  /** Core replaces only derived values. Governed edits retain precedence. */
  derived?: DerivedMemoryBlocks;
  /** Labels left out of this render. Their values still resolve everywhere
   *  else — the inspector, the tools — this only decides what the prompt says. */
  omit?: string[];
  /**
   * Tag and value only: no description paragraph, no character budget. The
   * full shape is Letta's, written for an agent that reads the description to
   * decide what belongs where and watches chars_current to manage its own
   * budget. Neither happens here — the budgets are enforced in code and the
   * append tool refuses over-limit writes itself, the tool schema names the
   * blocks, and the behavioural lines in the descriptions ("do not infer",
   * "follow them even when not mentioned") are already said, more forcefully,
   * elsewhere in the prompt. Measured against the live config, the wrappers
   * were ~1,700 characters a turn that told the model nothing it acts on.
   */
  compact?: boolean;
  /**
   * The fraction of each block's budget this render may use, 0..1. A phone
   * reply reads on a screen where every token is time before the first word,
   * and the memory blocks are the biggest single chunk the hosted brain
   * re-processes each turn — so away replies get the recent, high-priority
   * lines within a smaller budget, and the desk keeps the full blocks.
   */
  scale?: number;
};

export type CoreMemoryLabel = 'human' | 'preferences' | 'relationship' | 'shared_history';
export type DerivedMemoryBlocks = Record<CoreMemoryLabel, { value: string; memoryIds: string[]; graphIds?: string[] }>;

/** The compact shape: the label as the tag, then the value. */
export function renderBlockCompact(block: MemoryBlock, value: string): string {
  return corePolicySync<string>('block-governance.renderBlockCompact',[block,value]);
}

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
/**
 * Blocks an away reply gets whole. The scale exists so a phone that reads at
 * the speed of the first word is not kept waiting on what she remembers about
 * them; what she has been up to herself is what makes her her, and cutting it
 * to six tenths dropped last night out of every call. Measured 2026-09-06: the
 * extra size moves the hosted model's first word by tenths of a second at most.
 */
const UNSCALED_BLOCKS = new Set(['her_own']);
const CORE_DERIVED_BLOCKS = new Set(['human', 'preferences', 'relationship', 'shared_history']);

export function formatMemoryBlocks(blocks: MemoryBlock[], sources: BlockSources, options: BlockRenderOptions = {}): BlockRenderResult {
  {
    const plan=corePolicySync<BlockRenderResult | {error:string}>('block-governance.formatMemoryBlocks',[blocks,{...sources,semantic:sources.semantic?[...sources.semantic]:undefined,latestSemantic:sources.latestSemantic?[...sources.latestSemantic]:undefined,now:sources.now??new Date()},options]);
    if('error' in plan)throw Error(plan.error);return plan;
  }
}
/** "tomorrow", or the weekday and date, for a list item a few days out. */
/** "yesterday", "2 days ago (Fri 11 Sep)" — a past date, so it cannot be read as still to come. */
function whenWas(date: string | undefined, daysAway: number): string {
  const ago = daysAway === -1 ? 'yesterday' : `${-daysAway} days ago`;
  const [year, month, day] = (date ?? '').split('-').map(Number);
  if (!year || !month || !day) return ago;
  return `${ago} (${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })})`;
}

function whenIs(date: string | undefined, daysAway: number): string {
  if (daysAway === 1) return 'tomorrow';
  const [year, month, day] = (date ?? '').split('-').map(Number);
  if (!year || !month || !day) return `in ${daysAway} days`;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
