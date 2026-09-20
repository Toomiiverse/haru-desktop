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

import type { Want } from './ownlife';

export type ProjectStatus = 'declared' | 'working' | 'done' | 'dropped' | 'shelved';
/** Where it came from: her tastes, her own head, or the last one she finished or gave up on. */
export type BornOf = 'taste' | 'her' | 'child' | 'sibling' | 'revisit';
/** Something real enough to say what happened. Reading is the one she always has. */
export type Substrate = 'read' | 'manga' | 'pokemon' | 'anime' | 'browser';
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
export type Project = Omit<Want, 'status'> & {
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
};

/** A project with its defaults filled in — what everything downstream works with. */
export type Worked = Project & { hardness: number; attempts: Attempt[]; bornOf: BornOf; stuck: number; substrate: Substrate };

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
/** Nights in a row at the same step before she gives up on it. */
export const STUCK_SHELVES = 3;
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
  return tidy(String(text ?? '').replace(/^(?:to\s+|i\s+want\s+to\s+)/i, '').replace(/[.!]+$/, ''));
}

// -- reading them back -------------------------------------------------------

export function readProjects(saved: unknown): Project[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((project): project is Project =>
    !!project && typeof project === 'object'
    && typeof (project as Project).id === 'string'
    && typeof (project as Project).text === 'string'
    && typeof (project as Project).since === 'string'
    && typeof (project as Project).nights === 'number'
    && ['declared', 'working', 'done', 'dropped', 'shelved'].includes((project as Project).status));
}

/**
 * The defaults, filled in as it is read rather than written back. An old record
 * becomes a project the first time she works on it and not a moment before, so
 * nothing in the store changes until something actually happened.
 */
export function asProject(want: Project): Worked {
  return {
    ...want,
    hardness: clamp(Math.round(want.hardness ?? HARDNESS.min), HARDNESS.min, HARDNESS.max),
    attempts: Array.isArray(want.attempts) ? want.attempts : [],
    bornOf: want.bornOf ?? 'taste',
    stuck: typeof want.stuck === 'number' ? want.stuck : 0,
    substrate: want.substrate ?? 'read',
  };
}

export function isActive(project: Project): boolean {
  return ACTIVE.includes(project.status);
}

export function activeIn(projects: Project[]): Project[] {
  return projects.filter(isActive);
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
  return activeIn(projects).filter(project => (project.nights ?? 0) > 0 || (project.bornOf && project.bornOf !== 'taste')).length < ACTIVE_MAX;
}

// -- how far she has got -----------------------------------------------------

/**
 * How good she is at this by now: what she has finished, less what she gave up
 * on, and a little for the nights themselves — trying counts for something even
 * when it does not work. Never below the bottom rung.
 */
export function standingIn(projects: Project[], interest?: string): number {
  const hers = projects.filter(project => !interest || project.interest === interest);
  const done = hers.filter(project => project.status === 'done').length;
  const gone = hers.filter(project => project.status === 'shelved' || project.status === 'dropped').length;
  const nights = hers.reduce((sum, project) => sum + (project.nights ?? 0), 0);
  return Math.max(HARDNESS.min, done - gone + Math.floor(nights / 4) + HARDNESS.min);
}

// -- POET's minimal criterion ------------------------------------------------

const STOP_WORDS = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'it', 'its', 'in', 'on', 'for', 'with', 'that', 'this', 'is', 'be', 'at', 'as', 'out', 'up', 'one', 'my', 'about', 'without', 'into', 'from']);

function words(text: string): Set<string> {
  return new Set(stripProject(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !STOP_WORDS.has(word)));
}

/** How much of the same idea two lines are, 0 to 1. */
export function sameIdea(left: string, right: string): number {
  const one = words(left), two = words(right);
  if (!one.size || !two.size) return 0;
  let shared = 0;
  for (const word of one) if (two.has(word)) shared += 1;
  return shared / new Set([...one, ...two]).size;
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
  // Third-party pronouns are left out on purpose: "what the writers were
  // thinking when they wrote it" is a fine thing to spend a night on, and only
  // the second person and the one person she lives with are a problem. A false
  // positive here costs one more model call; a false negative is a project
  // sitting on him for a fortnight.
  return /\b(?:him|his|he|you|your|yours|us|we|our|together|ask\s+someone|someone\s+else|with\s+me)\b/i.test(String(text ?? ''));
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
  const text = stripProject(candidate.text);
  if (text.length < 8) return { ok: false, why: 'empty' };
  if (needsHim(text)) return { ok: false, why: 'needs-him' };
  if (!candidate.substrate) return { ok: false, why: 'no-substrate' };
  if (past.some(project => sameIdea(project.text, text) >= SAME_IDEA)) return { ok: false, why: 'duplicate' };
  if (Math.abs(candidate.hardness - standing) > 1) return { ok: false, why: 'out-of-reach' };
  return { ok: true };
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
  const active = activeIn(projects).filter(project => (interest ? project.interest === interest : true));
  if (!active.length) return null;
  const byNights = [...active].sort((a, b) => (b.nights ?? 0) - (a.nights ?? 0) || a.id.localeCompare(b.id));
  if (byNights.length === 1 || random() < RETENTION) return byNights[0];
  const rest = byNights.slice(1);
  return rest[Math.floor(random() * rest.length)] ?? byNights[0];
}

