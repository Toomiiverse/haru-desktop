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

/**
 * What a message says about where they are, or null. Only their own plain
 * statements — "I'm at work", "heading to mum's", "just got home", "finish at
 * 4:30" — never a question or a mention of somewhere else.
 */
export function placeToldFrom(text: string, nowIso: string): Told | null {
  // Sentence by sentence: "Leaving for the store now. How's the traffic?" is a
  // statement followed by a question, and the statement is the part that says
  // where they are. Only the questions are dropped.
  const said = (text ?? '').replace(/[‘’]/g, "'").split(/(?<=[.!?])\s+/).filter(part => !/\?\s*$/.test(part.trim())).join(' ');
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
  const heading = proper(new RegExp(`\\b(?:heading|on (?:my|the) way|going|off|driving|walking|leaving|left|setting off|about to (?:go|head|leave for|drive))\\s+(?:to|for|over to|down to|up to|back to)?\\s*${PLACE}\\b`, 'i').exec(head));
  const working = proper(/\b(?:work(?:s|ing)?(?: here)? (?:at|in|for)|at work (?:at|in))\s+((?:[A-Z][\w']+)(?:\s+[A-Z][\w']+){0,3}|home)\b/i.exec(head));
  const atWork = /\b(?:i'?m|i am)\s+(?:now\s+)?(?:at|in)\s+work\b|\bat work(?: now)?\b|\bi'?m working\b|\bworking now\b/i.test(head);
  const home = /\b(?:i'?m|i am|i've|i have|just)\s+(?:got |gotten |now |back )?(?:home|at home|back home)\b/i.test(lower) || /^home( now)?$/i.test(head);

  if (heading) told = { where: normalise(heading[1]), enRoute: true, at: nowIso };
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
  if (!told) return false;
  const age = nowMs - Date.parse(told.at);
  return Number.isFinite(age) && age >= 0 && age < TOLD_STALE_MS;
}

/** In words, for any composer. */
export function describeTold(told: Told | null | undefined, nowMs: number, clockNow: (ms: number) => string): string {
  if (!toldStillStands(told, nowMs)) return '';
  const minutes = Math.round((nowMs - Date.parse(told.at)) / 60_000);
  const when = minutes < 2 ? 'just now' : minutes < 60 ? `${minutes} minutes ago` : `at ${clockNow(Date.parse(told.at))}`;
  const bits = [`They told you ${when} that they are ${told.enRoute ? `on their way to ${told.where}` : told.where}`];
  if (told.doing) bits.push(`— ${told.doing}`);
  if (told.until) bits.push(`— until about ${told.until}`);
  if (told.thenTo) bits.push(`, then going to ${told.thenTo}`);
  return `${bits.join(' ')}. That is where they are unless they have said otherwise since; do not ask where they are or what they are doing there, and do not tell them to be somewhere else.`;
}

/** Busy, as in not to be chased for going quiet: at work, driving, in a place that is not a chat. */
export function toldTheyAreBusy(told: Told | null | undefined, nowMs: number): boolean {
  if (!toldStillStands(told, nowMs)) return false;
  if (told.enRoute) return true;
  return /\b(work|gym|hospital|doctor|dentist|meeting|uni|class|driving)\b/i.test(told.where + ' ' + (told.doing ?? ''));
}
