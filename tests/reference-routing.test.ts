import test from 'node:test';
import assert from 'node:assert/strict';
import { emotionHoldMs, expressionForEmotion } from '../src/companion/behaviour';
import { referenceClips } from '../src/companion/referenceClips';
import type { Emotion, EmotionName } from '../src/types';

test('reference clips match their emotion and energy, retain fallback faces, and finish their automatic beat', () => {
  const feeling = (emotion: EmotionName, energy = .5): Emotion => ({ emotion, energy, confidence: 1, intent: 'listen', focus: 'user' });
  const available = ['Heart eyes', 'Wolfram Smug', 'Wolfram Curious', 'Wolfram Sleepy', 'Wolfram Worried', ...referenceClips.map(clip => clip.name)];
  for (const [tag, low, high] of [
    ['curious', 'Curious · Cheek rest', 'Curious · Peace and cheer'],
    ['happy', 'Excited · Thumbs up', 'Cheerful · Bouncy steps'],
    ['smug', 'Wolfram Smug', 'Proud · Hands on hips'],
  ] as const) {
    assert.equal(expressionForEmotion(feeling(tag, 0), available), low);
    assert.equal(expressionForEmotion(feeling(tag, .49), available), low);
    assert.equal(expressionForEmotion(feeling(tag, .5), available), high);
    assert.equal(expressionForEmotion(feeling(tag, 1), available), high);
  }
  // A missing preferred reference must not produce a name the avatar cannot play.
  assert.equal(expressionForEmotion(feeling('curious', 1), ['Curious · Cheek rest']), 'Curious · Cheek rest');
  assert.equal(expressionForEmotion(feeling('smug', 0), ['Proud · Hands on hips']), 'Proud · Hands on hips');
  assert.equal(expressionForEmotion(feeling('happy'), ['Happy smile']), 'Happy smile');
  assert.equal(expressionForEmotion(feeling('sleepy'), available), 'Wolfram Sleepy');
  assert.equal(expressionForEmotion(feeling('curious'), []), null);
  for (const clip of referenceClips) {
    assert.equal(expressionForEmotion(feeling(clip.tag), [clip.name]), clip.name, `${clip.name} is reachable through its tag`);
    for (const energy of [0, .5, 1]) {
      assert.equal(emotionHoldMs(feeling(clip.tag, energy), clip.name), Math.max(2500 + energy * 3500, clip.duration * 1000 + 650), `${clip.name} can finish before automatic release`);
    }
  }
  assert.equal(emotionHoldMs(feeling('happy', 0)), 2500);
  assert.equal(emotionHoldMs(feeling('happy', 1), null), 6000);
  assert.equal(emotionHoldMs(feeling('smug', .5), 'Wolfram Smug'), 4250);
});
