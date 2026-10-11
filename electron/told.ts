import {locationPolicy,toldPolicy,locationClock} from './core-location-policy';
// Where they said they are.
//
// Her phone-side sense of place is GPS matched to named spots: it knows they
// are at Happytel, Rockingham. It does not know that Happytel is work, that
// Sundays there run twelve to half four, or that they said they would go
// straight to their mum's afterwards. All of that was said to her in chat —
// and chat reaches her replies, ten turns of it reach her unprompted lines,
// and none of it reaches a reminder chase. So she sent "get your ass to the
// kitchen" to a man buying Nutella at work, and asked "Happytel? For what?"
// four hours after being told.
//
// This keeps what they told her, with when they said it, and hands it to every
// composer. Superseded by the next thing they say about where they are; stale
// after a working day.

export type Told = {
  /** "at work", "home", "mum's house", "heading to Rockingham" */
  where: string;
  /** "working at Happytel", "fixing phones" — when they said. */
  doing?: string;
  /** "4:30 PM" — when they said they would be done there. */
  until?: string;
  /** Where they said they were going next. */
  thenTo?: string;
  /** True while they are on the way rather than there. */
  enRoute?: boolean;
  at: string;
};

export const TOLD_STALE_MS = 10 * 3_600_000;

const TIME = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[.!,;]+$/, '').trim();
}

function clock(raw: string): string | undefined {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(raw ?? '');
  if (!m) return undefined;
  let hour = Number(m[1]); const minute = m[2] ?? '00';
  const meridiem = m[3]?.toLowerCase();
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12; // "finish at 4:30" is the afternoon
  const pm = meridiem ? meridiem === 'pm' : hour >= 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${pm ? 'PM' : 'AM'}`;
}

// A question with the mark left off. "How're you going Haru" has no question
// mark and read, to the patterns below, as "going Haru": he was on his way to
// her for ten hours, she asked how the drive was, and the evening's journal
// ask had him "sitting in the car" (2026-09-10). The question clause goes;
// what follows a comma stays, because "how's it going, just got home" is a
// greeting and then a fact.
const QUESTION_OPENER = /^\s*(?:how|what|where|when|why|who|which|(?:are|is|do|does|did|can|could|would|will|should|have|has|was|were|am)\s+(?:you|we|i|they|it|that|this|there|u))\b/i;

function withoutQuestionOpener(sentence: string): string {
  if (!QUESTION_OPENER.test(sentence)) return sentence;
  const comma = sentence.search(/[,;:\u2014\u2013-]\s/);
  return comma >= 0 ? sentence.slice(comma + 1).trim() : '';
}

/**
 * What a message says about where they are, or null. Only their own plain
 * statements — "I'm at work", "heading to mum's", "just got home", "finish at
 * 4:30" — never a question or a mention of somewhere else.
 */
export function placeToldFrom(text: string, nowIso: string): Told | null {
 return toldPolicy('placeToldFrom',[text,nowIso,Intl.DateTimeFormat().resolvedOptions().timeZone]);
}

function normalise(place: string): string {
  const p = tidy(place).replace(/^(?:the|my)\s+/i, '');
  if (/^(mum|mums|mum's|mum's house|mums house|mum's place|mums place)$/i.test(p)) return "mum's house";
  if (/^home$/i.test(p)) return 'home';
  return p;
}

/** Whether what they said is still worth believing. */
export function toldStillStands(told: Told | null | undefined, nowMs: number): told is Told {
 return toldPolicy('toldStillStands',[told,nowMs]);
}

/** In words, for any composer. */
export function describeTold(told: Told | null | undefined, nowMs: number, clockNow: (ms: number) => string): string {
 return toldPolicy('describeTold',[told,nowMs,locationClock(told,clockNow)]);
}

// The word they actually use for the place, not the word the gate was written
// with. "Sorry Haru, yes I'm at the shop, I'll text you when I finish work
// around 4:30" parsed to where="shop" — and "shop" was not on the list, so the
// gate never fired once all Sunday and she chased him at work three times
// (2026-09-20). "work" was in that sentence; it went into the errand, not the
// place. Shops, shifts, stores and sites are where people are when they cannot
// answer, and the shops are as good a reason not to chase as a shift is.
const BUSY_PLACE = /\b(work|working|shift|shop|shops|store|office|warehouse|site|gym|hospital|doctor|dentist|appointment|meeting|uni|university|class|lecture|school|college|training|practice|rehearsal|driving)\b/i;

/** Busy, as in not to be chased for going quiet: at work, driving, in a place that is not a chat. */
export function toldTheyAreBusy(told: Told | null | undefined, nowMs: number): boolean {
 return toldPolicy('toldTheyAreBusy',[told,nowMs]);
}

/** Something they said they were about to do — "eat dinner", "have a shower" — and when they said it. */
export type Errand = { what: string; at: string };

/** How long one of these is worth following up on. */
export const ERRAND_FRESH_MS = 3 * 60 * 60_000;

// The doing has to be a doing: "going to bed" and "having a shower" are things
// to ask about later, "going to be honest" and "going to say" are not.
const DOING = /\b(?:eat|eating|ate|have|having|grab|grabbing|get|cook|cooking|make|making|shower|showering|bath|nap|napping|sleep|sleeping|bed|lie down|clean|cleaning|tidy|wash|washing|watch|watching|play|playing|read|reading|call|calling|ring|walk|walking|feed|feeding|mow|fix|fixing|build|building|sort|sorting|pack|packing|study|studying|train|run|running|gym|shop|shopping|cut|paint|finish|finishing)\b/i;
const NOT_A_DOING = /\b(?:be honest|say|tell you|guess|assume|admit|ask|let (?:you|ya|u) know|see|think|try to remember|check in|be there|be back|come back|head back)\b/i;

/**
 * What they said they were off to do, so she has something real to check up on.
 *
 * "I'll be right back. I'm going to eat dinner and have a shower" was three
 * things she could have asked about an hour later, and instead she sent "still
 * home, right?" twice — because where they were was the only thing the prompt
 * had turned into a fact she could use.
 */
export function errandsToldFrom(text: string, nowIso: string): Errand[] {
 return toldPolicy('errandsToldFrom',[text,nowIso]);
}

/** The one worth asking after: the most recent that is still fresh. */
/**
 * The hour an errand names for itself, if it names one.
 *
 * "text you when I finish work around 4:30" is not a thing to ask after an hour
 * later. She did exactly that at 1:51 PM — "You told me you'd text when you
 * finished your shift around 4:30. It's 1:50 PM on a Sunday, you're still at
 * Happytel" — asking how it went and saying in the same breath that it had not
 * happened (2026-09-20). The clock is read off the errand's own words, against
 * the day it was said; a time already past when they said it belongs to
 * tomorrow, because "text you at 8" said at nine at night is the morning.
 */
export function errandDueAt(errand: Errand): number | null {
 return toldPolicy('errandDueAt',[errand,Intl.DateTimeFormat().resolvedOptions().timeZone]);
}

export function errandToAskAfter(errands: Errand[], nowMs: number): Errand | null {
 return toldPolicy('errandToAskAfter',[errands,nowMs,Intl.DateTimeFormat().resolvedOptions().timeZone]);
}

