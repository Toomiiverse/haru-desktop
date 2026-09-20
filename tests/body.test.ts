// How they slept and how far they walked, from the phone, and the one sentence she gets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_STALE_MS, bodyForPage, describeBody, readBody, readBodyReport, sleepLength, type Body } from '../electron/body';

const NOW = new Date('2026-09-05T02:00:00Z'); // 10:00 Perth
const clock = (ms: number) => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Perth' }).format(ms);
const TODAY = '2026-09-05';

test('a report needs a day and at least one figure, and the figures are sane', () => {
  assert.equal(readBodyReport({ day: '2026-09-05' }, NOW), null);
  assert.equal(readBodyReport({ day: 'yesterday', steps: 100 }, NOW), null);
  assert.equal(readBodyReport({ day: '2026-09-05', sleepMinutes: 5000 }, NOW), null);
  const report = readBodyReport({ day: '2026-09-05', sleepMinutes: 340.4, sleepStart: '2026-09-04T15:10:00Z', sleepEnd: '2026-09-04T20:50:00Z', steps: 6200 }, NOW)!;
  assert.deepEqual(report, { day: '2026-09-05', sleepMinutes: 340, sleepStart: '2026-09-04T15:10:00.000Z', sleepEnd: '2026-09-04T20:50:00.000Z', steps: 6200, at: NOW.toISOString() });
  // Steps alone is a report; the sleep times are dropped without a length.
  assert.deepEqual(readBodyReport({ day: '2026-09-05', steps: 12, sleepStart: '2026-09-04T15:10:00Z' }, NOW)!.sleepStart, null);
});

test('the sentence names a short night and today\'s steps, and says it is background', () => {
  const state: Body = { enabled: true, last: readBodyReport({ day: TODAY, sleepMinutes: 340, sleepStart: '2026-09-04T15:10:00Z', sleepEnd: '2026-09-04T20:50:00Z', steps: 6200 }, NOW) };
  assert.equal(describeBody(state, NOW.getTime(), clock, TODAY), 'Their phone says they slept 5 h 40 m last night (11:10 pm to 4:50 am), on the short side and have walked 6,200 steps so far today. That is background she may notice if it fits, never a thing to read out.');
  const short: Body = { enabled: true, last: readBodyReport({ day: TODAY, sleepMinutes: 200 }, NOW) };
  assert.match(describeBody(short, NOW.getTime(), clock, TODAY), /slept 3 h 20 m last night, a short night\./);
  const yesterday: Body = { enabled: true, last: readBodyReport({ day: '2026-09-04', steps: 9000 }, NOW) };
  assert.match(describeBody(yesterday, NOW.getTime(), clock, TODAY), /walked 9,000 steps yesterday/);
});

test('off, empty or stale says nothing', () => {
  const report = readBodyReport({ day: TODAY, steps: 100 }, NOW);
  assert.equal(describeBody({ enabled: false, last: report }, NOW.getTime(), clock, TODAY), '');
  assert.equal(describeBody({ enabled: true, last: null }, NOW.getTime(), clock, TODAY), '');
  assert.equal(describeBody({ enabled: true, last: report }, NOW.getTime() + BODY_STALE_MS + 1, clock, TODAY), '');
});

test('what is saved reads back, and the page gets the figures and a freshness', () => {
  const report = readBodyReport({ day: TODAY, sleepMinutes: 420, steps: 100 }, NOW);
  const state = readBody({ enabled: true, last: report });
  assert.deepEqual(state, { enabled: true, last: report });
  assert.deepEqual(readBody(undefined), { enabled: false, last: null });
  assert.deepEqual(bodyForPage(state, NOW.getTime()), { enabled: true, at: NOW.toISOString(), fresh: true, day: TODAY, sleepMinutes: 420, steps: 100 });
  assert.equal(bodyForPage(state, NOW.getTime() + BODY_STALE_MS + 1).fresh, false);
  assert.equal(sleepLength(420), '7 h'); assert.equal(sleepLength(45), '45 m'); assert.equal(sleepLength(341), '5 h 41 m');
});
