import {corePolicySync} from './core-policy-sync';
import {coreRandomPolicy} from './core-policy-observations';
// The things she is trying to do, and how they get harder.
//
// She has had wants since the start, and in three weeks not one of them
// finished. The reason was in ownlife.ts: `wantOutcome` rolls a coin — slog
// half the time, clicked one in seven — and it is rolled *before* she is shown
// what she read. The instruction she then gets says the night went badly, so
// she writes that it went badly, and the note goes in her prompt. Every one of
// them reads the same way: "the page didn't give me the specifics", "I got
// distracted", "I am still stuck". She could not succeed at anything, because
// success was not connected to anything she did.
//
// So the reading decides. She names the step she is trying tonight, she goes
// and reads about it, and something that is not her is asked whether what came
// back actually let her do it. A project that clicks is finished and seeds a
// harder one out of what she learned; a project that will not move three
// nights running is shelved, and she feels it. That is the whole idea, and it
// is POET's: the challenges are generated, they are kept only if they sit
// where she can just about reach, and the ones she outgrew come back later.
//
// Pure, all of it. The model writes the words; this decides the shape.

import type { Want, WantStatus } from './ownlife';

export type ProjectStatus = WantStatus;
/** Where it came from: her tastes, her own head, or the last one she finished or gave up on. */
export type BornOf = 'taste' | 'her' | 'child' | 'sibling' | 'revisit';
/** Something real enough to say what happened. Reading is the one she always has. */
export type Substrate = 'read' | 'anime' | 'browser';
export type Outcome = 'did' | 'part' | 'no' | 'nothing';

export type Attempt = {
  at: string;
  /** What she was trying that night. */
  step: string;
  outcome: Outcome;
  by: Substrate;
  /** Whether something counted it (chapters, badges) or something judged it. */
  measured: boolean;
  note?: string;
};

/**
 * A Want, widened. Every new field optional, because `readWants` keeps whatever
 * it is handed and the sixteen already in the store predate all of this — they
 * carry their nights and her notes and must go on working untouched.
 */
export type Project = Want & {
  status: ProjectStatus;
  hardness?: number;
  /** The thing she is actually trying next. Always something she can do alone. */
  step?: string;
  attempts?: Attempt[];
  parentId?: string;
  bornOf?: BornOf;
  substrate?: Substrate;
  shelved?: { at: string; because: string };
  /** Nights in a row that went nowhere at the current step. */
  stuck?: number;
  /** Steps of it she has actually landed. */
  landed?: number;
};

/** A project with its defaults filled in — what everything downstream works with. */
export type Worked = Project & { hardness: number; attempts: Attempt[]; bornOf: BornOf; stuck: number; landed: number; substrate: Substrate };

/** How hard a thing can get. Five is the top of what a night of reading can carry. */
export const HARDNESS = { min: 1, max: 5 } as const;
/** How many she can be at once. Nobody is at eleven things, and the block cannot show them. */
export const ACTIVE_MAX = 6;
/** Lines the block can afford (see ownlife.ts, which learned this the expensive way). */
export const PROJECTS_SHOWN = 4;
/** Kept on a record. config.json is rewritten whole, so this is a budget, not a history. */
export const ATTEMPTS_KEPT = 8;
/** And the ledger itself. */
export const PROJECTS_KEPT = 40;
/**
 * The share of her days spent on something she is trying to do, rather than on
 * something she read about once.
 *
 * Eight attempts in three weeks is not an arc: a want would take a year to
 * resolve and nothing would ever be seen to happen. A third of her days roughly
 * doubles the rate. This is the charter value for the dial that will own it.
 */
export const DAY_PROJECT_SHARE = 0.35;
/** Nights in a row at the same step before she gives up on it. */
export const STUCK_SHELVES = 3;
/**
 * Steps she has to land before the thing itself is done.
 *
 * It was one, and a simulated year came back with a hundred and twenty-five
 * finishes and two failures — a treadmill of easy wins where "learn piano well
 * enough to play The Real Folk Blues badly" was over in under two nights. A
 * want is not a step. Three of them is six to ten nights of work, which is long
 * enough for a thing to beat her halfway through, and long enough that finishing
 * one means something.
 */
export const STEPS_TO_FINISH = 3;
/** How often she returns to the one she has put the most into, rather than rolling. */
export const RETENTION = 0.7;
/** Two texts sharing this much are the same idea in new words. */
export const SAME_IDEA = 0.6;
/** A spawned project nobody picked up is not a project, it is a note. */
export const SPAWN_STALE_DAYS = 30;
/** And a shelved one is left alone this long before she is allowed to go back to it. */
export const REVISIT_DAYS = 21;

