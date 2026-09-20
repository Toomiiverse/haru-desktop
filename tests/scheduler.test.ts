// Things to do later, that a restart does not forget.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitBooking, bookedNote, bookedPrompt, BOOKED_KIND, BOOKING_LIMITS, createScheduler, describeWhen, emptySchedule,
  BOOKED_KEPT_MS, MAX_FAILURES, nextDaily, normalizeSchedule, resolveBookingTime, runKey, zonedEpoch,
  type Job, type Outcome, type ScheduleFile, type Scheduler,
} from '../electron/scheduler';

const PERTH = 'Australia/Perth';
// 2026-09-16 22:00 in Perth is 14:00 UTC.
const T0 = Date.UTC(2026, 8, 16, 14, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

function once(id: string, dueAt: number, extra: Partial<Job> = {}): Job {
  return { id, kind: 'test', schedule: { at: dueAt }, dueAt, staleAfterMs: HOUR, createdBy: 'app', createdAt: T0 - HOUR, failures: 0, ...extra };
}

/** A scheduler over an in-memory file, a hand-moved clock and timers that only record. */
function harness(jobs: Job[], handlers: Record<string, (job: Job) => Outcome | Promise<Outcome>>, file: ScheduleFile = { ...emptySchedule(), jobs }) {
  const state = { file, now: T0, timers: [] as number[], saves: 0 };
  const scheduler = createScheduler({
    load: () => JSON.parse(JSON.stringify(state.file)),
    save: next => { state.file = JSON.parse(JSON.stringify(next)); state.saves += 1; },
    handlers,
    now: () => state.now,
    setTimer: (_run, ms) => { state.timers.push(ms); return state.timers.length; },
    clearTimer: () => undefined,
  });
  return { state, scheduler };
}

test('time: a local day and time in Perth is the right instant, and "daily" comes round tomorrow once today has passed', () => {
  assert.equal(zonedEpoch('2026-09-16', 22 * 60, PERTH), T0);
  assert.equal(nextDaily('04:30', PERTH, T0), zonedEpoch('2026-09-17', 270, PERTH));
  assert.equal(nextDaily('23:15', PERTH, T0), zonedEpoch('2026-09-16', 23 * 60 + 15, PERTH));
  // Across a daylight-saving change: Sydney goes forward on 2026-10-04 at 02:00.
  assert.equal(new Date(zonedEpoch('2026-10-04', 9 * 60, 'Australia/Sydney')).toISOString(), '2026-10-03T22:00:00.000Z');
});

test('a due job runs once, is written down before it runs, and a one-off is gone after', async () => {
  const seen: number[] = [];
  const { state, scheduler } = harness([once('a', T0 - MIN)], {
    test: () => { seen.push(state.file.runs.filter(run => run.outcome === 'started').length); return { done: true }; },
  });
  assert.equal(await scheduler.tick(), 1);
  assert.deepEqual(seen, [1], 'the started record was on disk while the handler ran');
  assert.equal(state.file.jobs.length, 0);
  assert.deepEqual(state.file.runs.map(run => run.outcome), ['started', 'done']);
  assert.equal(await scheduler.tick(), 0, 'nothing twice');
});

test('a run cut off by a restart is not run again', async () => {
  const job = once('a', T0 - MIN);
  let ran = 0;
  const { state, scheduler } = harness([job], { test: () => { ran += 1; return { done: true }; } }, {
    jobs: [job], runs: [{ key: runKey(job), kind: 'test', at: T0 - 30_000, outcome: 'started' }],
  });
  await scheduler.tick();
  assert.equal(ran, 0);
  assert.equal(state.file.jobs.length, 0);
  assert.equal(state.file.runs.at(-1)?.outcome, 'interrupted');
});

test('missed while down: late within staleAfter still runs, past it a one-off is dropped and a daily one waits for tomorrow', async () => {
  let ran = 0;
  const daily: Job = { ...once('d', T0 - 5 * HOUR), schedule: { daily: '17:00', timezone: PERTH } };
  const { state, scheduler } = harness([once('late', T0 - 30 * MIN), once('gone', T0 - 3 * HOUR), daily], { test: () => { ran += 1; return { done: true }; } });
  await scheduler.tick();
  assert.equal(ran, 1, 'only the one half an hour late');
  assert.deepEqual(state.file.jobs.map(job => job.id), ['d']);
  assert.equal(state.file.jobs[0].dueAt, zonedEpoch('2026-09-17', 17 * 60, PERTH));
  assert.ok(state.file.runs.some(run => run.key.startsWith('gone@') && run.outcome === 'missed'));
});

test('a handler can put its job off, and the new time is a new run', async () => {
  let calls = 0;
  const { state, scheduler } = harness([once('a', T0 - MIN)], {
    test: () => (calls++ === 0 ? { later: T0 + 2 * HOUR, reason: 'she is asleep' } : { done: true }),
  });
  await scheduler.tick();
  assert.equal(state.file.jobs[0].dueAt, T0 + 2 * HOUR);
  state.now = T0 + 2 * HOUR + MIN;
  await scheduler.tick();
  assert.equal(calls, 2);
  assert.equal(state.file.jobs.length, 0);
});

test('failures retry after 1, 5 and 15 minutes, then give up on that occurrence', async () => {
  const { state, scheduler } = harness([once('a', T0 - MIN, { staleAfterMs: 2 * HOUR })], { test: () => { throw new Error('model down'); } });
  await scheduler.tick();
  assert.equal(state.file.jobs[0].failures, 1);
  const waits: number[] = [];
  for (let i = 0; i < 10 && state.file.jobs.length; i++) {
    waits.push(state.file.jobs[0].dueAt - state.now);
    state.now = state.file.jobs[0].dueAt;
    await scheduler.tick();
  }
  assert.deepEqual(waits, [MIN, 5 * MIN, 15 * MIN], 'three retries, the fifteen-minute one included');
  assert.equal(state.file.jobs.length, 0);
  assert.equal(MAX_FAILURES, 4);
  assert.equal(state.file.runs.filter(run => run.outcome === 'failed').length, MAX_FAILURES);
});

test('putting a job off clears its failures, so the later try has all its retries', async () => {
  let calls = 0;
  const { state, scheduler } = harness([once('a', T0 - MIN, { staleAfterMs: 24 * HOUR })], {
    test: () => {
      calls += 1;
      if (calls === 3) return { later: T0 + 8 * HOUR, reason: 'she is asleep' };
      throw new Error('model down');
    },
  });
  await scheduler.tick();
  state.now = state.file.jobs[0].dueAt;
  await scheduler.tick();
  assert.equal(state.file.jobs[0].failures, 2);
  state.now = state.file.jobs[0].dueAt;
  await scheduler.tick();
  assert.equal(state.file.jobs[0].failures, 0, 'put off, and the count starts again');
  assert.equal(state.file.jobs[0].dueAt, T0 + 8 * HOUR);
  for (let i = 0; i < 10 && state.file.jobs.length; i++) {
    state.now = state.file.jobs[0].dueAt;
    await scheduler.tick();
  }
  assert.equal(calls, 3 + MAX_FAILURES, 'a full set of tries after waking');
});

test('an expired job goes without running, and the timer never sleeps past a minute', async () => {
  let ran = 0;
  const { state, scheduler } = harness([once('a', T0 + 3 * HOUR, { expiresAt: T0 - 1 }), once('b', T0 + 5 * HOUR)], { test: () => { ran += 1; return { done: true }; } });
  scheduler.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ran, 0);
  assert.deepEqual(state.file.jobs.map(job => job.id), ['b']);
  assert.ok(state.timers.every(ms => ms <= 60_000 && ms >= 1000));
  scheduler.stop();
});

