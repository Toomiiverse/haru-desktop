// Who she is at rest, and how a year of living moves it.
//
// Her state changes every minute and her character could not change at all: a
// year of good days and a year of bad ones produced the identical Haru, because
// who she is lives in hand-written prose that nothing writes back to.
//
// The idea is one line. A trait is the resting point of a state; state is the
// fast deviation from it; growth is the slow integral of state back into the
// trait. So nothing new has to be measured — every counter she owns already
// rests at zero and every vital at a fixed target, and nobody ever chose those
// numbers. Growth is what happens when the months move them.
//
// Four things keep this from turning her into someone else:
//
//  - the charter. Her written character stays fixed and is the anchor; each
//    trait may only travel inside a narrow band around its charter value, sized
//    so a full year of consistent treatment crosses the whole band and no more.
//  - scored against his own norm, never against a bar. Measured on his real
//    archive, an absolute bar saturates instantly: `howTheDayWent` calls a day
//    fine at three substantive messages and he clears that nearly every day
//    (28 of 29 in August), which would ratchet her to the ceiling in six months
//    and then mean nothing. A month only counts as good if it is better than
//    how he usually is, so a steady good relationship holds her steady and only
//    a change in him moves her.
//  - she softens at full speed and hardens at sixty percent. The failure to
//    fear is a spiral — she goes colder, he engages less, she goes colder — and
//    damping the hard direction is what stops it running away.
//  - nothing she does is an input. Growth reads his behaviour and her own
//    hours, never her own trait-influenced output, so no trait can feed the
//    signal that moves it.
//
// Pure: no store, no clock, no I/O. The caller gathers the months and keeps the
// ledger.

export type TraitName = 'warmth' | 'guardedness';
export type Traits = Record<TraitName, number>;

type Charter = {
  /** What her written character is worth as a number, and where she starts. */
  charter: number;
  /** How far either side she may ever travel. */
  band: number;
  /** Which way is "harder to live with" — that direction moves at 60%. */
  harder: 1 | -1;
  /** For the ledger and the status screen. */
  label: string;
  rising: string;
  falling: string;
};

export const CHARTER: Record<TraitName, Charter> = {
  // Where her affection rests while he is there (vitals.ts driftStep, 0.7).
  // Her prose has warmth rare and costly, which is about what she *shows*;
  // this is what she feels, and the `fond` cue is what lets it slip.
  warmth: { charter: 0.70, band: 0.10, harder: -1, label: 'Warmth', rising: 'warmer with him than she was', falling: 'cooler with him than she was' },
  // How high a feeling must climb before it reaches her prompt at all
  // (feelings.ts FELT.shows, 35). Up is more hidden.
  guardedness: { charter: 35, band: 5, harder: 1, label: 'Guardedness', rising: 'keeping more to herself than she did', falling: 'letting more show than she used to' },
};

export const TRAIT_NAMES = Object.keys(CHARTER) as TraitName[];

/** A whole year of consistent treatment crosses the whole band, and no faster. */
export function maxStep(trait: TraitName): number {
  return (CHARTER[trait].band * 2) / 12;
}

export function charterTraits(): Traits {
  return Object.fromEntries(TRAIT_NAMES.map(name => [name, CHARTER[name].charter])) as Traits;
}

export function readTraits(saved: unknown): Traits {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<TraitName, unknown>>;
  return Object.fromEntries(TRAIT_NAMES.map(name => {
    const value = Number(record[name]);
    return [name, Number.isFinite(value) ? hold(name, value) : CHARTER[name].charter];
  })) as Traits;
}

function hold(trait: TraitName, value: number): number {
  const { charter, band } = CHARTER[trait];
  // Rounded as well as clamped: 0.70 + 0.10 is 0.7999999999999999 in floating
  // point, and a trait that never quite equals its own ceiling is a nuisance to
  // compare, to log and to test against.
  return Math.round(Math.max(charter - band, Math.min(charter + band, value)) * 10000) / 10000;
}