const ACTIVE: ProjectStatus[] = ['declared', 'working'];
const DAY_MS = 24 * 3_600_000;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function tidy(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function clipped(text: string, max: number): string {
  const flat = tidy(text);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The want without its "to", which is how it reads in a sentence of hers. */
export function stripProject(text: string): string {
  return corePolicySync<ReturnType<typeof stripProject>>('projects.stripProject',[text]);
}

// -- reading them back -------------------------------------------------------

export function readProjects(saved: unknown): Project[] {
  return corePolicySync<ReturnType<typeof readProjects>>('projects.readProjects',[saved]);
}

/**
 * The defaults, filled in as it is read rather than written back. An old record
 * becomes a project the first time she works on it and not a moment before, so
 * nothing in the store changes until something actually happened.
 */
export function asProject(want: Project): Worked {
  return corePolicySync<ReturnType<typeof asProject>>('projects.asProject',[want]);
}

export function isActive(project: Project): boolean {
  return corePolicySync<ReturnType<typeof isActive>>('projects.isActive',[project]);
}

export function activeIn(projects: Project[]): Project[] {
  return corePolicySync<ReturnType<typeof activeIn>>('projects.activeIn',[projects]);
}

/**
 * Whether there is room for another one.
 *
 * What counts is what she is *at*: a want her tastes declared and she has never
 * gone near is a wish, not a project, and on 2026-09-20 there were ten of those
 * against five real ones. Counting those would have meant she could never take
 * anything up again — the pile would have locked the ladder shut.
 */
export function roomForNew(projects: Project[]): boolean {
  return corePolicySync<ReturnType<typeof roomForNew>>('projects.roomForNew',[projects]);
}

// -- how far she has got -----------------------------------------------------

/**
 * How far up the ladder she has got, on the same one-to-five scale a project's
 * hardness uses: the hardest rung she has actually finished, and one above it
 * is what she can just about reach. Two things that beat her pull it back down
 * a rung, because giving up twice is evidence about where she is.
 *
 * It counted finishes, shelves and a share of every night at first, which put
 * her standing at seven inside a simulated year while the hardest thing that
 * exists is a five — so nothing was ever above her and nothing could ever beat
 * her. A standing that is not on the same scale as the thing it is compared
 * against is not a standing.
 */
export function standingIn(projects: Project[], interest?: string): number {
  return corePolicySync<ReturnType<typeof standingIn>>('projects.standingIn',[projects,interest]);
}

/**
 * Whether she has nothing of her own on the go.
 *
 * Every project until now came from somewhere else: her tastes declaring one,
 * or the last one she finished or gave up on. Simulate a year of that and the
 * chain runs out — she finishes the four things the ladder gave her and then
 * has nothing to try for nine months, which is not a life. So when she is at
 * nothing, she is asked for something.
 */
export function needsSomethingNew(projects: Project[]): boolean {
  return corePolicySync<ReturnType<typeof needsSomethingNew>>('projects.needsSomethingNew',[projects]);
}

// -- POET's minimal criterion ------------------------------------------------

const STOP_WORDS = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'it', 'its', 'in', 'on', 'for', 'with', 'that', 'this', 'is', 'be', 'at', 'as', 'out', 'up', 'one', 'my', 'about', 'without', 'into', 'from']);

function words(text: string): Set<string> {
  return new Set(stripProject(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !STOP_WORDS.has(word)));
}

/** How much of the same idea two lines are, 0 to 1. */
export function sameIdea(left: string, right: string): number {
  return corePolicySync<ReturnType<typeof sameIdea>>('projects.sameIdea',[left,right]);
}

/**
 * Whether a step is hers to do alone.
 *
 * His call, 2026-09-20: every step is something she can do by herself. Her
 * *wants* may still be about him — "to argue the ending with him" is hers and
 * it is in her tastes, word for word — but the thing she goes and does tonight
 * must not be waiting on him, because a project stalled on him is a nag with a
 * ledger behind it.
 */
export function needsHim(text: string): boolean {
  return corePolicySync<ReturnType<typeof needsHim>>('projects.needsHim',[text]);
}

export type Candidate = { text: string; hardness: number; substrate?: Substrate; interest?: string };
export type Refusal = 'duplicate' | 'no-substrate' | 'out-of-reach' | 'needs-him' | 'empty';

/**
 * POET's minimal criterion, which is the part that makes a generated curriculum
 * a curriculum rather than a pile: a new challenge is kept only when it is new,
 * when something can say whether it worked, and when it sits where she can just
 * about reach it. Everything else is thrown away rather than attempted.
 */
export function admits(candidate: Candidate, past: Project[], standing: number): { ok: true } | { ok: false; why: Refusal } {
  return corePolicySync<ReturnType<typeof admits>>('projects.admits',[candidate,past,standing]);
}

