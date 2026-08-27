// Her list, across the gap to Google's.
//
// Only the data-shaping half is here. Everything else in google.ts is OAuth, a
// loopback consent server and authorised fetches — none of which can run outside
// Electron, and none of which is where the quiet damage happens.
//
// The quiet damage is a day. An event pulled back onto the wrong date, or a task
// pushed with an end that swallows the next morning, does not throw and does not
// log: she simply chases the wrong day, or says nothing about the right one. The
// file knows it, and says so twice — that a task's due date is taken off the
// string because a Date "would shift it by the local offset", and that an event
// is rendered in the configured zone rather than the machine's. Both of those
// are assertions, and neither had a test.
//
// Written so the timezone answers are the same everywhere: this desk is UTC+8
// and the runner is UTC, so anything that only fails in one of them is worth
// nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { disconnectGoogle, eventTimes, eventToItem, googleStatus, taskToItem } from '../electron/google';

const kept = (over: Partial<{ id: string; title: string; date: string; time: string }> = {}) =>
  ({ id: 'k1', title: 'Dentist', date: '2026-08-20', kind: 'event' as const, ...over });

// -- pushing a day out ------------------------------------------------------------

test('an all-day item ends on the next day, because Google reads the end as exclusive', () => {
  // An end of the same day is a zero-length event, and Google hides it.
  const times = eventTimes(kept(), 'Australia/Perth');
  assert.deepEqual(times, { start: { date: '2026-08-20' }, end: { date: '2026-08-21' } });
});

test('the exclusive end still lands when the day is the last of the month', () => {
  assert.equal(eventTimes(kept({ date: '2026-08-31' }), 'UTC').end.date, '2026-09-01');
  assert.equal(eventTimes(kept({ date: '2026-12-31' }), 'UTC').end.date, '2027-01-01');
  assert.equal(eventTimes(kept({ date: '2024-02-28' }), 'UTC').end.date, '2024-02-29', 'a leap year has a 29th');
  assert.equal(eventTimes(kept({ date: '2026-02-28' }), 'UTC').end.date, '2026-03-01', 'and an ordinary one does not');
});

test('a timed item runs an hour and carries the zone it was written in', () => {
  const times = eventTimes(kept({ time: '2:30 PM' }), 'Australia/Perth');
  assert.deepEqual(times, {
    start: { dateTime: '2026-08-20T14:30:00', timeZone: 'Australia/Perth' },
    end: { dateTime: '2026-08-20T15:30:00', timeZone: 'Australia/Perth' },
  });
});

test('the clock is padded, so 9am is not sent as 9:0', () => {
  const times = eventTimes(kept({ time: '9:05 AM' }), 'UTC');
  assert.equal(times.start?.dateTime, '2026-08-20T09:05:00');
  assert.equal(times.end?.dateTime, '2026-08-20T10:05:00');
});

test('an hour that would cross midnight is held at the end of the day', () => {
  // Without the clamp the end wraps to 00:xx of the same date — an end before its
  // own start, which Google rejects outright.
  assert.equal(eventTimes(kept({ time: '11:30 PM' }), 'UTC').end?.dateTime, '2026-08-20T23:59:00');
  assert.equal(eventTimes(kept({ time: '11:00 PM' }), 'UTC').end?.dateTime, '2026-08-20T23:59:00');
  // The hour before is ordinary.
  assert.equal(eventTimes(kept({ time: '10:30 PM' }), 'UTC').end?.dateTime, '2026-08-20T23:30:00');
});

test('a time nobody can read is sent as an all-day item rather than a broken one', () => {
  assert.deepEqual(eventTimes(kept({ time: 'sometime after lunch' }), 'UTC'),
    { start: { date: '2026-08-20' }, end: { date: '2026-08-21' } });
});

// -- pulling a day back -----------------------------------------------------------

