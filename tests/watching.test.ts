import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_HOLDS_MS, recentScene, sceneAsk, worthMentioning } from '../electron/watching';
import { screenContext } from '../electron/prompt';

test('a scene is hers to draw on while it is recent, and gone once it is stale', () => {
  const now = 1_000_000_000;
  assert.equal(recentScene('Anby at 12% HP, two enemies left', now - 60_000, now), 'Anby at 12% HP, two enemies left');
  assert.equal(recentScene('Anby at 12% HP, two enemies left', now - SCENE_HOLDS_MS - 1, now), '');
  assert.equal(recentScene('', now, now), '');
  assert.equal(recentScene('a scene', 0, now), '');
});

test('the eyes are asked for game state under the game they are playing', () => {
  const ask = sceneAsk('Zenless Zone Zero');
  assert.match(ask, /Zenless Zone Zero/);
  assert.match(ask, /health/i);
  assert.doesNotMatch(sceneAsk(''), /— /);
});

test('the reply prompt carries what she saw, and only the window when she has not looked', () => {
  const withScene = screenContext({ label: 'Zenless Zone Zero', scene: 'Anby at 12% HP, two enemies left' }, Date.now());
  assert.match(withScene, /Anby at 12% HP/);
  const without = screenContext({ label: 'Zenless Zone Zero', scene: '' }, Date.now());
  assert.doesNotMatch(without, /glanced/);
});

test('a menu is not worth a remark, and the same fight twice is not news', () => {
  assert.equal(worthMentioning('The pause menu is open.', ''), false);
  assert.equal(worthMentioning('Anby is fighting two enemies at 12% HP', ''), true);
  assert.equal(worthMentioning('Anby is fighting two enemies at 12% HP', 'Anby is fighting two enemies at 14% HP'), false);
});