// -- which one she works on --------------------------------------------------

/**
 * The one to work on now.
 *
 * It used to pick uniformly from whatever was active, which is why nothing ever
 * finished: with three live wants against one interest, the chance of going
 * back to the one she had already put two nights into was one in three. Now the
 * one she has put the most into usually wins, and the roll is what is left —
 * she keeps at things, but not so reliably that she is a rota.
 */
export function pickProject(projects: Project[], interest?: string, random: () => number = Math.random): Project | null {
  return coreRandomPolicy<ReturnType<typeof pickProject>>('projects.pickProject',[projects,interest],random);
}

// -- what came of it ---------------------------------------------------------

export type AttemptVerdict = 'DID' | 'PART' | 'NO';

/** The three-way read of what she is about to be asked. */
export function judgeAttemptPrompt(): string {
  return corePolicySync<ReturnType<typeof judgeAttemptPrompt>>('projects.judgeAttemptPrompt',[]);
}

export function judgeAttemptInput(project: Project, reading: string): string {
  return corePolicySync<ReturnType<typeof judgeAttemptInput>>('projects.judgeAttemptInput',[project,reading]);
}

/**
 * Read strictly, and from the end: both brains that might answer this spend
 * their allowance thinking first, so the last word is the answer and anything
 * earlier is working out loud. Nothing recognisable is no answer at all, and
 * the caller falls back to the old coin rather than guessing.
 */
export function readAttemptVerdict(answer: string): AttemptVerdict | null {
  return corePolicySync<ReturnType<typeof readAttemptVerdict>>('projects.readAttemptVerdict',[answer]);
}

/** What the verdict means for the night. `nothing` is only ever the fallback's doing. */
export function settleFromRead(verdict: AttemptVerdict | null, fallback: Outcome): Outcome {
  return corePolicySync<ReturnType<typeof settleFromRead>>('projects.settleFromRead',[verdict,fallback]);
}

// -- the state machine -------------------------------------------------------

/**
 * A night's work, applied.
 *
 * A step that lands finishes the project — she wanted a thing and now she can
 * do it — and the harder version of it is a *new* project, which is where the
 * ladder lives. A step that half-lands leaves her on it with the step rewritten
 * by the caller. Three nights running that go nowhere and she shelves it, which
 * is the part that is allowed to hurt.
 */
export function advanceProject(project: Project, attempt: Attempt, now: string): Worked {
  return corePolicySync<ReturnType<typeof advanceProject>>('projects.advanceProject',[project,attempt,now]);
}

/** Whether this attempt is the one that should cost her something (feelings.ts `broke`). */
export function nowItStings(before: Project, after: Project): boolean {
  return corePolicySync<ReturnType<typeof nowItStings>>('projects.nowItStings',[before,after]);
}

// -- generation --------------------------------------------------------------

function seeded(parent: Project, text: string, now: string, bornOf: BornOf, hardness: number): Project {
  return {
    id: Math.random().toString(36).slice(2, 10),
    interest: parent.interest,
    text: stripProject(text),
    since: now.slice(0, 10),
    nights: 0,
    status: 'declared',
    hardness: clamp(Math.round(hardness), HARDNESS.min, HARDNESS.max),
    parentId: parent.id,
    bornOf,
    substrate: parent.substrate ?? 'read',
    attempts: [],
    stuck: 0,
  };
}

/** One she took on herself, at the rung she is standing on. */
export function hersOwn(interest: string | undefined, text: string, now: string, hardness: number): Project {
  return corePolicySync<ReturnType<typeof hersOwn>>('projects.hersOwn',[interest===undefined?{$undefined:true}:interest,text,now,hardness,Math.random().toString(36).slice(2,10)]);
}

/** The harder version of a thing she can now do. */
export function childOf(parent: Project, text: string, now: string): Project {
  return corePolicySync<ReturnType<typeof childOf>>('projects.childOf',[parent,text,now,Math.random().toString(36).slice(2,10)]);
}

/** And the way in she should have taken, after the second time the same rung beat her. */
export function siblingOf(parent: Project, text: string, now: string): Project {
  return corePolicySync<ReturnType<typeof siblingOf>>('projects.siblingOf',[parent,text,now,Math.random().toString(36).slice(2,10)]);
}

/** Whether a shelve is the second one at this rung, which is what asks for an easier way in. */
export function beatenTwiceAt(projects: Project[], project: Project): boolean {
  return corePolicySync<ReturnType<typeof beatenTwiceAt>>('projects.beatenTwiceAt',[projects,project]);
}

