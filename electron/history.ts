// Telling old messages from new ones.
//
// Every message in the store carried `time: "now"` — the literal string, on all
// of them, for ever. It is what the bubble prints, and nothing anywhere recorded
// when anything was actually said. So the conversation handed to the model is a
// flat wall of text in which a line from last Tuesday at midnight sits flush
// against one from thirty seconds ago, indistinguishable.
//
// That is the mechanism behind a whole family of complaints, not one bug. Her
// own past assertions never expire: a marketing campaign she invented once was
// still "the campaign I was talking about earlier" two days later, and a remark
// framed for eleven at night reads as current at breakfast. She is not
// misremembering. She is reading something with no date on it and correctly
// concluding it is now.
//
// The fix is not to hide the old messages — the history is worth having — but to
// say plainly where the seams are.

export type Dated = { role: string; content: string; at?: string };

/** Below this a gap is just someone thinking, and marking it would be noise. */
export const GAP_MINUTES = 90;

const MINUTE = 60_000;

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * How to describe a gap, from the later message's point of view.
 *
 * Relative rather than absolute — "the next morning" is what a person would say,
 * and a bare timestamp invites her to read it out. The one exception is a gap
 * long enough that "later" stops being meaningful.
 */
export function describeGap(before: Date, after: Date): string {
  const minutes = Math.round((after.getTime() - before.getTime()) / MINUTE);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  if (sameDay(before, after)) {
    if (hours < 4) return `about ${hours} hour${hours === 1 ? '' : 's'} later, the same day`;
    return 'later the same day';
  }
  if (days <= 1) {
    const part = after.getHours() < 12 ? 'the next morning' : after.getHours() < 18 ? 'the next afternoon' : 'the next evening';
    return part;
  }
  if (days < 7) return `${days} days later`;
  if (days < 30) return `about ${Math.round(days / 7)} weeks later`;
  return 'a long time later';
}

/**
 * The same conversation with the seams named.
 *
 * A note goes in as a system message rather than being glued onto the next line,
 * so it cannot be mistaken for something either of them said — and so that a
 * model which ignores it is no worse off than before.
 *
 * Undated messages are passed through untouched. Everything already in the store
 * predates this and has no timestamp to reason from; guessing one would be worse
 * than the flatness being fixed.
 */
export function markTimeGaps<T extends Dated>(messages: T[], gapMinutes = GAP_MINUTES): (T | { role: 'system'; content: string })[] {
  const out: (T | { role: 'system'; content: string })[] = [];
  let previous: Date | null = null;
  for (const message of messages) {
    const at = message.at ? new Date(message.at) : null;
    const usable = at && !Number.isNaN(at.getTime()) ? at : null;
    if (usable && previous && usable.getTime() - previous.getTime() >= gapMinutes * MINUTE) {
      out.push({
        role: 'system',
        content: `[Time passed here — what follows was said ${describeGap(previous, usable)}. Everything above this line is from before that gap: it is background, not something still going on. Do not carry a plan, a mood or a time of day across this line, and do not refer to anything above it as though it were still happening unless they bring it up.]`,
      });
    }
    if (usable) previous = usable;
    out.push(message);
  }
  return out;
}

/**
 * How long ago the last thing was said, for the composers that speak first.
 *
 * She opens conversations, and an opening line written as though the last
 * exchange were still warm is the same failure seen from the other end.
 */
export function sinceLast(messages: Dated[], now: Date): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const at = messages[i].at ? new Date(messages[i].at as string) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const minutes = Math.round((now.getTime() - at.getTime()) / MINUTE);
    if (minutes < GAP_MINUTES) return '';
    return `The last thing either of you said was ${describeGap(at, now)} — that conversation is over. Do not pick it up mid-thought or refer back to it as though no time has passed.`;
  }
  return '';
}
