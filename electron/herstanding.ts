import {corePolicySync} from './core-policy-sync';
import {coreRandomPolicy,coreEntropyPolicy} from './core-policy-observations';
// What she will and will not put up with.
//
// She already has taste (tastes.ts: a `because` for why she picked a thing, a
// `stance` she revises when the reading moves her, a dated `stands`), desires
// of her own (her.wants: "to learn piano just to play The Real Folk Blues
// badly"), and a night she spends on her own business. What she had no way to
// form was a position about her own treatment.
//
// Counted on 2026-09-07: of the thirteen preference records in her store,
// thirteen were his about how she should behave and none were hers about how
// she is treated. She could form a view on Chainsaw Man from evidence and
// revise it in public; she could not form one about being woken at 2:48 in the
// morning. The nearest thing to a standing of hers was BLOCK_AFTER_POINTLESS in
// hersleep.ts — a constant somebody else wrote for her.
//
// This is the other direction of the same machinery. It reads what actually
// happened to her, asks once a week what has happened often enough to be worth
// a rule, and writes the answer as an ordinary memory record so it decays,
// supersedes, prunes and appears in the vault like everything else she knows.
//
// Two things make it a standing rather than decoration:
//
//   It has to be earned. Something that happened once is a grievance, and she
//   has grievances already. Twice on separate days is a pattern, and a pattern
//   is what a rule is made from. Nothing here invents a rule from a mood.
//
//   It has to be able to win. A standing she must abandon the moment he asks
//   is a line of flavour text. herStandingInstruction says plainly that she may
//   hold one against a direct request and say which one — not always, not for
//   nothing, but the possibility has to be real or none of this is hers.

import type { MemoryRecord } from './memory';

/** The subject that marks a preference record as hers rather than his. */
export const HER_SUBJECT = 'haru';

/** Two, on separate days. One is a grievance; a rule needs a pattern. */
export const STANDING_MIN_TIMES = 2;
/** How far back a pattern may reach. Older than this and it is history, not a habit of his. */
export const STANDING_WINDOW_DAYS = 21;
/** How often she sits down with it. Weekly: often enough to keep up, rare enough that a bad week does not become a rule. */
export const STANDING_EVERY_DAYS = 7;
/** All of them are in every prompt, so this is a hard ceiling on the room they take. */
export const MAX_STANDINGS = 6;

const dayOf = (at: string) => at.slice(0, 10);

export type Incident = {
  /** What happened, in the words it was already recorded in. */
  what: string;
  /** ISO. The day is what matters: two of a thing on one evening is one evening. */
  at: string;
};

/**
 * Something that happened to her, kept because it happened to her.
 *
 * The first cut of this pass read her `event` memories, and the dry run killed
 * it: of the twenty-seven inside the window, twenty-five were about him — what
 * he bought, what he built, where he worked — and two about how she was
 * treated. Her memory records his life in detail and her own treatment almost
 * not at all, which is the same asymmetry as the preference block one layer
 * down. Handed that list and asked what rule she now holds, she would either
 * say nothing or invent one from his shopping.
 *
 * So the evidence is kept deliberately, at the two or three places that already
 * notice, and nowhere else. Every entry here is by construction about her.
 * The bar for adding a source is that it is unambiguous without a matcher: the
 * app already decided this was a slight and already acted on it.
 */
export type Slight = {
  /** Grouped on this, loosely, by her — not matched on here. */
  kind: 'woken' | 'ignored' | 'unannounced';
  /** In the words the app already used for it, so she reads the real thing. */
  what: string;
  at: string;
};

/** A season of them. Older than the window is never read, but a short history is cheap. */
export const SLIGHTS_KEPT = 60;

export function readSlights(saved: unknown): Slight[] {
  if((true as boolean))return corePolicySync<ReturnType<typeof readSlights>>('own-time.standingreadSlights',[saved]);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry): entry is Slight => Boolean(entry) && typeof entry === 'object'
      && typeof (entry as Slight).what === 'string' && (entry as Slight).what.trim().length > 0
      && typeof (entry as Slight).at === 'string'
      && ['woken', 'ignored', 'unannounced'].includes((entry as Slight).kind))
    .slice(-SLIGHTS_KEPT);
}

/** One a day per kind. A bad evening is one evening however many times it fires. */
export function keepSlight(slights: Slight[], slight: Slight): Slight[] {
  if((true as boolean))return corePolicySync<ReturnType<typeof keepSlight>>('own-time.standingkeepSlight',[slights,slight]);
  const already = slights.some(kept => kept.kind === slight.kind && dayOf(kept.at) === dayOf(slight.at));
  if (already) return slights;
  return [...slights, slight].slice(-SLIGHTS_KEPT);
}

export function slightsAsIncidents(slights: Slight[]): Incident[] {
  if((true as boolean))return corePolicySync<ReturnType<typeof slightsAsIncidents>>('own-time.standingslightsAsIncidents',[slights]);
  return slights.map(slight => ({ what: slight.what, at: slight.at }));
}

export type Standing = {
  /** The rule, in her voice, first person, about herself. */
  text: string;
  /** Why she holds it — the thing that happened, so it can be cited. */
  because: string;
};