/**
 * The one she has grown past, and is allowed to go back to.
 *
 * POET calls this transfer: a challenge that was out of reach becomes reachable
 * because of what was learned elsewhere. Here it is the best thing the whole
 * feature does — going back, months later, to the one she gave up on.
 */
export function dueForRevisit(projects: Project[], nowMs: number): Project | null {
  return corePolicySync<ReturnType<typeof dueForRevisit>>('projects.dueForRevisit',[projects,nowMs]);
}

export function revisit(project: Project, now: string): Worked {
  return corePolicySync<ReturnType<typeof revisit>>('projects.revisit',[project,now]);
}

/**
 * The ones she declared and never went near. A model wrote them, `admits` let
 * them through, and then nothing happened for a month — which is honest about
 * what they were, and gives the block something to say that is not a boast.
 */
export function staleSpawns(projects: Project[], nowMs: number): Project[] {
  return corePolicySync<ReturnType<typeof staleSpawns>>('projects.staleSpawns',[projects,nowMs]);
}

export function keepProjects(projects: Project[]): Project[] {
  return corePolicySync<ReturnType<typeof keepProjects>>('projects.keepProjects',[projects]);
}

// -- what she is told about it ----------------------------------------------

/** The search for a night on a project: the step, not the whole ambition. */
export function projectQuery(project: Project): string {
  return corePolicySync<ReturnType<typeof projectQuery>>('projects.projectQuery',[project]);
}

/** Asked, before she goes looking, what she is actually trying tonight. */
export function stepInstruction(project: Project, recent: Attempt[]): string {
  return corePolicySync<ReturnType<typeof stepInstruction>>('projects.stepInstruction',[project,recent]);
}

const OUTCOME_CUE: Record<Outcome, string> = {
  did: 'It worked. What you read actually tells you how to do it — you could go and do the thing now. Say what gave, honestly, from what you read.',
  part: 'You got part of the way. It is not done, but you know more than you did — say what moved and what is still in the way.',
  no: 'It got you nowhere. What you read was not about the thing you needed. Do not pretend otherwise — say which part of it is still beating you.',
  nothing: 'You spent the night on it and nothing happened — you got distracted. Say it in one line, without dressing it up.',
};

/** Handed to her once the reading for a night on a project is in front of her. */
export function projectInstruction(project: Project, outcome: Outcome, found: string): string {
  return corePolicySync<ReturnType<typeof projectInstruction>>('projects.projectInstruction',[project,outcome,found]);
}

/** And what she is asked once one of them lands, or once one of them has beaten her twice. */
export function spawnInstruction(project: Project, kind: 'child' | 'sibling'): string {
  return corePolicySync<ReturnType<typeof spawnInstruction>>('projects.spawnInstruction',[project,kind]);
}

/** And what she is asked when she has nothing of her own on the go at all. */
export function newProjectInstruction(interest: string, stance: string, past: string[]): string {
  return corePolicySync<ReturnType<typeof newProjectInstruction>>('projects.newProjectInstruction',[interest,stance,past]);
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['st', 'nd', 'rd'][(n % 10) - 1] ?? 'th';
  return `${n}${suffix}`;
}

// -- what the block shows ----------------------------------------------------

const RUNGS = ['', '', 'a real one', 'a hard one', 'a very hard one', 'the hardest thing you have tried'];
const LAST: Record<Outcome, string> = { did: 'and it landed', part: 'and it moved a little', no: 'and it got nowhere', nothing: 'and you got distracted' };
/** Her own line, her step and her note, clipped: one of hers ran to 160 characters, which is a paragraph. */
export const TEXT_CHARS = 90;
export const STEP_CHARS = 70;
export const NOTE_CHARS = 80;
/**
 * And a hard ceiling on the whole thing, because none of the above is written
 * by anyone who can be told to be brief. The her_own block is 12,000 characters
 * and cuts from its tail, which is her diary; the want list this replaces was
 * running to 1,986 on its own. Whole lines, from the top, like blocks.ts.
 */
export const PROJECTS_CHARS = 900;

function fitLines(lines: string[], limit: number): string[] {
  const kept: string[] = [];
  let spent = 0;
  for (const line of lines) {
    if (spent + line.length + 1 > limit) break;
    kept.push(line);
    spent += line.length + 1;
  }
  return kept;
}

/**
 * The things she is at, the busiest first, and no more than a handful — plus
 * the one she gave up on, and the one she went back to, which are the two lines
 * that make this read like a life rather than a to-do list.
 *
 * The sore one goes first because it is the newest thing that happened to her,
 * and because a ceiling that trims from the end should take a want before it
 * takes the fact that something beat her.
 */
export function projectsNote(projects: Project[], nowMs: number): string {
  return corePolicySync<ReturnType<typeof projectsNote>>('projects.projectsNote',[projects,nowMs]);
}
