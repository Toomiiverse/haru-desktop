// Chasing, and stopping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERED_QUIET_MINUTES, shouldRemind } from '../electron/reminders';

// Answering her ends the chase, rather than restarting it.
//
// Being spoken to used to delete the record, which read as "never chased" —
// so she began the same task again three minutes later, and answering her was
// the one thing that guaranteed being asked again.

test('a task they have just answered about is left alone', () => {
  const now = Date.now();
  const answered = { attempts: 0, lastAt: now - 60_000, answeredAt: now - 60_000 };
  assert.equal(shouldRemind({ minutesUntilDue: -5, done: false, state: answered, minutesSinceUserSpoke: 1, machineIdleSeconds: 0, hour: 13, now }), false);
  // Still quiet well after the ladder's own gap would have let her start again.
  assert.equal(shouldRemind({ minutesUntilDue: -20, done: false, state: { ...answered, lastAt: now - 20 * 60_000, answeredAt: now - 20 * 60_000 }, minutesSinceUserSpoke: 20, machineIdleSeconds: 0, hour: 13, now }), false);
});

test('after a long quiet she goes back to something still missed, but not to something upcoming', () => {
  const now = Date.now();
  const long = now - (ANSWERED_QUIET_MINUTES + 5) * 60_000;
  const state = { attempts: 0, lastAt: long, answeredAt: long };
  assert.equal(shouldRemind({ minutesUntilDue: -30, done: false, state, minutesSinceUserSpoke: 50, machineIdleSeconds: 0, hour: 13, now }), true);
  assert.equal(shouldRemind({ minutesUntilDue: 10, done: false, state, minutesSinceUserSpoke: 50, machineIdleSeconds: 0, hour: 13, now }), false);
});
