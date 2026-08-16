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
  if (!saved || typeof saved !== 'object') return { corrections: [] };
  const record = saved as Partial<Hearing>;
  const corrections = Array.isArray(record.corrections) ? record.corrections : [];
  return {
    corrections: corrections
      .filter(c => c && typeof c.heard === 'string' && typeof c.meant === 'string' && c.heard.trim() && c.meant.trim())
      .map(c => ({ heard: c.heard, meant: c.meant, used: typeof c.used === 'number' ? c.used : 0, at: typeof c.at === 'string' ? c.at : '' })),
  };
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
  const a = clean(heard).split(' ');
  const b = clean(meant).split(' ');
  if (!a.length || !b.length) return null;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const left = a.slice(start, endA + 1).join(' ');
  // Taken from the original rather than the cleaned copy, so the replacement
  // keeps its capitals — the whole point is often that it is a name.
  const rightWords = meant.split(/\s+/);
  const right = rightWords.slice(start, rightWords.length - (b.length - 1 - endB)).join(' ');
  if (!left || !right) return null;
  // Nothing changed, or everything did. A whole-sentence rewrite is not a
  // correction, it is a different sentence, and applying it later would replace
  // an unrelated utterance wholesale.
  if (left === clean(right)) return null;
  if (a.slice(start, endA + 1).length > 6) return null;
  return { heard: left, meant: right };
}

export function remember(hearing: Hearing, heard: string, meant: string, now: string): Hearing {
  const pair = narrow(heard, meant);
  if (!pair) return hearing;
  const existing = hearing.corrections.find(c => c.heard === pair.heard);
  const corrections = existing
    ? hearing.corrections.map(c => (c.heard === pair.heard ? { ...c, meant: pair.meant, at: now } : c))
    : [{ heard: pair.heard, meant: pair.meant, used: 0, at: now }, ...hearing.corrections];
  return { corrections: corrections.slice(0, MAX_CORRECTIONS) };
}

/**
 * Rewrites a fresh transcript using everything it has been taught.
 *
 * Longest first, so a two-word correction wins over a one-word one that sits
 * inside it. Whole words only — without the boundaries "ha" would rewrite the
 * middle of "behave".
 */
export function correct(hearing: Hearing, transcript: string): { text: string; applied: string[] } {
  let text = transcript;
  const applied: string[] = [];
  const ordered = [...hearing.corrections].sort((a, b) => b.heard.length - a.heard.length);
  for (const rule of ordered) {
    const escaped = rule.heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
    if (!pattern.test(text)) continue;
    text = text.replace(pattern, rule.meant);
    applied.push(`${rule.heard} → ${rule.meant}`);
  }
  return { text, applied };
}

/** Bumps the counters for whatever fired, so a useless rule is visible as one. */
export function noteUsed(hearing: Hearing, applied: string[]): Hearing {
  if (!applied.length) return hearing;
  const fired = new Set(applied.map(a => a.split(' → ')[0]));
  return { corrections: hearing.corrections.map(c => (fired.has(c.heard) ? { ...c, used: c.used + 1 } : c)) };
}
