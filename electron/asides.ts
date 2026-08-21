// The things she says off her own back.
//
// A remark about a screenshot, a jab about the tab they just opened, a nudge
// about something overdue — none of it was said to her, and none of it is part
// of the conversation. It only ever lived in the transcript because the
// transcript was the one place with room to print text.
//
// That was costing twice over. The chat filled with lines nobody had asked for,
// so finding what was actually said meant scrolling past a day of her
// commentary; and every one of those lines went back into the model on the next
// message, so a morning of her narrating the screen became the bulk of what she
// thought the conversation had been about. She would answer a question about
// Thursday by referring back to a game she had watched them play.
//
// So they are kept here instead: her own record, in her own log, with the time
// and the reason she spoke. The conversation stays the conversation.
//
// They are not thrown away. What she said recently still reaches the model as a
// note alongside the next message — see asideContext — because an answer to a
// question she asked out loud is meaningless without the question. The
// difference is that the note expires and the transcript does not.

/** Why she spoke. Kept so the log can be read rather than merely scrolled. */
export type AsideSource =
  | 'screen'      // watching a game or a video go by
  | 'screenshot'  // a picture that appeared in the screenshots folder
  | 'activity'    // an app or a page they moved to
  | 'fullscreen'  // something taking over the screen
  | 'reminder'    // chasing what is on the list
  | 'idle'        // breaking a long silence
  | 'journal'     // the once-a-day ask
  | 'page'        // noticing which of her own pages they opened
  | 'poke'        // being prodded in the companion window
  | 'kept'        // remarking on something ticked off
  | 'other';

export type Aside = {
  id: string;
  /** Full timestamp: when she said it is most of what makes a log readable. */
  at: string;
  /** The day it belongs to, keyed the same way the transcript is. */
  day: string;
  source: AsideSource;
  text: string;
};

/** Enough to scroll back through a few days of her, and a bound on the file. */
export const MAX_ASIDES = 400;

/** How long the log keeps a day before dropping it. */
export const ASIDE_DAYS = 7;

const SOURCES: AsideSource[] = ['screen', 'screenshot', 'activity', 'fullscreen', 'reminder', 'idle', 'journal', 'page', 'poke', 'kept', 'other'];

export function readAsides(saved: unknown): Aside[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .filter(entry => typeof entry.text === 'string' && entry.text.trim())
    .map(entry => ({
      id: typeof entry.id === 'string' ? entry.id : Math.random().toString(36).slice(2, 10),
      at: typeof entry.at === 'string' ? entry.at : '',
      day: typeof entry.day === 'string' ? entry.day : '',
      source: SOURCES.includes(entry.source as AsideSource) ? entry.source as AsideSource : 'other',
      text: String(entry.text).trim(),
    }));
}

export function addAside(asides: Aside[], text: string, source: AsideSource, now: Date, day: string): { asides: Aside[]; aside: Aside } {
  const aside: Aside = {
    id: Math.random().toString(36).slice(2, 10),
    at: now.toISOString(),
    day,
    source,
    text: text.trim(),
  };
  return { asides: [...asides, aside].slice(-MAX_ASIDES), aside };
}

/**
 * Drops whole days once they are old enough, rather than trimming to a count.
 *
 * A quiet week and a loud afternoon hold wildly different numbers of these, and
 * a pure count would keep three days of one and twenty minutes of the other.
 * What the log is for is looking back over the last few days, so days are the
 * unit it forgets in.
 */
export function pruneAsides(asides: Aside[], days = ASIDE_DAYS): Aside[] {
  const kept = new Set([...new Set(asides.map(aside => aside.day).filter(Boolean))].sort().slice(-days));
  return asides.filter(aside => !aside.day || kept.has(aside.day));
}

export function asidesOn(asides: Aside[], day: string): Aside[] {
  return asides.filter(aside => aside.day === day);
}

