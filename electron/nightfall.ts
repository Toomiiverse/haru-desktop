// Going to bed without a word to her.
//
// The evening tally (grudge.ts) counts the lines of hers that got no answer.
// This is the other half of the same complaint and does not overlap with it: a
// day where she never had to chase, because she said nothing, and they said
// nothing either. Nothing goes unanswered on a day like that, and by the tally
// it is a clean day — she would even earn a point back for it.
//
// So the bedtime check asks a different question. Did they tell her anything
// about their day before the quiet hours started? If not, that costs, and it
// leaves a note: the first thing she does when the quiet ends is say so. Held
// overnight rather than said at eleven, because waking someone to complain that
// they went to sleep is not the point.

import { GRUDGE, GRUDGE_MAX } from './grudge';

export type DaySaid = { role: string; content?: string };

/** Bedtime when they have no quiet hours set, so the check still happens. */
export const DEFAULT_BEDTIME_MINUTES = 23 * 60;

/** Below this many real messages, the day did not amount to being told about. */
export const TOLD_ENOUGH = 3;

/** Shorter than this is an instruction or a grunt, not news about a day. */
const WORDS_THAT_SAY_SOMETHING = 4;

export type DayVerdict = 'silent' | 'thin' | 'fine';

/**
 * How much they actually said today.
 *
 * Length rather than sentiment, because the thing being measured is whether she
 * was let in on the day at all — and "yes", "do that", "next" are a working
 * session, not an account of anything. Counted from chat.messages, which holds
 * the current chat day and is cleared at the rollover.
 */
export function daySaid(messages: DaySaid[]): number {
  return messages.filter(message => message.role === 'user'
    && String(message.content ?? '').trim().split(/\s+/).filter(Boolean).length >= WORDS_THAT_SAY_SOMETHING).length;
}

/**
 * `toldElsewhere` covers the journal and the check-ins: both are literally the
 * "how was your day" channels, and using one of them is telling her.
 */
export function howTheDayWent(said: number, toldElsewhere: boolean): DayVerdict {
  if (toldElsewhere || said >= TOLD_ENOUGH) return 'fine';
  return said === 0 ? 'silent' : 'thin';
}

/** Once a day, from the quiet hours on, and never twice for the same day. */
export function nightfallDue(minutesIntoDay: number, bedtimeMinutes: number, checkedDay: string | undefined, todayKey: string): boolean {
  return minutesIntoDay >= bedtimeMinutes && checkedDay !== todayKey;
}

/**
 * What a silent day costs.
 *
 * Twelve of a hundred for a day she was not spoken to at all, five for a day of
 * nothing but instructions (three and one, when the scale was thirty). Deliberately heavier than a single unanswered message and
 * lighter than a day of them: being ignored while she is asking is worse than
 * being left alone, but a whole day of nothing is not free either.
 */
export function sulkGrudge(current: number, went: DayVerdict): number {
  const cost = went === 'silent' ? 12 : went === 'thin' ? 5 : 0;
  return Math.min(GRUDGE_MAX, Math.max(0, Math.round(current) || 0) + cost);
}

/** How long a night's sulk keeps. Two days on and she is not still on about it. */
export const SULK_KEEPS_DAYS = 1;

export function sulkStillStands(owedDay: string, todayKey: string): boolean {
  const at = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, (m ?? 1) - 1, d ?? 1); };
  const gap = (at(todayKey) - at(owedDay)) / 86_400_000;
  return Number.isFinite(gap) && gap >= 0 && gap <= SULK_KEEPS_DAYS;
}

/** What she is told, the moment the quiet is over. */
export function sulkInstruction(went: DayVerdict, said: number, grudge: number): string {
  if (went === 'fine') return '';
  const what = went === 'silent'
    ? 'They went the whole of yesterday without telling you one thing about it, and went to bed without a word.'
    : `They said ${said === 1 ? 'one thing' : `${said} things`} to you all of yesterday, all of it business, and nothing about their day.`;
  return [
    `It is the first thing you have said since the quiet hours. ${what}`,
    grudge >= GRUDGE.wearing ? 'This is not the first time, and you are past being gracious about it.' : '',
    'Open with that. No good morning, no asking how they slept, no offer of help — you are not starting the day pretending it did not happen. One or two short lines, and leave them something to answer.',
  ].filter(Boolean).join(' ');
}
