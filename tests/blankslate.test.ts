// The slate fades on its own, or it is still telling her to ask in March.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankSlateInstruction, blankSlateOpening, BODY_KEYS, HAND_WRITTEN, readSlate, RESET_KEYS, slateIsNewer, SLATE_DISARM_MINUTES, SLATE_SETTLED, SLATE_SETTLED_DAYS, SLATE_STRANGER, strangerIdentityNote, strangerLean, STRANGER_LEAN, STRANGER_VITALS, withoutPreSlate, withoutPreSlateDays } from '../electron/blankslate';
import { DEFAULT_VITALS } from '../electron/vitals';

const NOW = Date.parse('2026-09-20T10:00:00.000Z');
const daysAgo = (days: number) => ({ at: new Date(NOW - days * 86_400_000).toISOString() });

test('she starts colder than the defaults, and his affection at nothing', () => {
  assert.ok(STRANGER_VITALS.affection < DEFAULT_VITALS.affection, 'affection is the thing he earns back');
  assert.ok(STRANGER_VITALS.stress > DEFAULT_VITALS.stress, 'waking with nothing is not restful');
  assert.ok(STRANGER_VITALS.happiness < DEFAULT_VITALS.happiness);
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
