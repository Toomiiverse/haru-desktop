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
      id: blockIdFor('her_standing'),
      label: 'her_standing',
      // read_only: these are hers. The memory tools may not edit or delete one,
      // and neither may he through them — a rule somebody else can quietly
      // rewrite is not a rule she holds. Hers to form, hers to supersede when
      // she next sits down with what happened.
      description: 'Rules Haru has worked out for herself about how she is treated, from things that actually happened to her more than once. Hers, not the user\'s. They carry the same weight as the user\'s preferences and she may hold to one against a direct request.',
      limit: 1200,
      read_only: true,
    },
    {
      id: blockIdFor('relationship'),
      label: 'relationship',
      description: 'People and pets in the user\'s life and how they connect to them. Only what the user has actually said; never infer relationships.',
      limit: 2000,
      read_only: false,
    },
    {
      id: blockIdFor('shared_history'),
      label: 'shared_history',
      // Running jokes, house rules and moments between the two of them used to
      // render inside `human`, and the chat prompt shows only the tag. So "Haru,
      // with one r — he once spelled her name 'Harru'" (Us.md) sat among his
      // facts, right under his bio, and she read her own name as something he
      // gave her: "You named me Haru. One r. Like the season. It's in your
      // preferences" — six times in two minutes, against him saying she named
      // herself (2026-09-17). The tag is the framing, so it says whose this is.
      description: 'The history Haru and the user share — running jokes, house rules, moments between the two of them. It belongs to both of them; none of it is a fact about the user alone.',
      limit: 1500,
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
    {
      id: blockIdFor('her_own'),
      label: 'her_own',
      // Wider than the human blocks: this is a week of her own life plus the
      // night just gone, and it was being cut on every phone turn at 8000 —
      // and again on every turn at 10000 once her manga and her wants were in
      // it (11,028 chars, three days running, 2026-09-10 to 12). The cut
      // takes the tail, which is where her diary sits.
      description: 'What Haru has been up to on her own — the things she is into and the views she holds on them, what she read in the small hours, what she wrote in her diary. These are hers, not the user\'s: hold them, bring one up when it fits, and disagree when you mean it.',
      limit: 12000,
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
  const defaults = defaultMemoryBlocks();
  defaults.forEach((block, index) => {
    if (seen.has(block.label)) return;
    // Beside its neighbour in the default order, not at the end: a saved set
    // gains a new block where a fresh install has it, instead of after
    // her_own, the last and longest thing in the section.
    const neighbour = defaults.slice(0, index).reverse().find(candidate => seen.has(candidate.label));
    const at = neighbour ? out.findIndex(candidate => candidate.label === neighbour.label) + 1 : out.length;
    out.splice(at, 0, block);
    seen.add(block.label);
  });
  return out;
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
  return records.map(record => `- ${wrap(record.text, width)}`).join('\n');
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
  const words = records.map(record => keywords(record.text));
  return records.filter((record, index) => {
    const mine = words[index];
    // Too few words to tell a restatement from two short lines that happen to share them.
    if (mine.size < 3) return true;
    return !records.some((other, at) => {
      if (at === index) return false;
      const theirs = words[at];
      const shared = [...mine].filter(word => theirs.has(word)).length / mine.size;
      if (shared < RESTATED) return false;
      // The same length both ways round would drop both; the earlier one stays.
      return other.text.length > record.text.length || (other.text.length === record.text.length && at < index);
    });
  });
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
  const said = keywords(`${profile.about} ${profile.occupation} ${profile.nickname}`);
  if (!said.size) return false;
  const words = keywords(record.text);
  if (!words.size) return false;
  const shared = [...words].filter(word => said.has(word)).length;
  return shared / words.size >= PROFILE_COVERAGE;
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
      // Who they are, then whatever this message is about. What the two of
      // them share is not about him alone: it has its own block.
      const identity = fresh(retrieved(ofCategory(sources, 'identity'), sources, IDENTITY_LIMIT), sources, shown);
      const moment = fresh(retrieved(ofCategory(sources, ...MOMENT), sources, MOMENT_LIMIT, MOMENT_FLOOR), sources, shown);
      const records = [...withoutRestatements(identity), ...moment];
      if (records.length) lines.push(datedLines(records, sources.now ?? new Date()));
      return lines.join('\n');
    }
    case 'preferences': {
      // His rules for her, every one; then the best few of his own tastes for
      // this message.
      const now = sources.now ?? new Date();
      const rules = ofCategory(sources, 'instruction')
        .sort((a, b) => importanceOf(b, now) - importanceOf(a, now) || b.mentions - a.mentions);
      const tastes = retrieved(ofCategory(sources, 'preference'), sources, TASTE_LIMIT);
      return linesFromRecords(fresh(withoutRestatements([...rules, ...tastes]), sources, shown));
    }
    case 'her_standing': {
      // Rendered from herStandingInstruction rather than linesFromRecords: the
      // sentence saying she may hold one against him is the feature, and a bare
      // list of rules without it is a list of things she will apologise for.
      return herStandingInstruction(herStandings(sources.memories));
    }
    case 'relationship': {
      const records = retrieved(ofCategory(sources, 'person'), sources, PEOPLE_LIMIT);
      return linesFromRecords(fresh(withoutRestatements(records), sources, shown));
    }
    case 'shared_history': {
      const records = fresh(retrieved(ofCategory(sources, 'shared'), sources, SHARED_LIMIT), sources, shown);
      return records.length ? datedLines(records, sources.now ?? new Date()) : '';
    }
    case 'current_project': {
      const lines: string[] = [];
      // What is still ahead, soonest first, then what is under way, latest
      // first — whatever the message is about, since this is what he is in
      // the middle of. A plan whose day has gone is an event by now
      // (categoryOf) and is left to the human block.
      const now = sources.now ?? new Date();
      const recent = now.getTime() - ONGOING_DAYS * 86_400_000;
      // Not a dormant one: that is a plan ticked off the list (closeEvents).
      const plans = ofCategory(sources, 'plan')
        .filter(memory => memory.status !== 'dormant')
        .sort((a, b) => (a.when ?? '9999').localeCompare(b.when ?? '9999') || b.lastSeenAt.localeCompare(a.lastSeenAt));
      const ongoing = ofCategory(sources, 'ongoing')
        .filter(memory => memory.status !== 'dormant' && Date.parse(memory.lastSeenAt) >= recent)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
      const projectRecords = fresh([...plans, ...ongoing].slice(0, PROJECT_LIMIT), sources, shown);
      if (projectRecords.length) lines.push(datedLines(projectRecords, now));
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
      // Dated: a psychologist on Friday is not "today's agenda" on Sunday (2026-09-06).
      // And not on the Sunday after either: the fix above only parted the
      // future off, and an event two days gone that nobody ticked was still
      // "Today's agenda: Sam Psychologist (event, 11:30 AM)" — she opened with
      // "11:30 AM is over, Tommy. Don't ignore the calendar." (2026-09-13).
      // A past item is named as past, with its day, so the time reads as gone.
      const agenda = (sources.agenda ?? []).filter(item => !item.done);
      const today = agenda.filter(item => !Number.isFinite(item.daysAway) || item.daysAway === 0);
      const overdue = agenda.filter(item => Number.isFinite(item.daysAway) && (item.daysAway as number) < 0);
      const soon = agenda.filter(item => Number.isFinite(item.daysAway) && (item.daysAway as number) > 0 && (item.daysAway as number) <= 7);
      if (today.length) lines.push(`- Today's agenda: ${today.map(item => `${item.title} (${item.kind}${item.time ? `, ${item.time}` : ''})`).join(', ')}`);
      if (overdue.length) lines.push(`- Not ticked off, from before today: ${overdue.map(item => `${item.title} (${item.kind}, was ${whenWas(item.date, item.daysAway as number)}${item.time ? ` ${item.time}` : ''})`).join(', ')} — these are past, not today's; the times have been and gone`);
      if (soon.length) lines.push(`- Coming up: ${soon.map(item => `${item.title} (${whenIs(item.date, item.daysAway as number)}${item.time ? ` ${item.time}` : ''})`).join(', ')}`);
      return lines.join('\n');
    }
    case 'her_own': {
      return sources.herOwn?.trim() ?? '';
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
export function fitToLimit(value: string, block: MemoryBlock, scale = 1): { value: string; cut: boolean } {
  const limit = Math.floor(block.limit * scale);
  if (value.length <= limit) return { value, cut: false };
  const lines = value.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const candidate = used + line.length + (kept.length ? 1 : 0);
    if (candidate > limit && kept.length) break;
    kept.push(line);
    used = candidate;
  }
  const tail = '\n…';
  if (used + tail.length <= limit && kept.length) {
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
  return [`<${block.label}>`, value, `</${block.label}>`].join('\n');
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
  const parts: string[] = [];
  const cut: BlockRenderResult['cut'] = [];
  const omitted = new Set(options.omit ?? []);
  if (options.derived) {
    const labels = blocks.filter(block => !omitted.has(block.label)).map(block => block.label);
    const expected = ['human', 'preferences', 'relationship', 'shared_history', 'current_project'];
    const positions = labels.filter(label => expected.includes(label)).map(label => expected.indexOf(label));
    if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) throw new Error('unsupported_core_block_order');
  }
  const coreGraphIds = new Set<string>();
  // The fraction of each block's budget this render may use (see scale above).
  const scale = options.scale !== undefined ? Math.max(0.2, Math.min(1, options.scale)) : 1;
  // Threaded through the blocks in order, so a record shown by one is not
  // shown again by the next.
  const shown = new Set<string>();
  for (const block of blocks) {
    if (omitted.has(block.label)) continue;
    const replacement = CORE_DERIVED_BLOCKS.has(block.label) ? options.derived?.[block.label as CoreMemoryLabel] : undefined;
    const useReplacement = replacement && !(block.edited && typeof block.value === 'string');
    const value = useReplacement ? replacement.value : resolveBlockValue(block, sources, shown);
    if (useReplacement) for (const id of replacement.memoryIds) shown.add(id);
    if (!value.trim()) continue;
    const fitted = fitToLimit(value, block, UNSCALED_BLOCKS.has(block.label) ? 1 : scale);
    if (useReplacement && !fitted.cut) for (const id of replacement.graphIds ?? []) coreGraphIds.add(id);
    if (fitted.cut) cut.push({ label: block.label, before: value.length, after: fitted.value.length });
    parts.push(options.compact ? renderBlockCompact(block, fitted.value) : renderBlock(block, fitted.value));
  }
  const text = parts.length ? `<memory_blocks>\n${parts.join('\n')}\n</memory_blocks>` : '';
  return { text, cut, coreGraphIds: [...coreGraphIds] };
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
