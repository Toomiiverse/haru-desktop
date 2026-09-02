// What she said weeks ago, found again.
//
// The last few days of conversation go into the prompt whole (history.ts), and
// everything older became a one-line summary of the day. That is thirty days
// and two and a half thousand messages on disk that she cannot reach: asked
// about the motherboard she picked up in Belmont a fortnight ago she has the
// sentence "they did errands and talked about hardware" and nothing else.
//
// So the older days are cut into exchanges — one thing he said and what she
// said back — embedded once, and searched per turn against what he has just
// asked. Only a handful come back, only when they are actually close to the
// question, and never from a day already in the prompt.

export type Exchange = { id: string; day: string; text: string };

/** Enough of a match to be the thing he means; below this it is a coincidence. */
export const RECALL_FLOOR = 0.62;
/** How many come back at most: this is a jog of the memory, not a transcript. */
export const RECALL_LIMIT = 4;
/** Nothing older than this: past a couple of months it is a different life. */
export const RECALL_DAYS = 60;

const clean = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The archive as searchable exchanges, newest day last.
 *
 * One exchange is what he said and her answer to it, which is the smallest
 * piece that still makes sense on its own — a lone "yeah, fine" retrieved
 * without its question is worse than nothing.
 */
export function exchangesFrom(archive: Record<string, { role?: string; content?: string }[]>, before: string[], todayKey: string, days = RECALL_DAYS): Exchange[] {
  const skip = new Set(before);
  const out: Exchange[] = [];
  const oldest = new Date(Date.parse(todayKey) - days * 86_400_000).toISOString().slice(0, 10);
  for (const day of Object.keys(archive).sort()) {
    if (day >= todayKey || skip.has(day) || day < oldest) continue;
    const turns = (archive[day] ?? []).filter(turn => turn.role === 'user' || turn.role === 'assistant');
    for (let at = 0; at < turns.length; at++) {
      if (turns[at].role !== 'user') continue;
      const said = clean(turns[at].content);
      const answered = turns[at + 1]?.role === 'assistant' ? clean(turns[at + 1].content) : '';
      if (said.length < 12) continue;
      out.push({ id: `${day}#${at}`, day, text: `Them: ${said.slice(0, 400)}${answered ? `\nYou: ${answered.slice(0, 400)}` : ''}` });
    }
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0, left = 0, right = 0;
  for (let at = 0; at < a.length; at++) { dot += a[at] * b[at]; left += a[at] * a[at]; right += b[at] * b[at]; }
  const size = Math.sqrt(left) * Math.sqrt(right);
  return size ? dot / size : 0;
}

/** The closest few, best first, and none that is merely nearby. */
export function pickRecalled(exchanges: Exchange[], vectors: Map<string, number[]>, query: number[], limit = RECALL_LIMIT, floor = RECALL_FLOOR): { exchange: Exchange; score: number }[] {
  return exchanges
    .map(exchange => ({ exchange, score: cosine(vectors.get(exchange.id) ?? [], query) }))
    .filter(entry => entry.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * What she is told about them. Dated, because an exchange from three weeks ago
 * read as current is the whole reason time gaps are marked at all, and framed
 * as a record rather than as something she remembers word for word.
 */
export function recallNote(found: { exchange: Exchange; score: number }[], weekday: Intl.DateTimeFormat): string {
  if (!found.length) return '';
  const when = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return `${weekday.format(new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)))} ${day}`;
  };
  return [
    'From further back than the conversation above — older days, found because they look related to what they just said. They are not in front of you otherwise, and they are not necessarily still true:',
    ...found.map(entry => `[${when(entry.exchange.day)}]\n${entry.exchange.text}`),
    'Use one only if it is actually the thing they mean. Say when it was if you bring it up, and do not treat any of it as still standing without checking.',
  ].join('\n\n');
}
