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
 if(process.env.HARU_CORE_LOCATION_POLICY==='on')return toldPolicy('placeToldFrom',[text,nowIso,Intl.DateTimeFormat().resolvedOptions().timeZone]);
  // Sentence by sentence: "Leaving for the store now. How's the traffic?" is a
  // statement followed by a question, and the statement is the part that says
  // where they are. Only the questions are dropped.
  const said = (text ?? '').replace(/[‘’]/g, "'").split(/(?<=[.!?])\s+/).filter(part => !/\?\s*$/.test(part.trim())).map(withoutQuestionOpener).filter(Boolean).join(' ');
  const whole = tidy(said);
  if (!whole || whole.length > 300) return null;
  // "…then heading to mum's" is where they are going next, not where they are:
  // the tail is read for that and kept away from the current-place patterns.
  const split = /\b(?:and )?(?:then|after(?: that| work| this)?|straight after(?: work)?|afterwards)\b/i.exec(whole);
  const head = split ? whole.slice(0, split.index) : whole;
  const tail = split ? whole.slice(split.index + split[0].length) : '';
  // The patterns run case-insensitively so "heading" and "Heading" both
  // match, which also lets [A-Z] match "about". A captured place has to be a
  // proper noun in the original, or one of the plain places she knows.
  const KNOWN = /^(?:home|(?:my )?mum'?s?(?: house| place)?|(?:my )?(?:dad|nan|gran|grandma|grandpa|sister|brother|mate|friend)'?s?(?: house| place)?|the (?:gym|shops?|store|mall|servo|office|airport|hospital|doctor'?s?|dentist|uni|library|beach|park|pub|bar)|work)$/i;
  const proper = (m: RegExpExecArray | null) => (m && (/^[A-Z]/.test(m[1]) || KNOWN.test(m[1])) ? m : null);
  const lower = head.toLowerCase();
  let told: Told | null = null;

  const PLACE = "(home|(?:my )?mum'?s?(?: house| place)?|(?:my )?(?:dad|nan|gran|grandma|grandpa|sister|brother|mate|friend)'?s?(?: house| place)?|the (?:gym|shops?|store|mall|servo|office|airport|hospital|doctor'?s?|dentist|uni|library|beach|park|pub|bar)|[A-Z][\\w']+(?:\\s+[A-Z][\\w']+){0,3})";
  const arrived = proper(new RegExp(`\\b(?:i(?:'ve| have)? ?(?:just )?(?:arrived|got|made it)(?: at| to| in| here at)?|(?:i'm|im|i am) (?:now )?(?:at|in))\\s+${PLACE}\\b`, 'i').exec(head));
  // "going Haru" is not going anywhere. Without a "to" the place has to be one
  // of the plain ones she knows by name — "heading home", "going mums" — because
  // a bare capitalised word after "going" is as likely a name being addressed
  // as a destination, and her own was read as one (2026-09-10).
  const headingMatch = new RegExp(`\\b(?:heading|on (?:my|the) way|going|off|driving|walking|leaving|left|setting off|about to (?:go|head|leave|drive))\\s+(?:(to|for|over to|down to|up to|back to)\\s+)?${PLACE}\\b`, 'i').exec(head);
  const heading = headingMatch && (headingMatch[1] || KNOWN.test(headingMatch[2])) && (/^[A-Z]/.test(headingMatch[2]) || KNOWN.test(headingMatch[2])) ? headingMatch[2] : null;
  const working = proper(/\b(?:work(?:s|ing)?(?: here)? (?:at|in|for)|at work (?:at|in))\s+((?:[A-Z][\w']+)(?:\s+[A-Z][\w']+){0,3}|home)\b/i.exec(head));
  const atWork = /\b(?:i'?m|i am)\s+(?:now\s+)?(?:at|in)\s+work\b|\bat work(?: now)?\b|\bi'?m working\b|\bworking now\b/i.test(head);
  const home = /\b(?:i'?m|i am|i've|i have|just)\s+(?:got |gotten |now |back )?(?:home|at home|back home)\b/i.test(lower) || /^home( now)?$/i.test(head);

  if (heading) told = { where: normalise(heading), enRoute: true, at: nowIso };
  if (arrived && !/^work$/i.test(arrived[1])) told = { where: normalise(arrived[1]), at: nowIso };
  if (home) told = { where: 'home', at: nowIso };
  if (atWork || working) {
    const place = working ? normalise(working[1]) : null;
    // "at work in Rockingham" names the town; "working at Happytel" names the place. The place wins.
    const town = arrived && /^work$/i.test(arrived[1]) ? null : arrived ? normalise(arrived[1]) : null;
    const inTown = proper(/\bat work (?:now )?in\s+([A-Z][\w']+(?:\s+[A-Z][\w']+){0,2})\b/i.exec(head));
    const where = place && place !== 'home' ? `at work (${place})` : inTown ? `at work (${normalise(inTown[1])})` : town ? `at work (${town})` : 'at work';
    told = { where: place === 'home' ? 'at home, working' : where, at: nowIso, ...(place && place !== 'home' ? { doing: `working at ${place}` } : {}) };
  }
  if (!told) {
    const finish = /\b(?:finish(?:ing|ed)?|done|knock off|leaving)(?: work| here)?\s+(?:(?:at|by|around|about)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in\s+(?:about\s+)?\d{1,3}\s*min)/i.exec(head);
    if (!finish) return null;
    told = { where: 'at work', at: nowIso };
  }

  const finish = /\b(?:finish(?:ing|ed)?|done|off|out|leave|leaving|knock off|until|till)(?: work| here)?\s+(?:at|by|around|about)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.exec(head)
    ?? /\bfrom\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.exec(head);
  if (finish && TIME.test(finish[1])) told.until = clock(finish[1]);
  const inMinutes = /\b(?:finish(?:ing)?|done|off|leaving)(?: work| here)?\s+in\s+(?:about\s+)?(\d{1,3})\s*min/i.exec(head);
  if (inMinutes) {
    const at = new Date(Date.parse(nowIso) + Number(inMinutes[1]) * 60_000);
    told.until = clock(`${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`);
  }
  if (tail) {
    // The verbs come off first: left in as an optional prefix, the leftmost
    // match was "heading to mums" as a place name.
    const rest = tail.replace(/^\s*(?:(?:heading|going|go|head|off|straight|back|there|over|down|up|home)\s*)*(?:(?:to|over to)\s+)?/i, '');
    const then = proper(new RegExp(`^${PLACE}\\b`, 'i').exec(rest));
    if (then && normalise(then[1]) !== told.where) told.thenTo = normalise(then[1]);
  }
  const doing = /\b(?:fixing|repairing|building|cleaning|cooking|studying|training|serving|driving|packing)\s+[\w' ]{3,30}?(?=[,.]|$| though| but| and)/i.exec(head);
  if (doing && !told.doing) told.doing = tidy(doing[0]);
  return told;
}

function normalise(place: string): string {
  const p = tidy(place).replace(/^(?:the|my)\s+/i, '');
  if (/^(mum|mums|mum's|mum's house|mums house|mum's place|mums place)$/i.test(p)) return "mum's house";
  if (/^home$/i.test(p)) return 'home';
  return p;
}

/** Whether what they said is still worth believing. */
export function toldStillStands(told: Told | null | undefined, nowMs: number): told is Told {
 if(process.env.HARU_CORE_LOCATION_POLICY==='on')return toldPolicy('toldStillStands',[told,nowMs]);
  if (!told) return false;
  const age = nowMs - Date.parse(told.at);
  return Number.isFinite(age) && age >= 0 && age < TOLD_STALE_MS;
}

/** In words, for any composer. */
export function describeTold(told: Told | null | undefined, nowMs: number, clockNow: (ms: number) => string): string {
 if(process.env.HARU_CORE_LOCATION_POLICY==='on')return toldPolicy('describeTold',[told,nowMs,locationClock(told,clockNow)]);
  if (!toldStillStands(told, nowMs)) return '';
  const minutes = Math.round((nowMs - Date.parse(told.at)) / 60_000);
  const when = minutes < 2 ? 'just now' : minutes < 60 ? `${minutes} minutes ago` : `at ${clockNow(Date.parse(told.at))}`;
  const bits = [`They told you ${when} that they are ${told.enRoute ? `on their way to ${told.where}` : told.where}`];
  if (told.doing) bits.push(`— ${told.doing}`);
  if (told.until) bits.push(`— until about ${told.until}`);
  if (told.thenTo) bits.push(`, then going to ${told.thenTo}`);
  // The example sentence here used to be "still at home?" and she sent exactly
  // that, twice in an hour, as a whole notification. A place they told you
  // about is not a question worth asking again.
  return `${bits.join(' ')}. That is where they are unless they have said otherwise since; do not ask where they are or what they are doing there, and do not tell them to be somewhere else. Refer to the place by name rather than as "here" or "there" — you are not with them — and do not open by asking whether they are still there: they told you, and asking again is not a conversation.`;
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
 if(process.env.HARU_CORE_LOCATION_POLICY==='on')return toldPolicy('toldTheyAreBusy',[told,nowMs]);
  if (!toldStillStands(told, nowMs)) return false;
  if (told.enRoute) return true;
  // Naming the hour they are free is itself the answer: nobody says "until
  // 4:30" about sitting at home with their phone. The clock was already parsed
  // and sitting in `until` unused while she chased him through the shift it
  // described. Home is the exception — "home until 4:30" is not a commitment.
  if (told.until && !/^home$/i.test(told.where)) return true;
  return BUSY_PLACE.test(told.where + ' ' + (told.doing ?? ''));
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
 if(process.env.HARU_CORE_LOCATION_POLICY==='on')return toldPolicy('errandsToldFrom',[text,nowIso]);
  const said = (text ?? '').replace(/[‘’]/g, "'");
  if (!said.trim() || said.length > 300) return [];
  const out: Errand[] = [];
  // The "I" is optional: "gonna go play some Chainsaw Man" is how it is usually typed.
  const opener = /\b(?:(?:i(?:'m| am)?\s+)?(?:just\s+)?(?:gonna|going to|about to|off to)|i'll)\s+([^.!?;]{3,80})/gi;
  for (const match of said.matchAll(opener)) {
    // Commas part them too: "have a shower, back soon" is one errand and a
    // sign-off, and the sign-off has no doing in it to keep it.
    for (const part of match[1].split(/\s+(?:and|then|&)\s+|\s*,\s*/i)) {
      const what = part.trim().replace(/\s+/g, ' ').replace(/[,\s]+$/, '').slice(0, 60);
      if (what.length < 3 || !DOING.test(what) || NOT_A_DOING.test(what)) continue;
      if (out.some(errand => errand.what.toLowerCase() === what.toLowerCase())) continue;
      out.push({ what, at: nowIso });
    }
  }
  return out.slice(0, 3);
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
 if(process.env.HARU_CORE_LOCATION_POLICY==='on')return toldPolicy('errandDueAt',[errand,Intl.DateTimeFormat().resolvedOptions().timeZone]);
  const said = Date.parse(errand.at);
  if (!Number.isFinite(said)) return null;
  const match = /\b(?:at|around|about|by|after)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.exec(errand.what ?? '');
  if (!match || !TIME.test(match[1])) return null;
  const when = clock(match[1]);
  if (!when) return null;
  const parts = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(when);
  if (!parts) return null;
  let hour = Number(parts[1]) % 12;
  if (parts[3] === 'PM') hour += 12;
  const due = new Date(said);
  due.setHours(hour, Number(parts[2]), 0, 0);
  if (due.getTime() < said) due.setDate(due.getDate() + 1);
  return due.getTime();
}

export function errandToAskAfter(errands: Errand[], nowMs: number): Errand | null {
 if(process.env.HARU_CORE_LOCATION_POLICY==='on')return toldPolicy('errandToAskAfter',[errands,nowMs,Intl.DateTimeFormat().resolvedOptions().timeZone]);
  for (let i = errands.length - 1; i >= 0; i--) {
    const at = Date.parse(errands[i].at);
    if (!Number.isFinite(at)) continue;
    // An errand with an hour on it is asked after from that hour, not from when
    // they said it — measured from the saying, "text you around 4:30" said at
    // 12:54 would have gone stale at 3:54 and she could never have asked at all.
    const due = errandDueAt(errands[i]);
    const from = due ?? at;
    if (nowMs < from || nowMs - from > ERRAND_FRESH_MS) continue;
    return errands[i];
  }
  return null;
}

