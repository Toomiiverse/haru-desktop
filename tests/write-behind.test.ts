import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingRead } from '../electron/core-store';

test('a reader waits only for a document the in-flight commit is writing when that is the schedule, or for a nameless fence', () => {
  const patches = { config: { mood: 1 }, memories: {} };
  assert.equal(pendingRead(patches, 'config'), 'pending');     // served the state being written
  assert.equal(pendingRead(patches, 'archive'), 'committed');  // untouched by the commit: committed state is current
  assert.equal(pendingRead(patches, 'schedule'), 'fence');     // rebaseSchedule compares whole snapshots
  assert.equal(pendingRead(patches, undefined), 'fence');      // a write, or any caller that needs the commit done
  assert.equal(pendingRead(null, 'config'), 'fence');          // nothing recorded as pending: behave as before
});
