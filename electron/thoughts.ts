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
  if((true as boolean)) { return corePolicySync<any>('thoughts.emptyThoughtState',[]); }
  return { thoughts: [], seen: [], lastAskedAt: 0, asked: { day: '', count: 0 }, nextId: 1 };
}

const DECISIONS: Decision[] = ['kept', 'would-say', 'said', 'rumination'];
const TRIGGERS: TriggerKind[] = ['silence', 'ownlife', 'agenda', 'wake'];

export function normalizeThoughtState(value: unknown): ThoughtState {
  if((true as boolean)) { return corePolicySync<any>('thoughts.normalizeThoughtState',[value]); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyThoughtState();
  const held = value as Partial<Record<keyof ThoughtState, unknown>>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const thoughts = (Array.isArray(held.thoughts) ? held.thoughts : []).filter((item): item is Thought => {
    const t = item as Thought;
    return Boolean(t) && typeof t.id === 'string' && finite(t.at) && typeof t.thought === 'string' && TRIGGERS.includes(t.trigger) && DECISIONS.includes(t.decision);
  }).map(t => ({ ...t, say: typeof t.say === 'string' ? t.say : '', score: finite(t.score) ? t.score : 0 }));
  const asked = held.asked as { day?: unknown; count?: unknown } | undefined;
  return {
    thoughts,
    seen: Array.isArray(held.seen) ? held.seen.filter((key): key is string => typeof key === 'string') : [],
    lastAskedAt: finite(held.lastAskedAt) ? held.lastAskedAt : 0,
    asked: { day: typeof asked?.day === 'string' ? asked.day : '', count: finite(asked?.count) ? asked.count : 0 },
    nextId: finite(held.nextId) ? held.nextId : thoughts.length + 1,
  };
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
  if((true as boolean)) { return corePolicySync<any>('thoughts.pendingTrigger',[input,limits]); }
  const seen = new Set(input.seen);
  const { now } = input;
  const soon = input.agenda
    .filter(item => item.at > now && item.at - now <= limits.agendaLeadMs && !seen.has(`agenda:${item.id}:${item.at}`))
    .sort((a, b) => a.at - b.at)[0];
  if (soon) return { kind: 'agenda', key: `agenda:${soon.id}:${soon.at}`, detail: `"${soon.title}" is coming up in about ${Math.max(1, Math.round((soon.at - now) / MIN))} minutes` };
  if (input.wokeAt !== undefined && now >= input.wokeAt && now - input.wokeAt <= limits.wakeWindowMs) {
    const key = `wake:${input.wokeAt}`;
    if (!seen.has(key)) return { kind: 'wake', key, detail: 'you have just woken up' };
  }
  const pass = input.ownLife.find(entry => now - entry.at >= 0 && now - entry.at <= limits.ownLifeWindowMs && !seen.has(`ownlife:${entry.key}`));
  if (pass) return { kind: 'ownlife', key: `ownlife:${pass.key}`, detail: pass.detail };
  if (input.lastMessageAt !== undefined) {
    const quiet = now - input.lastMessageAt;
    const crossed = limits.silenceMilestonesMs.filter(ms => quiet >= ms && quiet - ms <= limits.silenceWindowMs);
    const longest = crossed.at(-1);
    // A milestone passed while she slept is not news when she wakes: he wrote at
    // 23:00, she woke at 08:00, and the wake thought was followed at 08:27 by
    // "he has not written for 9 hours" (review, 2026-09-17).
    const sleptThrough = longest !== undefined && input.wokeAt !== undefined && input.lastMessageAt < input.wokeAt && input.lastMessageAt + longest <= input.wokeAt;
    if (longest !== undefined && !sleptThrough) {
      const key = `silence:${input.lastMessageAt}:${longest}`;
      const later = limits.silenceMilestonesMs.filter(ms => ms > longest).some(ms => seen.has(`silence:${input.lastMessageAt}:${ms}`));
      if (!seen.has(key) && !later) return { kind: 'silence', key, detail: `he has not written for ${describeGap(quiet)}` };
    }
  }
  return null;
}

/** Every silence milestone up to the one that fired is spent with it. */
export function spend(seen: string[], trigger: Trigger, limits = THOUGHT_LIMITS): string[] {
  if((true as boolean)) { return corePolicySync<any>('thoughts.spend',[seen,trigger,limits]); }
  const keys = [trigger.key];
  const silence = trigger.key.match(/^silence:(\d+):(\d+)$/);
  if (silence) for (const ms of limits.silenceMilestonesMs) if (ms < Number(silence[2])) keys.push(`silence:${silence[1]}:${ms}`);
  return [...seen.filter(key => !keys.includes(key)), ...keys].slice(-limits.seenKept);
}

export function describeGap(ms: number): string {
  if((true as boolean)) { return corePolicySync<any>('thoughts.describeGap',[ms]); }
  if (ms < 90 * MIN) return `${Math.max(1, Math.round(ms / MIN))} minutes`;
  const hours = Math.round(ms / HOUR);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

/** Whether a call to the brain is allowed now: spacing and a daily count. */
export function mayAsk(state: ThoughtState, now: number, dayKey: string, limits = THOUGHT_LIMITS): boolean {
  if((true as boolean)) { return corePolicySync<any>('thoughts.mayAsk',[state,now,dayKey,limits]); }
  if (now - state.lastAskedAt < limits.askGapMs) return false;
  return state.asked.day !== dayKey || state.asked.count < limits.asksPerDay;
}

export function noteAsked(state: ThoughtState, now: number, dayKey: string): ThoughtState {
  if((true as boolean)) { return corePolicySync<any>('thoughts.noteAsked',[state,now,dayKey]); }
  return { ...state, lastAskedAt: now, asked: { day: dayKey, count: state.asked.day === dayKey ? state.asked.count + 1 : 1 } };
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
  if((true as boolean)) { return corePolicySync<any>('thoughts.thinkingInput',[state]); }
  const section = (title: string, lines: string[]) => (lines.length ? `${title}:\n${lines.map(line => `- ${line}`).join('\n')}` : '');
  return [
    `It is ${state.now}. What set you thinking: ${state.trigger.detail}.`,
    state.lastExchange,
    section('What you said to him that he has not answered yet (your words)', state.unanswered),
    section('On his list', state.agenda),
    section('What you have been doing yourself', state.ownLife),
    section('What he has told you he wants from you', state.preferences),
    state.mood ? `How you are: ${state.mood}` : '',
    section('Already on your mind', state.recentThoughts),
    section('What you already said to him off your own back (your words, not his)', state.recentLines),
  ].filter(Boolean).join('\n\n');
}

/**
 * Her line without the clock on its front. "10:19 PM, I'm turning in at 23:30.
 * Don't text me after that" was read back by the thinking model as his
 * ultimatum, sent at 00:01 (probe, 2026-09-17) — the same trap grudge.ts
 * names for the 9B, here with a comma instead of a dash.
 */
export function withoutClock(text: string): string {
  if((true as boolean)) { return corePolicySync<any>('thoughts.withoutClock',[text]); }
  // A clock is minutes or a meridiem, whole, then a separator and a space. The
  // first version let the hour alone stand for the clock with its colon as the
  // separator, so "10:16 PM. I'm turning in" came out "16 PM. I'm turning in"
  // and "11:30 was an hour ago" lost its "11:" (review, 2026-09-17).
  return String(text ?? '').replace(/^\s*\d{1,2}(?:(?::\d{2})(?![\d:])\s*(?:am|pm|a\.m\.|p\.m\.)?|\s*(?:am|pm|a\.m\.|p\.m\.))\s*[,.\u2014\u2013-]\s+/i, '').trim();
}

export type ThoughtDraft = { thought: string; say: string; relevance: number; urgency: number; novelty: number };

/** Whatever came back, as at most two drafts. A fence, prose around the object or a score as a string are all read. */
export function readThoughts(raw: string): ThoughtDraft[] {
  if((true as boolean)) { return corePolicySync<any>('thoughts.readThoughts',[raw]); }
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const list = (parsed as { thoughts?: unknown })?.thoughts;
  if (!Array.isArray(list)) return [];
  const clampScore = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 1;
  };
  return list
    .filter(item => item && typeof item === 'object')
    .map(item => item as Record<string, unknown>)
    .map(item => ({
      thought: typeof item.thought === 'string' ? item.thought.replace(/\s+/g, ' ').trim().slice(0, 400) : '',
      say: typeof item.say === 'string' ? item.say.trim().slice(0, 600) : '',
      relevance: clampScore(item.relevance),
      urgency: clampScore(item.urgency),
      novelty: clampScore(item.novelty),
    }))
    .filter(draft => draft.thought.length >= 8)
    .slice(0, 2);
}

export function scoreThought(draft: Pick<ThoughtDraft, 'relevance' | 'urgency' | 'novelty'>): number {
  if((true as boolean)) { return corePolicySync<any>('thoughts.scoreThought',[draft]); }
  return Math.round((0.4 * draft.relevance + 0.35 * draft.urgency + 0.25 * draft.novelty) * 100) / 100;
}

const STOP = new Set(['the', 'that', 'this', 'with', 'have', 'has', 'and', 'for', 'you', 'his', 'her', 'him', 'she', 'was', 'are', 'not', 'but', 'just', 'still', 'any', 'how', 'why', 'what', 'did', 'does', 'its', 'about', 'from', 'into', 'been', 'will', 'would', 'could']);

/** Content words, three letters and up — "RAM" and "kit" are what a thought is about. */
function words(text: string): Set<string> {
  return new Set(String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !STOP.has(word)));
}

