// The day's notes, and the clock they are read back on.
//
// A check-in is filed under a CHAT_TIMEZONE day key and read back by one, but
// its time was rendered with whatever zone the machine happened to be in. On
// the server, eight hours behind, a note written at nine in the morning came
// back as 01:00 — beside a prompt line saying "It is 9:00 AM" — so the day's
// first note appeared to have been written before the day began, and "anxious
// at 9, fine by 2" read in the wrong order. That ordering is the entire reason
// the times are kept.
//
// asides.ts:170 does the same job correctly and takes the zone as an argument.
// This one was copied from it without the argument, which is why the pair are
// tested together here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInInstruction, checkInsOn, summariseCheckIns, type CheckIn } from '../electron/checkins';

const PERTH = 'Australia/Perth';
const UTC = 'UTC';
const NEW_YORK = 'America/New_York';

/** 09:00 and 14:00 Perth on 2026-09-03. */
const morning: CheckIn = { id: 'a', date: '2026-09-03', at: '2026-09-03T01:00:00.000Z', note: 'anxious about the inspection', anxiety: 7 };
const afternoon: CheckIn = { id: 'b', date: '2026-09-03', at: '2026-09-03T06:00:00.000Z', note: 'went fine', anxiety: 2 };

test('a note is stamped on the user\'s clock, whatever the machine is set to', () => {
  const said = summariseCheckIns([morning, afternoon], PERTH);
  assert.ok(said.includes('09:00'), said);
  assert.ok(said.includes('14:00'), said);
});

test('a different zone is a different clock, which is the whole point of the argument', () => {
  // Not a bug, and the reason the fix is a parameter rather than a constant:
  // the times are rendered for whoever is being asked about their day. What
  // was wrong before was that the zone came from the machine, so the server
  // showed the desk's 09:00 note as 01:00 — beside a prompt line saying it was
  // nine in the morning.
  assert.ok(summariseCheckIns([morning], UTC).includes('01:00'));
  assert.ok(summariseCheckIns([morning], NEW_YORK).includes('21:00'));
  assert.ok(summariseCheckIns([morning], PERTH).includes('09:00'));
});

test('the order of the day survives — anxious at nine, fine by two', () => {
  const said = summariseCheckIns([morning, afternoon], PERTH);
  assert.ok(said.indexOf('09:00') < said.indexOf('14:00'), 'the day was told backwards');
  assert.ok(said.includes('anxiety 7/10'), said);
});

test('the instruction carries the clock it was given', () => {
  const instruction = checkInInstruction([morning, afternoon], PERTH);
  assert.ok(instruction.includes('09:00'), instruction);
  assert.ok(instruction.includes('14:00'), instruction);
});

test('no notes is nothing to say, not an empty heading', () => {
  assert.equal(checkInInstruction([], PERTH), '');
});

test('a note with an unreadable timestamp loses its clock, not its words', () => {
  const broken: CheckIn = { id: 'c', date: '2026-09-03', at: 'not a date', note: 'still worth reading' };
  const said = summariseCheckIns([broken], PERTH);
  assert.ok(said.includes('still worth reading'), said);
});

test('only the day asked for comes back', () => {
  const yesterday: CheckIn = { ...morning, id: 'd', date: '2026-09-02' };
  const got = checkInsOn({ entries: [yesterday, morning, afternoon] }, '2026-09-03');
  assert.deepEqual(got.map(entry => entry.id), ['a', 'b']);
});
