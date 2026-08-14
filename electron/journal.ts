// The journal.
//
// One entry a day, written either because she asked or because you sat down and
// wrote it. Kept apart from her memory on purpose: memories are things she knows
// about you and reads back into every conversation, whereas this is yours. She
// can be told to look at it; she does not carry it around.
//
// The ratings are self-report, the way a paper mood diary is — a number you pick
// because it feels right today. They are not a screening test and nothing here
// scores or interprets them. What makes them worth keeping is the shape over
// weeks, which is exactly the thing that is impossible to recall accurately and
// genuinely useful to put in front of someone you see once a month.

/** 0–10, the scale people already use out loud: "about a four today". */
export const SCALE_MAX = 10;

export type JournalEntry = {
  id: string;
  /** YYYY-MM-DD. One entry per day — a second save on the same day edits it. */
  date: string;
  createdAt: string;
  updatedAt?: string;
  text: string;
  mood?: number;
  anxiety?: number;
  energy?: number;
  sleep?: number;
  /** True when she prompted it, false when it was written unprompted. Worth
   *  knowing later: entries dragged out of you read differently from ones you sat
   *  down to write. */
  prompted: boolean;
};

export type JournalConfig = {
  enabled: boolean;
  /** Hour of the evening she may ask, 0–23. Before this she leaves it alone. */
  askHour: number;
  /** Whether she raises it at all, or waits to be come to. */
  askUnprompted: boolean;
};

export const DEFAULT_JOURNAL: JournalConfig = { enabled: false, askHour: 20, askUnprompted: true };

export function readJournalConfig(saved: unknown): JournalConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_JOURNAL;
  const record = saved as Partial<JournalConfig>;
  const askHour = typeof record.askHour === 'number' && record.askHour >= 0 && record.askHour <= 23
    ? Math.round(record.askHour) : DEFAULT_JOURNAL.askHour;
  return {
    enabled: record.enabled === true,
    askHour,
    askUnprompted: record.askUnprompted !== false,
  };
}

/** Clamped and rounded, or dropped entirely. A rating is optional — an entry with
 *  words and no numbers is still an entry, and a half-filled slider should not
 *  become a 0, which on these scales means something specific. */
export function readRating(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(SCALE_MAX, Math.round(value)));
}

