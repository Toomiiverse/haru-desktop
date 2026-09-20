// Things to do later, written down so a restart does not forget them.
//
// Every timer in main.ts is its own setTimeout or setInterval, and most keep
// what they know in memory: a second thought, the cooldowns, the spacing of her
// night passes all start again from nothing when the app restarts, and the daily
// sweeps (consolidation, decay, archive pruning) ran twenty-four hours after
// boot rather than at any time of day. And she had no way to decide to come back
// to something — "I'll ask you how it went tonight" was a sentence, not a plan.
//
// One list, in schedule.json, and one dispatcher:
//
//   - a job fires once (`at`) or every day at a local time (`daily`)
//   - its run is written down before it starts, keyed by the job and the time it
//     was due, so a restart part-way through never runs it twice — a line said
//     twice is worse than one lost
//   - a job missed while the app was down still runs late within its
//     staleAfterMs; past that a one-off is dropped and a daily one waits for its
//     next day
//   - a handler may put its job off ("she is asleep" → her wake time)
//   - a run that fails is tried again after 1, 5 and 15 minutes, then that
//     occurrence is given up
//   - one timer, to the earliest due job but never more than a minute away, so a
//     job added from elsewhere or a clock that jumped is noticed within a minute
//
// Pure except createScheduler, whose file, clock and timers are injected.

import { formatTimeOfDay, localDateKey, parseTimeOfDay, resolveDate, zonedNow } from './dates';

export type JobSchedule = { at: number } | { daily: string; timezone: string };

export type Job = {
  id: string;
  /** Which handler runs it. */
  kind: string;
  schedule: JobSchedule;
  /** When it next runs, epoch ms. */
  dueAt: number;
  /** How late it may still run after being missed. */
  staleAfterMs: number;
  payload?: Record<string, unknown>;
  createdBy: 'app' | 'haru';
  createdAt: number;
  /** Gone after this, run or not. */
  expiresAt?: number;
  /** Failed tries at the current occurrence. */
  failures: number;
  lastRunAt?: number;
};

export type RunOutcome = 'started' | 'done' | 'later' | 'failed' | 'missed' | 'expired' | 'interrupted';
export type RunRecord = { key: string; kind: string; at: number; outcome: RunOutcome; detail?: string };
/** One of her bookings, remembered past its job — see noteBookings. */
export type BookingRecord = { id: string; why: string; bookedAt: number; dueAt: number };
/** `booked` is optional because files written before 2026-09-17 have none. */
export type ScheduleFile = { jobs: Job[]; runs: RunRecord[]; booked?: BookingRecord[] };

/** What a handler says happened. */
export type Outcome = { done: true } | { later: number; reason: string } | { failed: string };

export const RUNS_KEPT = 200;
/** The wait before each retry of a failed run. */
export const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000];
/**
 * Failed tries at one occurrence before it is given up: the first, and one
 * retry for each wait above. Until 2026-09-17 this was 3 against the same three
 * waits, so the third failure gave up and the fifteen-minute wait was never
 * used — retries came at 1 and 5 minutes, not the 1, 5 and 15 promised.
 */
export const MAX_FAILURES = RETRY_MS.length + 1;
/** The longest the dispatcher sleeps without looking again. */
export const MAX_SLEEP_MS = 60_000;
/** Her bookings are remembered this long past both when she made them and when they were due… */
export const BOOKED_KEPT_MS = 48 * 3_600_000;
/** …and never more than this many. */
export const BOOKED_KEPT = 40;

export function emptySchedule(): ScheduleFile {
  return { jobs: [], runs: [], booked: [] };
}

const OUTCOMES: RunOutcome[] = ['started', 'done', 'later', 'failed', 'missed', 'expired', 'interrupted'];

