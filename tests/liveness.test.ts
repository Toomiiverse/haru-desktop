// The outage state machine, apart from the disk and the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FAIL_THRESHOLD, DEFAULT_RESTART_AFTER_MS, EMPTY_LIVENESS, backMessage, formatGap, probeOutcome, readLiveness, unreachableMessage } from '../electron/liveness';

test('what was on disk is read as numbers, and rubbish as nothing', () => {
  assert.deepEqual(readLiveness(undefined), EMPTY_LIVENESS);
  assert.deepEqual(readLiveness({ lastAliveAt: 'nonsense', failures: -3 }), EMPTY_LIVENESS);
  assert.deepEqual(readLiveness({ lastAliveAt: 10, downSince: 5, downAlertedAt: 6, failures: 2.9, restartedAt: 7 }), { lastAliveAt: 10, downSince: 5, downAlertedAt: 6, failures: 2, restartedAt: 7 });
});

test('one missed probe is not an outage, and the alert sounds once', () => {
  let state = { ...EMPTY_LIVENESS, lastAliveAt: 1_000 };
  const at = 2_000;
  let outcome = probeOutcome(state, false, at);
  state = outcome.state;
  assert.equal(outcome.action, 'none', 'a single blip stays quiet');
  assert.equal(state.downSince, at, 'the outage is dated from the first miss');
  for (let i = 1; i < DEFAULT_FAIL_THRESHOLD; i += 1) {
    outcome = probeOutcome(state, false, at + i);
    state = outcome.state;
  }
  assert.equal(outcome.action, 'alert-down', 'the threshold crossed raises the phone');
  const again = probeOutcome(state, false, at + 10);
  assert.equal(again.action, 'none', 'and not again on every probe after');
  assert.equal(again.state.downAlertedAt, state.downAlertedAt);
});

test('answering again clears the outage and remembers when it did', () => {
  let state = { ...EMPTY_LIVENESS, lastAliveAt: 1_000 };
  for (let i = 0; i < DEFAULT_FAIL_THRESHOLD; i += 1) state = probeOutcome(state, false, 2_000 + i).state;
  assert.ok(state.downAlertedAt > 0 && state.failures >= DEFAULT_FAIL_THRESHOLD);
  const recovered = probeOutcome(state, true, 3_000);
  assert.deepEqual(recovered.state, { lastAliveAt: 3_000, downSince: 0, downAlertedAt: 0, failures: 0, restartedAt: 0 });
  assert.equal(recovered.action, 'none');
});

test('one restart is tried per outage, after it has run long enough to not be a deploy', () => {
  let state = { ...EMPTY_LIVENESS, lastAliveAt: 1_000 };
  state = probeOutcome(state, false, 2_000).state;               // outage begins at 2_000
  const early = probeOutcome(state, false, 2_000 + DEFAULT_RESTART_AFTER_MS - 1);
  assert.equal(early.restartNow, false);
  state = early.state;
  const due = probeOutcome(state, false, 2_000 + DEFAULT_RESTART_AFTER_MS);
  assert.equal(due.restartNow, true);
  state = due.state;
  assert.ok(state.restartedAt > 0);
  assert.equal(probeOutcome(state, false, 2_000 + 10 * DEFAULT_RESTART_AFTER_MS).restartNow, false, 'not again this outage');
});

test('a gap reads as a person would say it', () => {
  assert.equal(formatGap(40_000), '40 seconds');
  assert.equal(formatGap(60_000), '60 seconds');
  assert.equal(formatGap(2 * 60_000), '2 minutes');
  assert.equal(formatGap(45 * 60_000), '45 minutes');
  assert.equal(formatGap(3 * 3_600_000 + 5 * 60_000), '3 h 5 min');
  assert.equal(formatGap(4 * 3_600_000), '4 h');
  assert.equal(formatGap(30 * 3_600_000), 'a day');
  assert.equal(formatGap(3 * 86_400_000), '3 days');
});

test('the two lines say which half of the outage is speaking', () => {
  assert.match(unreachableMessage(), /door has stopped answering/);
  assert.equal(backMessage(2 * 60_000), "I'm back. I was down for 2 minutes.");
});