test('an all-day event comes back as a date and nothing else', () => {
  const item = eventToItem({ id: 'g1', summary: 'Bins', start: { date: '2026-08-20' } }, 'Australia/Perth');
  assert.deepEqual(item, { id: 'g1', title: 'Bins', date: '2026-08-20' });
  assert.equal(item?.time, undefined, 'an all-day event has no hour to show');
});

test('a timed event is rendered in the zone she is configured for, not the machine\'s', () => {
  // The same instant, three zones. This is the whole reason the formatter is
  // given an explicit zone: on a machine in another country the pulled event
  // would land on a different day from the one she would have written.
  const event = { id: 'g2', summary: 'Call Mum', start: { dateTime: '2026-08-20T22:00:00Z' } };
  assert.deepEqual(eventToItem(event, 'UTC'), { id: 'g2', title: 'Call Mum', date: '2026-08-20', time: '10:00 PM' });
  assert.deepEqual(eventToItem(event, 'Australia/Perth'), { id: 'g2', title: 'Call Mum', date: '2026-08-21', time: '6:00 AM' });
  assert.deepEqual(eventToItem(event, 'America/New_York'), { id: 'g2', title: 'Call Mum', date: '2026-08-20', time: '6:00 PM' });
});

test('midnight comes back as midnight, not as hour twenty-four', () => {
  const item = eventToItem({ id: 'g3', summary: 'Midnight', start: { dateTime: '2026-08-20T00:00:00Z' } }, 'UTC');
  assert.equal(item?.date, '2026-08-20');
  assert.equal(item?.time, '12:00 AM');
});

test('an event with an offset on it is honoured as the instant it names', () => {
  const item = eventToItem({ id: 'g4', summary: 'Standup', start: { dateTime: '2026-08-21T08:00:00+10:00' } }, 'UTC');
  assert.equal(item?.date, '2026-08-20', 'ten in the morning in Sydney is the night before in UTC');
  assert.equal(item?.time, '10:00 PM');
});

test('an event she cannot place is dropped rather than guessed at', () => {
  assert.equal(eventToItem({ summary: 'no id', start: { date: '2026-08-20' } }, 'UTC'), null);
  assert.equal(eventToItem({ id: 'g5', summary: 'no start' }, 'UTC'), null);
  assert.equal(eventToItem({ id: 'g6', start: {} }, 'UTC'), null, 'a start with neither a date nor a time is not a start');
  assert.equal(eventToItem({ id: 'g7', start: { dateTime: 'the day after next' } }, 'UTC'), null);
});

test('an event with no title still has one', () => {
  assert.equal(eventToItem({ id: 'g8', start: { date: '2026-08-20' } }, 'UTC')?.title, '(no title)');
  assert.equal(eventToItem({ id: 'g9', summary: '   ', start: { date: '2026-08-20' } }, 'UTC')?.title, '(no title)');
});

// -- tasks ---------------------------------------------------------------------------

test('a task keeps the day it was written on, whatever instant it is dressed as', () => {
  // Google only honours the date part of `due`, so it is taken off the string.
  // Put through a Date it becomes an instant, and an instant belongs to whichever
  // day the offset says — this one is the 21st as written and the 20th in UTC.
  const task = taskToItem({ id: 't1', title: 'Bins', due: '2026-08-21T08:00:00+10:00', status: 'needsAction' });
  assert.equal(task?.date, '2026-08-21');

  // And the other way round, so neither direction can be papered over by the
  // machine happening to sit in the right zone.
  assert.equal(taskToItem({ id: 't2', title: 'Bins', due: '2026-08-20T23:30:00.000Z' })?.date, '2026-08-20');
  assert.equal(taskToItem({ id: 't3', title: 'Bins', due: '2026-08-20T00:00:00.000Z' })?.date, '2026-08-20');
});

