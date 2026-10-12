import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarClipEntries } from '../src/companion/avatar';
test('avatar pack accepts local body clips and rejects paths outside its clips folder', () => {
  assert.deepEqual(avatarClipEntries({ happy: 'clips/happy.vrma' }), [['happy', 'clips/happy.vrma']]);
  for (const value of [null, [], {}, { happy: '../happy.vrma' }, { happy: 'https://example.com/x.vrma' }, { happy: 'clips/../x.vrma' }, { happy: 1 }, { 'bad/name': 'clips/x.vrma' }]) assert.throws(() => avatarClipEntries(value));
});
