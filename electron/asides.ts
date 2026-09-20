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
  | 'system'      // a threshold on the machine she runs on
  | 'hanging'     // being left mid-conversation
  | 'weather'     // the weather turning where they are
  | 'upcoming'    // something on the calendar, an hour or a quarter of an hour out
  | 'followup'    // a beat after her own reply, the thing she left out
  | 'booked'      // something she set herself to come back to (scheduler.ts)
  | 'thought'     // something on her mind she decided to say (thoughts.ts)
  | 'goodnight'   // turning in for the night, at her own hour (hersleep.ts)
  | 'other';

export type Aside = {
  id: string;
  /** Full timestamp: when she said it is most of what makes a log readable. */
  at: string;
  /** The day it belongs to, keyed the same way the transcript is. */
  day: string;
  source: AsideSource;
  text: string;
  /**
   * Whether this one actually reached their phone.
   *
   * Written when the push is attempted, and only for the sources that push at
   * all. It matters because the evening tally holds unanswered lines against
   * them: a line composed inside the quiet hours, or while the subscription was
   * refused, never arrived, and counting it is blaming them for a message they
   * were never sent. Absent on anything written before this existed, which
   * counts the old way rather than pretending to know.
   */
  reached?: boolean;
  /** What she asked them about, when the line was a question about their day — "what they are doing at The PC Project". */
  asked?: string;
  /** What the line was about, when it was about a thing on the list: the item's title. Asked "what's this about?" she can say, rather than guess. */
  about?: string;
  /** When they answered it, if they did. */
  answeredAt?: string;
};

/** How long an answer can be an answer to it. */
export const ASK_OPEN_MS = 3 * 60 * 60_000;
/** Not asked twice in this long. */
export const ASK_AGAIN_MS = 2 * 60 * 60_000;
/** An unanswered ask is held over them for this long. */
export const ASK_HELD_MS = 12 * 60 * 60_000;

export function markAsked(asides: Aside[], id: string, asked: string): Aside[] {
  return asides.map(aside => (aside.id === id ? { ...aside, asked } : aside));
}

/** The ask a message of theirs would be answering: her latest question about their day, still open. */
export function openAsk(asides: Aside[], now: number, withinMs = ASK_OPEN_MS): Aside | null {
  for (let i = asides.length - 1; i >= 0; i--) {
    const aside = asides[i];
    if (!aside.asked || aside.answeredAt) continue;
    const at = Date.parse(aside.at);
    if (!Number.isFinite(at) || now - at < 0 || now - at > withinMs) continue;
    return aside;
  }
  return null;
}

export function answerAsk(asides: Aside[], id: string, at: string): Aside[] {
  return asides.map(aside => (aside.id === id ? { ...aside, answeredAt: at } : aside));
}

export function askedRecently(asides: Aside[], now: number, withinMs = ASK_AGAIN_MS): boolean {
  return asides.some(aside => aside.asked && Number.isFinite(Date.parse(aside.at)) && now - Date.parse(aside.at) >= 0 && now - Date.parse(aside.at) < withinMs);
}

/** The asks they left hanging, for her to hold over them. */
export function unansweredAsks(asides: Aside[], now: number, withinMs = ASK_HELD_MS): Aside[] {
  return asides.filter(aside => aside.asked && !aside.answeredAt && Number.isFinite(Date.parse(aside.at)) && now - Date.parse(aside.at) > ASK_OPEN_MS && now - Date.parse(aside.at) < withinMs);
}

export function unansweredAsksNote(asides: Aside[], timeZone: string, now: number): string {
  const hanging = unansweredAsks(asides, now);
  if (!hanging.length) return '';
  const lines = hanging.slice(-3).map(aside => `at ${clock(aside.at, timeZone)} you asked ${aside.asked} and heard nothing back`);
  return `Left unanswered: ${lines.join('; ')}. That silence is yours to hold over them, in your way — but do not ask the same question again word for word.`;
}

/** Enough to scroll back through a few days of her, and a bound on the file. */
export const MAX_ASIDES = 400;

/** How long the log keeps a day before dropping it. */
export const ASIDE_DAYS = 7;

