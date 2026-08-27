import test from 'node:test';
import assert from 'node:assert/strict';
import { expireHaunts, isJunkHaunt, worthRemembering, type Haunt } from '../electron/familiar';

const NOW = Date.parse('2026-08-20T00:00:00.000Z');
const DAY = 86_400_000;

function haunt(overrides: Partial<Haunt> & { key: string; label: string }): Haunt {
  return {
    kind: 'watching',
    firstSeen: new Date(NOW - 2 * DAY).toISOString(),
    lastSeen: new Date(NOW - DAY).toISOString(),
    visits: 1,
    minutes: 0,
    ...overrides,
  };
}

test('isJunkHaunt catches telemetry-shaped keys', () => {
  assert.equal(isJunkHaunt('steamwebhelper'), true);
  assert.equal(isJunkHaunt('cmd'), true);
  assert.equal(isJunkHaunt('windows powershell'), true);
  assert.equal(isJunkHaunt('c:\\windows\\system32\\cmd.exe'), true);
  assert.equal(isJunkHaunt('youtube.com/watch?v=abc123'), true);
  assert.equal(isJunkHaunt('www.etsy.com'), true);
  assert.equal(isJunkHaunt('www.etsy.com wants to open'), true);
  assert.equal(isJunkHaunt('youtube'), false);
  assert.equal(isJunkHaunt('canva'), false);
  assert.equal(isJunkHaunt('gmail'), false);
});

test('expireHaunts drops valueless haunts after a week', () => {
  const fresh = haunt({ key: 'canva', label: 'Canva', minutes: 0, lastSeen: new Date(NOW - 3 * DAY).toISOString() });
  const old = haunt({ key: 'gmail', label: 'Gmail', minutes: 0, lastSeen: new Date(NOW - 10 * DAY).toISOString() });
  const out = expireHaunts({ canva: fresh, gmail: old }, NOW);
  assert.deepEqual(Object.keys(out), ['canva']);
});

test('expireHaunts keeps a haunt that earned its place', () => {
  const valuable = haunt({ key: 'canva', label: 'Canva', minutes: 40, lastSeen: new Date(NOW - 30 * DAY).toISOString() });
  const out = expireHaunts({ canva: valuable }, NOW);
  assert.deepEqual(Object.keys(out), ['canva']);
});

test('expireHaunts drops junk keys after a day even when recent', () => {
  const junk = haunt({ key: 'steamwebhelper', label: 'steamwebhelper', minutes: 0, lastSeen: new Date(NOW - 2 * DAY).toISOString() });
  const out = expireHaunts({ steamwebhelper: junk }, NOW);
  assert.deepEqual(Object.keys(out), []);
});

test('expireHaunts is a no-op when nothing qualifies', () => {
  const a = haunt({ key: 'canva', label: 'Canva', minutes: 5, lastSeen: new Date(NOW - 2 * DAY).toISOString() });
  const input = { canva: a };
  const out = expireHaunts(input, NOW);
  assert.equal(out, input);
});

test('worthRemembering needs a pattern, not a single sitting', () => {
  const oneSitting = haunt({ key: 'canva', label: 'Canva', minutes: 60, visits: 1, notes: ['a', 'b'], firstSeen: new Date(NOW - 30 * 60_000).toISOString(), lastSeen: new Date(NOW - 5 * 60_000).toISOString() });
  assert.equal(worthRemembering(oneSitting), false);
});

test('worthRemembering accepts coming back across visits', () => {
  const returning = haunt({ key: 'canva', label: 'Canva', minutes: 35, visits: 4, notes: ['a', 'b'], firstSeen: new Date(NOW - 10 * DAY).toISOString() });
  assert.equal(worthRemembering(returning), true);
});

test('worthRemembering accepts a long visit spread over days', () => {
  const spread = haunt({ key: 'canva', label: 'Canva', minutes: 45, visits: 2, notes: ['a', 'b'], firstSeen: new Date(NOW - 3 * DAY).toISOString(), lastSeen: new Date(NOW - DAY).toISOString() });
  assert.equal(worthRemembering(spread), true);
});

test('worthRemembering stays false after being remembered', () => {
  const remembered = haunt({ key: 'canva', label: 'Canva', minutes: 35, visits: 4, notes: ['a', 'b'], remembered: true });
  assert.equal(worthRemembering(remembered), false);
});