test('ensureDaily adds once, leaves an unchanged job alone, and moves a changed one', () => {
  const { state, scheduler } = harness([], {});
  scheduler.ensureDaily({ id: 'maintenance', kind: 'maintenance', daily: '04:30', timezone: PERTH, staleAfterMs: 20 * HOUR });
  const first = state.file.jobs[0];
  state.now = T0 + HOUR;
  scheduler.ensureDaily({ id: 'maintenance', kind: 'maintenance', daily: '04:30', timezone: PERTH, staleAfterMs: 20 * HOUR });
  assert.deepEqual(state.file.jobs, [first]);
  scheduler.ensureDaily({ id: 'maintenance', kind: 'maintenance', daily: '03:00', timezone: PERTH, staleAfterMs: 20 * HOUR });
  assert.equal(state.file.jobs.length, 1);
  assert.equal(state.file.jobs[0].dueAt, zonedEpoch('2026-09-17', 180, PERTH));
});

test('her booking time: his words for the day, a clock time, or minutes from now', () => {
  assert.equal(resolveBookingTime({ time: '11:30 PM' }, T0, PERTH), zonedEpoch('2026-09-16', 23 * 60 + 30, PERTH));
  assert.equal(resolveBookingTime({ time: '6:00 PM' }, T0, PERTH), zonedEpoch('2026-09-17', 18 * 60, PERTH), 'gone today, so tomorrow');
  assert.equal(resolveBookingTime({ date: 'friday', time: '9am' }, T0, PERTH), zonedEpoch('2026-09-18', 9 * 60, PERTH));
  assert.equal(resolveBookingTime({ inMinutes: 90 }, T0, PERTH), T0 + 90 * MIN);
  assert.ok('error' in (resolveBookingTime({ date: 'tomorrow' }, T0, PERTH) as object));
});

