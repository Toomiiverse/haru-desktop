// The seam between the mood engine and the artwork.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOTIONS } from '../electron/emotion';
import { adaptEmotion, DEFAULT_TRANSITION_MS, emotionConfig, emotionFile, HARU_EMOTIONS, isHaruEmotion, MOOD_TO_EMOTION } from '../electron/emotions';

test('every word the mood engine has is a face she has', () => {
  for (const mood of EMOTIONS) {
    const face = MOOD_TO_EMOTION[mood];
    assert.ok(isHaruEmotion(face), `${mood} maps to ${face}, which is not a face`);
  }
});

test('every face has a file named for it and a label a screen reader can say', () => {
  for (const face of HARU_EMOTIONS) {
    assert.equal(emotionConfig[face].file, `${face}.svg`);
    assert.match(emotionConfig[face].label, /^Haru /);
    assert.equal(emotionConfig[face].transition, 'fade');
  }
  assert.equal(HARU_EMOTIONS.length, 14);
});

test('the adapter takes the mood engine’s words, a face’s own name, or nonsense', () => {
  assert.equal(adaptEmotion('determined'), 'excited');
  assert.equal(adaptEmotion('affectionate'), 'love');
  assert.equal(adaptEmotion('worried'), 'sad');
  assert.equal(adaptEmotion('thinking'), 'thinking');
  assert.equal(adaptEmotion('confused'), 'confused');
  assert.equal(adaptEmotion('jubilant'), 'neutral');
  assert.equal(adaptEmotion(null), 'neutral');
});

test('only a face’s name reaches the disk', () => {
  assert.equal(emotionFile('happy'), 'happy.svg');
  assert.equal(emotionFile('../portrait'), null);
  assert.equal(emotionFile('happy.svg'), null);
  assert.equal(emotionFile(''), null);
  assert.ok(DEFAULT_TRANSITION_MS >= 150 && DEFAULT_TRANSITION_MS <= 250);
});

test('every face knows how she moves while wearing it, within reason', () => {
  for (const face of HARU_EMOTIONS) {
    const idle = emotionConfig[face].idle;
    assert.ok(idle.periodMs >= 1500 && idle.periodMs <= 8000, `${face} period`);
    assert.ok(idle.bobPx >= 0 && idle.bobPx <= 10 && idle.swayDeg >= 0 && idle.swayDeg <= 4 && idle.breath >= 0 && idle.breath <= 0.05, `${face} motion is subtle`);
  }
  assert.ok(emotionConfig.excited.idle.periodMs < emotionConfig.sleepy.idle.periodMs, 'excited moves faster than sleepy');
  assert.ok(emotionConfig.sad.idle.bobPx < emotionConfig.happy.idle.bobPx, 'sad barely moves');
});
