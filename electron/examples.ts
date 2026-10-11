import {corePolicySync} from './core-policy-sync';
// How she sounds at her best, shown rather than described.
//
// Character cards carry example dialogue for a reason: a model copies the voice
// it can see over the voice it is told about — the finding behind seed.ts and
// revoice.ts, and why her emoji rut only broke when her shown history changed.
// Revoice rewrites her weak replies inside the history she is shown, but a
// rewrite older than that history does nothing; and 124 replies he gave a thumbs
// up to were only ever quoted back as 70-character excerpts.
//
// So a few whole exchanges go in front of her, from two sources:
//   revoiced  the voice tier's rewrites of her replies
//   liked     replies he marked good
// taken only from days older than the history she is shown (never a line she
// can also see in the transcript), without digits (a time, a price or a model
// number in an example is a stale fact waiting to be repeated), short, and never
// one he marked poor. A reply said word for word more than once is canned — the
// asleep line had a thumbs up — and a liked reply from before her persona was
// rewritten on 2026-09-04 is the voice revoice exists to replace ("Now that
// you've actually done something… stop wasting my time"), so neither is used.
// Three a day, rotated by the date, so no single example sets in; stable for
// the day, so the hosted brain's cached head changes once a day rather than
// every turn.
//
// She reads examples back word for word if she can (feedbackSummary's excerpts,
// reusesExample's "example four"). The block says the lines are spent, and
// reusedExample lets the reply path log it when she does it anyway.
//
// Pure.

export type ExampleTurn = { id?: string; role?: string; content?: unknown; reaction?: string };
export type Example = { id: string; theirs: string; hers: string; kind: 'revoiced' | 'liked'; day: string };

export const EXAMPLES_PER_DAY = 3;
/** Her persona was rewritten this day (haru_talks_like_a_person); a liked reply from before it is the old voice. */
export const VOICE_SINCE = '2026-09-04';
const HERS_MAX = 320;
const THEIRS_MAX = 220;

/** Emotion tags and stage directions are delivery, not voice. */
function cleaned(text: unknown): string {
  return String(text ?? '').replace(/\[[a-z][a-z ]{1,20}\]\s*/gi, '').replace(/\s+/g, ' ').trim();
}

/** Whether a reply can stand as an example of her voice. */
export function fitForExample(theirs: string, hers: string): boolean {
  return corePolicySync<any>('conversation-policy.fitForExample',[theirs,hers]);
}

/**
 * Every exchange that could be an example, oldest day first. `rewrites` maps a
 * reply id to her re-voiced text; `before` is the first day key she can still
 * see in her history, and nothing from it or later is used.
 */
export function examplePool(archive: Record<string, ExampleTurn[]>, rewrites: Record<string, { text: string }>, before: string, since = VOICE_SINCE): Example[] {
  return corePolicySync<any>('conversation-policy.examplePool',[archive,rewrites,before,since]);
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The day's examples: a shuffle keyed by the date, rewrites first because they were made to be her best. */
export function pickExamples(pool: Example[], dayKey: string, count = EXAMPLES_PER_DAY): Example[] {
  return corePolicySync<any>('conversation-policy.pickExamples',[pool,dayKey,count]);
}

export function examplesNote(examples: Example[]): string {
  return corePolicySync<any>('conversation-policy.examplesNote',[examples]);
}

/** Whether a reply lifted an example's line: eight words in a row from one of them. */
export function reusedExample(reply: string, examples: Example[], run = 8): Example | null {
  return corePolicySync<any>('conversation-policy.reusedExample',[reply,examples,run]);
}