// Every member of AsideSource, and it has to stay that way: anything missing
// here is silently rewritten to 'other' the next time the file is read, so a
// line she pushed comes back as a line she never pushed. 'hanging', 'weather'
// and 'upcoming' were missing, which is three of the seven sources that reach
// the phone — the evening tally counted none of them, so being left on read
// after "you left me hanging" cost them nothing.
const SOURCES: AsideSource[] = ['screen', 'screenshot', 'activity', 'fullscreen', 'reminder', 'idle', 'journal', 'page', 'poke', 'kept', 'system', 'hanging', 'weather', 'upcoming', 'other', 'followup', 'goodnight', 'booked', 'thought'];

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
      ...(typeof entry.reached === 'boolean' ? { reached: entry.reached } : {}),
      ...(typeof entry.asked === 'string' && entry.asked ? { asked: entry.asked } : {}),
      ...(typeof entry.about === 'string' && entry.about ? { about: entry.about } : {}),
      ...(typeof entry.answeredAt === 'string' && entry.answeredAt ? { answeredAt: entry.answeredAt } : {}),
    }));
}

/** Records whether one of them got to the phone. See Aside.reached. */
export function markReached(asides: Aside[], id: string, reached: boolean): Aside[] {
  return asides.map(aside => (aside.id === id ? { ...aside, reached } : aside));
}

