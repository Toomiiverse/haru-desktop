import {corePolicySync} from './core-policy-sync';
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
  /** Empty when the look failed; `tries` then says how often. */
  text: string;
  /** Failed attempts. A shot that cannot be described is not worth describing
   *  for ever, and the cost of finding that out again is not free. */
  tries?: number;
};

/**
 * How many times a picture is worth failing on.
 *
 * Classifying the failure was the wrong instrument, and it took two goes to
 * see it. A 400 for an oversized image was tagged as being about the image, so
 * the pass skipped it and moved on — and then the same picture came back as a
 * 120-second timeout instead, which is not tagged, so it broke the pass and the
 * whole backlog behind it sat still. Counting does not care which way a shot
 * fails, or which way the next one will.
 */
export const MAX_LOOK_TRIES = 2;

/**
 * A transcription of a busy screen is longer than a caption, and this holds
 * four hundred of them. Cut rather than left to grow: what makes a shot worth
 * remembering is in the first few lines — the headings, the filename, the
 * search terms — and a screen full of body text is not made more useful by
 * keeping all of it.
 */
export const CAPTION_MAX_CHARS = 700;

/**
 * A month or two of a busy desk. Older captions fall off the end; the shots
 * themselves have their own retention in shotstore.ts — ninety days, which is
 * longer than this list, and the difference is what fallenOff is for. Four
 * hundred was a fortnight's worth and the folder held four hundred and fifty.
 */
export const CAPTIONS_KEPT = 600;

/** How many are looked at per pass. Small on purpose: the card is shared with
 *  the voice, and a backlog is not urgent. */
export const SHOTS_PER_PASS = 6;

