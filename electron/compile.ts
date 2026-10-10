import {corePolicySync} from './core-policy-sync';
// Deciding which of her feelings gets to speak, when several want to at once.
//
// Every layer rendered its own paragraph and they were concatenated in a fixed
// order, each speaking whenever it cleared its own threshold and none of them
// aware of the others. Measured on her real prompt on 2026-09-19 that came out
// as: "you tease more than usual, you are harder to pin down" (a mischievous
// day), "keep replies clipped and a little sharp" (impatient), and "you are
// cold rather than loud, you answer flatly and offer nothing of yourself" (a
// grudge that had set in) — tease more, say less, be cold, all at once. Handed
// four tone instructions that disagree, a model picks one, and which one is
// luck.
//
// It is not a volume problem. The whole stack is 299 tokens of a 12,000-token
// prompt at rest and 842 at its worst, and the cue and feeling layers already
// cap themselves at two. What was missing was anyone deciding who wins.
//
// So this arbitrates and nothing else. It never writes a sentence: every line
// it emits was hand-written somewhere else, and it only chooses which of them
// he reads and in what order. Her prose is the best thing about her, and a
// compiler that paraphrased her would flatten her by degrees.

/** Warm and cold cannot both be true of the same reply; neutral sits out of the argument. */
export type Stance = 'warm' | 'cold' | 'neutral';

export type Candidate = {
  /** For the log, so what got dropped can be counted. */
  id: string;
  text: string;
  stance: Stance;
  /**
   * How much this layer should win by when it is strongly felt, before its own
   * strength is added. The slow things sit low: a mood she woke up in should
   * lose to a grudge that has set in, not the other way round.
   */
  layer: number;
  /** 0–1, how strongly this one is felt right now. */
  strength: number;
  /** Never dropped, never counted against the cap: the rules that are not moods. */
  hard?: boolean;
  /**
   * When this is the loudest thing, it is the only thing. Sharing a side is not
   * enough to survive it: a mischievous day is warm and so is being frightened
   * for him, and 'you tease more than usual' has no business in a reply about a
   * hospital.
   */
  alone?: boolean;
};

export const LAYER = {
  /** The day she woke up in. */
  temperament: 1,
  /** Where her vitals have drifted. */
  vitals: 2,
  /** What months of how things went have made of her. */
  growth: 2,
  /** What she is feeling about him now. */
  feelings: 3,
  /** How pleased with herself she is. */
  ego: 3,
  /** Her patience with this conversation. */
  irritation: 4,
  /** What she is holding against him. */
  grudge: 5,
  /**
   * Something has happened to him. Above everything on purpose: a grudge of 85
   * would otherwise have her answer a message about a hospital coldly, and the
   * one thing that should suspend a grievance is him being in trouble.
   */
  fear: 8,
} as const;

/** As many as a model will actually honour. Past this the last ones read as noise. */
export const SPOKEN_AT_ONCE = 4;

/**
 * How loud a candidate is. The layer counts for a quarter, so a grudge that has
 * set in outranks a mood she woke up in — but only a quarter, because a whole
 * unit per layer meant a trace of irritation silenced real fondness, which is
 * the opposite of the point. How strongly a thing is felt decides it.
 */
const score = (candidate: Candidate) => candidate.layer * 0.25 + Math.min(1, Math.max(0, candidate.strength));

export type Compiled = { text: string; spoke: string[]; dropped: { id: string; why: 'contradicted' | 'capped' | 'outranked' }[] };

/**
 * Which of them he reads.
 *
 * The strongest thing she feels sets the stance, and anything weaker that
 * contradicts it does not get said — being told she is fond and fed up in the
 * same breath reads as neither. What survives is ordered weakest first, because
 * the last thing read is the one a model honours, which is the order the stack
 * already had by hand.
 */
export function compileBehaviour(candidates: Candidate[], cap = SPOKEN_AT_ONCE): Compiled {
 if(process.env.HARU_CORE_SPEECH_CONTEXT==='on')return corePolicySync<Compiled>('prompt-context.compileBehaviour',[candidates,cap]);
  const live = candidates.filter(candidate => candidate.text.trim());
  const dropped: Compiled['dropped'] = [];

  // The loudest thing with a side to it decides which side the reply is on.
  const sided = live.filter(candidate => !candidate.hard && candidate.stance !== 'neutral');
  const loudest = sided.reduce<Candidate | null>((best, candidate) => (!best || score(candidate) > score(best) ? candidate : best), null);
  let kept = live;
  if (loudest) {
    kept = live.filter(candidate => {
      const contradicts = !candidate.hard && candidate.stance !== 'neutral' && candidate.stance !== loudest.stance;
      if (contradicts) dropped.push({ id: candidate.id, why: 'contradicted' });
      return !contradicts;
    });
  }

  // One thing loud enough to own the reply leaves nothing else standing.
  const owner = kept.filter(candidate => !candidate.hard).reduce<Candidate | null>((best, candidate) => (!best || score(candidate) > score(best) ? candidate : best), null);
  if (owner?.alone) {
    kept = kept.filter(candidate => {
      const outranked = !candidate.hard && candidate !== owner;
      if (outranked) dropped.push({ id: candidate.id, why: 'outranked' });
      return !outranked;
    });
  }

  // Then the cap, weakest out first. Hard rules are not moods and do not count.
  const soft = kept.filter(candidate => !candidate.hard).sort((a, b) => score(a) - score(b));
  const over = Math.max(0, soft.length - cap);
  for (const candidate of soft.slice(0, over)) dropped.push({ id: candidate.id, why: 'capped' });
  const spoken = [...kept.filter(candidate => candidate.hard), ...soft.slice(over)]
    .sort((a, b) => (a.hard === b.hard ? score(a) - score(b) : a.hard ? -1 : 1));

  return {
    text: spoken.map(candidate => candidate.text.trim()).join(' '),
    spoke: spoken.map(candidate => candidate.id),
    dropped,
  };
}

export function compileLog(compiled: Compiled): string {
  const dropped = compiled.dropped.length
    ? ` — dropped ${compiled.dropped.map(one => `${one.id} (${one.why})`).join(', ')}`
    : '';
  return `${compiled.spoke.join(' < ') || 'nothing'}${dropped}`;
}