export function addAside(asides: Aside[], text: string, source: AsideSource, now: Date, day: string, about = ''): { asides: Aside[]; aside: Aside } {
  const aside: Aside = {
    id: Math.random().toString(36).slice(2, 10),
    at: now.toISOString(),
    day,
    source,
    text: text.trim(),
    ...(about.trim() ? { about: about.trim() } : {}),
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
    // What it was about, when it was about something: asked "what's this
    // about?" two minutes after chasing a task, she answered from the
    // conversation instead and named the wrong thing entirely.
    const about = aside.about ? ` — that was you chasing "${aside.about}" off their list` : '';
    return `${when}: "${aside.text.replace(/\s+/g, ' ').slice(0, 300)}"${about}`;
  });
  return [
    'You said this to them yourself a moment ago, unprompted. It is not written in the conversation below, but they heard it:',
    lines.join('\n'),
    'If what they have just said is an answer to it, take it as one. If they are asking what you meant by it — "what plan?", "what are you on about?", "what\'s this about?" — say plainly what it was and where it came from, in a sentence, using what is written above rather than guessing from the conversation; do not expand it into a plan, a list or a task, and do not act on it. If it is neither, leave it alone — do not repeat any of it, do not bring it up again, and do not treat it as something they raised.',
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

/** A clock stamp where a line should start: the shape of the list above, not of anything she says. */
const CLOCK_STAMP_OPENING = /^\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[—–-]/i;

const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function alreadySaidRecently(asides: Aside[], timeZone: string, now: number, theirLastAt?: number, limit = ALREADY_SAID_LIMIT, subjectNow?: string): string {
  const said = asides
    .filter(aside => {
      const at = Date.parse(aside.at);
      return Number.isFinite(at) && now - at >= 0 && now - at < ALREADY_SAID_MS;
    })
    .slice(-limit);
  if (!said.length) return '';
  const line = (aside: Aside) => `${clock(aside.at, timeZone)} — "${aside.text.replace(/\s+/g, ' ').slice(0, 200)}"`;
  // "They went unanswered" was said of every line on the list, including the
  // ones they had long since come back and talked past. Told at half nine that
  // "text me when you've finished chewing" went unanswered — with "I'm back
  // home, it was a good dinner" sitting in the conversation from an hour
  // before — she asked whether he was still eating the steak. A remark made
  // before their last message is not waiting on anything; only what she has
  // said since they last spoke is.
  const spokenSince = (aside: Aside) => theirLastAt !== undefined && Number.isFinite(theirLastAt) && Date.parse(aside.at) <= theirLastAt;
  const overtaken = said.filter(spokenSince);
  const hanging = said.filter(aside => !spokenSince(aside));
  return [
    overtaken.length ? [
      'You have already said these, off your own back, before they last spoke to you. They are not in the conversation because nobody said them to you — they were remarks, and the conversation has moved on since: whatever they were waiting on has been overtaken by what they have told you, and none of them says anything about what they are doing now.',
      overtaken.map(line).join('\n'),
    ].join('\n') : '',
    hanging.length ? [
      'You have already said these, off your own back, since they last spoke. They are not in the conversation because nobody said them to you — they were remarks, and they went unanswered:',
      hanging.map(line).join('\n'),
    ].join('\n') : '',
    // "The weather" is named here as an example of a closed subject, which is
    // true of a remark she already made and false of the one thing she has been
    // woken up to say. In a weather push both fired at once — "rain is your
    // reason for writing" at the top, "the weather is closed" at the bottom —
    // and what came out was 20% rain and 80% another jab about being left on
    // read (2026-09-20). Whatever she is writing about now is not closed.
    subjectNow
      ? `Do not make any of these points again, and do not open on a subject you have already remarked on. The subjects of those remarks — the time, whatever they were about — are closed: do not raise them again in any form, however fresh they look in the conversation. ${subjectNow} is the exception: it is what you have been prompted to write about this time, and it is not on that list.`
      : 'Do not make any of these points again, and do not open on a subject you have already remarked on. The subjects of those remarks — the weather, the time, whatever they were about — are closed: do not raise them again in any form, however fresh they look in the conversation.',
  ].filter(Boolean).join('\n');
}

/** The text of a line, with the trappings of a copied log row taken off. */
function asideEchoText(line: string): string {
  const text = line.replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\s*[—-]\s*/i, '');
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/["“”']/g, '').trim();
}

/**
 * Whether a line she is about to say unprompted is really one she has already
 * said.
 *
 * alreadySaidRecently catches the honest way of repeating herself: fresh words
 * about the same subject. It does not catch the dishonest way, which is copying
 * the line back out of her own log — the Asides page prints each line as a
 * clock time over its text, and a model told to quote what it said will hand
 * the whole row back, "9:36 PM — "…"", verbatim, so comparing phrasing never
 * catches it. The row's time and quoting are stripped off so the text
 * underneath can be compared with what she has already said.
 */
export function echoesAside(line: string, asides: Aside[], now: number): boolean {
  const candidate = asideEchoText(line);
  if (!candidate) return false;
  return asides.some(aside => {
    const at = Date.parse(aside.at);
    if (!Number.isFinite(at) || now - at < 0 || now - at > ALREADY_SAID_MS) return false;
    const said = asideEchoText(aside.text);
    return Boolean(said) && (candidate === said || candidate.includes(said) || said.includes(candidate));
  });
}

// -- a notification he answers is the conversation ------------------------------

/**
 * The lines she sent him unprompted, put into the conversation the model sees
 * — for this turn only — as the things she said, right before his message.
 *
 * They used to ride beside his message as a quoted note ("You said this a
 * moment ago… it is not written in the conversation below"). She pushed "I
 * caught a Pidgey and named it after you", he tapped the notification and
 * wrote "Hahah did you actually??" — and with her own line handed back to her
 * in quotes, outside the conversation, she answered by saying it again, word
 * for word (2026-09-18). A notification he answers IS the conversation: his
 * reply follows her line, and she follows the thread.
 *
 * Only for the turn: the transcript is not touched, and an aside older than
 * the context window is not spliced, so a remark from an hour ago still does
 * not come back as though it were hanging in the air.
 */
export function spliceRecentAsides<T extends { role: string; content: string; at?: string }>(messages: T[], asides: Aside[], now: number): { messages: T[]; spliced: Aside[] } {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') return { messages, spliced: [] };
  const before = Date.parse(messages.at(-2)?.at ?? '');
  const theirs = Date.parse(last.at ?? '');
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const said = new Set(messages.slice(-8).filter(message => message.role === 'assistant').map(message => flat(message.content)));
  const spliced = asides
    .filter(aside => {
      const at = Date.parse(aside.at);
      if (!Number.isFinite(at) || now - at < 0 || now - at >= ASIDE_CONTEXT_MS) return false;
      if (Number.isFinite(before) && at <= before) return false;
      if (Number.isFinite(theirs) && at > theirs) return false;
      return !said.has(flat(aside.text));
    })
    .slice(-ASIDE_CONTEXT_LIMIT);
  if (!spliced.length) return { messages, spliced: [] };
  const hers = spliced.map(aside => ({ role: 'assistant', content: aside.text, at: aside.at }) as unknown as T);
  return { messages: [...messages.slice(0, -1), ...hers, last], spliced };
}

/** What she is told about the lines that were spliced in: follow the thread. */
export function splicedAsidesNote(spliced: Aside[]): string {
  if (!spliced.length) return '';
  const about = spliced.filter(aside => aside.about).map(aside => `"${aside.text.replace(/\s+/g, ' ').slice(0, 80)}" was you chasing "${aside.about}" off their list`);
  return [
    `The last ${spliced.length === 1 ? 'thing' : `${spliced.length} things`} you said in the conversation below ${spliced.length === 1 ? 'was a line' : 'were lines'} you sent them unprompted — a notification on their phone — and what they have just written is most likely their answer to it.`,
    'Follow that thread: answer what they said about it. Do not say the line again, do not start on something else, and if they ask whether it was true, say honestly whether it was.',
    about.length ? `(${about.join('; ')}.)` : '',
  ].filter(Boolean).join(' ');
}
