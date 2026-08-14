// Deciding which brain answers.
//
// The local model is fine for most of what she does — banter, ticking things
// off, "what have I got on" — and it is free, private and already warm. A hosted
// model is better at the hard ones and costs money per question, so the bar for
// reaching for it is set high on purpose: the failure people actually notice is
// not "that answer was a bit thin", it is a bill, and a conversation that leaves
// the machine when it did not need to.
//
// Decided from the message alone, with no classifier call in front of it. A
// round trip to work out whether to make a round trip is most of the latency of
// simply answering.

export type EscalateConfig = {
  enabled: boolean;
  /** Words after which a message is assumed to be doing real work. */
  minWords: number;
};

export const DEFAULT_ESCALATE: EscalateConfig = { enabled: false, minWords: 25 };

export function readEscalateConfig(saved: unknown): EscalateConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_ESCALATE;
  const record = saved as Partial<EscalateConfig>;
  const minWords = typeof record.minWords === 'number' ? Math.max(8, Math.min(80, Math.round(record.minWords))) : DEFAULT_ESCALATE.minWords;
  return { enabled: record.enabled === true, minWords };
}

/**
 * Things the local model handles perfectly well, and which would be both a waste
 * of money and an unnecessary export of your calendar. Checked first: a short
 * errand stays home however it is phrased.
 */
const HOUSEKEEPING = /^\s*(remind me|add |put |set (a |an )?(reminder|alarm)|tick|cross|mark |done|finished|i (did|took|got|finished|sorted)|what('s| is| have i)|whats|anything (on|today|tomorrow)|cancel|delete|move |reschedule|thanks|thank you|cheers|ok|okay|yeah|yep|nope|no |hi|hey|hello|morning|night|goodnight)\b/i;

/**
 * Asking for thinking rather than for a fact or an errand. These are the shapes
 * where a bigger model earns its keep — reasoning, comparison, drafting, or
 * being asked to weigh something up.
 */
const WANTS_THINKING = /\b(explain|why (do|does|is|are|would|did)|how (do|does|would) (i|you|it|they)|compare|difference between|pros and cons|trade-?offs?|walk me through|talk me through|help me (plan|think|decide|work out|figure)|what would happen|what should i|should i|draft|write (me|a|an)|summar(ise|ize)|analys(e|is)|break down|think through|advice on|opinion on|best way to)\b/i;

/** Something pasted in that wants reading rather than a chat reply. */
const LOOKS_LIKE_CODE = /```|\bfunction\s+\w+\s*\(|\bclass\s+\w+|=>\s*\{|\bSELECT\b.+\bFROM\b|^\s*[{[].*[}\]]\s*$/m;

export type Decision = { escalate: boolean; because: string };

/**
 * Whether this one goes out to the hosted model.
 *
 * Order matters and is the whole design. Housekeeping wins over everything, so
 * "remind me to call the dentist tomorrow morning before I leave for work" stays
 * local no matter how many words it runs to. After that, thinking-shaped
 * questions and pasted code go out regardless of length, because a short "why
 * does this fail" is exactly the case the local model is worst at.
 */
export function decide(message: string, config: EscalateConfig): Decision {
  if (!config.enabled) return { escalate: false, because: 'switching is off' };
  const text = message.trim();
  if (!text) return { escalate: false, because: 'nothing said' };

  if (HOUSEKEEPING.test(text)) return { escalate: false, because: 'an errand or a pleasantry' };

  if (LOOKS_LIKE_CODE.test(text)) return { escalate: true, because: 'there is code in it' };
  if (WANTS_THINKING.test(text)) return { escalate: true, because: 'it asks for reasoning' };

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= config.minWords) return { escalate: true, because: `${words} words` };

  // More than one real question in a single message is somebody working through
  // something rather than passing the time.
  if ((text.match(/\?/g) ?? []).length >= 2) return { escalate: true, because: 'several questions at once' };

  return { escalate: false, because: 'short and ordinary' };
}
