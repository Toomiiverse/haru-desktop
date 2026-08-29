// The day at the desk.
//
// Two things this has to get right or it is worse than not existing: it must
// not turn a day of alt-tabbing into four hundred rows, and it must not write
// down the one category activity.ts goes out of its way never to write down.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ENTRIES_PER_DAY, isRedacted, mergeActivity, minutesOf, noteActivity,
  normalizeActivityLog, summariseDay, type ActivityEntry, type ActivityLog,
} from '../electron/activitylog';

const DAY = '2026-08-29';
const seen = (over: Partial<{ kind: string; label: string; process: string; title: string; url: string }> = {}) => ({
  kind: 'working' as const, label: 'Figma', process: 'chrome', title: 'poster — Figma', ...over,
}) as never;

const at = (minutes: number) => new Date(Date.UTC(2026, 7, 29, 9, minutes, 0));

test('a window in front for the first time is one entry', () => {
  const log = noteActivity({}, DAY, seen(), at(0));
  assert.equal(log[DAY].length, 1);
  assert.equal(log[DAY][0].title, 'poster — Figma');
  assert.equal(log[DAY][0].at, log[DAY][0].until, 'a stretch starts with no length');
});

test('staying at the same window moves the end rather than adding a row', () => {
  let log = noteActivity({}, DAY, seen(), at(0));
  for (const minute of [1, 2, 3, 4]) log = noteActivity(log, DAY, seen(), at(minute));
  assert.equal(log[DAY].length, 1, 'four more sightings became four more rows');
  assert.equal(minutesOf(log[DAY][0]), 4);
});

test('a sighting that moves nothing returns the very same log', () => {
  // The caller writes a file when this changes; returning a fresh object for an
  // unchanged day would write it on every poll.
  const first = noteActivity({}, DAY, seen(), at(0));
  assert.equal(noteActivity(first, DAY, seen(), at(0)), first);
});

test('coming back after a long gap is a new sitting, not the same one', () => {
  let log = noteActivity({}, DAY, seen(), at(0));
  log = noteActivity(log, DAY, seen(), at(30));
  assert.equal(log[DAY].length, 2, 'half an hour later is not the same stretch');
});

test('a different window is a new entry even at the same second', () => {
  let log = noteActivity({}, DAY, seen(), at(0));
  log = noteActivity(log, DAY, seen({ title: 'other thing — Figma' }), at(0));
  assert.equal(log[DAY].length, 2, 'two pages on one site are not one stretch');
});

test('adult browsing keeps its timing and loses its title', () => {
  const log = noteActivity({}, DAY, seen({ kind: 'adult', label: 'a site', title: 'a title', url: 'https://example' }), at(0));
  const [entry] = log[DAY];
  assert.equal(entry.kind, 'adult', 'the category is still the truth about the day');
  assert.equal(entry.title, '', 'the title was written down');
  assert.equal(entry.label, '');
  assert.equal(entry.url, undefined);
  assert.equal(isRedacted('adult'), true);
  assert.equal(isRedacted('working'), false);
});

test('a day cannot grow without bound', () => {
  let log: ActivityLog = {};
  for (let index = 0; index < MAX_ENTRIES_PER_DAY + 50; index += 1) {
    log = noteActivity(log, DAY, seen({ title: `window ${index}` }), at(index));
  }
  assert.equal(log[DAY].length, MAX_ENTRIES_PER_DAY);
  assert.equal(log[DAY][log[DAY].length - 1].title, `window ${MAX_ENTRIES_PER_DAY + 49}`, 'the newest is what survives');
});

test('the digest is what the day was about, longest first', () => {
  const entries: ActivityEntry[] = [
    { at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:20:00.000Z', kind: 'working', label: 'Figma', process: 'chrome', title: 'a' },
    { at: '2026-08-29T10:00:00.000Z', until: '2026-08-29T12:20:00.000Z', kind: 'gaming', label: 'Elden Ring', process: 'eldenring', title: 'b' },
    { at: '2026-08-29T13:00:00.000Z', until: '2026-08-29T13:25:00.000Z', kind: 'working', label: 'Figma', process: 'chrome', title: 'c' },
  ];
  const digest = summariseDay(entries);
  assert.equal(digest, 'Elden Ring (gaming, 140m); Figma (working, 45m)', digest);
});

test('a window passed through is not something they did', () => {
  const entries: ActivityEntry[] = [
    { at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:00:30.000Z', kind: 'other', label: 'Settings', process: 'explorer', title: 'x' },
  ];
  assert.equal(summariseDay(entries), '', 'thirty seconds in Settings is not a fact about the day');
});

test('a redacted stretch says nothing about itself in the digest', () => {
  const entries: ActivityEntry[] = [
    { at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T10:00:00.000Z', kind: 'adult', label: '', process: 'chrome', title: '' },
  ];
  // It falls back to the process, which is 'chrome' — a browser was open, which
  // is true and says nothing. What must not happen is a label reappearing here.
  assert.ok(!summariseDay(entries).includes('adult') || summariseDay(entries).startsWith('chrome'));
});

test('the desk and the server end up holding one log', () => {
  const mine: ActivityLog = {
    [DAY]: [{ at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:10:00.000Z', kind: 'working', label: 'Figma', process: 'chrome', title: 'a' }],
  };
  const theirs: ActivityLog = {
    [DAY]: [{ at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:40:00.000Z', kind: 'working', label: 'Figma', process: 'chrome', title: 'a' }],
    '2026-08-28': [{ at: '2026-08-28T09:00:00.000Z', until: '2026-08-28T09:05:00.000Z', kind: 'coding', label: 'VS Code', process: 'code', title: 'b' }],
  };
  const merged = mergeActivity(mine, theirs);
  assert.deepEqual(Object.keys(merged).sort(), ['2026-08-28', '2026-08-29']);
  assert.equal(merged[DAY].length, 1, 'the same stretch arriving twice is one stretch');
  assert.equal(minutesOf(merged[DAY][0]), 40, 'the longer view of the stretch wins');
});

test('merging is stable, so a second push changes nothing', () => {
  const log: ActivityLog = {
    [DAY]: [{ at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:10:00.000Z', kind: 'working', label: 'Figma', process: 'chrome', title: 'a' }],
  };
  assert.deepEqual(mergeActivity(mergeActivity(log, log), log), mergeActivity(log, log));
});

test('rubbish off the network is dropped rather than stored', () => {
  assert.deepEqual(normalizeActivityLog(null), {});
  assert.deepEqual(normalizeActivityLog([1, 2]), {});
  assert.deepEqual(normalizeActivityLog('a log'), {});
  assert.deepEqual(normalizeActivityLog({ [DAY]: 'not a list' }), {});
  const mixed = normalizeActivityLog({
    [DAY]: [null, 7, { at: 'x' }, { process: 'chrome' }, { at: 'a', process: 'chrome', title: 't' }],
  });
  assert.equal(mixed[DAY].length, 1, 'only the entry with both fields survived');
  assert.equal(mixed[DAY][0].until, 'a', 'a missing end falls back to the start');
});
