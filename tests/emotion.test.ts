import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localEmotion,
  parseEmotion,
  faceForEmotion,
  CORE_EMOTIONS,
  EMOTIONS,
  NEUTRAL_EMOTION,
} from '../electron/emotion';

// ---- her reading must not reach her vitals ----

// This was emotionToVitals, and six tests kept it honest: damped by headroom so
// a run of the same label converged rather than climbing. It is gone, because
// damping a loop is not the same as not having one. Her own prose set her mood
// — 108 real replies through the real classifier moved happiness -0.16, stress
// +0.12, energy -0.10 with nothing having happened to her at all. What is
// guarded now is the absence: nothing this module produces may move a vital.
test('nothing in emotion.ts can move a vital', async () => {
  const emotion = await import('../electron/emotion') as Record<string, unknown>;
  const vitals = { happiness: 0.5, energy: 0.5, curiosity: 0.5, affection: 0.5, sleepiness: 0.2, stress: 0.2, focus: 0.5 };
  for (const [name, exported] of Object.entries(emotion)) {
    if (typeof exported !== 'function') continue;
    const before = JSON.stringify(vitals);
    try { (exported as (...args: unknown[]) => unknown)(NEUTRAL_EMOTION, vitals); } catch { /* wrong shape for this export, which is the point */ }
    assert.equal(JSON.stringify(vitals), before, `${name} mutated the vitals it was handed`);
  }
  // And the door it used to come through is shut.
  assert.equal(emotion.emotionToVitals, undefined, 'the loop is back');
});
