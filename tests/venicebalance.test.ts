import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBalances, balanceLevel, balanceWarning } from '../electron/venicebalance';

test('the balances are read out of what Venice returns, and nothing else', () => {
  assert.deepEqual(parseBalances({ data: { balances: { USD: -0.00577316, DIEM: 0 }, apiTier: { id: 'paid' } } }), { usd: -0.00577316, diem: 0 });
  assert.deepEqual(parseBalances({ data: { balances: { USD: '12.5' } } }), { usd: 12.5, diem: 0 });
  assert.equal(parseBalances({ data: {} }), null);
  assert.equal(parseBalances({ error: 'nope' }), null);
  assert.equal(parseBalances(null), null);
});

test('low is under the threshold with the two pools together; empty is nothing left', () => {
  assert.equal(balanceLevel({ usd: 12, diem: 0 }, 2), 'fine');
  assert.equal(balanceLevel({ usd: 0.5, diem: 3 }, 2), 'fine', 'diem counts');
  assert.equal(balanceLevel({ usd: 1.4, diem: 0 }, 2), 'low');
  assert.equal(balanceLevel({ usd: -0.006, diem: 0 }, 2), 'empty');
  assert.equal(balanceLevel({ usd: 0.005, diem: 0 }, 2), 'empty', 'a cent is not a balance');
});

test('a warning is said once a day per level, and a top-up starts the count again', () => {
  const noon = new Date('2026-09-06T04:00:00.000Z');
  const low = balanceWarning({ usd: 1.4, diem: 0 }, 2, {}, noon);
  assert.ok(low && low.level === 'low' && /\$1\.40/.test(low.line) && /local model/.test(low.line));
  assert.equal(balanceWarning({ usd: 1.2, diem: 0 }, 2, { level: 'low', at: noon.toISOString() }, new Date(noon.getTime() + 3 * 3_600_000)), null, 'not again three hours later');
  const empty = balanceWarning({ usd: 0, diem: 0 }, 2, { level: 'low', at: noon.toISOString() }, new Date(noon.getTime() + 3 * 3_600_000));
  assert.ok(empty && empty.level === 'empty' && /out of credit/.test(empty.line), 'running out is a new thing to say');
  assert.ok(balanceWarning({ usd: 1.0, diem: 0 }, 2, { level: 'low', at: noon.toISOString() }, new Date(noon.getTime() + 25 * 3_600_000)), 'a day later it is worth saying again');
  assert.equal(balanceWarning({ usd: 20, diem: 0 }, 2, { level: 'empty', at: noon.toISOString() }, noon), null, 'topped up: nothing to say');
});