test('her booking time: a day with a time already gone is not an instant in the past', () => {
  // T0 is Wednesday 22:00 in Perth.
  assert.equal(resolveBookingTime({ date: 'tonight', time: '1:00 AM' }, T0, PERTH), zonedEpoch('2026-09-17', 60, PERTH), 'the small hours after this evening');
  assert.equal(resolveBookingTime({ date: 'tonight', time: '11:30 PM' }, T0, PERTH), zonedEpoch('2026-09-16', 23 * 60 + 30, PERTH));
  assert.equal(resolveBookingTime({ date: 'tonight', time: '1:00 AM' }, T0 + 150 * MIN, PERTH), zonedEpoch('2026-09-17', 60, PERTH), 'said at 00:30, it is already that night');
  assert.equal(resolveBookingTime({ date: 'wednesday', time: '9:00 AM' }, T0, PERTH), zonedEpoch('2026-09-23', 9 * 60, PERTH), 'gone today, so next week');
  assert.equal(resolveBookingTime({ date: 'Wednesday', time: '11:00 PM' }, T0, PERTH), zonedEpoch('2026-09-16', 23 * 60, PERTH), 'still to come today');
  const refusal = (input: { date: string; time: string }) => {
    const result = resolveBookingTime(input, T0, PERTH);
    assert.equal(typeof result, 'object', JSON.stringify(input));
    return (result as { error: string }).error;
  };
  assert.match(refusal({ date: 'today', time: '9:00 AM' }), /^9:00 AM today has already passed\. Pick a later time/);
  assert.match(refusal({ date: 'tonight', time: '9:00 PM' }), /^9:00 PM tonight has already passed/);
  assert.match(refusal({ date: '2026-09-10', time: '9am' }), /^2026-09-10 has already gone/);
  for (const input of [{ date: 'today', time: '9:00 AM' }, { date: '2026-09-10', time: '9am' }]) assert.doesNotMatch(refusal(input), /just say it/);
  // And the booking itself goes through, rather than being turned back as "now".
  const at = resolveBookingTime({ date: 'tonight', time: '1:00 AM' }, T0, PERTH) as number;
  assert.ok('job' in admitBooking({ jobs: [] }, { at, why: 'check he actually went to bed' }, T0, 'b1'));
});

test('what she may book: not now, not beyond a week, not a sixth, not a fourth today, not the same thing twice', () => {
  const book = (jobs: Job[], at: number, why: string) => admitBooking({ jobs }, { at, why }, T0, `b${jobs.length}`);
  assert.ok('refused' in book([], T0 + MIN, 'ask how the build went'));
  assert.ok('refused' in book([], T0 + 8 * 86_400_000, 'ask how the build went'));
  const made = book([], T0 + 2 * HOUR, 'ask how the build went');
  assert.ok('job' in made);
  const job = (made as { job: Job }).job;
  assert.equal(job.kind, BOOKED_KIND);
  assert.equal(job.expiresAt, job.dueAt + BOOKING_LIMITS.keepMs);
  assert.match((book([job], T0 + 3 * HOUR, 'ask him how that build went') as { refused: string }).refused, /already have that booked/);
  const three = [0, 1, 2].map(i => ({ ...job, id: `x${i}`, payload: { why: `thing number ${i} unrelated ${'abcdefgh'[i]}` }, dueAt: T0 + (10 + i * 20) * HOUR }));
  assert.match((book(three, T0 + 80 * HOUR, 'check the Switch 2 preorder') as { refused: string }).refused, /enough for today/);
  const five = [0, 1, 2, 3, 4].map(i => ({ ...job, id: `y${i}`, createdAt: T0 - 3 * 86_400_000, payload: { why: `older thing ${'abcde'[i]}` }, dueAt: T0 + (10 + i * 20) * HOUR }));
  assert.match((book(five, T0 + 150 * HOUR, 'check the Switch 2 preorder') as { refused: string }).refused, /5 things waiting/);
});

/** Books through the scheduler the way bookFollowUp does, at the harness's clock. Null when admitted. */
function bookInto(state: { now: number }, scheduler: Scheduler, at: number, why: string, id: string): string | null {
  const admitted = admitBooking({ jobs: scheduler.list(), booked: scheduler.booked() }, { at, why }, state.now, id);
  if ('refused' in admitted) return admitted.refused;
  scheduler.add(admitted.job);
  return null;
}

