// A preference that asks her to speak first, and when.
//
// He wrote "Check up on Tommy to see how he's doing in the mornings" on his
// preferences page. It was admitted, active, and rendered in her preferences
// block all day on 2026-09-08. She never did it, and at 18:57 he asked why she
// had not texted him all day.
//
// She was not ignoring it. A preference only ever reaches her while she is
// already composing a reply, and by then he has spoken first, which is the one
// situation the instruction is not about. Every proactive composer — the
// opening, the bored nudge, the pushes — reads the agenda, her memories, her
// own life and where his phone is, and none of them reads a preference. So an
// instruction to *initiate* was structurally inert: the only path that could
// have carried it out could not see it.
//
// This is the corollary of the rule that keeps coming up in this codebase: if
// she has to choose to act on grounding she cannot see at the moment it
// matters, she will not. Detect the trigger and hand it to the composer that
// can act on it.
//
// Deliberately narrow. Only a preference that both asks her to make contact and
// names a time of day becomes a reason to speak. "Keep replies human-length" is
// a tone rule and must never become a nudge; "don't nag twice in a day" is a
// prohibition and must never be read as an instruction to do the thing.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** The hours each word covers, as anyone means them. `night` wraps midnight. */
export const TIME_WINDOWS: Record<TimeOfDay, [number, number]> = {
  morning: [6, 12],
  afternoon: [12, 17],
  evening: [17, 22],
  night: [22, 6],
};

export function withinWindow(when: TimeOfDay, hour: number): boolean {
  const [from, to] = TIME_WINDOWS[when];
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

const NAMES: [TimeOfDay, RegExp][] = [
  ['morning', /\bmornings?\b|\bfirst thing\b|\bwhen (?:he|they) wakes? up\b/i],
  ['afternoon', /\bafternoons?\b|\bmidday\b|\blunchtimes?\b/i],
  ['evening', /\bevenings?\b|\bafter work\b|\bwhen (?:he|they) gets? (?:home|in)\b/i],
  ['night', /\bnights?\b|\bbefore bed\b|\bbedtime\b/i],
];

export function timeNamedIn(text: string): TimeOfDay | null {
  for (const [when, pattern] of NAMES) if (pattern.test(text)) return when;
  return null;
}

/**
 * Whether the line asks her to make contact rather than describing how to
 * behave once contact exists.
 *
 * A prohibition is refused outright even when it names a time, because "don't
 * interrupt him in the mornings" and "check on him in the mornings" differ by
 * one word and mean opposite things. Reading the second out of the first would
 * be the worst failure this file could have.
 */
const ASKS = /\b(check (?:up )?(?:on|in)|see how|ask how|text|message|say (?:good ?morning|hello|hi)|check on|reach out|touch base|wish (?:him|them))\b/i;
const FORBIDS = /^\s*(don'?t|do not|never|avoid|stop)\b|\bdon'?t\b(?=[^.!?]*\b(check|text|message|ask|interrupt|nag)\b)/i;

export function asksHerToOpen(text: string): boolean {
  const clean = (text ?? '').trim();
  if (!clean || FORBIDS.test(clean)) return false;
  return ASKS.test(clean);
}

export type DueOpening = { text: string; when: TimeOfDay };

/** The standing instructions to make contact that are due at this hour. */
export function openingsDueNow(preferences: { text: string }[], hour: number): DueOpening[] {
  const due: DueOpening[] = [];
  for (const preference of preferences) {
    const text = (preference.text ?? '').trim();
    if (!asksHerToOpen(text)) continue;
    const when = timeNamedIn(text);
    if (!when || !withinWindow(when, hour)) continue;
    due.push({ text, when });
  }
  return due;
}

/**
 * What the nudge composer is told.
 *
 * His words go in verbatim rather than summarised: it is his instruction, and
 * a paraphrase of "check up on Tommy to see how he's doing" is a different
 * errand. She is told it is a standing thing she does, not a fact to recite,
 * because a composer handed a rule tends to read the rule out.
 */
export function openingInstruction(due: DueOpening): string {
  return `This is something you do in the ${due.when}, and you have not done it yet today: ${due.text.replace(/\s+$/, '')}. Open on that — ask him, in your own words, the way you would. Do not mention that it is a rule, do not quote it back at him, and do not explain why you are asking.`;
}
