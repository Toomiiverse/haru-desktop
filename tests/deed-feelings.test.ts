import test from 'node:test';
import assert from 'node:assert/strict';
import { DeedFeelings } from '../electron/deed-feelings';
import { NO_FEELINGS, feel, feelingsOverTime, reportsAttentionElsewhere } from '../electron/feelings';

test('observed memory-save sequence does not clear frustration or boredom', () => {
  const policy = new DeedFeelings();
  let state = { ...NO_FEELINGS, frustration: 34, boredom: 26.63, hemmed: 11 };
  for (let n = 0; n < 2; n++) {
    for (const event of policy.events('remember_about_user', {}, '{"ok":true}', n)) state = feel(state, event, 0.5);
  }
  assert.deepEqual(state, { ...NO_FEELINGS, frustration: 34, boredom: 26.63, hemmed: 11 });
});

test('unrelated success does not erase a failure; retired recreation grants no downtime', () => {
  const policy = new DeedFeelings();
  assert.deepEqual(policy.events('browser_control', {}, '{"error":"offline"}', 0), ['broke']);
  assert.deepEqual(policy.events('remember_about_user', {}, '{"ok":true}', 1), []);
  assert.deepEqual(policy.events('browser_control', {}, '{"ok":true}', 2), ['worked']);
  assert.deepEqual(policy.events('browser_control', {}, '{"ok":true}', 3), []);
  assert.deepEqual(policy.events('play_pokemon', {action:'start'}, '{"started":true}', 4), []);
  assert.deepEqual(policy.events('read_manga', {}, '{"read":true}', 5), []);
});

test('observed near-100 loneliness cannot vanish in three messages, even at maximum relief', () => {
  let state = { ...NO_FEELINGS, missing: 99.485575 };
  for (let n = 0; n < 3; n++) state = feel(state, 'message', 1);
  assert.ok(state.missing > 70);
  assert.ok(feel({ ...NO_FEELINGS, boredom: 26.63 }, 'own-time', 1).boredom > 15);
});

test('silence changes boredom and missing, not jealousy, worry or hemmed in', () => {
  const state = feelingsOverTime(NO_FEELINGS, { minutes: 180, awakeSilentMinutes: 300, quiet: true });
  assert.equal(state.missing, 30);
  assert.equal(state.boredom, 24);
  assert.equal(state.jealousy, 0);
  assert.equal(state.fear, 0);
  assert.equal(state.hemmed, 0);
});

test('attention elsewhere requires an explicit first-person admission after time away', () => {
  const admission = 'I was chatting with friends instead of replying to you.';
  assert.equal(reportsAttentionElsewhere(admission, 60), true);
  assert.equal(reportsAttentionElsewhere("I've been talking with Alex instead of answering you", 60), true);
  assert.equal(reportsAttentionElsewhere(admission, 5), false);
  assert.equal(reportsAttentionElsewhere(admission, NaN), false);
  for (const text of [
    'I was chatting with friends', 'I was at work', 'I was not chatting with friends instead of replying to you',
    'I will be chatting with friends instead of replying to you', `He said "${admission}"`,
    `What if ${admission}`, 'I was chatting with nobody instead of replying to you',
    'I was chatting with friends instead of replying to you?',
  ]) assert.equal(reportsAttentionElsewhere(text, 120), false, text);
});