test('what she booked still counts once it has been said: nine in twenty-five minutes is three', async () => {
  const said: string[] = [];
  const { state, scheduler } = harness([], { [BOOKED_KIND]: job => { said.push(String(job.payload?.why)); return { done: true }; } });
  const whys = ['ask how the build went', 'check the preorder shipped', 'remind about laundry', 'see whether dinner happened', 'mention the anime episode', 'nudge about sleeping early', 'follow up on groceries', 'check his reply from work', 'tease about the rematch'];
  const refusals: (string | null)[] = [];
  for (const [i, why] of whys.entries()) {
    state.now = T0 + i * 3 * MIN;
    await scheduler.tick();
    refusals.push(bookInto(state, scheduler, state.now + 5 * MIN, why, `b${i}`));
  }
  state.now = T0 + 40 * MIN;
  await scheduler.tick();
  assert.equal(refusals.filter(refused => refused === null).length, 3);
  assert.match(refusals[3] ?? '', /enough for today/);
  assert.deepEqual(said, whys.slice(0, 3), 'the three she was allowed came round and were said');
  assert.equal(scheduler.list().length, 0, 'none of them is still waiting');
  assert.deepEqual(normalizeSchedule(JSON.parse(JSON.stringify(state.file))).booked?.map(entry => entry.why), whys.slice(0, 3), 'remembered in the file, and read back');
  state.now = T0 + 25 * HOUR;
  assert.equal(bookInto(state, scheduler, state.now + HOUR, 'check the preorder shipped', 'next-day'), null, 'a day later, she may book again');
});

test('the same thing is not booked again a minute after it came round', async () => {
  const sixPm = zonedEpoch('2026-09-17', 18 * 60, PERTH);
  const { state, scheduler } = harness([], { [BOOKED_KIND]: () => ({ done: true }) });
  assert.equal(bookInto(state, scheduler, sixPm, 'ask how the psych appointment went', 'b1'), null);
  state.now = sixPm;
  assert.equal(await scheduler.tick(), 1);
  assert.equal(scheduler.list().length, 0);
  state.now = sixPm + MIN;
  assert.match(bookInto(state, scheduler, sixPm + 30 * MIN, 'ask how the psych appointment went', 'b2') ?? '', /already come round: "ask how the psych appointment went"/);
  assert.match(bookInto(state, scheduler, state.now + 2 * HOUR, 'ask him how his psych appointment went', 'b3') ?? '', /already come round/);
  assert.equal(bookInto(state, scheduler, sixPm + 30 * MIN, 'check the Switch preorder shipped', 'b4'), null, 'something else is fine');
  // The app's own writes keep the notes, and they are let go two days on.
  state.now = sixPm + 2 * MIN;
  scheduler.ensureDaily({ id: 'maintenance', kind: 'maintenance', daily: '04:30', timezone: PERTH, staleAfterMs: 20 * HOUR });
  assert.deepEqual(scheduler.booked().map(entry => entry.id), ['b1', 'b4']);
  state.now = sixPm + 30 * MIN + BOOKED_KEPT_MS + MIN;
  await scheduler.tick();
  assert.deepEqual(scheduler.booked(), []);
});

test('a note of hers follows her job when it is put off, and a job waiting in an older file is noted', async () => {
  const at = T0 + HOUR;
  const old: Job = { id: 'from-before', kind: BOOKED_KIND, schedule: { at }, dueAt: at, staleAfterMs: 6 * HOUR, payload: { why: 'ask how the build went', bookedAt: T0 - HOUR }, createdBy: 'haru', createdAt: T0 - HOUR, failures: 0 };
  const { state, scheduler } = harness([], { [BOOKED_KIND]: () => ({ later: T0 + 5 * HOUR, reason: 'she is asleep' }) }, { jobs: [old], runs: [] });
  state.now = at;
  await scheduler.tick();
  assert.deepEqual(scheduler.booked(), [{ id: 'from-before', why: 'ask how the build went', bookedAt: T0 - HOUR, dueAt: T0 + 5 * HOUR }]);
});