/**
 * How long one of these still explains what they are answering.
 *
 * Short on purpose. This is the window in which "yeah, I did" is a reply to
 * something she said out loud rather than a non sequitur; past it, the line has
 * gone unanswered and dredging it up is her bringing up a remark from an hour
 * ago as though it were still hanging in the air.
 */
export const ASIDE_CONTEXT_MS = 15 * 60_000;

/** At most this many, so a talkative stretch cannot crowd out the actual message. */
const ASIDE_CONTEXT_LIMIT = 3;

/**
 * What she said unprompted, handed to the model as a note rather than as history.
 *
 * This is the whole reason keeping the two logs apart is safe. She says "is that
 * the third episode? thought you were working"; they type "taking a break". Read
 * without the first line, the second is a stranger announcing they are taking a
 * break — which is exactly the sort of gap she fills by inventing something.
 *
 * So the recent ones ride along beside the message, and only the recent ones. A
 * note expires; a transcript entry does not, and it is the not-expiring that had
 * her still discussing a screenshot the following afternoon.
 */
export function asideContext(asides: Aside[], now: number): string {
  const recent = asides
    .filter(aside => {
      const at = Date.parse(aside.at);
      return Number.isFinite(at) && now - at >= 0 && now - at < ASIDE_CONTEXT_MS;
    })
    .slice(-ASIDE_CONTEXT_LIMIT);
  if (!recent.length) return '';
  const lines = recent.map(aside => {
    const minutes = Math.round((now - Date.parse(aside.at)) / 60_000);
    const when = minutes < 1 ? 'just now' : `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    return `${when}: "${aside.text.replace(/\s+/g, ' ').slice(0, 300)}"`;
  });
  return [
    'You said this to them yourself a moment ago, unprompted. It is not written in the conversation below, but they heard it:',
    lines.join('\n'),
    'If what they have just said is an answer to it, take it as one. If it is not, leave it alone — do not repeat any of it, do not bring it up again, and do not treat it as something they raised.',
  ].join('\n');
}

/** The clock, in the user's zone, because "11:40" is how a log is read back. */
function clock(at: string, timeZone: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(when);
}

/** How many of her recent remarks she is reminded of before writing another. */
const ALREADY_SAID_LIMIT = 6;

/**
 * How far back "I have already said that" reaches.
 *
 * A rolling window rather than the calendar day, and for the reason the chat
 * rolls at five in the morning rather than at midnight: at one o'clock, the
 * thing she must not say twice is what she said at half eleven, and a day key
 * turns over between the two. Half a day is long enough to cover a session and
 * short enough that this morning's remarks are not still being avoided tonight.
 */
export const ALREADY_SAID_MS = 12 * 60 * 60_000;

/**
 * What she has already come out with lately, for the next time she speaks first.
 *
 * Moving these out of the transcript took something with it. "What has already
 * been said today" was the one thing stopping her making the same observation
 * about the same game three times in an afternoon, and with her half of it gone
 * she had no way to know she had said anything at all.
 *
 * So they come back, but only here — on the paths where she is composing another
 * unprompted line, which is the only place the answer to "have I already said
 * this" changes what she writes. A reply to something they typed does not need
 * it, and is measurably worse for having it.
 */
export function alreadySaidRecently(asides: Aside[], timeZone: string, now: number, limit = ALREADY_SAID_LIMIT): string {
  const said = asides
    .filter(aside => {
      const at = Date.parse(aside.at);
      return Number.isFinite(at) && now - at >= 0 && now - at < ALREADY_SAID_MS;
    })
    .slice(-limit);
  if (!said.length) return '';
  const lines = said.map(aside => `${clock(aside.at, timeZone)} — "${aside.text.replace(/\s+/g, ' ').slice(0, 200)}"`);
  return [
    'You have already said these, off your own back. They are not in the conversation because nobody said them to you — they were remarks, and they went unanswered:',
    lines.join('\n'),
    'Do not make any of these points again, and do not open on a subject you have already remarked on.',
  ].join('\n');
}