test('a finished task remembers when it was actually finished', () => {
  // The only way to know when something ticked off on a phone happened, rather
  // than dating it to whenever the sync got round to noticing.
  const done = taskToItem({ id: 't4', title: 'Bins', due: '2026-08-20T00:00:00Z', status: 'completed', completed: '2026-08-20T07:14:00.000Z' });
  assert.equal(done?.done, true);
  assert.equal(done?.completedAt, '2026-08-20T07:14:00.000Z');
});

test('an unfinished task carries no completion time, even if one is sitting there', () => {
  const open = taskToItem({ id: 't5', title: 'Bins', due: '2026-08-20T00:00:00Z', status: 'needsAction', completed: '2026-08-20T07:14:00.000Z' });
  assert.equal(open?.done, false);
  assert.equal(open?.completedAt, undefined);
});

test('a task with no day is not something she can chase', () => {
  assert.equal(taskToItem({ id: 't6', title: 'Someday' }), null);
  assert.equal(taskToItem({ id: 't7', title: 'Bins', due: 'next tuesday' }), null);
  assert.equal(taskToItem({ id: 't8', title: 'Bins', due: '20/08/2026' }), null);
});

test('a task with no title or no id is dropped', () => {
  assert.equal(taskToItem({ title: 'Bins', due: '2026-08-20T00:00:00Z' }), null);
  assert.equal(taskToItem({ id: 't9', due: '2026-08-20T00:00:00Z' }), null);
  assert.equal(taskToItem({ id: 't10', title: '   ', due: '2026-08-20T00:00:00Z' }), null);
});

// -- what the settings panel is told ---------------------------------------------------

function fakeStore(values: Record<string, unknown> = {}) {
  const map = new Map(Object.entries(values));
  return {
    map,
    store: {
      get: (key: string) => map.get(key),
      set: (key: string, value: unknown) => { map.set(key, value); },
      delete: (key: string) => { map.delete(key); },
    },
  };
}

test('nothing set up reads as nothing set up', () => {
  assert.deepEqual(googleStatus(fakeStore().store), {
    hasCredentials: false, connected: false, email: undefined,
    lastSync: undefined, lastError: undefined, tasksGranted: false,
  });
});

test('credentials without a connection are reported apart, because they are different problems', () => {
  const { store } = fakeStore({ 'google.clientId': 'id.apps.googleusercontent.com' });
  const status = googleStatus(store);
  assert.equal(status.hasCredentials, true);
  assert.equal(status.connected, false, 'having a client id is not being signed in');
});

test('a connection reports who it is and how it last went', () => {
  const { store } = fakeStore({
    'google.clientId': 'id', 'google.refreshToken': 'secret',
    'google.email': 'tom@example.com', 'google.lastSync': '2026-08-20T07:00:00.000Z',
    'google.lastError': 'quota exceeded', 'google.tasksGranted': true,
  });
  assert.deepEqual(googleStatus(store), {
    hasCredentials: true, connected: true, email: 'tom@example.com',
    lastSync: '2026-08-20T07:00:00.000Z', lastError: 'quota exceeded', tasksGranted: true,
  });
});

test('disconnecting forgets the connection but keeps what was typed in', () => {
  // The client id and secret are the user's own registration, not the session.
  // Clearing them would mean setting Google up from scratch to sign back in.
  const { store, map } = fakeStore({
    'google.clientId': 'id', 'google.clientSecret': 'plain:shh', 'google.refreshToken': 'secret',
    'google.email': 'tom@example.com', 'google.lastSync': 'then', 'google.lastError': 'something',
  });
  disconnectGoogle(store);
  assert.equal(map.get('google.refreshToken'), undefined);
  assert.equal(map.get('google.email'), undefined);
  assert.equal(map.get('google.lastSync'), undefined);
  assert.equal(map.get('google.lastError'), undefined);
  assert.equal(map.get('google.clientId'), 'id', 'the registration should survive a disconnect');
  assert.equal(map.get('google.clientSecret'), 'plain:shh');
  assert.equal(googleStatus(store).connected, false);
  assert.equal(googleStatus(store).hasCredentials, true);
});
