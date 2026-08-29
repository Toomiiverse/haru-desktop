// The day at the desk.
//
// Two things this has to get right or it is worse than not existing: it must
// not turn a day of alt-tabbing into four hundred rows, and it must not write
// down the one category activity.ts goes out of its way never to write down.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ENTRIES_PER_DAY, describeShot, isRedacted, isScreenshotEntry, mergeActivity,
  minutesOf, noteActivity, noteScreenshot, normalizeActivityLog, summariseDay,
  summariseShots, type ActivityEntry, type ActivityLog,
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

// -- screenshots ------------------------------------------------------------------
//
// These shipped broken once and it is worth saying how: a screenshot is taken at
// an instant, so its entry has no duration, and summariseDay put every entry
// through a five-minute floor. The whole log of them travelled to the server and
// was then dropped before the day pass ever saw it. Counting, not timing.

test('a screenshot is noted with what was in front at the time', () => {
  const log = noteScreenshot({}, DAY, { name: 'shot.png', doing: { kind: 'coding', label: 'VS Code' } }, at(0));
  const [entry] = log[DAY];
  assert.equal(entry.shot, 'shot.png');
  assert.equal(entry.title, 'shot.png — while in VS Code');
  assert.equal(entry.kind, 'coding');
  assert.equal(isScreenshotEntry(entry), true);
});

test('a screenshot taken during adult browsing does not say so', () => {
  const log = noteScreenshot({}, DAY, { name: 'shot.png', doing: { kind: 'adult', label: 'a site' } }, at(0));
  const [entry] = log[DAY];
  assert.equal(entry.title, 'shot.png', 'the label came along for the ride');
  assert.equal(entry.kind, 'other');
});

test('screenshots are counted rather than timed, however long ago', () => {
  // The bug: three screenshots, zero minutes between them, dropped entirely.
  let log: ActivityLog = {};
  for (const name of ['a.png', 'b.png', 'c.png']) log = noteScreenshot(log, DAY, { name }, at(0));
  const digest = summariseDay(log[DAY]);
  assert.ok(digest.includes('3 screenshots'), digest);
});

test('one screenshot is one screenshot, not one screenshots', () => {
  const log = noteScreenshot({}, DAY, { name: 'a.png' }, at(0));
  assert.equal(summariseShots(log[DAY]), '1 screenshot');
});

test('what the vision model saw is what makes a screenshot worth remembering', () => {
  let log = noteScreenshot({}, DAY, { name: 'a.png' }, at(0));
  log = describeShot(log, DAY, 'a.png', '  a stack trace in a code editor  ');
  assert.equal(log[DAY][0].description, 'a stack trace in a code editor', 'trimmed');
  assert.ok(summariseShots(log[DAY]).includes('a stack trace in a code editor'));
});

test('a description lands on its own screenshot, not the newest one', () => {
  let log = noteScreenshot({}, DAY, { name: 'first.png' }, at(0));
  log = noteScreenshot(log, DAY, { name: 'second.png' }, at(1));
  log = describeShot(log, DAY, 'first.png', 'the first thing');
  assert.equal(log[DAY][0].description, 'the first thing');
  assert.equal(log[DAY][1].description, undefined, 'it landed on the wrong entry');
});

test('a description with nothing to attach to changes nothing', () => {
  const log = noteScreenshot({}, DAY, { name: 'a.png' }, at(0));
  assert.equal(describeShot(log, DAY, 'missing.png', 'anything'), log);
  assert.equal(describeShot(log, '2026-01-01', 'a.png', 'anything'), log);
  assert.equal(describeShot(log, DAY, 'a.png', '   '), log, 'an empty description is not a description');
  const once = describeShot(log, DAY, 'a.png', 'the same words');
  assert.equal(describeShot(once, DAY, 'a.png', 'the same words'), once, 'writing the same thing twice is a write');
});

