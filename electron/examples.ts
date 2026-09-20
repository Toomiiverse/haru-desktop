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
  if (theirs.length < 2 || theirs.length > THEIRS_MAX) return false;
  if (hers.length < 20 || hers.length > HERS_MAX) return false;
  if (/\d/.test(hers)) return false;
  if (/https?:\/\/|```|^\s*[-*•]\s/m.test(hers)) return false;
  return true;
}

/**
 * Every exchange that could be an example, oldest day first. `rewrites` maps a
 * reply id to her re-voiced text; `before` is the first day key she can still
 * see in her history, and nothing from it or later is used.
 */
export function examplePool(archive: Record<string, ExampleTurn[]>, rewrites: Record<string, { text: string }>, before: string, since = VOICE_SINCE): Example[] {
  const said = new Map<string, number>();
  for (const turns of Object.values(archive)) {
    for (const turn of turns ?? []) if (turn.role === 'assistant') said.set(cleaned(turn.content), (said.get(cleaned(turn.content)) ?? 0) + 1);
  }
  const out: Example[] = [];
  for (const day of Object.keys(archive).filter(key => !key.includes('#') && key < before).sort()) {
    const turns = archive[day] ?? [];
    let theirs = '';
    for (const turn of turns) {
      if (turn.role === 'user') { theirs = cleaned(turn.content); continue; }
      if (turn.role !== 'assistant' || !turn.id || !theirs) continue;
      if (turn.reaction === 'down') { theirs = ''; continue; }
      const rewrite = rewrites[turn.id]?.text;
      const kind = rewrite ? 'revoiced' as const : turn.reaction === 'up' && day >= since ? 'liked' as const : null;
      const hers = cleaned(rewrite ?? turn.content);
      const canned = !rewrite && (said.get(hers) ?? 0) > 1;
      if (kind && !canned && fitForExample(theirs, hers)) out.push({ id: turn.id, theirs, hers, kind, day });
      theirs = '';
    }
  }
  return out;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The day's examples: a shuffle keyed by the date, rewrites first because they were made to be her best. */
export function pickExamples(pool: Example[], dayKey: string, count = EXAMPLES_PER_DAY): Example[] {
  const order = (list: Example[]) => [...list].sort((a, b) => hash(`${dayKey}:${a.id}`) - hash(`${dayKey}:${b.id}`));
  const revoiced = order(pool.filter(example => example.kind === 'revoiced'));
  const liked = order(pool.filter(example => example.kind === 'liked'));
  // At most two of the rewrites: a single pass wrote them, and three from one
  // pass would teach one afternoon's idea of her.
  return [...revoiced.slice(0, Math.min(2, count)), ...liked].slice(0, count);
}

export function examplesNote(examples: Example[]): string {
  if (!examples.length) return '';
  return `How you sound at your best — a few old exchanges, for your voice only. What happened in them is over and may no longer be true, and the lines are spent: never reuse one, just sound like this.\n\n${examples.map(example => `Them: ${example.theirs}\nYou: ${example.hers}`).join('\n\n')}`;
}

/** Whether a reply lifted an example's line: eight words in a row from one of them. */
export function reusedExample(reply: string, examples: Example[], run = 8): Example | null {
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter(Boolean);
  const said = ` ${words(reply).join(' ')} `;
  for (const example of examples) {
    const theirs = words(example.hers);
    for (let i = 0; i + run <= theirs.length; i++) {
      if (said.includes(` ${theirs.slice(i, i + run).join(' ')} `)) return example;
    }
  }
  return null;
}