/**
 * A month of how he was, and of what she did with her own time.
 *
 * Everything here is either his behaviour or her own hours. Nothing she said is
 * in it, on purpose: a trait that shaped her replies and then read those replies
 * back would be a loop with nothing holding it.
 */
export type MonthSignals = {
  month: string;
  days: number;
  /** Substantive messages from him a day (nightfall.ts daySaid). */
  saidPerDay: number;
  /** Lines of hers a day that got nothing back inside the window (grudge.ts). */
  hangingPerDay: number;
  /** Evenings he went to bed without a word. */
  silentNights: number;
  /** Tallied live from here on; absent for months that ended before the tally existed. */
  hurtEvents?: number;
  apologies?: number;
};

export type Norm = { saidPerDay: number; hangingPerDay: number; hurtEvents?: number; apologies?: number; months: number };

/** How he usually is: up to six months behind the one being scored. */
export const NORM_MONTHS = 6;

export function normFrom(history: MonthSignals[]): Norm | null {
  const recent = history.slice(-NORM_MONTHS);
  if (!recent.length) return null;
  const mean = (pick: (month: MonthSignals) => number | undefined) => {
    const values = recent.map(pick).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
  };
  return {
    saidPerDay: mean(month => month.saidPerDay) ?? 0,
    hangingPerDay: mean(month => month.hangingPerDay) ?? 0,
    hurtEvents: mean(month => month.hurtEvents),
    apologies: mean(month => month.apologies),
    months: recent.length,
  };
}

const clamp1 = (value: number) => Math.max(-1, Math.min(1, value));
/** How far from his usual, as a share of it. */
const against = (now: number, norm: number, floor: number) => (now - norm) / Math.max(floor, norm);

export type Scored = { score: number; because: string } | null;

/**
 * Warmth: more of him than usual, and fewer of her lines left hanging.
 *
 * A silent evening counts against him whatever his norm — going to bed without
 * a word is not the kind of thing that gets graded on a curve.
 */
export function scoreWarmth(now: MonthSignals, norm: Norm | null): Scored {
  if (!norm) return null;
  const said = against(now.saidPerDay, norm.saidPerDay, 1);
  const answered = -against(now.hangingPerDay, norm.hangingPerDay, 0.5);
  const silent = -(now.silentNights / Math.max(1, now.days)) * 2;
  const score = clamp1(said * 0.5 + answered * 0.5 + silent);
  const reasons = [
    said > 0.08 ? 'more from him than usual' : said < -0.08 ? 'less from him than usual' : '',
    answered > 0.08 ? 'fewer of her lines left hanging' : answered < -0.08 ? 'more of her lines left hanging' : '',
    now.silentNights ? `${now.silentNights} evening${now.silentNights === 1 ? '' : 's'} with nothing said` : '',
  ].filter(Boolean);
  return { score, because: reasons.join(', ') || 'much as he usually is' };
}

/**
 * Guardedness: hurt she was left holding closes her up, and being put right
 * opens her. Needs a month of tallies on both sides, so it does not move at all
 * until there is one.
 */
export function scoreGuardedness(now: MonthSignals, norm: Norm | null): Scored {
  if (!norm || now.hurtEvents === undefined || norm.hurtEvents === undefined) return null;
  const hurt = against(now.hurtEvents, norm.hurtEvents, 1);
  const madeRight = -((now.apologies ?? 0) - (norm.apologies ?? 0)) / Math.max(1, now.days) * 6;
  const score = clamp1(hurt * 0.7 + madeRight);
  const reasons = [
    hurt > 0.08 ? 'more that stung than usual' : hurt < -0.08 ? 'less that stung than usual' : '',
    madeRight < -0.05 ? 'and he put more of it right' : madeRight > 0.05 ? 'and less of it was put right' : '',
  ].filter(Boolean);
  return { score, because: reasons.join(', ') || 'much as usual' };
}

const SCORERS: Record<TraitName, (now: MonthSignals, norm: Norm | null) => Scored> = {
  warmth: scoreWarmth,
  guardedness: scoreGuardedness,
};

