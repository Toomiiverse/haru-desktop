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

test('only success of the failed tool gives one small recovery; failure gives no downtime', () => {
  const policy = new DeedFeelings();
  assert.deepEqual(policy.events('read_manga', {}, '{"error":"offline"}', 0), ['broke']);
  assert.deepEqual(policy.events('remember_about_user', {}, '{"ok":true}', 1), []);
  assert.deepEqual(policy.events('read_manga', {}, '{"read":true}', 2), ['worked', 'own-time']);
  assert.deepEqual(policy.events('read_manga', {}, '{"read":true}', 3), []);
  assert.deepEqual(policy.events('read_manga', {}, '{"read":true}', 1_800_002), ['own-time']);
});

test('permission, declined starts, status reads, and malformed results give no reward', () => {
  const policy = new DeedFeelings();
  for (const result of ['{"confirm":false}', '{"started":false}', 'null', '[]', 'invalid']) {
    assert.deepEqual(policy.events('play_pokemon', { action: 'start' }, result, 0), []);
  }
  assert.deepEqual(policy.events('play_pokemon', { action: 'status' }, '{"ok":true}', 0), []);
  assert.deepEqual(policy.events('play_pokemon', { action: 'start' }, '{"started":true}', 0), ['own-time']);
  assert.deepEqual(policy.events('read_manga', {}, '{"read":true}', 1), [], 'shared recreation cooldown');
});