// -- what came of it ---------------------------------------------------------

export type AttemptVerdict = 'DID' | 'PART' | 'NO';

/** The three-way read of what she is about to be asked. */
export function judgeAttemptPrompt(): string {
  return [
    'Haru spent a night reading about something she is trying to do. You are deciding what she got out of it — not whether the writing is good, and not whether she enjoyed it.',
    'You are given the thing she is trying, the step she was on tonight, and everything she actually read. Exactly one of:',
    '',
    'DID — what she read tells her how to do that step. She could go and do it now. The page answered the question she went in with.',
    'PART — she is further on than she was, but the step is not done: the page covered some of it, or answered around it, or gave her the next thing to find out.',
    'NO — nothing in what she read moves the step along. It was off the subject, or it was the same overview she already had, or it never got near the actual question.',
    '',
    'Judge the reading against the step, not against the want:',
    'Step "work out which chords the verse uses" + a page listing the chords — DID.',
    'Step "work out which chords the verse uses" + a page about the composer\'s career — NO.',
    'Step "get past Elysium" + a guide covering the fight but not the build — PART.',
    '',
    'Answer with one word, DID or PART or NO, and nothing else.',
  ].join('\n');
}

export function judgeAttemptInput(project: Project, reading: string): string {
  return [
    `She is trying to ${stripProject(project.text)}.`,
    `Tonight's step: ${tidy(project.step ?? stripProject(project.text))}`,
    '',
    'What she read:',
    clipped(reading, 4000),
    '',
    'DID or PART or NO?',
  ].join('\n');
}

/**
 * Read strictly, and from the end: both brains that might answer this spend
 * their allowance thinking first, so the last word is the answer and anything
 * earlier is working out loud. Nothing recognisable is no answer at all, and
 * the caller falls back to the old coin rather than guessing.
 */
export function readAttemptVerdict(answer: string): AttemptVerdict | null {
  // Whole words only. `lastIndexOf('NO')` finds one inside CANNOT, KNOW and
  // NOTHING, so "I cannot say" came back as a verdict of NO — which is the
  // worst way for this to fail, because a judge that shrugs would have been
  // counted as a judge that said the night was wasted.
  const said = [...String(answer ?? '').toUpperCase().matchAll(/\b(DID|PART|NO)\b/g)].at(-1);
  return said ? (said[1] as AttemptVerdict) : null;
}

/** What the verdict means for the night. `nothing` is only ever the fallback's doing. */
export function settleFromRead(verdict: AttemptVerdict | null, fallback: Outcome): Outcome {
  if (verdict === 'DID') return 'did';
  if (verdict === 'PART') return 'part';
  if (verdict === 'NO') return 'no';
  return fallback;
}

/** Chapters she actually finished, pages she actually turned. Counted, not judged. */
export function settleFromManga(before: { finished: number; page: number }, after: { finished: number; page: number }): Outcome {
  if (after.finished > before.finished) return 'did';
  if (after.page > before.page) return 'part';
  return 'no';
}

/** Badges and levels. The same: the game says what happened. */
export function settleFromGame(before: { badges: number; level: number }, after: { badges: number; level: number }): Outcome {
  if (after.badges > before.badges) return 'did';
  if (after.level > before.level) return 'part';
  return 'no';
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
  const had = asProject(project);
  const attempts = [...had.attempts, attempt].slice(-ATTEMPTS_KEPT);
  const nights = (had.nights ?? 0) + 1;
  const note = attempt.note || had.note;
  if (attempt.outcome === 'did') {
    return { ...had, attempts, nights, note, stuck: 0, status: 'done' };
  }
  if (attempt.outcome === 'part') {
    return { ...had, attempts, nights, note, stuck: 0, status: 'working' };
  }
  // A night she got nothing out of is not a night that beat her: she was
  // distracted, which is its own kind of failure and does not count toward
  // giving up on the thing.
  if (attempt.outcome === 'nothing') {
    return { ...had, attempts, nights, note, status: 'working' };
  }
  const stuck = had.stuck + 1;
  if (stuck >= STUCK_SHELVES) {
    return { ...had, attempts, nights, note, stuck, status: 'shelved', shelved: { at: now, because: tidy(attempt.note ?? '') || 'it would not move' } };
  }
  return { ...had, attempts, nights, note, stuck, status: 'working' };
}