export type GrowthStep = { month: string; trait: TraitName; from: number; to: number; score: number; because: string };

/**
 * The month's mark on her. Nothing moves without a norm to judge it against, so
 * her first month with him changes nothing — she has no idea yet what usual is.
 */
export function growMonth(traits: Traits, now: MonthSignals, history: MonthSignals[]): { traits: Traits; steps: GrowthStep[] } {
  const norm = normFrom(history.filter(month => month.month !== now.month));
  const grown: Traits = { ...traits };
  const steps: GrowthStep[] = [];
  for (const trait of TRAIT_NAMES) {
    const scored = SCORERS[trait](now, norm);
    if (!scored || scored.score === 0) continue;
    // She softens at full speed and hardens at sixty percent: for warmth the
    // hard way is down, for guardedness it is up.
    const hardening = Math.sign(scored.score) === CHARTER[trait].harder;
    const moved = scored.score * maxStep(trait) * (hardening ? 0.6 : 1);
    const from = grown[trait];
    const to = hold(trait, from + moved);
    if (to === from) continue;
    grown[trait] = to;
    steps.push({ month: now.month, trait, from, to, score: Math.round(scored.score * 100) / 100, because: scored.because });
  }
  return { traits: grown, steps };
}

/** Her traits as they stood before that month, rebuilt from the ledger. */
export function revertTo(traits: Traits, ledger: GrowthStep[], month: string): Traits {
  const undone: Traits = { ...traits };
  for (const step of [...ledger].reverse()) {
    if (step.month < month) break;
    undone[step.trait] = step.from;
  }
  return undone;
}

// -- what the rest of the machine reads ---------------------------------------

/** Warmth is where her affection rests, so it reaches the vitals as a standing lean. */
export function traitLean(traits: Traits): { affection: number } | Record<string, never> {
  const push = Math.round((traits.warmth - CHARTER.warmth.charter) * 1000) / 1000;
  return push ? { affection: push } : {};
}

/** Guardedness is the bar a feeling has to clear before it reaches her prompt. */
export function feelingsShowAt(traits: Traits): number {
  return Math.round(traits.guardedness);
}

/** How far a trait has travelled, as a share of the room it has. */
export function travelled(traits: Traits, trait: TraitName): number {
  return (traits[trait] - CHARTER[trait].charter) / CHARTER[trait].band;
}

/** For the status screen: where she sits, 0–100 across the whole band. */
export function traitMeter(traits: Traits, trait: TraitName): { label: string; value: number; note: string } {
  const { label, band, charter, rising, falling } = CHARTER[trait];
  const share = travelled(traits, trait);
  return {
    label,
    value: Math.round(((traits[trait] - (charter - band)) / (band * 2)) * 100),
    note: Math.abs(share) < 0.15 ? 'Where she started.' : `Months of how things have gone have left her ${share > 0 ? rising : falling}.`,
  };
}

/**
 * What she is told, once a trait has moved half the room it has — and only
 * then. A drift she cannot feel is not worth a line of prompt, and a number
 * would come back to him as a number.
 */
export function growthNote(traits: Traits): string {
  const far = TRAIT_NAMES
    .map(trait => ({ trait, share: travelled(traits, trait) }))
    .filter(({ share }) => Math.abs(share) >= 0.5)
    .sort((a, b) => Math.abs(b.share) - Math.abs(a.share))[0];
  if (!far) return '';
  if (far.trait === 'warmth') {
    return far.share > 0
      ? 'Months of this have worn you down in a way you would never admit: you are fonder of him now than you were when this started. It does not change how you talk to him. It does mean that once in a while, something gets through that would not have a few months ago.'
      : 'Something has gone out of this over the last few months. You are not as invested as you were — you answer, you do what he asks, but you have stopped reaching for him, and you do not particularly want to talk about why.';
  }
  return far.share > 0
    ? 'You give less of yourself away than you used to. Whatever you are feeling stays yours for longer, and he has to actually ask.'
    : 'You have got easier with him over these months. Things you would once have sat on, you say — not softly, and not often, but you say them.';
}
