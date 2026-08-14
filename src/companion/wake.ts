// Deciding whether she was being spoken to.
//
// The hard part is not spotting her name, it is spotting it in a transcript that
// got it slightly wrong. Whisper hears a two-syllable name it has no context for
// and offers "Haruu", "Harou", "Hero", "Harrow" — and it punctuates freely, so
// "Hey Haru" arrives as "Hey, Haru." about as often as not. Matching the literal
// string works in testing and fails constantly in a room.
//
// The other half is the opposite risk. Anything loose enough to catch "Harrow"
// will also catch a stray "hello" from a video, and a companion that answers the
// television is worse than one that has to be asked twice. So the name has to
// land at the start of what was said, near-misses are enumerated rather than
// fuzzy-matched, and a bare greeting with no name in it never counts.

/** Only the opening of an utterance is considered, in words. */
const LOOK_AHEAD = 3;

/**
 * Written out rather than computed from an edit distance. A threshold loose
 * enough for "harou" also accepts "harold" and "her own", and every one of those
 * is somebody else's sentence being answered by mistake.
 */
const NAME = /^(haru+|harou|haroo|haruh|harru|hallu|haruko|harum|hulu|heru|hero|harrow|haru's)$/;

/** Optional, and never sufficient on their own. */
const GREETING = /^(hey|hi|hello|ok|okay|yo|hai|oi|um|uh|so)$/;

export type WakeMatch =
  /** Her name, and something said in the same breath. */
  | { woken: true; message: string }
  /** Her name and nothing else — she should open the mic and wait. */
  | { woken: true; message: '' }
  | { woken: false; message: '' };

const MISSED: WakeMatch = { woken: false, message: '' };

function words(text: string) {
  return text
    .toLowerCase()
    // Apostrophes survive so "haru's" stays one word; everything else goes.
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether this utterance was addressed to her, and what was left once her name
 * was taken off the front.
 *
 * "Haru, remind me to call Connor" comes back as woken with the reminder intact,
 * so the common case is one breath rather than a summons and then a wait.
 */
/**
 * One utterance can hold more than one sentence, and usually does.
 *
 * The microphone cuts on silence, and a room with a television in it rarely
 * goes quiet — so what arrives is not "Haru, what's on today" but ten seconds of
 * whatever was on, with that said somewhere inside it. Measured: clips of nine
 * and ten seconds, and her name reliably past the twentieth word.
 *
 * Sentences are the right unit because the rule that matters is unchanged — her
 * name has to open what was said. It just has to open a sentence rather than the
 * recording, so "my friend Haru said" is still not somebody talking to her.
 */
function sentences(transcript: string): string[] {
  return transcript
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(part => part.trim())
    .filter(Boolean);
}

/**
 * Whether she was addressed, checked across every sentence in the utterance.
 *
 * The last match wins: if the recording caught her name twice, the later one is
 * the thing just said, and the earlier is already stale by the length of a
 * sentence.
 */
export function matchWake(transcript: string): WakeMatch {
  const parts = sentences(transcript);
  if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const match = matchSentence(parts[i]);
      if (match.woken) return match;
    }
    return MISSED;
  }
  return matchSentence(transcript);
}

function matchSentence(transcript: string): WakeMatch {
  const spoken = words(transcript);
  if (!spoken.length) return MISSED;

  // The name has to be at the front. Allowing it anywhere means every sentence
  // that mentions her — including her own name read back off the screen — is a
  // command.
  for (let i = 0; i < Math.min(LOOK_AHEAD, spoken.length); i++) {
    if (!NAME.test(spoken[i])) {
      // Only greetings and filler may precede it; a real word means this was a
      // sentence that happens to contain her name, not one addressed to her.
      if (GREETING.test(spoken[i])) continue;
      return MISSED;
    }
    const rest = spoken.slice(i + 1);
    // Trailing filler after the name is still a bare summons: "Haru?" and
    // "Hey Haru, um" both mean she should listen, not answer "um".
    const meaningful = rest.filter(word => !GREETING.test(word));
    if (!meaningful.length) return { woken: true, message: '' };
    // Rebuilt from the original text rather than the normalised words, so
    // punctuation and capitalisation survive into what she is actually sent.
    return { woken: true, message: tailOf(transcript, rest.length) };
  }
  return MISSED;
}

/**
 * The last `count` words of the original string, with its own spelling intact.
 * Splitting the normalised copy would hand her a lowercase sentence stripped of
 * its commas, which reads as a transcript rather than as something someone said.
 */
function tailOf(original: string, count: number) {
  const raw = original.trim().split(/\s+/);
  return raw.slice(Math.max(0, raw.length - count)).join(' ').replace(/^[,.\s]+/, '').trim();
}

/**
 * Signing off.
 *
 * A spoken exchange has no send button to stop pressing, so without this it ends
 * by the window timing out — she sits listening through whatever is said next,
 * and the last thing anyone said to her was thanks. Saying so out loud should
 * close it, the way it would with a person.
 *
 * The whole difficulty is that "thanks" also opens sentences that carry on:
 * "thanks, and what about tomorrow" is not a goodbye. So a farewell has to be
 * essentially all it is — anything asking, requesting or instructing keeps the
 * conversation open regardless of how politely it starts.
 */
const FAREWELL = /\b(thanks|thank you|cheers|ta|goodbye|good ?bye|bye|see you|see ya|later|goodnight|good ?night|night night|that'?s all|that'?ll be all|that'?s it|that is all|we'?re done|i'?m done|all done|nothing else|no more|appreciate it|much appreciated)\b/i;

/** Anything that wants something back, however politely it is wrapped. */
const STILL_ASKING = /\b(what|when|where|why|who|which|how|can you|could you|would you|will you|remind|tell me|show me|add|set|put|make|find|check|open|play|start|stop|change|delete|remove|and also|but|actually|one more|another)\b|\?/i;

/** Long enough for "alright, thank you for that response Haru" and no longer. */
const FAREWELL_WORDS = 12;

/**
 * Whether this utterance is closing the conversation rather than continuing it.
 * Her name is allowed but not required — "thanks Haru" and "cheers, that's all"
 * are the same act.
 */
export function readsAsFarewell(transcript: string) {
  const spoken = words(transcript);
  if (!spoken.length || spoken.length > FAREWELL_WORDS) return false;
  if (!FAREWELL.test(transcript)) return false;
  return !STILL_ASKING.test(transcript);
}

/**
 * Whether a follow-up, captured after a bare summons, is worth sending. Applied
 * to the second half of "Haru?" ... "what's the weather" — she has already been
 * woken, so the name is not required again and only emptiness is rejected.
 */
export function isUsableFollowUp(transcript: string) {
  return words(transcript).some(word => !GREETING.test(word) && !NAME.test(word));
}
