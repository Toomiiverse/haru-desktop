// What the services panel adds up, and the three ways it can be wrong quietly.
//
// A cache read priced as input, a top-up counted as a refund, or a day folded
// through UTC: none of them throw, and each one puts a confident wrong number
// in front of somebody deciding whether to top an account up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceSpendDays, claudeCost, foldDays, keepSnapshots, priceFor, tokensOf, totals } from '../electron/spend';

const day = (key: string, hour = 12) => new Date(`${key}T${String(hour).padStart(2, '0')}:00:00`).getTime();

// -- pricing ----------------------------------------------------------------

test('a cached read is a tenth of the input rate, and an hour-long write is twice it', () => {
  // A million of each, on Opus: input $5, output $25, read $0.50, 5m write $6.25, 1h write $10.
  const million = 1_000_000;
  assert.equal(claudeCost('claude-opus-5', { input_tokens: million }), 5);
  assert.equal(claudeCost('claude-opus-5', { output_tokens: million }), 25);
  assert.equal(claudeCost('claude-opus-5', { cache_read_input_tokens: million }), 0.5);
  assert.equal(claudeCost('claude-opus-5', { cache_creation: { ephemeral_5m_input_tokens: million } }), 6.25);
  assert.equal(claudeCost('claude-opus-5', { cache_creation: { ephemeral_1h_input_tokens: million } }), 10);
});

test('a transcript with only the cache total is priced as a five-minute write, not as input', () => {
  const only = claudeCost('claude-opus-5', { cache_creation_input_tokens: 1_000_000 });
  assert.equal(only, 6.25);
});

test('the model picks the rate, and an unknown one is priced as Opus rather than as free', () => {
  assert.equal(priceFor('claude-haiku-4-5').input, 1);
  assert.equal(priceFor('claude-sonnet-5').output, 10);
  assert.equal(priceFor('claude-fable-5-1').cacheRead, 0.25);
  assert.equal(priceFor('something-nobody-has-heard-of').input, 5);
});

test('tokens count the cache as well — it is most of an agent turn', () => {
  assert.equal(tokensOf({ input_tokens: 2, output_tokens: 199, cache_read_input_tokens: 29_951, cache_creation_input_tokens: 15_266 }), 45_418);
});

// -- folding ----------------------------------------------------------------

test('rows land on the local day, and anything older than the window is dropped', () => {
  const rows = [
    { at: day('2026-09-20'), cost: 1, tokens: 10 },
    { at: day('2026-09-20', 23), cost: 2, tokens: 20 },
    { at: day('2026-08-01'), cost: 99, tokens: 99 },
  ];
  const days = foldDays(rows, new Date('2026-09-20T12:00:00'));
  assert.deepEqual(days, [{ day: '2026-09-20', cost: 3, tokens: 30 }]);
});

test('today, the week and the month are read off the days', () => {
  const days = [
    { day: '2026-09-10', cost: 10, tokens: 1 },
    // Six days back is inside the week, which is seven days counting today.
    { day: '2026-09-14', cost: 4, tokens: 1 },
    { day: '2026-09-20', cost: 1, tokens: 1 },
  ];
  const sum = totals(days, new Date('2026-09-20T12:00:00'));
  assert.equal(sum.today, 1);
  assert.equal(sum.week, 5);
  assert.equal(sum.month, 15);
});

// -- a balance read backwards ----------------------------------------------

// Local times on purpose: the days on the chart are his days, and a snapshot
// stamped in UTC belongs to whichever of his days it actually fell in.
test('a balance falling is spending; a top-up is not a refund', () => {
  const history = [
    { at: '2026-09-18T20:00:00', total: 20 },
    { at: '2026-09-19T20:00:00', total: 17.5 },
    // Topped up: the balance rises, and that day counts as nothing rather than as -12.50.
    { at: '2026-09-20T20:00:00', total: 30 },
  ];
  const days = balanceSpendDays(history, new Date('2026-09-21T12:00:00'));
  assert.deepEqual(days, [{ day: '2026-09-19', cost: 2.5, tokens: 0 }]);
});

test('the last snapshot of a day is the one compared, so a day is the whole day', () => {
  const history = [
    { at: '2026-09-19T01:00:00', total: 10 },
    // The one that counts for the 19th is this one, not the morning's.
    { at: '2026-09-19T22:00:00', total: 8 },
    { at: '2026-09-20T22:00:00', total: 5 },
  ];
  const days = balanceSpendDays(history, new Date('2026-09-20T23:30:00'));
  assert.deepEqual(days.map(entry => entry.cost), [3]);
});

test('snapshots thin to one a half hour and a month deep', () => {
  let history: { at: string; total: number }[] = [];
  // Four in ten minutes — a restart loop — leaves one.
  for (let minute = 0; minute < 40; minute += 10) {
    history = keepSnapshots(history, { at: `2026-09-20T10:${String(minute).padStart(2, '0')}:00.000Z`, total: 9 });
  }
  assert.equal(history.length, 1);
  history = keepSnapshots(history, { at: '2026-09-20T11:00:00.000Z', total: 8 });
  assert.equal(history.length, 2);
  // And the old ones fall off the far end.
  const aged = keepSnapshots([{ at: '2026-01-01T00:00:00.000Z', total: 50 }], { at: '2026-09-20T12:00:00.000Z', total: 8 });
  assert.deepEqual(aged.map(entry => entry.total), [8]);
});
