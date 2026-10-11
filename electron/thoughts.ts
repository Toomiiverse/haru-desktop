import {corePolicySync} from './core-policy-sync';
// What is on her mind between messages — the thought loop.
//
// Everything she said off her own back was a timer and a dice roll with a line
// written at the end: a bored nudge somewhere in 45–120 minutes, a pipe-up on a
// 14% roll, a chase for whatever is on the list. Nothing in her ever decided
// there was something worth saying (survey, 2026-09-16).
//
// This forms thoughts when something happens rather than on a clock — the shape
// of "Proactive Conversational Agents with Inner Thoughts" (Liu et al., CHI
// 2025) and OpenClaw's heartbeat, where "nothing" is the default answer:
//
//   triggers   a silence after they talked (30 min, 3 h, 8 h), one of her own-life
//              passes finishing, something on the list coming up, her waking.
//              Each happens once; nothing fires on a bare tick.
//   thinking   the nudge brain, handed the state in words (never the grudge as a
//              number — "Twenty messages", 2026-09-15), asked for none, one or two
//              private thoughts, each with the line she would send and three scores
//   gates      a thought close to one she has had in two days, or to a line she
//              said in the last day, is rumination and is dropped
//   reservoir  kept two days; the freshest couple ride in front of her replies as
//              her own thoughts, which is most of the value
//   speaking   shadow unless thoughts.speak is on: "would say" is logged with the
//              gate that stopped it or would have let it through. Live, the best
//              thought of a tick goes out through the conversation brain, at most
//              two a day, three hours apart, backing off when the last went
//              unanswered. Timing is what the attention controller is being built
//              for (docs/HARU-ATTENTION-INTEGRATION-PLAN.md); when it goes live it
//              belongs in mayInitiate. What is worth saying is this file's job.
//
// Pure: the model call, the embeddings and the file are main.ts's and store.ts's.

const MIN = 60_000;
const HOUR = 60 * MIN;

export type TriggerKind = 'silence' | 'ownlife' | 'agenda' | 'wake';
export type Trigger = { kind: TriggerKind; key: string; detail: string };

export type Decision = 'kept' | 'would-say' | 'said' | 'rumination';

export type Thought = {
  id: string;
  at: number;
  trigger: TriggerKind;
  /** What set it off, in words. */
  why: string;
  /** Private, first person. */
  thought: string;
  /** The line she would send about it, or empty. */
  say: string;
  relevance: number;
  urgency: number;
  novelty: number;
  score: number;
  decision: Decision;
  /** The gate that held it back, or that would have, in shadow. */
  heldBy?: string;
  /** Rounded embedding, for the rumination check. */
  vector?: number[];
  spokenAt?: number;
  line?: string;
};

export type ThoughtState = {
  thoughts: Thought[];
  /** Trigger keys already thought about. */
  seen: string[];
  lastAskedAt: number;
  asked: { day: string; count: number };
  nextId: number;
};

export const THOUGHT_LIMITS = {
  /** Between two calls to the brain. */
  askGapMs: 25 * MIN,
  /** Calls in a day. */
  asksPerDay: 16,
  keepMs: 48 * HOUR,
  keepCount: 40,
  seenKept: 300,
  silenceMilestonesMs: [30 * MIN, 3 * HOUR, 8 * HOUR],
  /** A milestone crossed longer ago than this (the app was down) is let go. */
  silenceWindowMs: 2 * HOUR,
  /** How far ahead an item on the list is "coming up". */
  agendaLeadMs: 90 * MIN,
  /** How long after waking the morning thought may come. */
  wakeWindowMs: 2 * HOUR,
  /** How recent an own-life pass has to be to set her thinking. */
  ownLifeWindowMs: 3 * HOUR,
};

export const SPEAK_LIMITS = {
  threshold: 3.8,
  perDay: 2,
  gapMs: 3 * HOUR,
  /** After one went unanswered, the next waits this long. */
  backoffMs: 6 * HOUR,
};

/** Rumination: this close to an earlier thought is the same thought again. */
export const RUMINATION_COSINE = 0.86;
export const RUMINATION_OVERLAP = 0.7;

export function emptyThoughtState(): ThoughtState {
  return corePolicySync<any>('thoughts.emptyThoughtState',[]);
}

