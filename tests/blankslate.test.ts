// The slate fades on its own, or it is still telling her to ask in March.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankSlateInstruction, blankSlateOpening, readSlate, RESET_KEYS, slateIsNewer, SLATE_SETTLED, SLATE_SETTLED_DAYS, SLATE_STRANGER, withoutPreSlate } from '../electron/blankslate';

const NOW = Date.parse('2026-09-20T10:00:00.000Z');
const daysAgo = (days: number) => ({ at: new Date(NOW - days * 86_400_000).toISOString() });

test('no slate, nothing said', () => {
  assert.equal(blankSlateInstruction(null, 0, NOW), '');
  assert.equal(blankSlateInstruction(undefined, 0, NOW), '');
});

test('a fresh slate tells her outright to ask', () => {
  const said = blankSlateInstruction(daysAgo(0), 0, NOW);
  assert.match(said, /woke up with nothing/);
  assert.match(said, /remember_about_user/);
});

test('once she knows a few things she is only told to admit the gaps', () => {
  const said = blankSlateInstruction(daysAgo(1), SLATE_STRANGER, NOW);
  assert.doesNotMatch(said, /woke up with nothing/);
  assert.match(said, /still new to them/);
});

test('it goes quiet once she has learned enough', () => {
  assert.notEqual(blankSlateInstruction(daysAgo(1), SLATE_SETTLED - 1, NOW), '');
  assert.equal(blankSlateInstruction(daysAgo(1), SLATE_SETTLED, NOW), '');
});

test('and quiet after a fortnight however little she learned', () => {
  assert.notEqual(blankSlateInstruction(daysAgo(SLATE_SETTLED_DAYS - 1), 0, NOW), '');
  assert.equal(blankSlateInstruction(daysAgo(SLATE_SETTLED_DAYS), 0, NOW), '');
});

test('a slate stamped in the future is new, not spent', () => {
  assert.notEqual(blankSlateInstruction(daysAgo(-3), 0, NOW), '');
});

test('an unreadable stamp ends it rather than lasting forever', () => {
  assert.equal(blankSlateInstruction({ at: 'not a date' }, 0, NOW), '');
});

test('the opening angle is only for the days she is a stranger', () => {
  assert.match(blankSlateOpening(daysAgo(0), 0, NOW), /do not know who this is/);
  assert.equal(blankSlateOpening(daysAgo(0), SLATE_STRANGER, NOW), '');
  assert.equal(blankSlateOpening(null, 0, NOW), '');
});

test('the reset keeps her attitude, his settings and his own things', () => {
  for (const kept of ['character', 'her.sleep', 'kept.items', 'reminders', 'checkins', 'journal.entries', 'veniceApiKey']) {
    assert.ok(!RESET_KEYS.includes(kept), `${kept} must survive a reset`);
  }
  assert.ok(RESET_KEYS.includes('profile'));
  assert.ok(RESET_KEYS.includes('tastes'));
  assert.ok(RESET_KEYS.includes('her.traits'));
  assert.equal(new Set(RESET_KEYS).size, RESET_KEYS.length, 'no key listed twice');
});

// -- the wire: her brain resets, and the bodies have to find out ---------------

const record = (id: string, createdAt: string) => ({ id, text: id, kind: 'fact', createdAt, lastSeenAt: createdAt, mentions: 1 });
const SLATE = { at: '2026-09-20T10:00:00.000Z' };

test('a slate is read off a sync payload, and nothing else is', () => {
  assert.deepEqual(readSlate({ memories: [], slate: SLATE }), SLATE);
  assert.equal(readSlate({ memories: [] }), null);
  assert.equal(readSlate({ slate: { at: 'yesterday' } }), null);
  assert.equal(readSlate(null), null);
  assert.equal(readSlate('{}'), null);
});

test('a body follows a reset it has not seen, once', () => {
  assert.equal(slateIsNewer(SLATE, null), true, 'never reset here');
  assert.equal(slateIsNewer(SLATE, SLATE), false, 'already followed');
  assert.equal(slateIsNewer(SLATE, { at: '2026-09-19T10:00:00.000Z' }), true, 'brain reset again since');
  assert.equal(slateIsNewer(SLATE, { at: '2026-09-21T10:00:00.000Z' }), false, 'this machine is ahead');
  assert.equal(slateIsNewer(null, SLATE), false, 'a brain with no slate asks nothing of anyone');
});

test('what a body pushes back cannot resurrect what the reset cleared', () => {
  const pushed = [record('old', '2026-01-04T00:00:00.000Z'), record('new', '2026-09-21T00:00:00.000Z')];
  assert.deepEqual((withoutPreSlate(pushed, SLATE) as { id: string }[]).map(m => m.id), ['new']);
});

test('a record born the instant of the reset is kept, not dropped', () => {
  assert.equal((withoutPreSlate([record('edge', SLATE.at)], SLATE) as unknown[]).length, 1);
});

test('a record with no readable birthday is old, and goes', () => {
  assert.equal((withoutPreSlate([{ id: 'legacy', text: 'x' }], SLATE) as unknown[]).length, 0);
});

test('with no slate, nothing is filtered — the merge is untouched on a machine never reset', () => {
  const theirs = [record('a', '2026-01-04T00:00:00.000Z')];
  assert.equal(withoutPreSlate(theirs, null), theirs);
  assert.equal(withoutPreSlate('not a list', SLATE), 'not a list');
});