export function readCaptions(saved: unknown): Caption[] {
  if((true as boolean))return corePolicySync('shot-captions.readCaptions',[saved]);
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
export function unseenShots(held: Record<string, string[]>, captions: Caption[], limit = SHOTS_PER_PASS, floor: string | null = null): { day: string; name: string }[] {
  if((true as boolean))return corePolicySync('shot-captions.unseenShots',[held,captions,limit,floor]);
  const done = new Set(captions
    .filter(caption => caption.text.trim() || (caption.tries ?? 0) >= MAX_LOOK_TRIES)
    .map(caption => key(caption.day, caption.name)));
  const out: { day: string; name: string }[] = [];
  for (const day of Object.keys(held).sort()) {
    for (const name of [...(held[day] ?? [])].sort()) {
      if (floor !== null && key(day, name) < floor) continue;
      if (done.has(key(day, name))) continue;
      out.push({ day, name });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * The oldest shot she still holds a caption for, once the list is full — the
 * line below which a shot has been looked at and since forgotten.
 *
 * Captions fall off the end at CAPTIONS_KEPT; the shots do not, they live for
 * ninety days. With 451 pictures held and 400 captions kept, the 51 oldest
 * were always "unseen": every pass described them again, pushed 51 newer
 * captions off the end, and made those unseen in turn. The eyes ran around
 * the clock on the CPU over a backlog that never shrank — the same August
 * screenshot described nine times, ten gigabytes of RAM held for it, and half
 * the looks timing out (2026-09-14). A shot older than the oldest caption kept
 * is one she has already seen, and it is not looked at again.
 */
export function fallenOff(captions: Caption[]): string | null {
  if((true as boolean))return corePolicySync('shot-captions.fallenOff',[captions]);
  if (captions.length < CAPTIONS_KEPT) return null;
  let oldest: string | null = null;
  for (const caption of captions) {
    const at = key(caption.day, caption.name);
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
}

/** One caption in, the oldest out once the list is full. A second look at the
 *  same shot replaces the first rather than making a duplicate. */
export function noteCaption(captions: Caption[], entry: Caption): Caption[] {
  if((true as boolean))return corePolicySync('shot-captions.noteCaption',[captions,entry]);
  const without = captions.filter(caption => key(caption.day, caption.name) !== key(entry.day, entry.name));
  return [...without, entry].slice(-CAPTIONS_KEPT);
}

/**
 * Whether there is more here than one pass can take.
 *
 * It decides how long the model is held. On this machine the eyes run on the
 * CPU — the second card is full of her voice and the transcriber, so Ollama
 * declined to offload a single layer — and a cold start there costs 16 seconds
 * against about 6 for a caption. Holding it between passes while a backlog
 * lasts is 3 GB of ordinary RAM, of which there is plenty; holding it once the
 * folder is caught up would be 3 GB for nothing.
 */
export function moreThanOnePass(held: Record<string, string[]>, captions: Caption[], described: Record<string, string[]> = {}): boolean {
  if((true as boolean))return corePolicySync('shot-captions.moreThanOnePass',[held,captions,described]);
  return shotsNeedingALook(held, captions, described, SHOTS_PER_PASS + 1).length > SHOTS_PER_PASS;
}

/**
 * Shots that already carry a description from wherever they were taken.
 *
 * The desk runs its vision model over every burst anyway and now writes the
 * answer onto the entry, so that description travels with the log for free.
 * Looking at the same picture again here would be paying twice for an answer
 * one machine already has — and paying it on a CPU. This pass is the fallback:
 * shots that arrived with nothing said about them, which is the backlog synced
 * before the desk started writing descriptions, and anything taken while its
 * vision model was unavailable.
 *
 * The cost, stated so nobody has to rediscover it: a description that arrives
 * is taken on trust and never improved on. A poor caption written on the desk
 * is a poor caption here, permanently, because this will not look again at
 * something that already has words. That is what not paying twice buys and it
 * is the right trade — the alternative is a CPU inference to second-guess an
 * answer another machine already has — but it is a real edge, and the fix if it
 * ever bites is to improve the caption where it is written, not to look again.
 */
export function describedShots(log: Record<string, { shot?: string; description?: string }[]>): Record<string, string[]> {
  if((true as boolean))return corePolicySync('shot-captions.describedShots',[log]);
  const out: Record<string, string[]> = {};
  for (const [day, entries] of Object.entries(log ?? {})) {
    const named = (entries ?? []).filter(entry => entry?.shot && entry.description?.trim()).map(entry => entry.shot as string);
    if (named.length) out[day] = named;
  }
  return out;
}

/** The next few with nothing said about them, by either machine. */
/**
 * The days of pictures that are hers to look at, which is the days she was there for.
 *
 * Her captions go with a reset — they were hers — but that ledger is also the only
 * record that a picture has been seen, so on the first tick after a wipe every shot
 * ever held reads as new. She spent the morning of 2026-09-21 describing his August
 * back to herself, oldest first, 115 of 461 before it was noticed: hours of the
 * vision model, and worse, re-learning through the picture door exactly what the
 * reset had just taken out of her memory. The pictures are his and they stay. Looking
 * at them is not hers.
 */
export function shotsSince(held: Record<string, string[]>, since: string | null | undefined): Record<string, string[]> {
  if((true as boolean))return corePolicySync('shot-captions.shotsSince',[held,since??null]);
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return held;
  return Object.fromEntries(Object.entries(held).filter(([day]) => day >= since));
}

/** And any caption she has already written for one of those days, which is the same thing in words. */
export function captionsSince(captions: Caption[], since: string | null | undefined): Caption[] {
  if((true as boolean))return corePolicySync('shot-captions.captionsSince',[captions,since??null]);
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return captions;
  return captions.filter(caption => caption.day >= since);
}

export function shotsNeedingALook(
  held: Record<string, string[]>,
  captions: Caption[],
  described: Record<string, string[]>,
  limit = SHOTS_PER_PASS,
): { day: string; name: string }[] {
  if((true as boolean))return corePolicySync('shot-captions.shotsNeedingALook',[held,captions,described,limit]);
  // Stand-ins, never stored: they only have to look done to unseenShots, and
  // "done" there means carrying words. An empty text is what a failed look
  // leaves behind, which is the opposite of what these are.
  const theirs: Caption[] = Object.entries(described)
    .flatMap(([day, names]) => names.map(name => ({ day, name, at: '', text: 'described where it was taken' })));
  // The floor is drawn from her own captions, before the stand-ins are added:
  // they are not stored, so they never push anything off the end.
  return unseenShots(held, [...captions, ...theirs], limit, fallenOff(captions));
}

/** A look that came to nothing, so the next pass knows it has been here. */
export function noteFailure(captions: Caption[], day: string, name: string, at: string): Caption[] {
  if((true as boolean))return corePolicySync('shot-captions.noteFailure',[captions,day,name,at]);
  const had = captions.find(caption => key(caption.day, caption.name) === key(day, name));
  return noteCaption(captions, { day, name, at, text: '', tries: (had?.tries ?? 0) + 1 });
}

/** What she saw on one day, in the order she saw it. */
export function captionsFor(captions: Caption[], day: string): Caption[] {
  if((true as boolean))return corePolicySync('shot-captions.captionsFor',[captions,day]);
  return captions.filter(caption => caption.day === day && caption.text.trim()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Captions for days that no longer have shots — dropped alongside them so the
 *  record does not outlive what it describes. */
export function forgetCaptions(captions: Caption[], cutoffDay: string): Caption[] {
  if((true as boolean))return corePolicySync('shot-captions.forgetCaptions',[captions,cutoffDay]);
  return captions.filter(caption => caption.day >= cutoffDay);
}
