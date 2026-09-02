// A plain "remind me" is read here, not left to the model.

import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedOffer, acceptsOffer, promisedTitle, reminderOffered, reminderPromised, reminderAsk, reminderSavedAside } from '../electron/remindme';

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

test('a reminder she promised in her own reply is read back off it', () => {
  const now = new Date(2026, 7, 30, 22, 4); // 10:04 pm
  assert.deepEqual(reminderPromised("🙄 Of course I can. But don't expect me to babysit you into adulthood. I'll set the reminder at 6:54 AM sharp — don't be late.", now), { time: '6:54 AM', date: '2026-08-31' });
  assert.deepEqual(reminderPromised("Great. I'll remind you at 6:54 AM if you need it.", now), { time: '6:54 AM', date: '2026-08-31' });
  assert.deepEqual(reminderPromised("Fine, I've set a reminder for 4pm.", new Date(2026, 7, 30, 12, 0)), { time: '4:00 PM', date: '2026-08-30' });
  assert.deepEqual(reminderPromised("Consider it set for 7 tomorrow.", now), { time: '7:00 AM', date: '2026-08-31' });
  // Not a promise: talking about a time, or a threat.
  assert.equal(reminderPromised("Don't make me come find you at 6:55 AM.", now), null);
  assert.equal(reminderPromised("You're going to be up before the sun tomorrow.", now), null);
  assert.equal(reminderPromised('', now), null);
});

test('what the reminder is for comes from what they said, not from her', () => {
  assert.equal(promisedTitle(['Kinda sucks because I have to be at the shop tomorrow by 7am as we have some electricians coming in to change the lights', 'Yes please', 'You can set a reminder for me can’t you Haru?']), 'Be at the shop tomorrow by 7am');
  assert.equal(promisedTitle(['yes']), 'What you asked her to remind you about');
});

test('her offer and their yes, read together, are a reminder', () => {
  const now = new Date(2026, 7, 30, 22, 3);
  const offer = "Great. I'll remind you at 6:54 AM if you need it.";
  assert.deepEqual(reminderOffered(offer, now), { time: '6:54 AM', date: '2026-08-31' });
  assert.deepEqual(reminderOffered('Want me to set a reminder for 4pm?', new Date(2026, 7, 30, 12, 0)), { time: '4:00 PM', date: '2026-08-30' });
  assert.equal(reminderOffered("Don't make me come find you at 6:55 AM.", now), null);
  for (const yes of ['Yes please', 'yes', 'sure, thanks', 'Do it', 'You can set a reminder for me can’t you Haru?', 'please do'])
    assert.equal(acceptsOffer(yes), true, yes);
  for (const no of ['No thanks', 'What time is it', 'Remind me to get Nutella @4pm please', 'I just got out the shower', 'yes I did eat, what did you get up to last night?'])
    assert.equal(acceptsOffer(no), false, no);
  const theirs = ['Kinda sucks because I have to be at the shop tomorrow by 7am as we have some electricians coming in to change the lights', 'Yes please'];
  assert.deepEqual(acceptedOffer('Yes please', offer, theirs, now), { title: 'Be at the shop tomorrow by 7am', date: '2026-08-31', time: '6:54 AM' });
  // No offer, or no yes: nothing.
  assert.equal(acceptedOffer('Yes please', 'Go to sleep.', theirs, now), null);
  assert.equal(acceptedOffer('what?', offer, theirs, now), null);
  assert.equal(acceptedOffer('Yes please', undefined, theirs, now), null);
});

test('"remind me what happened" is a question, not an errand', () => {
  const now = new Date(2026, 8, 2, 14, 0);
  for (const line of [
    'remind me what happened with that motherboard from Umart',
    'remind me who that customer was',
    'remind me where I put the screwdriver',
    'remind me when did we order those mailboxes',
    'remind me how the family sharing thing works',
    'remind me whether I paid that invoice',
  ]) assert.equal(reminderAsk(line, now), null, line);
  assert.notEqual(reminderAsk('remind me to pick up the parcel tomorrow', now), null, 'a real errand still is one');
  assert.notEqual(reminderAsk('remind me at 6pm about the venice route', now), null, 'and so is a time');
  assert.notEqual(reminderAsk('remind me about the parcel tomorrow', now), null, 'and a thing, without "to"');
});

