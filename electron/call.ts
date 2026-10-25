// A call: the phone's microphone up, her voice down, for as long as the mic
// is on. This file is the part every engine shares — which engine is on, and
// the lines she says while a tool runs. The engines are evibridge.ts (Hume
// hears and speaks, her brain answers through a hook) and localcall.ts (her
// own ears, brain and voice, streamed sentence by sentence).

export type CallEngine = 'hume' | 'local';

export type CallConfig = {
  engine: CallEngine;
  /** How much quiet ends what they said, on the local engine. Shorter is snappier and cuts pauses. */
  endAfterMs: number;
};

// Local by default: Hume's EVI is retired, and a call left on it was refused.
export const DEFAULT_CALL: CallConfig = { engine: 'local', endAfterMs: 550 };

export function readCallConfig(saved: unknown): CallConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_CALL;
  const record = saved as Partial<CallConfig>;
  const engines: CallEngine[] = ['hume', 'local'];
  return {
    engine: engines.includes(record.engine as CallEngine) ? record.engine as CallEngine : DEFAULT_CALL.engine,
    endAfterMs: typeof record.endAfterMs === 'number' && Number.isFinite(record.endAfterMs) ? Math.max(200, Math.min(2000, Math.round(record.endAfterMs))) : DEFAULT_CALL.endAfterMs,
  };
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
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[-–—…,:;]$/.test(trimmed)) return true;
  // Whisper closes a sentence it heard the end of. One it did not, it leaves open.
  if (!/[.!?]["'”’)]*$/.test(trimmed)) return true;
  const last = trimmed.toLowerCase().replace(/[^a-z' ]/g, ' ').trim().split(/\s+/).pop() ?? '';
  return DANGLING.has(last);
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
  const pool = FILLERS.filter(line => line !== notThis);
  const at = Math.min(pool.length - 1, Math.max(0, Math.floor(pick * pool.length)));
  return pool[at];
}