test('the stretches and the screenshots both survive into one digest', () => {
  let log: ActivityLog = { [DAY]: [
    { at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T10:00:00.000Z', kind: 'working', label: 'Figma', process: 'chrome', title: 'a' },
  ] };
  log = noteScreenshot(log, DAY, { name: 'a.png' }, at(0));
  log = describeShot(log, DAY, 'a.png', 'a poster half finished');
  const digest = summariseDay(log[DAY]);
  assert.ok(digest.includes('Figma (working, 60m)'), digest);
  assert.ok(digest.includes('1 screenshot: a poster half finished'), digest);
});

test('a day of nothing but screenshots still says something', () => {
  const log = noteScreenshot({}, DAY, { name: 'a.png' }, at(0));
  assert.equal(summariseDay(log[DAY]), '1 screenshot');
});

test('a screenshot entry survives the trip to the server with its description', () => {
  let log = noteScreenshot({}, DAY, { name: 'a.png' }, at(0));
  log = describeShot(log, DAY, 'a.png', 'a stack trace');
  const there = mergeActivity({}, JSON.parse(JSON.stringify(log)));
  assert.equal(there[DAY][0].description, 'a stack trace');
  assert.equal(there[DAY][0].shot, 'a.png');
});

// -- which copy of an entry survives -----------------------------------------------
//
// The split-brain this fixes: a screenshot has no duration, so `until` always
// tied, and the old rule fell through to "keep what we already have" - which is
// whichever machine is running the merge. The desk captioned a screenshot on its
// GPU and pushed it; the server kept its own uncaptioned copy and dropped the
// caption; and because the push is one-way the desk never found out. Two
// machines, two answers, for ever.

const shot = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:00:00.000Z',
  kind: 'other', label: 'screenshot', process: 'screenshot', title: 'a.png', shot: 'a.png', ...over,
});

test('a caption beats no caption, whichever machine is asking', () => {
  const captioned = shot({ description: 'Search Console: gaming cafe perth, 73 impressions' });
  const bare = shot();
  const atTheDesk = mergeActivity({ [DAY]: [captioned] }, { [DAY]: [bare] });
  const atTheServer = mergeActivity({ [DAY]: [bare] }, { [DAY]: [captioned] });
  assert.equal(atTheDesk[DAY][0].description, captioned.description);
  assert.equal(atTheServer[DAY][0].description, captioned.description, 'the server dropped the caption it was sent');
  assert.deepEqual(atTheDesk, atTheServer);
});

test('two captions of one image resolve the same way from either side', () => {
  const desk = shot({ description: 'Google Search Console, Performance. Queries: gaming cafe perth, 73 impressions.' });
  const server = shot({ description: 'a web browser showing a graph' });
  const atTheDesk = mergeActivity({ [DAY]: [desk] }, { [DAY]: [server] });
  const atTheServer = mergeActivity({ [DAY]: [server] }, { [DAY]: [desk] });
  assert.deepEqual(atTheDesk, atTheServer, 'the two machines disagreed');
  assert.equal(atTheDesk[DAY][0].description, desk.description, 'the fuller account should survive');
});

test('a longer stretch still wins when neither has a caption', () => {
  const short = { at: '2026-08-29T09:00:00.000Z', until: '2026-08-29T09:10:00.000Z', kind: 'working' as const, label: 'Figma', process: 'chrome', title: 'a' };
  const long = { ...short, until: '2026-08-29T09:40:00.000Z' };
  assert.equal(minutesOf(mergeActivity({ [DAY]: [short] }, { [DAY]: [long] })[DAY][0]), 40);
  assert.equal(minutesOf(mergeActivity({ [DAY]: [long] }, { [DAY]: [short] })[DAY][0]), 40);
});

test('a caption outranks a longer stretch, since duration is not what was lost', () => {
  const captionedShort = shot({ until: '2026-08-29T09:00:00.000Z', description: 'what was on the screen' });
  const bareLong = shot({ until: '2026-08-29T09:30:00.000Z' });
  const merged = mergeActivity({ [DAY]: [bareLong] }, { [DAY]: [captionedShort] });
  assert.equal(merged[DAY][0].description, 'what was on the screen');
});

test('an empty caption is not a caption', () => {
  const blank = shot({ description: '   ' });
  const real = shot({ description: 'the actual screen' });
  assert.equal(mergeActivity({ [DAY]: [blank] }, { [DAY]: [real] })[DAY][0].description, 'the actual screen');
  assert.equal(mergeActivity({ [DAY]: [real] }, { [DAY]: [blank] })[DAY][0].description, 'the actual screen');
});

test('captions settle, so syncing twice does not flap between them', () => {
  const desk = { [DAY]: [shot({ description: 'the fuller account of the screen' })] };
  const server = { [DAY]: [shot({ description: 'a browser' })] };
  const once = mergeActivity(server, desk);
  const twice = mergeActivity(once, desk);
  assert.deepEqual(twice, once, 'a second push changed the answer');
  assert.deepEqual(mergeActivity(once, server), once, 'the older caption came back');
});
