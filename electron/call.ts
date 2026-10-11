import {corePolicySync} from './core-policy-sync';
// A call: the phone's microphone up, her voice down, for as long as the mic
// is on. This file is the part every engine shares — which engine is on, and
// the lines she says while a tool runs. The engines are evibridge.ts (Hume
// hears and speaks, her brain answers through a hook) and localcall.ts (her
// own ears, brain and voice, streamed sentence by sentence).

export type CallEngine = 'hume' | 'local';

export type CallConfig = {
  inputMode?: 'open' | 'addressed';
  engine: CallEngine;
  /** How much quiet ends what they said, on the local engine. Shorter is snappier and cuts pauses. */
  endAfterMs: number;
  /** Opt-in read-only recognition during endpoint quiet; zero disables it. */
  prepareAfterMs?: number;
  /** Opt-in unfinished hold measured from received speech end, not ASR completion. */
  unfinishedQuietMs?: number;
};

export const DEFAULT_CALL: CallConfig = { engine: 'hume', endAfterMs: 550 };

export function readCallConfig(saved: unknown): CallConfig {
  return corePolicySync<any>('speech-boundary.readCallConfig',[saved??null]);
}

/**
 * Whether what was heard reads as a sentence they stopped in the middle of.
 *
 * The detector ends an utterance on quiet, and a breath in the middle of a
 * question is quiet. The transcript knows better than the room: a cut word,
 * no full stop, a trailing "and" or "in" — that is a sentence still coming,
 * and worth a moment's wait before she answers half of it. A question mark or
 * a full stop is answered at once.
 */
const DANGLING = new Set(['and', 'but', 'or', 'so', 'because', 'the', 'a', 'an', 'to', 'in', 'of', 'on', 'at', 'for', 'with', 'about', 'like', 'um', 'uh', 'er', 'if', 'when', 'my', 'your']);

export function looksUnfinished(text: string): boolean {
  return corePolicySync<any>('speech-boundary.looksUnfinished',[text]);
}

/**
 * Said while she looks something up. A search takes a few seconds and a page
 * longer; silence there reads as a dropped call. Pooled here rather than asked
 * of the model — a filler that had to be generated would arrive after the
 * thing it was filling for. Short, hers, and none of them a promise about what
 * she will find.
 */
export const FILLERS = [
  'Hang on.',
  'Give me a sec.',
  'Wait, let me look.',
  'Hold on, checking.',
  'One sec.',
  'Ugh, fine, let me check.',
  'Hm. Let me see.',
  'Checking.',
] as const;

/** One of the fillers, not the one said last time. `pick` is 0..1, the caller's randomness. */
export function pickFiller(pick: number, notThis = ''): string {
  return corePolicySync<any>('speech-boundary.pickFiller',[pick,notThis]);
}