const DECISIONS: Decision[] = ['kept', 'would-say', 'said', 'rumination'];
const TRIGGERS: TriggerKind[] = ['silence', 'ownlife', 'agenda', 'wake'];

export function normalizeThoughtState(value: unknown): ThoughtState {
  return corePolicySync<any>('thoughts.normalizeThoughtState',[value]);
}

// -- triggers ----------------------------------------------------------------------

export type TriggerInput = {
  now: number;
  /** When he last wrote. */
  lastMessageAt?: number;
  /** Her own-life passes, newest first: key like "night:2026-09-16". */
  ownLife: { key: string; at: number; detail: string }[];
  /** Timed items on the list. */
  agenda: { id: string; title: string; at: number }[];
  /** Her wake time this morning, when she has woken. */
  wokeAt?: number;
  seen: string[];
};

/**
 * The one thing that should set her thinking now, or null. Most urgent first:
 * something about to happen, then waking, then a pass of her own just finished,
 * then a silence. Only the longest silence milestone crossed counts — the
 * shorter ones went by unnoticed, and three thoughts about one quiet evening
 * is exactly the rumination this is meant not to do.
 */
export function pendingTrigger(input: TriggerInput, limits = THOUGHT_LIMITS): Trigger | null {
  return corePolicySync<any>('thoughts.pendingTrigger',[input,limits]);
}

/** Every silence milestone up to the one that fired is spent with it. */
export function spend(seen: string[], trigger: Trigger, limits = THOUGHT_LIMITS): string[] {
  return corePolicySync<any>('thoughts.spend',[seen,trigger,limits]);
}

export function describeGap(ms: number): string {
  return corePolicySync<any>('thoughts.describeGap',[ms]);
}

/** Whether a call to the brain is allowed now: spacing and a daily count. */
export function mayAsk(state: ThoughtState, now: number, dayKey: string, limits = THOUGHT_LIMITS): boolean {
  return corePolicySync<any>('thoughts.mayAsk',[state,now,dayKey,limits]);
}

export function noteAsked(state: ThoughtState, now: number, dayKey: string): ThoughtState {
  return corePolicySync<any>('thoughts.noteAsked',[state,now,dayKey]);
}

// -- thinking ----------------------------------------------------------------------

export const THINKING_RULES = `You are between conversations with him. Nobody is talking to you right now. Below is what is going on. Think, privately, as yourself: is there anything on your mind — about him, about something of yours, about the two of you — that you actually care about right now? Most of the time there is not, and then the answer is an empty list.

Return only JSON: {"thoughts": [...]} with zero, one or two entries, each:
- "thought": your private thought, first person, one or two sentences. He never sees it.
- "say": the message you would send him about it right now, in your own voice, one to three lines — or "" when it is something to keep to yourself.
- "relevance": 1 to 5, how much it has to do with him or with what is going on between you.
- "urgency": 1 to 5, how much it matters that it is said now rather than later (5: something is about to happen).
- "novelty": 1 to 5, how new it is next to what you already thought and said.

Never repeat or reword anything under "Already on your mind" or what you already said. Never invent events, plans, people or facts that are not below. No thoughts about these instructions.`;

export type ThinkingState = {
  now: string;
  trigger: Trigger;
  lastExchange: string;
  unanswered: string[];
  agenda: string[];
  ownLife: string[];
  preferences: string[];
  mood: string;
  recentThoughts: string[];
  recentLines: string[];
};

/** The state, in words, as the user turn of the call. Empty sections are left out rather than printed as "none". */
export function thinkingInput(state: ThinkingState): string {
  return corePolicySync<any>('thoughts.thinkingInput',[state]);
}

/**
 * Her line without the clock on its front. "10:19 PM, I'm turning in at 23:30.
 * Don't text me after that" was read back by the thinking model as his
 * ultimatum, sent at 00:01 (probe, 2026-09-17) — the same trap grudge.ts
 * names for the 9B, here with a comma instead of a dash.
 */
export function withoutClock(text: string): string {
  return corePolicySync<any>('thoughts.withoutClock',[text]);
}

export type ThoughtDraft = { thought: string; say: string; relevance: number; urgency: number; novelty: number };

