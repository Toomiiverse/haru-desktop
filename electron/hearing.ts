import {hearingPolicy} from './core-hearing-policy';
// Learning what she keeps mishearing.
//
// Whisper gets most of a sentence right and the same few words wrong for ever —
// names, in-jokes, anything outside its training. Telling it once should be
// enough, and until now there was nowhere to tell it.
//
// Corrections are applied to the transcript after the fact, not fed to the model
// as a prompt. That is deliberate and the reason is already written down in
// listen.ts: priming Whisper biases it toward the primed words, and given near
// silence it returns the prompt itself word for word, which then arrives as
// though somebody said it. A substitution table cannot hallucinate — it only
// ever rewrites something that was actually heard.

export type Correction = {
  /** What came out of the speech server, lowercased. */
  heard: string;
  /** What they actually said. */
  meant: string;
  /** How many times this rewrite has fired since it was taught. */
  used: number;
  at: string;
};

export type Hearing = { corrections: Correction[] };

/** Enough to cover the words one person keeps saying; short enough to stay fast. */
const MAX_CORRECTIONS = 200;

export function readHearing(saved: unknown): Hearing {
 return hearingPolicy('readHearing',[saved]);
}

const clean = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * The words that actually differ between what was heard and what was meant.
 *
 * Storing the whole sentence would teach nothing — the next sentence is
 * different — so the pair is trimmed to the part that changed. "remind me to
 * call harrow at six" against "remind me to call Haru at six" should teach
 * harrow → Haru and nothing else, because everything else was already right.
 */
export function narrow(heard: string, meant: string): { heard: string; meant: string } | null {
 return hearingPolicy('narrow',[heard,meant]);
}

export function remember(hearing: Hearing, heard: string, meant: string, now: string): Hearing {
 return hearingPolicy('remember',[hearing,heard,meant,now]);
}

/**
 * Rewrites a fresh transcript using everything it has been taught.
 *
 * Longest first, so a two-word correction wins over a one-word one that sits
 * inside it. Whole words only — without the boundaries "ha" would rewrite the
 * middle of "behave".
 */
export function correct(hearing: Hearing, transcript: string): { text: string; applied: string[] } {
 return hearingPolicy('correct',[hearing,transcript]);
}

/** Bumps the counters for whatever fired, so a useless rule is visible as one. */
export function noteUsed(hearing: Hearing, applied: string[]): Hearing {
 return hearingPolicy('noteUsed',[hearing,applied]);
}
