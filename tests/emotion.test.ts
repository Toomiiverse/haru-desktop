import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localEmotion,
  parseEmotion,
  faceForEmotion,
  EMOTIONS,
  NEUTRAL_EMOTION,
} from '../electron/emotion';

// ---- parseEmotion: validation, clamping, graceful failure ----

test('parseEmotion accepts a fully valid object', () => {
  const parsed = parseEmotion({ emotion: 'happy', confidence: 0.8, energy: 0.6, intent: 'celebrate', focus: 'user' });
  assert.deepEqual(parsed, { emotion: 'happy', confidence: 0.8, energy: 0.6, intent: 'celebrate', focus: 'user' });
});

test('parseEmotion rejects an invalid emotion enum value', () => {
  assert.equal(parseEmotion({ emotion: 'furious', confidence: 0.8, energy: 0.6, intent: 'tease', focus: 'user' }), null);
});

test('parseEmotion returns null for a missing/non-object payload rather than throwing', () => {
  assert.equal(parseEmotion(null), null);
  assert.equal(parseEmotion(undefined), null);
  assert.equal(parseEmotion(42), null);
  assert.equal(parseEmotion('not json'), null);
});

test('parseEmotion clamps out-of-range numeric fields instead of failing', () => {
  const parsed = parseEmotion({ emotion: 'curious', confidence: 5, energy: -3, intent: 'listen', focus: 'user' });
  assert.ok(parsed);
  assert.equal(parsed!.confidence, 1);
  assert.equal(parsed!.energy, 0);
});

test('parseEmotion falls back to defaults for an invalid intent/focus rather than rejecting the whole object', () => {
  const parsed = parseEmotion({ emotion: 'bored', confidence: 0.4, energy: 0.4, intent: 'nonsense', focus: 'nowhere' });
  assert.ok(parsed);
  assert.equal(parsed!.intent, 'listen');
  assert.equal(parsed!.focus, 'user');
});

test('parseEmotion parses a JSON string payload the same as an object', () => {
  const raw = JSON.stringify({ emotion: 'smug', confidence: 0.9, energy: 0.5, intent: 'tease', focus: 'user' });
  const parsed = parseEmotion(raw);
  assert.ok(parsed);
  assert.equal(parsed!.emotion, 'smug');
});

test('every EMOTIONS value round-trips through parseEmotion', () => {
  for (const emotion of EMOTIONS) {
    const parsed = parseEmotion({ emotion, confidence: 0.5, energy: 0.5, intent: 'listen', focus: 'user' });
    assert.equal(parsed?.emotion, emotion);
  }
});

test('NEUTRAL_EMOTION is a valid, parseable fallback', () => {
  const parsed = parseEmotion(NEUTRAL_EMOTION);
  assert.deepEqual(parsed, NEUTRAL_EMOTION);
});

// ---- faceForEmotion: regex-matched against whatever a model actually ships ----

test('faceForEmotion matches the real model expression set for annoyed/worried/surprised', () => {
  const available = ['Angry', 'Cry', 'scare', 'Blush', 'Blush 2', 'Full Blush', 'hat off on'];
  assert.equal(faceForEmotion('annoyed', available), 'Angry');
  assert.equal(faceForEmotion('worried', available), 'Cry');
  assert.equal(faceForEmotion('surprised', available), 'scare');
  assert.equal(faceForEmotion('affectionate', available), 'Blush');
  assert.equal(faceForEmotion('embarrassed', available), 'Full Blush');
});

test('faceForEmotion returns null when nothing in the available set matches', () => {
  assert.equal(faceForEmotion('surprised', ['Angry', 'Cry']), null);
});

test('faceForEmotion returns null for emotions deliberately left faceless', () => {
  // 'neutral', 'smug', 'bored', 'sleepy', 'determined' have no FACES entry at all.
  const available = ['Angry', 'Cry', 'scare', 'Blush', 'Blush 2', 'Full Blush'];
  assert.equal(faceForEmotion('neutral', available), null);
  assert.equal(faceForEmotion('smug', available), null);
  assert.equal(faceForEmotion('bored', available), null);
});

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

test('localEmotion reads a heated line as annoyed, matching the sharpen override', () => {
  assert.equal(localEmotion('Are you serious. Shut up and move it.'), 'annoyed');
});

test('localEmotion reads her emoji', () => {
  assert.equal(localEmotion('Dishes. 😒'), 'annoyed');
  assert.equal(localEmotion('Oh, the drama. 😏'), 'smug');
  assert.equal(localEmotion('Wait, actually? 👀'), 'curious');
});

test('localEmotion reads a question as curious', () => {
  assert.equal(localEmotion('What are you doing with that?'), 'curious');
});

test('localEmotion reads tiredness and delight in the words', () => {
  assert.equal(localEmotion('Honestly, I could nod off right here.'), 'sleepy');
  assert.equal(localEmotion('Haha, that made my day.'), 'happy');
});

test('localEmotion stays neutral when nothing is felt', () => {
  assert.equal(localEmotion('The bins go out on Tuesday.'), 'neutral');
  assert.equal(localEmotion(''), 'neutral');
});
