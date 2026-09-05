// One Breeze synthesis at a time: the slot is handed on in order, and only
// once the holder gives it back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { breezeSlot } from '../electron/voice';

test('the slot goes to callers in order, each after the last has released', async () => {
  const order: string[] = [];
  const first = await breezeSlot();
  order.push('first in');
  let secondIn = false;
  const second = breezeSlot().then(release => { secondIn = true; order.push('second in'); return release; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(secondIn, false, 'the second waits while the first holds the slot');
  first();
  first(); // a second release is harmless
  const releaseSecond = await second;
  assert.deepEqual(order, ['first in', 'second in']);
  releaseSecond();
  const third = await breezeSlot();
  third();
});