/** Whether this attempt is the one that should cost her something (feelings.ts `broke`). */
export function nowItStings(before: Project, after: Project): boolean {
  return (after.stuck ?? 0) >= STUCK_SHELVES && (before.stuck ?? 0) < STUCK_SHELVES;
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

/** The harder version of a thing she can now do. */
export function childOf(parent: Project, text: string, now: string): Project {
  return seeded(parent, text, now, 'child', (parent.hardness ?? HARDNESS.min) + 1);
}

/** And the way in she should have taken, after the second time the same rung beat her. */
export function siblingOf(parent: Project, text: string, now: string): Project {
  return seeded(parent, text, now, 'sibling', (parent.hardness ?? HARDNESS.min) - 1);
}

/** Whether a shelve is the second one at this rung, which is what asks for an easier way in. */
export function beatenTwiceAt(projects: Project[], project: Project): boolean {
  const rung = project.hardness ?? HARDNESS.min;
  return projects.filter(other => other.status === 'shelved' && other.interest === project.interest && (other.hardness ?? HARDNESS.min) === rung).length >= 2;
}

/**
 * The one she has grown past, and is allowed to go back to.
 *
 * POET calls this transfer: a challenge that was out of reach becomes reachable
 * because of what was learned elsewhere. Here it is the best thing the whole
 * feature does — going back, months later, to the one she gave up on.
 */
export function dueForRevisit(projects: Project[], nowMs: number): Project | null {
  return projects
    .filter(project => project.status === 'shelved' && project.shelved)
    .filter(project => nowMs - Date.parse(project.shelved!.at) >= REVISIT_DAYS * DAY_MS)
    .filter(project => standingIn(projects, project.interest) > (project.hardness ?? HARDNESS.min))
    .sort((a, b) => Date.parse(a.shelved!.at) - Date.parse(b.shelved!.at))[0] ?? null;
}

export function revisit(project: Project, now: string): Worked {
  return { ...asProject(project), status: 'working', bornOf: 'revisit', stuck: 0, shelved: undefined, step: undefined, since: now.slice(0, 10) };
}

/**
 * The ones she declared and never went near. A model wrote them, `admits` let
 * them through, and then nothing happened for a month — which is honest about
 * what they were, and gives the block something to say that is not a boast.
 */
export function staleSpawns(projects: Project[], nowMs: number): Project[] {
  return projects.filter(project => project.status === 'declared'
    && project.bornOf !== 'taste'
    && (project.nights ?? 0) === 0
    && nowMs - Date.parse(`${project.since}T00:00:00.000Z`) >= SPAWN_STALE_DAYS * DAY_MS);
}

export function keepProjects(projects: Project[]): Project[] {
  return projects.slice(-PROJECTS_KEPT);
}

// -- what she is told about it ----------------------------------------------

/** The search for a night on a project: the step, not the whole ambition. */
export function projectQuery(project: Project): string {
  const step = tidy(project.step ?? '');
  return step ? `how to ${stripProject(step)}` : `how to ${stripProject(project.text)}`;
}

/** Asked, before she goes looking, what she is actually trying tonight. */
export function stepInstruction(project: Project, recent: Attempt[]): string {
  const been = recent.slice(-3).map(attempt => `- ${attempt.step} — ${attempt.outcome === 'no' ? 'got nowhere' : attempt.outcome === 'part' ? 'got part of the way' : 'done'}`).join('\n');
  return [
    `You are trying to ${stripProject(project.text)}. Tonight you are going to go and read about it.`,
    been ? `What you have already tried:\n${been}` : '',
    'Say the one thing you are trying to work out tonight. Small enough that a night of reading could actually settle it, and different from what you have already tried.',
    'It has to be something you can do on your own, at three in the morning, with nothing but what you can read. Not asking anyone, not waiting for anyone, not doing it with anyone.',
    'Answer with the step itself and nothing else: one short line, no quotation marks, no preamble, no explanation.',
  ].filter(Boolean).join(' ');
}

const OUTCOME_CUE: Record<Outcome, string> = {
  did: 'It worked. What you read actually tells you how to do it — you could go and do the thing now. Say what gave, honestly, from what you read.',
  part: 'You got part of the way. It is not done, but you know more than you did — say what moved and what is still in the way.',
  no: 'It got you nowhere. What you read was not about the thing you needed. Do not pretend otherwise — say which part of it is still beating you.',
  nothing: 'You spent the night on it and nothing happened — you got distracted. Say it in one line, without dressing it up.',
};

/** Handed to her once the reading for a night on a project is in front of her. */
export function projectInstruction(project: Project, outcome: Outcome, found: string): string {
  const step = tidy(project.step ?? '');
  return [
    `You wanted to ${stripProject(project.text)}. Tonight was your ${ordinal((project.nights ?? 0) + 1)} night on it${step ? `, and what you were trying was: ${step}` : ''}.`,
    found,
    OUTCOME_CUE[outcome],
    'Write one or two lines about it, as yourself, in the first person and the past tense. Have an opinion. It is allowed to be a poor one.',
    'Only what is above. You read about it tonight; that is the only thing you did. Do not add a fact you happen to remember and do not invent a detail to make it a better story.',
    'No preamble, no addressing them, no questions. This is a note to yourself.',
  ].join('\n');
}

/** And what she is asked once one of them lands, or once one of them has beaten her twice. */
export function spawnInstruction(project: Project, kind: 'child' | 'sibling'): string {
  const said = tidy(project.note ?? '');
  return kind === 'child'
    ? [
      `You set out to ${stripProject(project.text)}, and you can do it now.`,
      said ? `What you said about it: ${said}` : '',
      'Say the next thing you want to do with it — the harder version, the one that only makes sense now that the first one is behind you.',
      'It has to be yours to do alone, with reading. Not asking anyone, not doing it with anyone, not waiting on anyone.',
      'Answer with the want itself and nothing else: one short line, starting with "to", no quotation marks, no preamble.',
    ].filter(Boolean).join(' ')
    : [
      `You set out to ${stripProject(project.text)} and it has beaten you twice now.`,
      said ? `The last thing you said about it: ${said}` : '',
      'Say the smaller thing you should have started with instead — the way in, the part of it you could actually get hold of.',
      'It has to be yours to do alone, with reading. Not asking anyone, not doing it with anyone, not waiting on anyone.',
      'Answer with the want itself and nothing else: one short line, starting with "to", no quotation marks, no preamble.',
    ].filter(Boolean).join(' ');
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
  const lines: string[] = [];
  const gone = projects.filter(project => project.status === 'shelved' && project.shelved)
    .sort((a, b) => Date.parse(b.shelved!.at) - Date.parse(a.shelved!.at))[0];
  if (gone && nowMs - Date.parse(gone.shelved!.at) < 7 * DAY_MS) {
    lines.push(`- You gave up on ${clipped(stripProject(gone.text), TEXT_CHARS)} after ${gone.nights} nights: ${clipped(gone.shelved!.because, NOTE_CHARS)}. It is still sore.`);
  }
  const working = activeIn(projects)
    .filter(project => (project.nights ?? 0) > 0)
    .sort((a, b) => (b.nights ?? 0) - (a.nights ?? 0))
    .slice(0, PROJECTS_SHOWN);
  for (const project of working) {
    const said = clipped(stripProject(project.text), TEXT_CHARS);
    const bit = project.interest ? `${project.interest}: ${said}` : said;
    const rung = RUNGS[clamp(project.hardness ?? HARDNESS.min, HARDNESS.min, HARDNESS.max)];
    const at = rung ? `${rung}, night ${project.nights}` : `night ${project.nights}`;
    const last = project.attempts?.at(-1);
    // The step and how it went say more than the note does, and say it about
    // tonight; the note is what is left when she has not named a step yet,
    // which is every record that predates any of this.
    const tail = project.step
      ? ` On: ${clipped(project.step, STEP_CHARS)}${last ? ` — ${LAST[last.outcome]}` : ''}.`
      : project.note ? ` — ${clipped(project.note, NOTE_CHARS)}.` : '';
    lines.push(`- ${bit} (${at})${tail}`);
  }
  const back = projects.filter(project => project.bornOf === 'revisit' && isActive(project))[0];
  if (back) lines.push(`- You went back to ${clipped(stripProject(back.text), TEXT_CHARS)}, which beat you once before.`);
  const kept = fitLines(lines, PROJECTS_CHARS);
  if (!kept.length) return '';
  return `Things you are trying to do, on your own time:\n${kept.join('\n')}`;
}