/** A file edited by hand, or half-written, comes back usable rather than throwing. */
export function normalizeSchedule(value: unknown): ScheduleFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySchedule();
  const held = value as Partial<Record<keyof ScheduleFile, unknown>>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const jobs = (Array.isArray(held.jobs) ? held.jobs : []).filter((job): job is Job => {
    if (!job || typeof job !== 'object') return false;
    const candidate = job as Job;
    const schedule = candidate.schedule as Partial<{ at: unknown; daily: unknown; timezone: unknown }> | undefined;
    const validSchedule = Boolean(schedule) && (finite(schedule?.at) || (typeof schedule?.daily === 'string' && /^\d{1,2}:\d{2}$/.test(schedule.daily) && typeof schedule?.timezone === 'string'));
    return typeof candidate.id === 'string' && typeof candidate.kind === 'string' && validSchedule && finite(candidate.dueAt) && finite(candidate.staleAfterMs);
  }).map(job => ({ ...job, failures: finite(job.failures) ? job.failures : 0, createdBy: job.createdBy === 'haru' ? 'haru' as const : 'app' as const, createdAt: finite(job.createdAt) ? job.createdAt : job.dueAt }));
  const runs = (Array.isArray(held.runs) ? held.runs : []).filter((run): run is RunRecord =>
    Boolean(run) && typeof (run as RunRecord).key === 'string' && finite((run as RunRecord).at) && OUTCOMES.includes((run as RunRecord).outcome));
  const booked = (Array.isArray(held.booked) ? held.booked : []).filter((entry): entry is BookingRecord => {
    const candidate = entry as BookingRecord | null;
    return Boolean(candidate) && typeof candidate?.id === 'string' && typeof candidate.why === 'string' && finite(candidate.bookedAt) && finite(candidate.dueAt);
  });
  return { jobs, runs: runs.slice(-RUNS_KEPT), booked: booked.slice(-BOOKED_KEPT) };
}

// -- time --------------------------------------------------------------------------

/** Epoch ms for a local day and minutes past its midnight in a time zone. */
export function zonedEpoch(day: string, minutes: number, timeZone: string): number {
  const [year, month, date] = day.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, date, 0, minutes);
  const offset = (at: number) => {
    const zoned = zonedNow(timeZone, new Date(at));
    return Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), zoned.getHours(), zoned.getMinutes(), zoned.getSeconds()) - at;
  };
  // Twice: the offset at the wall time read as UTC can differ from the offset
  // at the real instant by a daylight-saving shift.
  const first = wall - offset(wall);
  return wall - offset(first);
}

function nextDayKey(day: string, days = 1): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** The next time "HH:MM" comes round in that zone, strictly after `after`. */
export function nextDaily(daily: string, timeZone: string, after: number): number {
  const [hours, mins] = daily.split(':').map(Number);
  const minutes = hours * 60 + mins;
  let day = localDateKey(zonedNow(timeZone, new Date(after)));
  for (let i = 0; i < 3; i++) {
    const at = zonedEpoch(day, minutes, timeZone);
    if (at > after) return at;
    day = nextDayKey(day);
  }
  return after + 86_400_000;
}

export function runKey(job: Pick<Job, 'id' | 'dueAt'>): string {
  return `${job.id}@${job.dueAt}`;
}

// -- the dispatcher ----------------------------------------------------------------

export type SchedulerDeps = {
  load(): ScheduleFile;
  save(file: ScheduleFile): void;
  handlers: Record<string, (job: Job) => Promise<Outcome> | Outcome>;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (line: string) => void;
};

