// Hearing him: how Hume's prosody scores become the room she reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HUME, readHumeConfig, readingFrom } from '../electron/hume';

test('readHumeConfig defaults on and keeps an explicit off', () => {
  assert.deepEqual(readHumeConfig(undefined), { expressionsEnabled: true });
  assert.deepEqual(readHumeConfig({ expressionsEnabled: false }), { expressionsEnabled: false });
  assert.deepEqual(readHumeConfig(null), DEFAULT_HUME);
});

test('a quiet or flat clip reads as nothing', () => {
  assert.deepEqual(readingFrom({ Calmness: 0.8, Interest: 0.6 }), { rough: false, why: '' });
  assert.deepEqual(readingFrom({}), { rough: false, why: '' });
});

test('anger reads as annoyed, distress and exhaustion as worn out', () => {
  const annoyed = readingFrom({ Anger: 0.7, Calmness: 0.1 });
  assert.equal(annoyed.rough, true);
  assert.match(annoyed.why, /annoyed/);
  const worn = readingFrom({ Exhaustion: 0.8, Sadness: 0.5 });
  assert.equal(worn.rough, true);
  assert.match(worn.why, /worn out/);
  const anxious = readingFrom({ Anxiety: 0.6, Distress: 0.5 });
  assert.equal(anxious.rough, true);
  assert.match(anxious.why, /off/, 'distress and anxiety are an unplaceable "off", but still rough');
});

test('a mild reading is ignored rather than nagging him', () => {
  assert.deepEqual(readingFrom({ Anger: 0.1, Calmness: 0.5 }), { rough: false, why: '' });
});