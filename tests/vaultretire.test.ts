import test from 'node:test';
import assert from 'node:assert/strict';
import { goneFromPage, planRetirement, readAdmitted, recordsToRetire, type RetirableRecord } from '../electron/vaultretire';

const record = (text: string, over: Partial<RetirableRecord> = {}): RetirableRecord =>
  ({ text, kind: 'preference', status: 'active', source: 'explicit', ...over });

// The real edit, on 2026-09-08. He replaced a prohibition with its own reversal
// and the prohibition stayed active, so both were in the same block.
const BEFORE = [
  'Keep replies human-length and direct.',
  "Don't interrupt with unprompted lines while Tommy is working at the shop or mid-task.",
  'Remind Tommy about bin night on Thursdays.',
];
const AFTER = [
  'Keep replies human-length and direct.',
  'She can interrupt whenever she likes, the shop included.',
];

test('a bullet he took off the page is retired; the ones still on it are not', () => {
  const plan = planRetirement(BEFORE, AFTER);
  assert.deepEqual(plan.gone.sort(), [
    "Don't interrupt with unprompted lines while Tommy is working at the shop or mid-task.",
    'Remind Tommy about bin night on Thursdays.',
  ].sort());
  assert.equal(plan.held, undefined);
});

// The failure that would matter most: a file half-written, unreadable, or
// momentarily empty must not retire every preference he has.
test('a page that parses to nothing retires nothing', () => {
  const plan = planRetirement(BEFORE, []);
  assert.deepEqual(plan.gone, []);
  assert.equal(plan.held, 'the page parsed to nothing');
});

test('the first sync only records, it never retires', () => {
  const plan = planRetirement(undefined, AFTER);
  assert.deepEqual(plan.gone, []);
  assert.equal(plan.held, 'first sync, nothing to compare');
});

test('a bullet added rather than removed changes nothing', () => {
  assert.deepEqual(goneFromPage(AFTER, [...AFTER, 'Topics: anything goes.']), []);
});

test('whitespace is not a deletion', () => {
  assert.deepEqual(goneFromPage(['  Keep replies short.  '], ['Keep replies short.']), []);
});

// It may only ever retire what the page itself once said.
test('something she was told in conversation is never touched', () => {
  const gone = ["Don't interrupt with unprompted lines while Tommy is working at the shop or mid-task."];
  const memories = [
    record(gone[0]),
    record(gone[0], { source: 'conversation' }),
    record('Prefers exciting tasks over boring admin work', { source: 'conversation' }),
  ];
  const hit = recordsToRetire(memories, gone, 'preference');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].source, 'explicit');
});

test('a record of another kind that reads alike is left alone', () => {
  const gone = ['Johnny — Tommy’s stepfather'];
  const memories = [record(gone[0], { kind: 'relationship' }), record(gone[0], { kind: 'fact' })];
  assert.equal(recordsToRetire(memories, gone, 'relationship').length, 1);
});

test('nothing already shelved is retired a second time', () => {
  const gone = ['Remind Tommy about bin night on Thursdays.'];
  const memories = [
    record(gone[0], { status: 'archived' }),
    record(gone[0], { supersededBy: 'something-else' }),
  ];
  assert.deepEqual(recordsToRetire(memories, gone, 'preference'), []);
});

test('junk on disk is not a page history', () => {
  assert.deepEqual(readAdmitted(null), {});
  assert.deepEqual(readAdmitted(['a']), {});
  assert.deepEqual(readAdmitted({ 'Preferences.md': 'not a list' }), {});
  assert.deepEqual(readAdmitted({ 'Preferences.md': ['a', 3, '  '] }), { 'Preferences.md': ['a'] });
});
