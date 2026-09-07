import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localEmotion,
  parseEmotion,
  faceForEmotion,
  emotionToVitals,
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

// ---- emotionToVitals: scaled by confidence ----

test('emotionToVitals nudges vitals in the documented direction, scaled by confidence', () => {
  const vitals = { happiness: 0.5, energy: 0.5, curiosity: 0.5, affection: 0.5, sleepiness: 0.2, stress: 0.2 };
  const confident = emotionToVitals({ emotion: 'happy', confidence: 1, energy: 0.5, intent: 'celebrate', focus: 'user' }, vitals);
  assert.ok(confident.happiness > vitals.happiness);
});

test('emotionToVitals barely moves vitals when confidence is near zero', () => {
  const vitals = { happiness: 0.5, energy: 0.5, curiosity: 0.5, affection: 0.5, sleepiness: 0.2, stress: 0.2 };
  const hedged = emotionToVitals({ emotion: 'annoyed', confidence: 0.01, energy: 0.5, intent: 'dismiss', focus: 'user' }, vitals);
  assert.ok(Math.abs(hedged.happiness - vitals.happiness) < 0.01);
});

test('emotionToVitals keeps every value clamped to [0, 1]', () => {
  const vitals = { happiness: 0.95, energy: 0.95, curiosity: 0.5, affection: 0.95, sleepiness: 0.2, stress: 0.2 };
  const next = emotionToVitals({ emotion: 'happy', confidence: 1, energy: 1, intent: 'celebrate', focus: 'user' }, vitals);
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    assert.ok(next[key] >= 0 && next[key] <= 1, `${key} out of range: ${next[key]}`);
  }
});

test('a run of the same reading converges instead of climbing — she cannot talk herself into a state', () => {
  // The loop this closes: a reply with a question in it comes back `curious`,
  // that raised curiosity, and past 0.8 the vital cue told her one pointed
  // question was allowed — so she asked another. By the third turn curiosity
  // sat at 1.00 and stayed there (2026-09-07, three interview questions in a
  // row in answer to "I'm so tired").
  const curious = { emotion: 'curious' as const, confidence: 0.92, energy: 0.5, intent: 'listen' as const, focus: 'user' as const };
  let vitals = { happiness: 0.5, energy: 0.5, curiosity: 0.5, affection: 0.5, sleepiness: 0.2, stress: 0.2 };
  const first = emotionToVitals(curious, vitals).curiosity - vitals.curiosity;
  // Three replies was all it took in life. 0.8 is where vitals.ts starts telling
  // her a pointed question is allowed; her own three questions must not reach it.
  for (let reply = 0; reply < 3; reply++) vitals = emotionToVitals(curious, vitals);
  assert.ok(vitals.curiosity < 0.8, `three curious replies talked her past the cue: ${vitals.curiosity}`);
  for (let reply = 0; reply < 7; reply++) vitals = emotionToVitals(curious, vitals);
  const later = emotionToVitals(curious, vitals).curiosity - vitals.curiosity;
  assert.ok(later < first / 3, `the tenth reading moved her nearly as much as the first: ${first} then ${later}`);
});

test('one strong reading still moves her properly', () => {
  const vitals = { happiness: 0.5, energy: 0.5, curiosity: 0.5, affection: 0.5, sleepiness: 0.2, stress: 0.2 };
  const next = emotionToVitals({ emotion: 'affectionate', confidence: 1, energy: 0.5, intent: 'listen', focus: 'user' }, vitals);
  assert.ok(next.affection - vitals.affection > 0.05, `a confident reading barely registered: ${next.affection}`);
});

test('emotionToVitals leaves neutral readings with no effect', () => {
  const vitals = { happiness: 0.5, energy: 0.5, curiosity: 0.5, affection: 0.5, sleepiness: 0.2, stress: 0.2 };
  const next = emotionToVitals({ emotion: 'neutral', confidence: 1, energy: 0.5, intent: 'listen', focus: 'user' }, vitals);
  assert.equal(next.happiness, vitals.happiness);
  assert.equal(next.curiosity, vitals.curiosity);
  assert.equal(next.affection, vitals.affection);
  assert.equal(next.stress, vitals.stress);
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
