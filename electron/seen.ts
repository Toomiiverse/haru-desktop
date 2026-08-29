// What she made of the screenshots the desk sent over.
//
// The desk syncs the pictures themselves into userData/screenshots/<day>/, and
// until now nothing on this machine opened them — the server held a folder of
// images it could not see. This is the pass that looks: oldest day first, a few
// at a time, one caption each, and a note of which have been done so a backlog
// of three hundred is worked through rather than started again every tick.
//
// Pure, like agenda.ts and opening.ts: which shots are next and what the record
// looks like afterwards are decided here, and main.ts does the looking. The
// model is small and lives on the other card — see ollama-vision.service — so a
// run costs the chat model nothing.

export type Caption = {
  day: string;
  name: string;
  /** When she looked, not when the shot was taken. */
  at: string;
  text: string;
};

/** Roughly a fortnight of a busy desk. Older captions fall off the end; the
 *  shots themselves have their own retention in shotstore.ts. */
export const CAPTIONS_KEPT = 400;

/** How many are looked at per pass. Small on purpose: the card is shared with
 *  the voice, and a backlog is not urgent. */
export const SHOTS_PER_PASS = 6;

export function readCaptions(saved: unknown): Caption[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((entry): entry is Caption =>
    Boolean(entry) && typeof entry === 'object'
    && typeof (entry as Caption).day === 'string'
    && typeof (entry as Caption).name === 'string'
    && typeof (entry as Caption).text === 'string'
    && typeof (entry as Caption).at === 'string');
}

const key = (day: string, name: string) => `${day}/${name}`;

/**
 * The next few shots with no caption, oldest day first and in name order
 * within a day — which for a timestamped filename is chronological, so what she
 * sees follows the day as it happened rather than arriving shuffled.
 */
export function unseenShots(held: Record<string, string[]>, captions: Caption[], limit = SHOTS_PER_PASS): { day: string; name: string }[] {
  const done = new Set(captions.map(caption => key(caption.day, caption.name)));
  const out: { day: string; name: string }[] = [];
  for (const day of Object.keys(held).sort()) {
    for (const name of [...(held[day] ?? [])].sort()) {
      if (done.has(key(day, name))) continue;
      out.push({ day, name });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** One caption in, the oldest out once the list is full. A second look at the
 *  same shot replaces the first rather than making a duplicate. */
export function noteCaption(captions: Caption[], entry: Caption): Caption[] {
  const without = captions.filter(caption => key(caption.day, caption.name) !== key(entry.day, entry.name));
  return [...without, entry].slice(-CAPTIONS_KEPT);
}

/** What she saw on one day, in the order she saw it. */
export function captionsFor(captions: Caption[], day: string): Caption[] {
  return captions.filter(caption => caption.day === day).sort((a, b) => a.name.localeCompare(b.name));
}

/** Captions for days that no longer have shots — dropped alongside them so the
 *  record does not outlive what it describes. */
export function forgetCaptions(captions: Caption[], cutoffDay: string): Caption[] {
  return captions.filter(caption => caption.day >= cutoffDay);
}
