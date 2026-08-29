// Her own remarks, and the one thing about them that has to survive the disk.
//
// There were no tests here at all, which is how three sources came to be
// dropped on every read: readAsides validates against a hand-written SOURCES
// list, the list fell behind the union, and the mismatch is silent — a
// 'hanging' aside simply comes back as 'other'. Nothing throws, nothing logs,
// and the evening tally quietly stops counting a third of what buzzed the
// phone. The round-trip below is checked by the compiler as well as at run
// time, so the next source added cannot go missing the same way.

import test from 'node:test';
import assert from 'node:assert/strict';
import { addAside, markReached, readAsides, type Aside, type AsideSource } from '../electron/asides';

// Every member of AsideSource. This is a Record over the union, so adding a
// source without adding it here fails to compile.
const EVERY_SOURCE: Record<AsideSource, true> = {
  screen: true, screenshot: true, activity: true, fullscreen: true, reminder: true,
  idle: true, journal: true, page: true, poke: true, kept: true, system: true,
  hanging: true, weather: true, upcoming: true, other: true,
};

const sources = Object.keys(EVERY_SOURCE) as AsideSource[];

test('every source survives being written and read back', () => {
  const written = sources.map((source, index) => ({
    id: `a${index}`, at: '2026-08-29T01:00:00.000Z', day: '2026-08-29', source, text: `said by ${source}`,
  }));
  const read = readAsides(written);
  assert.equal(read.length, sources.length);
  for (const [index, source] of sources.entries()) {
    assert.equal(read[index].source, source, `"${source}" came back as "${read[index].source}"`);
  }
});

test('something that is not a source at all still lands somewhere safe', () => {
  const [read] = readAsides([{ id: 'x', at: '', day: '', source: 'telepathy', text: 'hm' }]);
  assert.equal(read.source, 'other');
});

test('whether it reached the phone round-trips, and absent stays absent', () => {
  const rows = [
    { id: 'a', at: '', day: '', source: 'idle', text: 'landed', reached: true },
    { id: 'b', at: '', day: '', source: 'idle', text: 'did not', reached: false },
    { id: 'c', at: '', day: '', source: 'idle', text: 'before the flag existed' },
  ];
  const read = readAsides(rows);
  assert.equal(read[0].reached, true);
  assert.equal(read[1].reached, false);
  // Not false, and not true: unknown, which is what the tally treats as "count it".
  assert.equal('reached' in read[2], false);
});

test('marking one reached leaves the rest of the log alone', () => {
  const { asides } = addAside([], 'oi', 'idle', new Date('2026-08-29T01:00:00.000Z'), '2026-08-29');
  const { asides: two } = addAside(asides, 'again', 'reminder', new Date('2026-08-29T02:00:00.000Z'), '2026-08-29');
  const marked = markReached(two, two[1].id, true);
  assert.equal(marked[0].reached, undefined);
  assert.equal(marked[1].reached, true);
  assert.equal(marked.length, 2);
  // And a failed push is recorded as such, not left unknown.
  assert.equal(markReached(two, two[0].id, false)[0].reached, false);
  // An id that is not there changes nothing.
  assert.deepEqual(markReached(two, 'nope', true), two satisfies Aside[]);
});
