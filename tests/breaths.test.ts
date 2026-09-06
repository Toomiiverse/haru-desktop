// Her breaths, by mood: a laugh where she is amused, an hmph where she is not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { breathKind, kindsFor, pickBreath } from '../electron/breaths';

const FILES = [
  '/b/laugh-soft-01.wav', '/b/laugh-chuckle-02.wav', '/b/hmph-01.wav', '/b/throat-clear-01.wav', '/b/sigh-hmmm-soft-01.wav',
];

test('the kind is read off the name, and an unnamed file is a sigh', () => {
  assert.equal(breathKind('/b/laugh-soft-01.wav'), 'laugh');
  assert.equal(breathKind('/b/laugh-chuckle-02.wav'), 'laugh');
  assert.equal(breathKind('/b/hmph-01.wav'), 'hmph');
  assert.equal(breathKind('/x/grunt-iso-03.wav'), 'hmph', 'the old reel\'s grunts are hmphs');
  assert.equal(breathKind('/b/throat-clear-01.wav'), 'throat');
  assert.equal(breathKind('/b/sigh-hmmm-soft-01.wav'), 'sigh');
  assert.equal(breathKind('/x/sigh-iso-02.wav'), 'sigh');
  assert.equal(breathKind('/x/breath.wav'), 'sigh');
});

test('each mood breathes its own kind: laughs when amused, hmph when not, a sigh when flat', () => {
  assert.equal(pickBreath(FILES, 'happy', () => 0), '/b/laugh-soft-01.wav');
  assert.equal(pickBreath(FILES, 'happy', () => 0.99), '/b/laugh-chuckle-02.wav');
  assert.equal(pickBreath(FILES, 'affectionate', () => 0), '/b/laugh-soft-01.wav');
  assert.equal(pickBreath(FILES, 'annoyed', () => 0), '/b/hmph-01.wav');
  assert.equal(pickBreath(FILES, 'surprised', () => 0), '/b/hmph-01.wav');
  assert.equal(pickBreath(FILES, 'sleepy', () => 0), '/b/sigh-hmmm-soft-01.wav');
  assert.equal(pickBreath(FILES, 'bored', () => 0.5), '/b/sigh-hmmm-soft-01.wav');
  assert.equal(pickBreath(FILES, 'neutral', () => 0), '/b/throat-clear-01.wav');
  assert.deepEqual(kindsFor('smug'), ['laugh', 'hmph']);
  assert.equal(pickBreath(FILES, 'smug', () => 0), '/b/laugh-soft-01.wav');
});

test('a mood with no file of its kind falls through to the next kind, then to anything; nothing gives nothing', () => {
  const noLaughs = FILES.filter(file => !file.includes('laugh'));
  assert.equal(pickBreath(noLaughs, 'happy', () => 0), '/b/sigh-hmmm-soft-01.wav', 'a laugh wanted, a sigh will do');
  assert.equal(pickBreath(['/b/laugh-soft-01.wav'], 'annoyed', () => 0), '/b/laugh-soft-01.wav', 'only a laugh on disk: better than silence');
  assert.equal(pickBreath(FILES, 'something-else', () => 0.2), '/b/laugh-chuckle-02.wav', 'an unknown mood takes whichever comes');
  assert.equal(pickBreath(FILES, null, () => 0.999), '/b/sigh-hmmm-soft-01.wav');
  assert.equal(pickBreath([], 'happy'), null);
  assert.equal(pickBreath(['', ''], 'happy'), null);
});
