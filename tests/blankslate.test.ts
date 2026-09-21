// The slate fades on its own, or it is still telling her to ask in March.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankSlateInstruction, blankSlateOpening, BODY_KEYS, HAND_WRITTEN, readSlate, RESET_KEYS, slateIsNewer, SLATE_DISARM_MINUTES, SLATE_SETTLED, SLATE_SETTLED_DAYS, SLATE_STRANGER, withoutPreSlate, withoutPreSlateDays } from '../electron/blankslate';

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
  assert.match(blankSlateOpening(daysAgo(0), 0, NOW), /nothing about them but their name/);
  assert.equal(blankSlateOpening(daysAgo(0), SLATE_STRANGER, NOW), '');
  assert.equal(blankSlateOpening(null, 0, NOW), '');
});

test('she is not told she has lost the one thing the reset keeps', () => {
  // The persona names him and a reset deliberately spares it, so "you do not
  // know this person's name" was contradicted in the same prompt.
  const said = blankSlateInstruction(daysAgo(0), 0, NOW);
  assert.match(said, /You know their name/);
  assert.doesNotMatch(said, /do not know this person's name/);
  assert.match(said, /part of who you are/);
});

test('a body pushing its whole log cannot put the days before the reset back', () => {
  const log = { '2026-09-18': [{ at: 'x' }], '2026-09-20': [{ at: 'y' }], '2026-09-21': [{ at: 'z' }] };
  const kept = withoutPreSlateDays(log, { at: '2026-09-20T14:00:00.000Z' }) as Record<string, unknown>;
  assert.deepEqual(Object.keys(kept), ['2026-09-20', '2026-09-21'], 'the day of the reset is kept whole');
});

test('with no slate the log is untouched, and rubbish is handed straight back', () => {
  const log = { '2026-09-18': [] };
  assert.equal(withoutPreSlateDays(log, null), log);
  assert.equal(withoutPreSlateDays(log, { at: 'not a date' }), log);
  assert.equal(withoutPreSlateDays('not a log', { at: '2026-09-20T14:00:00.000Z' }), 'not a log');
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

test('his location sharing is a setting, so the reset takes the two leaves and not the key', () => {
  assert.ok(!RESET_KEYS.includes('whereabouts'), 'the whole key holds `enabled`, which is his');
  assert.ok(!RESET_KEYS.includes('whereabouts.enabled'));
  assert.ok(RESET_KEYS.includes('whereabouts.last'));
  assert.ok(RESET_KEYS.includes('whereabouts.places'));
});

test('the state this branch grew since the list was written goes with the rest of her', () => {
  // her.weather is the wander and the bruise — the same family as her.temperament,
  // and left behind it biases the first tick of the new life with the old one's mood.
  for (const hers of ['her.weather', 'shots.captions']) {
    assert.ok(RESET_KEYS.includes(hers), `${hers} is hers and should go`);
  }
});

test('the copies the migrations left in config.json are named too', () => {
  for (const legacy of ['memories', 'chat.archive', 'memory.sessions', 'memory.forgettingLog']) {
    assert.ok(RESET_KEYS.includes(legacy), `${legacy} is a pre-migration copy of her record`);
  }
});

test('the wipe disarms itself long enough to outlast a restart loop', () => {
  // Restart=on-failure is three seconds; the drop-in that sets HARU_RESET is
  // removed by hand. Anything under a couple of minutes would re-fire.
  assert.ok(SLATE_DISARM_MINUTES >= 3, 'shorter than a restart loop is no guard at all');
  assert.ok(SLATE_DISARM_MINUTES <= 60, 'longer than an hour would refuse a second reset he meant');
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

test('a body clears its own life and leaves what he typed', () => {
  for (const typed of HAND_WRITTEN) {
    assert.ok(RESET_KEYS.includes(typed), `${typed} should still go in a reset`);
    assert.ok(!BODY_KEYS.includes(typed), `${typed} is his, and a limb does not throw it away`);
  }
  // The life it led as a second her is exactly what a body clear is for.
  for (const hers of ['tastes', 'nights', 'her.traits', 'her.months', 'mood', 'vitals']) {
    assert.ok(BODY_KEYS.includes(hers), `${hers} is the machine's own and should go`);
  }
  assert.equal(BODY_KEYS.length, RESET_KEYS.length - HAND_WRITTEN.length);
});