export function readEntries(saved: unknown): JournalEntry[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map(entry => ({
      id: typeof entry.id === 'string' ? entry.id : `${entry.date}`,
      date: typeof entry.date === 'string' ? entry.date : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
      text: typeof entry.text === 'string' ? entry.text : '',
      mood: readRating(entry.mood),
      anxiety: readRating(entry.anxiety),
      energy: readRating(entry.energy),
      sleep: readRating(entry.sleep),
      prompted: entry.prompted === true,
    }))
    .filter(entry => entry.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Today's entry, if there is one. The whole once-a-day rule rests on this. */
export function entryFor(entries: JournalEntry[], date: string) {
  return entries.find(entry => entry.date === date);
}

/**
 * Writes an entry, replacing the day's existing one rather than stacking a
 * second. Ratings left undefined keep whatever was already there, so she can add
 * a mood to something you typed earlier without wiping the words.
 */
export function upsertEntry(entries: JournalEntry[], entry: Omit<JournalEntry, 'id' | 'createdAt'> & { id?: string }): JournalEntry[] {
  const existing = entryFor(entries, entry.date);
  const now = new Date().toISOString();
  const merged: JournalEntry = existing
    ? {
        ...existing,
        text: entry.text.trim() || existing.text,
        mood: entry.mood ?? existing.mood,
        anxiety: entry.anxiety ?? existing.anxiety,
        energy: entry.energy ?? existing.energy,
        sleep: entry.sleep ?? existing.sleep,
        prompted: existing.prompted || entry.prompted,
        updatedAt: now,
      }
    : { ...entry, id: entry.id ?? `${entry.date}-${now}`, createdAt: now, text: entry.text.trim() };
  return [merged, ...entries.filter(item => item.date !== entry.date)].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Whether she should raise it now. Deliberately conservative — she gets one run
 * at it per day, in the evening, and only if nothing is written yet. A journal
 * she nags about is one you stop keeping.
 */
export function shouldAsk(config: JournalConfig, entries: JournalEntry[], now: Date, today: string, askedToday: string | undefined) {
  if (!config.enabled || !config.askUnprompted) return false;
  if (now.getHours() < config.askHour) return false;
  if (askedToday === today) return false;
  return !entryFor(entries, today);
}

const RATING_WORDS = ['flat on the floor', 'awful', 'bad', 'low', 'below par', 'middling', 'alright', 'good', 'really good', 'great', 'the best it gets'];

/** A number said as a person would say it, for lines she speaks aloud. */
export function describeRating(value: number | undefined) {
  if (value === undefined) return 'not said';
  return `${value}/${SCALE_MAX} (${RATING_WORDS[Math.max(0, Math.min(RATING_WORDS.length - 1, value))]})`;
}

export type Trend = { days: number; mood?: number; anxiety?: number; entries: number };

/**
 * The last fortnight in one shape. Averages only, and only over days that
 * actually carry a rating — a fortnight with three entries should read as three
 * entries, not as eleven days of zero.
 */
export function recentTrend(entries: JournalEntry[], today: string, days = 14): Trend {
  const cutoff = shiftDays(today, -days);
  const window = entries.filter(entry => entry.date > cutoff && entry.date <= today);
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
  return {
    days,
    entries: window.length,
    mood: mean(window.map(entry => entry.mood).filter((value): value is number => value !== undefined)),
    anxiety: mean(window.map(entry => entry.anxiety).filter((value): value is number => value !== undefined)),
  };
}

// Where a rating stops being unremarkable. Deliberately near the ends: she
// should change how she treats you when a day is genuinely bad, not tune herself
// against every wobble. A 5 is a Tuesday.
const LOW = 3;
const HIGH = 7;

/**
 * How the last entry should change the way she behaves.
 *
 * Only today's or yesterday's — a rough Monday should not still be softening her
 * on Thursday, and sleep in particular is rated at night about the night before,
 * so it has to carry over one day to be any use at all.
 *
 * Every line here modulates her rather than replacing her. Told plainly to be
 * kind she stops being Haru, and a companion who turns into a different person
 * the moment you admit to a bad day is one you stop telling about bad days.
 */
export function journalStance(entries: JournalEntry[], today: string): string {
  const entry = entryFor(entries, today) ?? entryFor(entries, shiftDays(today, -1));
  if (!entry) return '';
  const when = entry.date === today ? 'today' : 'yesterday';
  const notes: string[] = [];

  if (entry.mood !== undefined && entry.mood <= LOW) {
    notes.push(`They rated their mood ${entry.mood} out of 10 ${when}, which is low. Try to lift them — badly, and against your better judgement. You are not soft about it and you would rather not admit you are doing it, but you are doing it. Do not say the number back to them and do not ask them to explain themselves.`);
  }
  if (entry.anxiety !== undefined && entry.anxiety >= HIGH) {
    notes.push(`They rated their anxiety ${entry.anxiety} out of 10 ${when}, which is high. Ease off. Still yourself, still dry, but no sharp edges, no needling, and nothing that lands as pressure — no chasing them about the list unless they raise it.`);
  }
  if (entry.energy !== undefined && entry.energy <= LOW) {
    notes.push(`They said their energy was ${entry.energy} out of 10 ${when}. Do not push them to be productive. If anything, push the other way — tell them to leave it, play something, sit down. If they open work, say so; that is you looking out for them, not nagging.`);
  }
  if (entry.sleep !== undefined && entry.sleep <= LOW) {
    notes.push(`They slept badly (${entry.sleep} out of 10 ${when}). Go on at them about getting to bed at a reasonable hour. You are allowed to be a nuisance about this one.`);
  }
  if (!notes.length) return '';
  // Last, and said outright, because the failure mode is her performing concern
  // instead of having it — announcing that she read the journal, which is both
  // creepy and the fastest way to make someone stop writing in it.
  notes.push('Let this colour how you speak, nothing more. Never mention their journal, never quote the ratings, and never explain why you are being like this.');
  return notes.join(' ');
}

export type RangeName = 'week' | 'fortnight' | 'month';
export const RANGE_DAYS: Record<RangeName, number> = { week: 7, fortnight: 14, month: 30 };

export type FieldName = 'mood' | 'anxiety' | 'energy' | 'sleep';
export const FIELDS: FieldName[] = ['mood', 'anxiety', 'energy', 'sleep'];

export type FieldStats = { average?: number; lowest?: number; highest?: number; rated: number; change?: number };
export type RangeStats = {
  days: number;
  /** Days in the window that have an entry at all. */
  written: number;
  /** Days running up to today with an entry — the number people actually care about. */
  streak: number;
  fields: Record<FieldName, FieldStats>;
  /** One point per day in the window, oldest first, so a chart needs no date maths. */
  series: { date: string; mood?: number; anxiety?: number; energy?: number; sleep?: number; written: boolean }[];
};

/**
 * A window of days, with a point for every day rather than only the written
 * ones. A chart drawn from entries alone silently closes the gaps and turns
 * three entries in a fortnight into an unbroken line, which is a lie about how
 * often someone wrote.
 */
export function rangeStats(entries: JournalEntry[], today: string, range: RangeName): RangeStats {
  const days = RANGE_DAYS[range];
  const series: RangeStats['series'] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = shiftDays(today, -offset);
    const entry = entryFor(entries, date);
    series.push({ date, mood: entry?.mood, anxiety: entry?.anxiety, energy: entry?.energy, sleep: entry?.sleep, written: Boolean(entry) });
  }
  const fields = {} as Record<FieldName, FieldStats>;
  for (const field of FIELDS) {
    const values = series.map(point => point[field]).filter((value): value is number => value !== undefined);
    // Compared as halves so "change" means something on a short window too;
    // first-versus-last would swing wildly on a single odd day.
    const half = Math.floor(values.length / 2);
    const mean = (list: number[]) => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : undefined;
    const earlier = mean(values.slice(0, half));
    const later = mean(values.slice(values.length - half));
    fields[field] = {
      average: mean(values),
      lowest: values.length ? Math.min(...values) : undefined,
      highest: values.length ? Math.max(...values) : undefined,
      rated: values.length,
      change: values.length >= 4 && earlier !== undefined && later !== undefined ? later - earlier : undefined,
    };
  }
  return { days, written: series.filter(point => point.written).length, streak: streakEndingToday(entries, today), fields, series };
}

/**
 * Consecutive days with an entry, counting back from today. Today not being
 * written yet does not break a streak — it is still early — so the count starts
 * from yesterday in that case rather than resetting to zero at every midnight.
 */
export function streakEndingToday(entries: JournalEntry[], today: string): number {
  let streak = 0;
  let cursor = entryFor(entries, today) ? today : shiftDays(today, -1);
  while (entryFor(entries, cursor)) { streak++; cursor = shiftDays(cursor, -1); }
  return streak;
}

/** Consecutive days ending today on which one particular thing was rated. */
export function fieldStreak(entries: JournalEntry[], today: string, field: FieldName): number {
  let streak = 0;
  let cursor = entryFor(entries, today)?.[field] !== undefined ? today : shiftDays(today, -1);
  while (entryFor(entries, cursor)?.[field] !== undefined) { streak++; cursor = shiftDays(cursor, -1); }
  return streak;
}

export type HaruNote = { tone: 'proud' | 'pleased' | 'watching' | 'grumpy'; text: string };

const FIELD_WORDS: Record<FieldName, string> = { mood: 'your mood', anxiety: 'your anxiety', energy: 'your energy', sleep: 'your sleep' };

/**
 * What she makes of your journalling, said in her own voice.
 *
 * Written here rather than generated, on purpose. This sits in a panel that has
 * to render the instant the page opens, it must say the same thing if you look
 * twice, and it is arithmetic about streaks — none of which wants a model. Her
 * voice lives in the wording, not in the sampling.
 */
export function haruNote(entries: JournalEntry[], today: string): HaruNote {
  const yesterday = shiftDays(today, -1);
  const streak = streakEndingToday(entries, today);
  const wroteToday = Boolean(entryFor(entries, today));
  const missedYesterday = !entryFor(entries, yesterday) && entries.some(entry => entry.date < yesterday);

  if (!entries.length) return { tone: 'watching', text: 'Nothing in here yet. Go on then — tell me how today actually went.' };
  if (missedYesterday && !wroteToday) return { tone: 'grumpy', text: 'Careful. You skipped yesterday and today is looking the same way, and I do notice.' };
  if (missedYesterday) return { tone: 'watching', text: 'You missed yesterday. Today is written though, so I will let it go this once.' };

  // The longest thing you have kept up, named specifically — "3 days in a row"
  // about nothing in particular is a statistic, about your sleep it is a habit.
  const best = FIELDS
    .map(field => ({ field, run: fieldStreak(entries, today, field) }))
    .sort((a, b) => b.run - a.run)[0];
  if (best && best.run >= 3) return { tone: 'proud', text: `Haru is quietly proud of you — that is ${best.run} days running you have tracked ${FIELD_WORDS[best.field]}.` };
  if (streak >= 3) return { tone: 'proud', text: `${streak} days in a row. I would say I am impressed, but you would get cocky.` };
  if (streak === 2) return { tone: 'pleased', text: 'Two days on the trot. Do not ruin it now.' };
  if (wroteToday) return { tone: 'pleased', text: 'Today is written down. That is the hard part done.' };
  return { tone: 'watching', text: 'Nothing from you today yet. I am waiting, obviously.' };
}

function shiftDays(dateKey: string, delta: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * What she is told about the journal, and it is deliberately thin. She gets
 * whether today is written and roughly how the fortnight has gone — enough to
 * ask a question that is not insultingly generic — and never the entries
 * themselves. What you wrote in a journal is not conversational material she
 * should be quoting back at you unprompted.
 */
export function journalPrompt(config: JournalConfig, entries: JournalEntry[], today: string): string {
  if (!config.enabled) return '';
  const todays = entryFor(entries, today);
  const trend = recentTrend(entries, today);
  const parts: string[] = [];
  if (todays) {
    const said = [
      todays.mood !== undefined ? `mood ${todays.mood}/${SCALE_MAX}` : '',
      todays.anxiety !== undefined ? `anxiety ${todays.anxiety}/${SCALE_MAX}` : '',
    ].filter(Boolean).join(', ');
    parts.push(`They have already written today's journal entry${said ? ` (${said})` : ''}. Do not ask them to do it again.`);
  } else {
    // The instruction belongs here rather than only in the tool description: she
    // has to know that an answer to "how was your day" is the thing to write
    // down, not just something to reply to.
    parts.push('They have not written today\'s journal entry yet. If they tell you how their day went or how they are feeling — whether you asked or they just came out with it — call save_journal_entry with what they said. Do not announce that you are saving it, and do not ask them to rate anything they did not bring up themselves.');
  }
  if (trend.entries >= 3) {
    const shape = [
      trend.mood !== undefined ? `mood averaging ${trend.mood.toFixed(1)}/${SCALE_MAX}` : '',
      trend.anxiety !== undefined ? `anxiety averaging ${trend.anxiety.toFixed(1)}/${SCALE_MAX}` : '',
    ].filter(Boolean).join(' and ');
    if (shape) parts.push(`Over the last ${trend.days} days: ${shape}, across ${trend.entries} entries.`);
  }
  // The line that keeps her out of it. She has the shape, not the contents, and
  // she is not a clinician — noticing is welcome, diagnosing is not.
  parts.push('You can see the shape of it, never what they wrote. Do not quote their journal back at them, do not read anything into the numbers beyond what they plainly say, and do not tell them what is wrong with them or what they should do about it. If something looks genuinely rough, you are allowed to say so kindly and ask — that is all.');
  return parts.join(' ');
}
