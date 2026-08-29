// A plain "remind me" is read here, not left to the model.

import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderAsk, reminderSavedAside } from '../electron/remindme';

// Saturday 29 August 2026, 11:04 in the morning, their clock.
const morning = new Date(2026, 7, 29, 11, 4);
const afternoon = new Date(2026, 7, 29, 14, 30);

test('the message that was let through: eat, at twelve', () => {
  assert.deepEqual(reminderAsk('Set me a reminder to eat @12', morning), { title: 'Eat', date: '2026-08-29', time: '12:00 PM' });
  assert.deepEqual(reminderAsk('remind me to eat at 12', morning), { title: 'Eat', date: '2026-08-29', time: '12:00 PM' });
  assert.deepEqual(reminderAsk('Remind me at 12 to eat', morning)?.time, '12:00 PM');
});

test('a task with no time is today, all day', () => {
  assert.deepEqual(reminderAsk('Reminder today for building website for the pc project', morning), { title: 'Building website for the pc project', date: '2026-08-29' });
  assert.deepEqual(reminderAsk('remind me to call mum', morning), { title: 'Call mum', date: '2026-08-29' });
});

test('a bare hour is the next time it comes round', () => {
  assert.equal(reminderAsk('remind me to stretch at 5', morning)?.time, '5:00 PM');
  assert.equal(reminderAsk('remind me to stretch at 5', new Date(2026, 7, 29, 3, 0))?.time, '5:00 AM');
  assert.equal(reminderAsk('remind me to take the bins out at 8pm', morning)?.time, '8:00 PM');
  assert.equal(reminderAsk('remind me at 7:30 to leave', afternoon)?.time, '7:30 PM');
  assert.equal(reminderAsk('remind me at 14:30 to leave', morning)?.time, '2:30 PM');
});

test('"in twenty minutes" is a clock time from now', () => {
  assert.deepEqual(reminderAsk('remind me in 20 minutes to check the oven', morning), { title: 'Check the oven', date: '2026-08-29', time: '11:24 AM' });
  assert.equal(reminderAsk('remind me to check the oven in 2 hours', morning)?.time, '1:04 PM');
});

test('tomorrow and weekdays resolve to a date, keeping the time as said', () => {
  assert.deepEqual(reminderAsk('remind me tomorrow at 9 to ring the agent', afternoon), { title: 'Ring the agent', date: '2026-08-30', time: '9:00 AM' });
  assert.deepEqual(reminderAsk('set a reminder for monday to pay rent', morning), { title: 'Pay rent', date: '2026-08-31' });
});

test('a small bare hour on another day is the afternoon one, and a timer is a countdown', () => {
  assert.equal(reminderAsk('remind me tomorrow at 4 to pick up the parts', morning)?.time, '4:00 PM');
  assert.deepEqual(reminderAsk('Set a timer for 10 minutes', morning), { title: 'Timer', date: '2026-08-29', time: '11:14 AM' });
});

test('what is not a plain reminder is left to the model', () => {
  assert.equal(reminderAsk('remind me', morning), null);
  assert.equal(reminderAsk('did you set a reminder for me?', morning), null);
  assert.equal(reminderAsk('Haru where was my 12pm reminder', morning), null);
  assert.equal(reminderAsk('I need to remember to eat', morning), null);
});

test('the aside matches what was saved', () => {
  const aside = reminderSavedAside({ title: 'Eat', date: '2026-08-29', time: '12:00 PM' }, '2026-08-29');
  assert.match(aside, /"Eat", today at 12:00 PM/);
  assert.match(aside, /do not call a tool/);
});
