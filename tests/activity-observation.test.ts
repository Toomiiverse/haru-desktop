import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityObservations, readActivityReport, type ActivityReport } from '../electron/activity-observation';


const client = 'browser-session-0001';
const desktop = (sequence = 1, idleSeconds = 1000): ActivityReport => ({
  kind: 'desktop', client, sequence, sampleAgeMs: 0, idleSeconds, windowFocused: true, onBattery: true,
});

test('activity protocol accepts content-free readings and refuses content, clocks and invalid numbers', () => {
  for (const value of [{ kind: 'input' }, { kind: 'input', client, sequence: 1 }, desktop()]) {
    assert.deepEqual(readActivityReport(value), value);
  }
  for (const value of [null, [], {}, { kind: 'input', client }, { kind: 'input', client, sequence: -1 },
    { kind: 'input', client, sequence: 1, key: 'private' }, { ...desktop(), at: 1 },
    { ...desktop(), sampleAgeMs: 5001 }, { ...desktop(), idleSeconds: Infinity },
    { ...desktop(), idleSeconds: -1 }, { ...desktop(), windowFocused: null }]) {
    assert.equal(readActivityReport(value), null);
  }
});

test('unknown expires without becoming absence and never invents focus or battery from browser input', () => {
  const observations = new ActivityObservations();
  assert.equal(observations.read(1000).availability, 'unknown');
  observations.note('phone', { kind: 'input', client, sequence: 1 }, 1000);
  assert.deepEqual(observations.read(301_000), { availability: 'recent-input', source: 'browser',
    idleSeconds: 300, windowFocused: null, onBattery: null, receivedAgeMs: 300_000, freshSources: 1 });
  assert.equal(observations.read(301_001).idleSeconds, null);
  assert.equal(observations.read(301_001).availability, 'unknown');
});

test('idle desktop cannot erase recent phone input or lend it desktop focus', () => {
  const observations = new ActivityObservations();
  observations.note('phone', { kind: 'input', client, sequence: 1 }, 1000);
  observations.note('pc', desktop(), 2000);
  assert.deepEqual(observations.read(3000), { availability: 'recent-input', source: 'browser',
    idleSeconds: 2, windowFocused: null, onBattery: null, receivedAgeMs: 2000, freshSources: 2 });
  const pcOnly = new ActivityObservations();
  pcOnly.note('pc', { ...desktop(), sampleAgeMs: 5000 } as ActivityReport, 1000);
  assert.equal(pcOnly.read(86_000).idleSeconds, 1090);
  assert.equal(pcOnly.read(86_001).availability, 'unknown');
});

test('sequence watermarks reject duplicate and delayed input across expiry; sessions remain separate', () => {
  const observations = new ActivityObservations();
  const input: ActivityReport = { kind: 'input', client, sequence: 10 };
  assert.equal(observations.note('a', input, 1000), true);
  assert.equal(observations.note('a', input, 2000), false);
  assert.equal(observations.note('a', { ...input, sequence: 9 }, 3000), false);
  assert.equal(observations.note('b', { ...input, sequence: 1 }, 4000), true);
  assert.equal(observations.read(4000).freshSources, 2);
  assert.equal(observations.read(400_000).availability, 'unknown');
  assert.equal(observations.note('a', input, 400_001), false);
  assert.equal(observations.note('a', { ...input, sequence: 11 }, 400_002), true);
  assert.equal(observations.read(400_002).idleSeconds, 0);
});

test('conversation is evidence without client focus; clock rollback clears evidence and restart begins unknown', () => {
  const observations = new ActivityObservations();
  observations.conversation(1000);
  assert.equal(observations.read(1000).source, 'conversation');
  assert.equal(observations.read(1000).windowFocused, null);
  assert.equal(observations.read(999).availability, 'unknown');
  assert.equal(observations.read(1001).availability, 'unknown');
  assert.equal(new ActivityObservations().read(1001).availability, 'unknown');
  assert.equal(observations.note('a', desktop(), NaN), false);
  assert.equal(observations.read(NaN).availability, 'unknown');
});

test('many authenticated sources remain bounded, including conversation and local observations', () => {
  const observations = new ActivityObservations();
  for (let i = 0; i < 100; i++) observations.note('session-' + i, desktop(), 1000 + i);
  observations.conversation(1100);
  assert.equal(observations.read(1100).freshSources, 32);
  const local = observations.read(1100, { idleSeconds: 0, windowFocused: true, onBattery: false });
  assert.equal(local.freshSources, 33, 'local is an ephemeral reading, not another stored client');
});
