import test from 'node:test';
import assert from 'node:assert/strict';
import { nextIrritation, afterCooldown, nextEgo, afterEgoCooldown, isLowEffort, isRedo, isShouting, isApology, isGoodnight, isIgnoring, shoutState, afterPoke, IGNORE_THRESHOLD, IRRITATION_MAX, EGO_MAX, IRRITATION, EGO, jittered, rescaleOldMood, COOLDOWN_MINUTES, EGO_COOLDOWN_MINUTES, moodInstruction, egoInstruction, goodnightInstruction, shoutInstruction, notTwiceInstruction, repeatedPhrase } from '../electron/mood';

test('the bands are the old levels, in order, on the new scale', () => {
  const { stirred, voiced, short, fedUp, seething, stonewall, max } = IRRITATION;
  assert.deepEqual([stirred, voiced, short, fedUp, seething, stonewall, max], [11, 33, 44, 56, 67, 78, 100]);
  assert.deepEqual([EGO.smug, EGO.coasting, EGO.showing, EGO.insufferable, EGO.max], [25, 50, 63, 75, 100]);
});