export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let running = false;
  let started = false;

  const write = (change: (file: ScheduleFile) => void) => {
    const file = deps.load();
    const next: ScheduleFile = { jobs: [...file.jobs], runs: [...file.runs], booked: [...(file.booked ?? [])] };
    change(next);
    next.runs = next.runs.slice(-RUNS_KEPT);
    next.booked = noteBookings(next.booked, next.jobs, now());
    deps.save(next);
    return next;
  };

  function arm() {
    if (!started) return;
    if (timer !== null) clearTimer(timer);
    const jobs = deps.load().jobs;
    const earliest = jobs.length ? Math.min(...jobs.map(job => job.dueAt)) : Number.POSITIVE_INFINITY;
    const wait = Math.max(1000, Math.min(MAX_SLEEP_MS, earliest - now()));
    timer = setTimer(() => { timer = null; void tick(); }, wait);
  }

  /** Moves a job past the occurrence it just had: a one-off is removed, a daily one goes to its next day. */
  function advance(file: ScheduleFile, index: number) {
    const job = file.jobs[index];
    if ('at' in job.schedule) {
      file.jobs.splice(index, 1);
      return;
    }
    file.jobs[index] = { ...job, dueAt: nextDaily(job.schedule.daily, job.schedule.timezone, Math.max(now(), job.dueAt)), failures: 0, lastRunAt: now() };
  }

  function settle(job: Job, outcome: Outcome | 'missed' | 'interrupted') {
    write(file => {
      const index = file.jobs.findIndex(candidate => candidate.id === job.id && candidate.dueAt === job.dueAt);
      const record = (result: RunOutcome, detail?: string) => file.runs.push({ key: runKey(job), kind: job.kind, at: now(), outcome: result, ...(detail ? { detail } : {}) });
      if (typeof outcome === 'string') {
        record(outcome);
        if (index >= 0) advance(file, index);
        return;
      }
      if ('later' in outcome) {
        record('later', outcome.reason);
        // Put off is a fresh start: failures counted against the old time would
        // otherwise eat into the retries of the new one, and a booking that failed
        // twice before she fell asleep reached her wake time with most of its
        // retries already spent (2026-09-17).
        if (index >= 0) file.jobs[index] = { ...file.jobs[index], dueAt: Math.max(outcome.later, now() + 1000), failures: 0 };
        return;
      }
      if ('failed' in outcome) {
        record('failed', outcome.failed);
        if (index < 0) return;
        const failures = file.jobs[index].failures + 1;
        if (failures < MAX_FAILURES) file.jobs[index] = { ...file.jobs[index], failures, dueAt: now() + RETRY_MS[failures - 1] };
        else advance(file, index);
        return;
      }
      record('done');
      if (index >= 0) advance(file, index);
    });
  }

  async function runOne(id: string): Promise<boolean> {
    const at = now();
    const file = deps.load();
    const job = file.jobs.find(candidate => candidate.id === id);
    if (!job || job.dueAt > at) return false;
    const key = runKey(job);
    // Written down and never settled: it was running when the app went away.
    // Not run again — whatever it did may already be out there.
    if (file.runs.some(run => run.key === key)) {
      log(`[schedule] ${job.kind} ${job.id} was cut off by a restart — not running it twice`);
      settle(job, 'interrupted');
      return false;
    }
    if (at - job.dueAt > job.staleAfterMs) {
      log(`[schedule] ${job.kind} ${job.id} missed by ${Math.round((at - job.dueAt) / 60_000)} min — ${'at' in job.schedule ? 'dropped' : 'waiting for tomorrow'}`);
      settle(job, 'missed');
      return false;
    }
    write(next => { next.runs.push({ key, kind: job.kind, at, outcome: 'started' }); });
    let outcome: Outcome;
    try {
      const handler = deps.handlers[job.kind];
      outcome = handler ? await handler(job) : { failed: `nothing handles "${job.kind}"` };
    } catch (error) {
      outcome = { failed: error instanceof Error ? error.message : String(error) };
    }
    settle(job, outcome);
    if ('failed' in outcome) log(`[schedule] ${job.kind} ${job.id} failed: ${outcome.failed}`);
    else if ('later' in outcome) log(`[schedule] ${job.kind} ${job.id} put off to ${new Date(outcome.later).toISOString()} — ${outcome.reason}`);
    return true;
  }

  /** Runs whatever is due, oldest first. Returns how many handlers ran. */
  async function tick(): Promise<number> {
    if (running) return 0;
    running = true;
    let ran = 0;
    try {
      const at = now();
      const expired = deps.load().jobs.filter(job => job.expiresAt !== undefined && job.expiresAt <= at);
      if (expired.length) {
        write(file => {
          file.jobs = file.jobs.filter(job => !expired.some(gone => gone.id === job.id));
          file.runs.push(...expired.map(job => ({ key: runKey(job), kind: job.kind, at, outcome: 'expired' as const })));
        });
        for (const job of expired) log(`[schedule] ${job.kind} ${job.id} expired`);
      }
      const due = deps.load().jobs.filter(job => job.dueAt <= at).sort((a, b) => a.dueAt - b.dueAt);
      for (const job of due) if (await runOne(job.id)) ran += 1;
    } finally {
      running = false;
      arm();
    }
    return ran;
  }

  function add(job: Job) {
    write(file => { file.jobs = [...file.jobs.filter(candidate => candidate.id !== job.id), job]; });
    arm();
  }

  return {
    start() {
      started = true;
      void tick();
    },
    stop() {
      started = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    tick,
    add,
    cancel(id: string): boolean {
      let removed = false;
      write(file => {
        const before = file.jobs.length;
        file.jobs = file.jobs.filter(job => job.id !== id);
        removed = file.jobs.length < before;
      });
      arm();
      return removed;
    },
    list(): Job[] {
      return deps.load().jobs;
    },
    runs(): RunRecord[] {
      return deps.load().runs;
    },
    /** Her recent bookings, including the ones that have already come and gone. */
    booked(): BookingRecord[] {
      return deps.load().booked ?? [];
    },
    /** A daily job of the app's own: added when missing, moved when its time changed, otherwise left alone. */
    ensureDaily(input: { id: string; kind: string; daily: string; timezone: string; staleAfterMs: number }) {
      const existing = deps.load().jobs.find(job => job.id === input.id);
      const same = existing && 'daily' in existing.schedule && existing.schedule.daily === input.daily && existing.schedule.timezone === input.timezone && existing.staleAfterMs === input.staleAfterMs;
      if (same) return;
      add({
        id: input.id, kind: input.kind, schedule: { daily: input.daily, timezone: input.timezone },
        dueAt: nextDaily(input.daily, input.timezone, now()), staleAfterMs: input.staleAfterMs,
        createdBy: 'app', createdAt: now(), failures: 0,
      });
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;

// -- what she books for herself ----------------------------------------------------

export const BOOKED_KIND = 'booked';

export const BOOKING_LIMITS = {
  /** Things she may have waiting at once. */
  maxPending: 5,
  /** New bookings in any twenty-four hours. */
  maxPerDay: 3,
  minLeadMs: 5 * 60_000,
  maxLeadMs: 7 * 86_400_000,
  /** How late a booking may still be said after the app was down at its time. */
  staleAfterMs: 6 * 3_600_000,
  /** Put off past this — asleep, quiet hours, him busy — and it is let go. */
  keepMs: 24 * 3_600_000,
};

/** "Tonight at 1 AM" is the small hours after this evening, up to the chat's 05:00 roll. */
const NIGHT_ENDS_HOUR = 5;
const WEEKDAY_WORDS = /^(?:this |next |on |this coming )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/;

/**
 * When she meant, from the tool's arguments: a day in his words and a time, or
 * minutes from now. Resolved here rather than by the model, for the reason
 * resolveDate gives — it was reliably a day out.
 *
 * A day given with a time already gone used to come back as that instant in
 * the past, and admitBooking answered "That is now, not later — just say it in
 * this reply", which told her to say at 10 PM what she meant for tomorrow's
 * small hours (2026-09-17). resolveDate reads "tonight" as today and a weekday
 * as its next occurrence counting today, which is right for its other callers,
 * so the booking's reading is settled here instead: "tonight" with a small-hours
 * time is the next calendar day, a weekday whose time has gone today is a week
 * on, and anything else already gone is refused in words that say so.
 */
export function resolveBookingTime(input: { date?: string; time?: string; inMinutes?: number }, nowMs: number, timeZone: string): number | { error: string } {
  if (typeof input.inMinutes === 'number' && Number.isFinite(input.inMinutes) && input.inMinutes > 0) {
    return nowMs + Math.round(input.inMinutes) * 60_000;
  }
  const clock = input.time ? parseTimeOfDay(input.time) : null;
  if (!clock) return { error: 'Give a time of day, like "6:00 PM", or minutes from now.' };
  const local = zonedNow(timeZone, new Date(nowMs));
  const today = localDateKey(local);
  const said = input.date ? input.date.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  let day = said ? resolveDate(said, local) : today;
  if (!day) return { error: `Could not tell which day "${input.date}" is — use "today", "tomorrow" or a weekday.` };
  // "Tonight at 1 AM" said at 10 PM is tomorrow's date; said at 00:30 it is
  // already that night, and today's.
  if (said === 'tonight' && clock.hour < NIGHT_ENDS_HOUR && local.getHours() >= NIGHT_ENDS_HOUR) day = nextDayKey(day);
  const minutes = clock.hour * 60 + clock.minute;
  const at = zonedEpoch(day, minutes, timeZone);
  if (at > nowMs) return at;
  // A time already gone today, with no day given, is the next one.
  if (!said) return zonedEpoch(nextDayKey(day), minutes, timeZone);
  if (day === today && WEEKDAY_WORDS.test(said)) return zonedEpoch(nextDayKey(day, 7), minutes, timeZone);
  if (day < today) return { error: `${input.date} has already gone. Pick a day still to come.` };
  return { error: `${formatTimeOfDay(clock.hour, clock.minute)} ${said === 'tonight' ? 'tonight' : 'today'} has already passed. Pick a later time, or a later day.` };
}

function contentWords(text: string): Set<string> {
  return new Set(String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(word => word.length >= 4));
}

const isHers = (job: Job) => job.kind === BOOKED_KIND && job.createdBy === 'haru';

/**
 * Her bookings, kept for a while after their jobs are gone. Run on every write
 * the scheduler makes: a booking of hers not yet noted is added, a noted one
 * still waiting follows its job's time as it is put off, and one past
 * BOOKED_KEPT_MS on both its booking and its time is dropped.
 *
 * The limits on what she books used to look only at jobs still waiting, and a
 * booking stops waiting the moment it is said. So "three new in a day" let
 * through nine in twenty-five minutes, each said before the next was made, and
 * "ask how the psych appointment went" was booked again at 18:01, a minute
 * after it had come round (2026-09-17). Noting a booking when its job is
 * written rather than when it leaves means every way out — said, let go,
 * expired, missed, cut off by a restart, cancelled — is covered without a hook
 * in each, and a job waiting in a file from before this is picked up too.
 */
export function noteBookings(booked: BookingRecord[] | undefined, jobs: Job[], nowMs: number): BookingRecord[] {
  const hers = jobs.filter(isHers);
  const noted = (booked ?? []).map(entry => {
    const job = hers.find(candidate => candidate.id === entry.id);
    return job && job.dueAt !== entry.dueAt ? { ...entry, dueAt: job.dueAt } : entry;
  });
  for (const job of hers) {
    if (!noted.some(entry => entry.id === job.id)) noted.push({ id: job.id, why: String(job.payload?.why ?? ''), bookedAt: job.createdAt, dueAt: job.dueAt });
  }
  return noted.filter(entry => Math.max(entry.bookedAt, entry.dueAt) > nowMs - BOOKED_KEPT_MS).slice(-BOOKED_KEPT);
}

/**
 * Whether she may book this, and the job if so. The refusals are written to
 * her, because they come back to her as the tool's answer.
 *
 * `held` is the schedule: what is waiting counts against maxPending, and what
 * she booked lately — waiting or already come and gone — against maxPerDay and
 * the same-thing check (see noteBookings).
 */
export function admitBooking(held: { jobs: Job[]; booked?: BookingRecord[] }, request: { at: number; why: string }, nowMs: number, id: string, limits = BOOKING_LIMITS): { job: Job } | { refused: string } {
  const why = String(request.why ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 4) return { refused: 'Say what you mean to come back to, in a few words.' };
  if (why.length > 240) return { refused: 'Keep it to one line — what you mean to ask or say.' };
  if (request.at < nowMs + limits.minLeadMs) return { refused: 'That is now, not later — just say it in this reply.' };
  if (request.at > nowMs + limits.maxLeadMs) return { refused: 'That is more than a week away. For something that far off, put it on their list with create_kept_item.' };
  const hers = held.jobs.filter(isHers);
  if (hers.length >= limits.maxPending) return { refused: `You already have ${hers.length} things waiting to come back to. Let one of them happen first.` };
  const recent = noteBookings(held.booked, held.jobs, nowMs);
  if (recent.filter(entry => nowMs - entry.bookedAt < 86_400_000).length >= limits.maxPerDay) return { refused: 'You have booked enough for today. Leave it — if it matters, it will come up.' };
  const words = contentWords(why);
  const twin = recent.find(entry => {
    const noted = contentWords(entry.why);
    const shared = [...words].filter(word => noted.has(word)).length;
    return Math.abs(entry.dueAt - request.at) < 6 * 3_600_000 && words.size > 0 && noted.size > 0 && shared / Math.min(words.size, noted.size) >= 0.6;
  });
  if (twin && hers.some(job => job.id === twin.id)) return { refused: `You already have that booked: "${twin.why}". Nothing more to do.` };
  if (twin) return { refused: `That has already come round: "${twin.why}". Leave it — if there is more to it, it will come up.` };
  return {
    job: {
      id, kind: BOOKED_KIND, schedule: { at: request.at }, dueAt: request.at,
      staleAfterMs: limits.staleAfterMs, payload: { why, bookedAt: nowMs },
      createdBy: 'haru', createdAt: nowMs, expiresAt: request.at + limits.keepMs, failures: 0,
    },
  };
}

/** "6:00 PM today", "9:30 AM tomorrow", "7:00 PM Friday". */
export function describeWhen(at: number, nowMs: number, timeZone: string): string {
  const local = zonedNow(timeZone, new Date(at));
  const today = localDateKey(zonedNow(timeZone, new Date(nowMs)));
  const day = localDateKey(local);
  const clock = formatTimeOfDay(local.getHours(), local.getMinutes());
  if (day === today) return `${clock} today`;
  if (day === nextDayKey(today)) return `${clock} tomorrow`;
  return `${clock} ${new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}`;
}

/** Her bookings, in front of her, so she neither books twice nor says early what is set for later. */
export function bookedNote(jobs: Job[], nowMs: number, timeZone: string): string {
  const hers = jobs.filter(job => job.kind === BOOKED_KIND && job.createdBy === 'haru').sort((a, b) => a.dueAt - b.dueAt);
  if (!hers.length) return '';
  return `What you have set yourself to come back to — each comes back to you at its time, so leave it until then and do not book it again:\n${hers.map(job => `- ${describeWhen(job.dueAt, nowMs, timeZone)}: ${job.payload?.why}`).join('\n')}`;
}

/** The instruction when a booking's time comes. */
export function bookedPrompt(why: string, bookedAt: number, nowMs: number, timeZone: string): string {
  const local = zonedNow(timeZone, new Date(bookedAt));
  const clock = formatTimeOfDay(local.getHours(), local.getMinutes());
  const day = localDateKey(local);
  const today = localDateKey(zonedNow(timeZone, new Date(nowMs)));
  const when = day === today ? `${clock} earlier today` : nextDayKey(day) === today ? `${clock} yesterday` : describeWhen(bookedAt, nowMs, timeZone);
  return `At ${when} you decided to come back to this now: "${why}". Say it to them now, as a new message of your own — one to three lines, no greeting, and no mention of having planned or booked it. If the conversation since has already covered it, or it no longer makes sense, answer with a single dash and nothing else.`;
}