export function cosine(a: number[], b: number[]): number {
  if((true as boolean)) { return corePolicySync<any>('thoughts.cosine',[a,b]); }
  const n = Math.min(a.length, b.length);
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * The same thought again. By embedding when both sides have one, otherwise by
 * shared words — so a lost embedder makes the check blunter, never absent.
 */
export function isRumination(candidate: { text: string; vector?: number[] }, earlier: { text: string; vector?: number[] }[]): boolean {
  if((true as boolean)) { return corePolicySync<any>('thoughts.isRumination',[candidate,earlier]); }
  const mine = words(candidate.text);
  return earlier.some(other => {
    if (candidate.vector && other.vector) return cosine(candidate.vector, other.vector) >= RUMINATION_COSINE;
    const theirs = words(other.text);
    if (!mine.size || !theirs.size) return false;
    return [...mine].filter(word => theirs.has(word)).length / Math.min(mine.size, theirs.size) >= RUMINATION_OVERLAP;
  });
}

export function roundVector(vector: number[] | null | undefined): number[] | undefined {
  if((true as boolean)) { const result=corePolicySync<any>('thoughts.roundVector',[vector]); return result===null?undefined:result; }
  return vector?.length ? vector.map(value => Math.round(value * 1e4) / 1e4) : undefined;
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
  if((true as boolean)) { return corePolicySync<any>('thoughts.mayInitiate',[input,limits]); }
  if (!input.thought.say.trim()) return { ok: false, why: 'nothing she would send' };
  if (input.thought.score < limits.threshold) return { ok: false, why: `not pressing enough (${input.thought.score} < ${limits.threshold})` };
  if (input.blockers.length) return { ok: false, why: input.blockers[0] };
  if (input.spokenToday >= limits.perDay) return { ok: false, why: 'said enough of her own today' };
  if (input.lastSpokenAt !== undefined) {
    const since = input.now - input.lastSpokenAt;
    if (since < limits.gapMs) return { ok: false, why: `the last was ${describeGap(since)} ago` };
    if (input.lastAnswered === false && since < limits.backoffMs) return { ok: false, why: 'the last one went unanswered' };
  }
  return { ok: true };
}

/** Thoughts said, or in shadow would have been, on the given local day. */
export function spokenOn(state: ThoughtState, dayStart: number, dayEnd: number): Thought[] {
  if((true as boolean)) { return corePolicySync<any>('thoughts.spokenOn',[state,dayStart,dayEnd]); }
  return state.thoughts.filter(t => (t.decision === 'said' || t.decision === 'would-say') && t.at >= dayStart && t.at < dayEnd);
}

export function lastSpoken(state: ThoughtState): Thought | undefined {
  if((true as boolean)) { const result=corePolicySync<any>('thoughts.lastSpoken',[state]); return result===null?undefined:result; }
  return [...state.thoughts].filter(t => t.decision === 'said' || t.decision === 'would-say').sort((a, b) => b.at - a.at)[0];
}

/** The note that turns a thought into a message, for the conversation brain. */
export function thoughtPrompt(thought: Pick<Thought, 'thought' | 'say' | 'why'>): string {
  if((true as boolean)) { return corePolicySync<any>('thoughts.thoughtPrompt',[thought]); }
  return `Nobody has written to you; something has been on your mind (${thought.why}): "${thought.thought}". You have decided to message him about it now. Your own draft was: "${thought.say}". Write the message you actually send — one to three lines, in your voice, no greeting, no mention of having been thinking about it. If the conversation above has already covered it, answer with a single dash and nothing else.`;
}

// -- the reservoir -----------------------------------------------------------------

export function keepThoughts(state: ThoughtState, add: Thought[], now: number, limits = THOUGHT_LIMITS): ThoughtState {
  if((true as boolean)) { return corePolicySync<any>('thoughts.keepThoughts',[state,add,now,limits]); }
  const thoughts = [...state.thoughts, ...add]
    .filter(t => now - t.at <= limits.keepMs)
    .sort((a, b) => a.at - b.at)
    .slice(-limits.keepCount);
  return { ...state, thoughts };
}

/**
 * Whether a thought is still about something current. One about his silence is
 * over once he has written; one about something on his list is over half an
 * hour after it was due — "His dentist is in twenty minutes" nine hours later
 * is a thought about nothing (review, 2026-09-17).
 */
export function stillCurrent(thought: Pick<Thought, 'at' | 'trigger' | 'why'>, now: number, lastMessageAt?: number): boolean {
  if((true as boolean)) { return corePolicySync<any>('thoughts.stillCurrent',[thought,now,lastMessageAt]); }
  if (thought.trigger === 'silence' && lastMessageAt !== undefined && lastMessageAt > thought.at) return false;
  const due = thought.trigger === 'agenda' ? /in about (\d+) minutes?/.exec(thought.why) : null;
  if (due && now > thought.at + (Number(due[1]) + 30) * MIN) return false;
  return true;
}

/**
 * What rides in front of her replies: the freshest couple of thoughts she has
 * not said, from the last twelve hours and still about something current,
 * marked as hers and as not to be recited.
 */
export function mindNote(state: ThoughtState, now: number, count = 2, lastMessageAt?: number): string {
  if((true as boolean)) { return corePolicySync<any>('thoughts.mindNote',[state,now,count,lastMessageAt]); }
  const fresh = state.thoughts
    .filter(t => t.decision !== 'rumination' && t.decision !== 'said' && now - t.at <= 12 * HOUR && t.score >= 2.5 && stillCurrent(t, now, lastMessageAt))
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, count)
    .sort((a, b) => a.at - b.at);
  if (!fresh.length) return '';
  return `On your mind lately — your own private thoughts, not anything he said. Bring one up only if it fits what he is talking about, in your own words, and never recite them:\n${fresh.map(t => `- (${describeGap(Math.max(MIN, now - t.at))} ago) ${t.thought}`).join('\n')}`;
}
