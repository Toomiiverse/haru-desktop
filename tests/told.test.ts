// Where they said they are, kept in their own words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTold, errandDueAt, placeToldFrom, toldStillStands, toldTheyAreBusy, TOLD_STALE_MS, errandsToldFrom, errandToAskAfter, ERRAND_FRESH_MS } from '../electron/told';

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

test('the word they used for the place is the word that counts', () => {
  const t = Date.parse(now) + 60_000;
  // The Sunday she chased him through: where="shop", and "work" was in the
  // errand rather than the place (2026-09-20).
  const shop = tell('Sorry Haru, yes I’m at the shop, I’ll text you when I finish work around 4:30');
  assert.equal(shop?.where, 'shop');
  assert.equal(shop?.until, '4:30 PM');
  assert.equal(toldTheyAreBusy(shop, t), true);
  assert.equal(toldTheyAreBusy(tell('I’m at the store now'), t), true);
  assert.equal(toldTheyAreBusy(tell('I’m at the gym'), t), true);
  // An hour they named for being free is a commitment wherever they are.
  assert.equal(toldTheyAreBusy({ where: "mum's house", until: '6:00 PM', at: now }, t), true);
  // Except at home, which is not one.
  assert.equal(toldTheyAreBusy({ where: 'home', until: '4:30 PM', at: now }, t), false);
  // And a stale one is still not believed, whatever it says.
  assert.equal(toldTheyAreBusy(shop, Date.parse(now) + TOLD_STALE_MS + 1), false);
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

test('a question with the mark left off is still a question, and a bare name is not a place', () => {
  // "How're you going Haru" put him on his way to her for ten hours, and she
  // asked how the drive was (2026-09-10).
  assert.equal(tell('How’re you going Haru'), null);
  assert.equal(tell('How are you going to Perth'), null);
  assert.equal(tell("how's it going, just got home")?.where, 'home', 'the fact after the greeting stays');
  assert.equal(tell('What a day. Heading home now')?.where, 'home');
  assert.equal(tell('Going Rockingham'), null, 'no "to", and not a place she knows by name');
  assert.equal(tell('going mums')?.where, "mum's house", 'a plain place she knows needs no "to"');
  assert.equal(tell('off to Rockingham')?.where, 'Rockingham');
  assert.equal(tell('about to leave for Perth')?.enRoute, true);
  assert.deepEqual(errandsToldFrom("I'll let ya know 🤣 I'm still in bed", '2026-09-07T01:34:50.632Z'), [], '"let ya know" is not an errand');
});


test('an errand that names an hour is not asked after before the hour', () => {
  // 12:54 PM: "I'll text you when I finish work around 4:30". At 1:51 PM she
  // asked how it went, and said in the same line that it was 1:50 (2026-09-20).
  const saidAt = new Date(2026, 8, 20, 12, 54, 54);
  const errands = errandsToldFrom('Sorry Haru, yes I’m at the shop, I’ll text you when I finish work around 4:30', saidAt.toISOString());
  assert.equal(errands.length, 1, JSON.stringify(errands));
  const due = errandDueAt(errands[0]);
  assert.ok(due !== null);
  assert.equal(new Date(due!).getHours(), 16);
  assert.equal(new Date(due!).getMinutes(), 30);
  const at = (h: number, m: number) => new Date(2026, 8, 20, h, m).getTime();
  assert.equal(errandToAskAfter(errands, at(13, 51)), null, 'not two and a half hours early');
  assert.equal(errandToAskAfter(errands, at(16, 29)), null, 'not a minute early');
  assert.equal(errandToAskAfter(errands, at(16, 31))?.what, errands[0].what, 'once the hour has come, it is fair game');
  // Its three hours run from the hour it named, not from when he said it —
  // measured from the saying it would have gone stale at 3:54, before the
  // shift it was about had even ended.
  assert.equal(errandToAskAfter(errands, at(19, 29))?.what, errands[0].what, 'still askable within three hours of 4:30');
  assert.equal(errandToAskAfter(errands, at(19, 31)), null, 'three hours after the hour it named');
});

test('an hour already gone when they said it belongs to tomorrow, and an errand with no hour is unchanged', () => {
  const late = new Date(2026, 8, 20, 21, 0, 0);
  // "I'll call you at 8pm" said at nine at night is tomorrow evening, not an
  // hour that went by before he spoke.
  const evening = errandsToldFrom("I'll call you at 8pm", late.toISOString());
  const due = errandDueAt(evening[0]);
  assert.ok(due !== null && due! > late.getTime(), 'tomorrow, not an hour ago');
  assert.equal(new Date(due!).getDate(), 21);
  assert.equal(new Date(due!).getHours(), 20);
  // A bare "at 8" is not a clock — TIME wants am/pm or a colon, the same rule
  // that governs `until`. It falls back to the three hours from the saying,
  // which is the behaviour it always had.
  const bare = errandsToldFrom("I'll call you at 8", late.toISOString());
  assert.equal(errandDueAt(bare[0]), null);
  assert.equal(errandToAskAfter(bare, late.getTime() + 40 * 60_000)?.what, 'call you at 8');
  // No clock at all: unchanged.
  const shower = errandsToldFrom("I'm about to have a shower", late.toISOString());
  assert.equal(errandDueAt(shower[0]), null);
  assert.equal(errandToAskAfter(shower, late.getTime() + 40 * 60_000)?.what, 'have a shower');
});
