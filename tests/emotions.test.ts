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

test('every face says how far her eyes may go; surprised has none to move, sleepy barely', () => {
  for (const face of HARU_EMOTIONS) assert.ok(emotionConfig[face].gaze >= 0 && emotionConfig[face].gaze <= 1, face);
  assert.equal(emotionConfig.surprised.gaze, 0);
  assert.ok(emotionConfig.sleepy.gaze < 0.3 && emotionConfig.neutral.gaze === 1);
});

test('she blinks on every face that has eyes to close', () => {
  for (const face of HARU_EMOTIONS) assert.equal(typeof emotionConfig[face].blink, 'boolean', face);
  assert.equal(emotionConfig.surprised.blink, false, 'no separable eyes');
  assert.equal(emotionConfig.sleepy.blink, false, 'already closed');
  assert.equal(emotionConfig.love.blink, false, 'hearts');
  assert.equal(HARU_EMOTIONS.filter(face => emotionConfig[face].blink).length, 11);
});

test('every face says how she holds herself, within reason; sleepy and sad droop', () => {
  for (const face of HARU_EMOTIONS) {
    const pose = emotionConfig[face].pose;
    assert.ok(pose.tiltDeg >= 0 && pose.tiltDeg <= 15 && pose.roam >= 0 && pose.roam <= 0.15 && Math.abs(pose.leanDeg) <= 6, `${face} holds herself within reason`);
  }
  assert.ok(emotionConfig.curious.pose.tiltDeg > emotionConfig.neutral.pose.tiltDeg, 'curious cocks her head');
  assert.ok(emotionConfig.sleepy.pose.leanDeg > 0 && emotionConfig.sad.pose.leanDeg > 0, 'sleepy and sad droop');
  assert.ok(emotionConfig.excited.pose.roam > emotionConfig.sad.pose.roam, 'excited roams, sad stays put');
});

test('thinking is still: less float than neutral, no roaming, a slight tilt at most', () => {
  const t = emotionConfig.thinking, n = emotionConfig.neutral;
  assert.ok(t.idle.bobPx < n.idle.bobPx / 2 && t.idle.swayDeg < n.idle.swayDeg / 2, 'a faint float');
  assert.equal(t.pose.roam, 0, 'no roaming while thinking');
  assert.ok(t.pose.tiltDeg <= 4, 'a slight tilt at most');
});
