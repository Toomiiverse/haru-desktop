// 4470: a provider's HTTP refusal settles failed at no cost; anything without a status stays unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFailure } from '../electron/provider';
import { settlementFor } from '../electron/task-controller';

test('an answered HTTP refusal is booked as failed at no cost; a broken stream stays unknown', () => {
  const refused = httpFailure(400, JSON.stringify({ error: { message: 'Your credit balance is too low to access the Anthropic API.' } }), 'anthropic');
  assert.equal(refused.status, 400);
  assert.match(refused.message, /credit balance is too low/);
  assert.deepEqual(settlementFor(refused), { status: 'failed', costMicros: 0 });
  assert.deepEqual(settlementFor(httpFailure(429, '', 'openai')), { status: 'failed', costMicros: 0 });
  assert.deepEqual(settlementFor(new Error('aborted')), { status: 'unknown' });
  assert.deepEqual(settlementFor(Object.assign(new Error('socket hang up'), { status: 'ECONNRESET' })), { status: 'unknown' });
  assert.deepEqual(settlementFor(null), { status: 'unknown' });
});