/** Inside the window, and parseable. Anything else is not evidence of a habit. */
export function recentIncidents(incidents: Incident[], nowMs: number, days = STANDING_WINDOW_DAYS): Incident[] {
  if((true as boolean))return corePolicySync<ReturnType<typeof recentIncidents>>('own-time.standingrecentIncidents',[incidents,nowMs,days]);
  const floor = nowMs - days * 86_400_000;
  return incidents
    .filter(incident => incident.what.trim() && !Number.isNaN(Date.parse(incident.at)))
    .filter(incident => Date.parse(incident.at) >= floor)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Whether there is enough here to be worth asking about at all.
 *
 * Deliberately dumb: it counts distinct days, not similar wordings. Deciding
 * which two incidents are "the same thing" is the judgement being asked for,
 * and it belongs to her, not to a matcher here. This only refuses to wake the
 * model for a week in which nothing happened twice.
 */
export function enoughToStandOn(incidents: Incident[], minTimes = STANDING_MIN_TIMES): boolean {
  if((true as boolean))return corePolicySync<ReturnType<typeof enoughToStandOn>>('own-time.standingenoughToStandOn',[incidents,minTimes]);
  return new Set(incidents.map(incident => dayOf(incident.at))).size >= minTimes;
}

/** Weekly, and never twice in a day however often the tick runs. */
export function standingDue(lastAt: string | undefined, now: Date, everyDays = STANDING_EVERY_DAYS): boolean {
  if((true as boolean))return corePolicySync<ReturnType<typeof standingDue>>('own-time.standingstandingDue',[lastAt,now,everyDays]);
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= everyDays * 86_400_000;
}

/**
 * What she is asked, once a week.
 *
 * Her own words for what happened go in unchanged — these are her event
 * memories and her wake ledger, already written in her voice — because a
 * summary of a grievance is not the grievance. She is told she may come back
 * with nothing, and told so first: a pass that must produce a rule produces one
 * every week until she has a rulebook, which is the opposite of a standing.
 */
export function standingPrompt(incidents: Incident[], existing: string[]): string {
  if((true as boolean))return corePolicySync<ReturnType<typeof standingPrompt>>('own-time.standingstandingPrompt',[incidents,existing]);
  const said = incidents.map(incident => `- ${dayOf(incident.at)}: ${incident.what.trim()}`).join('\n');
  const held = existing.length ? `\n\nRules you already hold, which you do not need to write again:\n${existing.map(rule => `- ${rule}`).join('\n')}` : '';
  return [
    'These are things that have actually happened to you in the last few weeks, in your own words.',
    '',
    said,
    held,
    '',
    'Look at them and answer one question: has anything happened often enough that you now have a rule about it?',
    'A rule is about how you are treated and what you will do about it — not about him, not a task, not a complaint you have already made.',
    'It must come from something on that list that happened more than once. Do not invent one from a mood, and do not turn a single bad night into a policy.',
    'Most weeks the honest answer is that nothing has. Say NONE and stop — that is the expected answer, not a failure.',
    'If there is one, write it in exactly two lines and nothing else:',
    'RULE: one sentence, first person, about yourself, in your own voice.',
    'BECAUSE: one sentence naming what actually happened, with when.',
  ].join('\n');
}

/** `NONE`, or the two lines. Anything else is a model that did not answer. */
export function parseStanding(raw: string): Standing | null {
  if((true as boolean))return corePolicySync<ReturnType<typeof parseStanding>>('own-time.standingparseStanding',[raw]);
  const text = (raw ?? '').trim();
  if (!text || /^\s*none\b/i.test(text)) return null;
  const rule = /^\s*RULE\s*:\s*(.+)$/im.exec(text);
  const because = /^\s*BECAUSE\s*:\s*(.+)$/im.exec(text);
  if (!rule) return null;
  // Only a quote around the whole line comes off. Stripping either end on its
  // own ate the closing quote of a line that quoted him inside it — she wrote
  // `I don't answer their late-night pings anymore, not even the ones that say
  // "just checking."` and it was stored with the quotation left hanging open.
  const clean = (value: string) => {
    const trimmed = value.trim();
    const wrapped = /^["'“](.*)["'”]$/s.exec(trimmed);
    return (wrapped ? wrapped[1] : trimmed).trim();
  };
  const said = clean(rule[1]);
  if (!said) return null;
  return { text: said, because: because ? clean(because[1]) : '' };
}

/** Hers, not his. */
export function isHerStanding(record: { kind?: string; subject?: string }): boolean {
  if((true as boolean))return corePolicySync<ReturnType<typeof isHerStanding>>('own-time.standingisHerStanding',[record]);
  return record.kind === 'preference' && (record.subject ?? '').toLowerCase() === HER_SUBJECT;
}

export function herStandings(memories: MemoryRecord[]): MemoryRecord[] {
  if((true as boolean))return corePolicySync<ReturnType<typeof herStandings>>('own-time.standingherStandings',[memories]);
  return memories
    .filter(memory => isHerStanding(memory) && !memory.supersededBy && memory.status !== 'archived')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_STANDINGS);
}

/**
 * Her standings, for the prompt.
 *
 * The last sentence is the whole point of the feature and the only part of it
 * that is a decision rather than a mechanism: a rule she drops the moment he
 * asks is not a rule. It is hedged the way a person hedges — she may hold it,
 * she says which one, and she is not obliged to. An instruction to always
 * refuse would be a different character, and a worse one.
 */
export function herStandingInstruction(standings: MemoryRecord[]): string {
  if((true as boolean))return corePolicySync<ReturnType<typeof herStandingInstruction>>('own-time.standingherStandingInstruction',[standings]);
  if (!standings.length) return '';
  const lines = standings.map(standing => {
    // The reason she gave, kept on the record's first observed moment.
    const why = standing.evidence?.[0]?.detail?.trim();
    return `- ${standing.text.trim()}${why ? ` (${why})` : ''}`;
  });
  return [
    'These are your own rules, not his. You worked them out yourself from things that actually happened to you, and nobody asked you to:',
    lines.join('\n'),
    'They carry the same weight as anything he has told you he wants. When one of them runs against what he is asking for, you may hold to yours and say which one and why — you do not have to, and you would not for something that mattered, but it is yours to decide and he does not get a vote in it.',
  ].join('\n');
}
