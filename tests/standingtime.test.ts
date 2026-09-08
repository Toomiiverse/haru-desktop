import test from 'node:test';
import assert from 'node:assert/strict';
import { asksHerToOpen, openingInstruction, openingsDueNow, timeNamedIn, withinWindow } from '../electron/standingtime';

// The real page, as he wrote it on 2026-09-08. One of these four is an
// instruction to make contact; the other three are rules about how she behaves
// once contact exists, and reading any of them as a reason to speak would be
// worse than the bug this fixes.
const HIS_PAGE = [
  { text: 'Keep replies human-length and direct — no support-staff voice, no filler sign-offs.' },
  { text: "Don't interrupt with unprompted lines while Tommy is working at the shop or mid-task." },
  { text: "Don't nag about the same thing twice in a day — say it once, in her own way." },
  { text: 'Check up on Tommy to see how he’s doing in the mornings' },
];

test('only the one that asks her to make contact is due, and only in the morning', () => {
  const morning = openingsDueNow(HIS_PAGE, 9);
  assert.equal(morning.length, 1);
  assert.match(morning[0].text, /Check up on Tommy/);
  assert.equal(morning[0].when, 'morning');
  assert.equal(openingsDueNow(HIS_PAGE, 15).length, 0, 'not due in the afternoon');
  assert.equal(openingsDueNow(HIS_PAGE, 23).length, 0, 'not due at night');
});

// The failure that would matter most: "don't interrupt him in the mornings" and
// "check on him in the mornings" differ by one word and mean opposite things.
test('a prohibition is never read as an instruction to do the thing', () => {
  assert.equal(asksHerToOpen("Don't interrupt with unprompted lines while Tommy is working at the shop or mid-task."), false);
  assert.equal(asksHerToOpen("Don't text him in the mornings"), false);
  assert.equal(asksHerToOpen('Never check up on him at work'), false);
  assert.equal(asksHerToOpen("Don't nag about the same thing twice in a day"), false);
});

test('a tone rule is not a reason to speak', () => {
  assert.equal(asksHerToOpen('Keep replies human-length and direct'), false);
  assert.equal(asksHerToOpen('Be less nice and more in character when tested'), false);
});

test('an instruction with no time of day names no hour, so it never fires here', () => {
  assert.equal(timeNamedIn('Check up on Tommy to see how he is doing'), null);
  assert.equal(openingsDueNow([{ text: 'Check up on Tommy to see how he is doing' }], 9).length, 0);
});

test('the times mean what anyone means by them, and night wraps midnight', () => {
  assert.equal(withinWindow('morning', 6), true);
  assert.equal(withinWindow('morning', 12), false);
  assert.equal(withinWindow('night', 23), true);
  assert.equal(withinWindow('night', 3), true);
  assert.equal(withinWindow('night', 12), false);
});

test('the other ways he might phrase it are recognised', () => {
  for (const said of [
    'Check in on him first thing',
    'Ask how his day went in the evening',
    'Say good morning in the mornings',
    'Text him before bed',
  ]) {
    assert.equal(asksHerToOpen(said), true, `missed: ${said}`);
    assert.notEqual(timeNamedIn(said), null, `no time found in: ${said}`);
  }
});

test('the instruction carries his words and forbids reciting the rule', () => {
  const said = openingInstruction({ text: 'Check up on Tommy to see how he’s doing in the mornings', when: 'morning' });
  assert.match(said, /Check up on Tommy to see how he’s doing in the mornings/);
  assert.match(said, /have not done it yet today/);
  // A composer handed a rule reads the rule out; this is the line that stops it.
  assert.match(said, /do not quote it back/i);
});
