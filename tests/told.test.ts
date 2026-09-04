// Where they said they are, kept in their own words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTold, placeToldFrom, toldStillStands, toldTheyAreBusy, TOLD_STALE_MS, errandsToldFrom, errandToAskAfter, ERRAND_FRESH_MS } from '../electron/told';

const now = '2026-08-30T04:46:00.000Z';
const tell = (text: string) => placeToldFrom(text, now);

test("the afternoon that went wrong, in their own words", () => {
  const work = tell('I’m at work now in Rockingham. Working at Happytel Rockingham. I work here every Sunday. Usually from 12-4:30 😇')!;
  assert.ok(work);
  assert.match(work.where, /^at work \(Happytel Rockingham\)/);
  assert.equal(work.until, '4:30 PM');
  const plan = tell('Thanks for the reminder Haru. I’m at work in Rockingham, and finish at 4:30. I plan to go straight after work')!;
  assert.equal(plan.where, 'at work (Rockingham)');
  assert.equal(plan.until, '4:30 PM');
  const soon = tell('Finishing work in about 14 minutes! Then heading straight there')!;
  assert.equal(soon.where, 'at work');
  // The until is the host's local time for now+14min, run through the same
  // clock() the code uses — asserted against that rather than a fixed TZ, so
  // this test passes on any runner (CI runs UTC; the box runs AWST).
  // clock() adds 12 to a bare hour of 1-7 ("finish at 4:30 is the afternoon"),
  // so the expectation has to apply that too.
  const soonAt = new Date(Date.parse(now) + 14 * 60_000);
  let soonHour = soonAt.getHours(); const soonMin = String(soonAt.getMinutes()).padStart(2, '0');
  if (soonHour >= 1 && soonHour <= 7) soonHour += 12;
  const soonPm = soonHour >= 12; const soonH12 = soonHour % 12 === 0 ? 12 : soonHour % 12;
  assert.equal(soon.until, `${soonH12}:${soonMin} ${soonPm ? 'PM' : 'AM'}`, String(soon.until));
  const off = tell('Alright I finished work, heading to mum’s now')!;
  assert.equal(off.where, "mum's house");
  assert.equal(off.enRoute, true);
  const there = tell('Alright I’ve arrived at mums house now')!;
  assert.equal(there.where, "mum's house");
  assert.equal(there.enRoute, undefined);
  assert.equal(tell('I just got out the shower'), null);
  assert.equal(tell('how long does it take to get to Rockingham?'), null);
  assert.equal(tell('Got the Nutella !'), null);
  assert.equal(tell('I’m home')?.where, 'home');
  // The morning it went wrong: eight chases for a man who had said this.
  const leaving = tell('Leaving for the store now. How’s the traffic from Murdoch into Perth this morning?')!;
  assert.equal(leaving.where, 'store'); assert.equal(leaving.enRoute, true);
  assert.equal(tell('Left for work')?.enRoute, true);
});

test('what she is told, and when it stops being true', () => {
  const clockNow = () => '12:46 PM';
  const told = tell('I’m at work now in Rockingham, working at Happytel, finish at 4:30 then heading to mums')!;
  const said = describeTold(told, Date.parse(now) + 5 * 60_000, clockNow);
  assert.match(said, /They told you 5 minutes ago that they are at work \(Happytel\)/);
  assert.match(said, /until about 4:30 PM/);
  assert.match(said, /then going to mum's house/);
  assert.match(said, /do not ask where they are/);
  assert.equal(toldStillStands(told, Date.parse(now) + TOLD_STALE_MS + 1), false);
  assert.equal(describeTold(told, Date.parse(now) + TOLD_STALE_MS + 1, clockNow), '');
  assert.equal(describeTold(undefined, Date.parse(now), clockNow), '');
});

test('at work or on the road is busy, at home is not', () => {
  const t = Date.parse(now) + 60_000;
  assert.equal(toldTheyAreBusy(tell('I’m at work now'), t), true);
  assert.equal(toldTheyAreBusy(tell('heading to mum’s now'), t), true);
  assert.equal(toldTheyAreBusy(tell('I’ve arrived at mums house now'), t), false);
  assert.equal(toldTheyAreBusy(tell('I’m home'), t), false);
  assert.equal(toldTheyAreBusy(undefined, t), false);
});

test('what they said they were off to do is kept, so she has something to ask after', () => {
  const at = '2026-08-31T13:48:00.000Z';
  assert.deepEqual(errandsToldFrom("Alright I'll be right back. I'm going to eat dinner and have a shower", at).map(e => e.what), ['eat dinner', 'have a shower']);
  assert.deepEqual(errandsToldFrom('right, im going to eat dinner and have a shower, back soon', at).map(e => e.what), ['eat dinner', 'have a shower'], 'the sign-off is not an errand');
  assert.deepEqual(errandsToldFrom('gonna go play some chainsaw man', at).map(e => e.what), ['go play some chainsaw man']);
  assert.deepEqual(errandsToldFrom("I'm going to be honest with you", at), [], 'being honest is not an errand');
  assert.deepEqual(errandsToldFrom("I'll let you know", at), []);
  assert.deepEqual(errandsToldFrom('no plans at all', at), []);
  const errands = errandsToldFrom("I'm about to have a shower", at);
  const now = Date.parse(at);
  assert.equal(errandToAskAfter(errands, now + 40 * 60_000)?.what, 'have a shower');
  assert.equal(errandToAskAfter(errands, now + ERRAND_FRESH_MS + 1), null, 'stale after three hours');
  assert.equal(errandToAskAfter([], now), null);
});

test('a place they told her about is not a question to ask again', () => {
  const said = describeTold({ where: 'home', at: '2026-08-31T11:32:00.000Z' }, Date.parse('2026-08-31T11:40:00.000Z'), () => '7:32 pm');
  assert.match(said, /do not open by asking whether they are still there/);
  assert.doesNotMatch(said, /"still at home\?"/, 'the example sentence went out verbatim as a notification, twice');
});