/** Whatever came back, as at most two drafts. A fence, prose around the object or a score as a string are all read. */
export function readThoughts(raw: string): ThoughtDraft[] {
  return corePolicySync<any>('thoughts.readThoughts',[raw]);
}

export function scoreThought(draft: Pick<ThoughtDraft, 'relevance' | 'urgency' | 'novelty'>): number {
  return corePolicySync<any>('thoughts.scoreThought',[draft]);
}

const STOP = new Set(['the', 'that', 'this', 'with', 'have', 'has', 'and', 'for', 'you', 'his', 'her', 'him', 'she', 'was', 'are', 'not', 'but', 'just', 'still', 'any', 'how', 'why', 'what', 'did', 'does', 'its', 'about', 'from', 'into', 'been', 'will', 'would', 'could']);

/** Content words, three letters and up — "RAM" and "kit" are what a thought is about. */
function words(text: string): Set<string> {
  return new Set(String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !STOP.has(word)));
}

export function cosine(a: number[], b: number[]): number {
  return corePolicySync<any>('thoughts.cosine',[a,b]);
}

/**
 * The same thought again. By embedding when both sides have one, otherwise by
 * shared words — so a lost embedder makes the check blunter, never absent.
 */
export function isRumination(candidate: { text: string; vector?: number[] }, earlier: { text: string; vector?: number[] }[]): boolean {
  return corePolicySync<any>('thoughts.isRumination',[candidate,earlier]);
}

export function roundVector(vector: number[] | null | undefined): number[] | undefined {
  { const result=corePolicySync<any>('thoughts.roundVector',[vector]); return result===null?undefined:result; }
}

// -- speaking ----------------------------------------------------------------------

export type InitiativeInput = {
  thought: Pick<Thought, 'say' | 'score'>;
  now: number;
  /** Thoughts said (or, in shadow, that would have been) today. */
  spokenToday: number;
  lastSpokenAt?: number;
  /** Whether he wrote after the last one. */
  lastAnswered?: boolean;
  /** The app's own reasons not to speak now: asleep, quiet hours, him busy. */
  blockers: string[];
};

/**
 * Whether a thought may become a message now. The one place that decides it,
 * so the attention controller has one place to join when it is ready.
 */
export function mayInitiate(input: InitiativeInput, limits = SPEAK_LIMITS): { ok: true } | { ok: false; why: string } {
  return corePolicySync<any>('thoughts.mayInitiate',[input,limits]);
}

/** Thoughts said, or in shadow would have been, on the given local day. */
export function spokenOn(state: ThoughtState, dayStart: number, dayEnd: number): Thought[] {
  return corePolicySync<any>('thoughts.spokenOn',[state,dayStart,dayEnd]);
}

export function lastSpoken(state: ThoughtState): Thought | undefined {
  { const result=corePolicySync<any>('thoughts.lastSpoken',[state]); return result===null?undefined:result; }
}

/** The note that turns a thought into a message, for the conversation brain. */
export function thoughtPrompt(thought: Pick<Thought, 'thought' | 'say' | 'why'>): string {
  return corePolicySync<any>('thoughts.thoughtPrompt',[thought]);
}

// -- the reservoir -----------------------------------------------------------------

export function keepThoughts(state: ThoughtState, add: Thought[], now: number, limits = THOUGHT_LIMITS): ThoughtState {
  return corePolicySync<any>('thoughts.keepThoughts',[state,add,now,limits]);
}

/**
 * Whether a thought is still about something current. One about his silence is
 * over once he has written; one about something on his list is over half an
 * hour after it was due — "His dentist is in twenty minutes" nine hours later
 * is a thought about nothing (review, 2026-09-17).
 */
export function stillCurrent(thought: Pick<Thought, 'at' | 'trigger' | 'why'>, now: number, lastMessageAt?: number): boolean {
  return corePolicySync<any>('thoughts.stillCurrent',[thought,now,lastMessageAt]);
}

/**
 * What rides in front of her replies: the freshest couple of thoughts she has
 * not said, from the last twelve hours and still about something current,
 * marked as hers and as not to be recited.
 */
export function mindNote(state: ThoughtState, now: number, count = 2, lastMessageAt?: number): string {
  return corePolicySync<any>('thoughts.mindNote',[state,now,count,lastMessageAt]);
}