test('what she is shown: her bookings with their times, and the note when one comes due', () => {
  const job = (admitBooking({ jobs: [] }, { at: zonedEpoch('2026-09-17', 18 * 60, PERTH), why: 'ask how the build went' }, T0, 'b1') as { job: Job }).job;
  assert.equal(bookedNote([], T0, PERTH), '');
  assert.match(bookedNote([job, once('app-job', T0 + HOUR)], T0, PERTH), /come back to[^\n]*\n- 6:00 PM tomorrow: ask how the build went$/);
  assert.equal(describeWhen(zonedEpoch('2026-09-19', 19 * 60, PERTH), T0, PERTH), '7:00 PM Saturday');
  const note = bookedPrompt('ask how the build went', T0, T0 + HOUR, PERTH);
  assert.match(note, /^At 10:00 PM earlier today you decided/);
  assert.match(bookedPrompt('ask how the build went', T0, T0 + 4 * HOUR, PERTH), /^At 10:00 PM yesterday you decided/, 'booked before midnight, said after it');
  assert.match(note, /single dash/);
});

test('the file is read defensively', () => {
  const file = normalizeSchedule({
    jobs: [
      once('ok', T0),
      { id: 'no-schedule', kind: 'x', dueAt: T0, staleAfterMs: 1 },
      { ...once('bad-daily', T0), schedule: { daily: '25h', timezone: PERTH } },
      { ...once('daily', T0), schedule: { daily: '04:30', timezone: PERTH }, failures: 'x', createdBy: 'someone' },
    ],
    runs: [{ key: 'ok@1', kind: 'x', at: 1, outcome: 'done' }, { key: 'bad', at: 1, outcome: 'exploded' }],
    booked: [{ id: 'b1', why: 'ask how the build went', bookedAt: T0, dueAt: T0 + HOUR }, { id: 'b2', why: 'no times' }, null],
  });
  assert.deepEqual(file.booked, [{ id: 'b1', why: 'ask how the build went', bookedAt: T0, dueAt: T0 + HOUR }]);
  assert.deepEqual(normalizeSchedule({ jobs: [], runs: [] }).booked, [], 'a file from before bookings were remembered');
  assert.deepEqual(file.jobs.map(job => job.id), ['ok', 'daily']);
  assert.equal(file.jobs[1].failures, 0);
  assert.equal(file.jobs[1].createdBy, 'app');
  assert.equal(file.runs.length, 1);
  assert.deepEqual(normalizeSchedule(null), emptySchedule());
});

test('the tool is on the table when the turn is about later, and its answer is written to her', async () => {
  const { chatTools, laterRelevant, runChatTool } = await import('../electron/tools');
  const available = {
    choices: false, journal: false, anilist: false, web: true, search: { enabled: false, readPages: false, transcripts: false },
    knowledge: false, browser: false, claude: false, system: { enabled: false, level: 0 }, hands: false,
    desktop: { launch: false, power: false }, knockedAwake: false, minecraft: false, booking: true,
  } as unknown as Parameters<typeof chatTools>[0];
  const names = (latest: string) => chatTools(available, latest).map(tool => tool.function.name);
  assert.ok(names('psych appointment at 3pm, wish me luck').includes('book_follow_up'));
  assert.ok(names('heading to work').includes('book_follow_up'));
  assert.equal(names('what anime should I watch').includes('book_follow_up'), false);
  assert.equal(chatTools({ ...available, booking: false }, 'tomorrow').some(tool => tool.function.name === 'book_follow_up'), false);
  assert.equal(laterRelevant('lol'), false);

  const asked: unknown[] = [];
  const deps = {
    onWeb: () => true, handsAllowed: () => false,
    booking: { book: (input: unknown) => { asked.push(input); return (input as { why: string }).why.includes('twice') ? { booked: false as const, reason: 'You already have that booked.' } : { booked: true as const, when: '6:00 PM today' }; } },
  } as unknown as Parameters<typeof runChatTool>[2];
  const call = (args: Record<string, unknown>) => runChatTool({ function: { name: 'book_follow_up', arguments: JSON.stringify(args) } } as Parameters<typeof runChatTool>[0], '', deps);
  const booked = JSON.parse(await call({ why: 'ask how the appointment went', time: '6:00 PM', date: ' ' }));
  assert.equal(booked.booked, true);
  assert.equal(booked.when, '6:00 PM today');
  assert.deepEqual(asked[0], { why: 'ask how the appointment went', date: undefined, time: '6:00 PM', inMinutes: undefined });
  assert.equal(JSON.parse(await call({ why: 'ask twice', in_minutes: '45' })).reason, 'You already have that booked.');
  assert.equal((asked[1] as { inMinutes: number }).inMinutes, 45);
  const none = JSON.parse(await runChatTool({ function: { name: 'book_follow_up', arguments: '{"why":"x"}' } } as Parameters<typeof runChatTool>[0], '', { onWeb: () => true, handsAllowed: () => false } as unknown as Parameters<typeof runChatTool>[2]));
  assert.match(none.error, /nowhere to keep/);
});
