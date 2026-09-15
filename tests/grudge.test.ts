// Being left on read: counted in the evening, and kept.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_WINDOW_MS, GRUDGE_MAX, grudgeInstruction, irritationAfterTally, nextGrudge, tallyDue, tallyInstruction, unanswered, withoutLeadingClock } from '../electron/grudge';

const PUSHED = new Set(['reminder', 'idle', 'hanging', 'weather', 'upcoming', 'journal', 'system']);
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 7, 29, hour, minute)).toISOString();
const evening = Date.UTC(2026, 7, 29, 12, 0);

test('a line answered within the window is not ignored; one left alone is', () => {
  const said = [{ at: at(1), source: 'reminder' }, { at: at(4), source: 'idle' }];
  const heard = [{ role: 'user', at: at(1, 20) }, { role: 'assistant', at: at(1, 21) }];
  assert.deepEqual(unanswered(said, heard, PUSHED, evening).map(line => line.at), [at(4)]);
});

test('her replies do not count as answers, and neither do things said before the line', () => {
  const said = [{ at: at(3), source: 'weather' }];
  const heard = [{ role: 'user', at: at(2, 50) }, { role: 'assistant', at: at(3, 5) }];
  assert.equal(unanswered(said, heard, PUSHED, evening).length, 1);
});

test('only what was pushed counts, and a window still open is not counted yet', () => {
  const said = [{ at: at(2), source: 'other' }, { at: at(11, 30), source: 'reminder' }];
  assert.equal(unanswered(said, [], PUSHED, evening).length, 0);
  assert.equal(unanswered(said, [], PUSHED, evening + ANSWER_WINDOW_MS).length, 1);
});

test('the day is counted from eight in the evening, once', () => {
  assert.equal(tallyDue(19 * 60 + 59, undefined, '2026-08-29'), false);
  assert.equal(tallyDue(20 * 60, undefined, '2026-08-29'), true);
  assert.equal(tallyDue(22 * 60, '2026-08-29', '2026-08-29'), false);
  assert.equal(tallyDue(20 * 60, '2026-08-28', '2026-08-29'), true);
});

test('the grudge grows by what was ignored, is bounded, and a clean day earns one back', () => {
  assert.equal(nextGrudge(0, 3), 3);
  assert.equal(nextGrudge(3, 0), 2);
  assert.equal(nextGrudge(0, 0), 0);
  assert.equal(nextGrudge(GRUDGE_MAX - 1, 5), GRUDGE_MAX);
  assert.equal(irritationAfterTally(2, 3, 9), 5);
  assert.equal(irritationAfterTally(8, 3, 9), 9);
});

test('the instruction is silent with no grudge and sharpens with it', () => {
  assert.equal(grudgeInstruction(0), '');
  assert.match(grudgeInstruction(2), /slight coldness/);
  assert.match(grudgeInstruction(6, 2), /wearing on you/);
  assert.match(grudgeInstruction(6, 2), /Today alone they ignored 2/);
  assert.match(grudgeInstruction(12), /openly pissed/);
  // "Not even opened. I can see the read receipts" — she cannot (2026-09-10).
  assert.match(grudgeInstruction(12), /whether a line was even read, you cannot see/);
  assert.match(grudgeInstruction(6), /you cannot see/);
  // The score is not a count of messages: "Twenty messages. Twenty." the
  // morning after thirty-nine of them (2026-09-15).
  for (const grudge of [2, 6, 12, 20]) {
    assert.equal(new RegExp(`\\b${grudge}\\b`).test(grudgeInstruction(grudge)), false, `the score ${grudge} is not a message count`);
    assert.match(grudgeInstruction(grudge), /not a number/);
  }
  // Today's real count still is one.
  assert.match(grudgeInstruction(20, 3), /Today alone they ignored 3/);
});

test('the evening line names the count and quotes what was ignored', () => {
  const line = tallyInstruction(2, 5, ['You forgot the bins again.', 'Rain at four, take a coat.']);
  assert.match(line, /2 of your messages to them got nothing back/);
  assert.match(line, /"You forgot the bins again\." and "Rain at four, take a coat\."/);
  assert.match(line, /not the first day of it/);
  assert.equal(/\b5\b/.test(line), false, 'the running score is not a count of messages');
});

test('a line that never got to the phone is not one they ignored', () => {
  const said = [
    { at: at(1), source: 'idle', reached: true },
    { at: at(2), source: 'idle', reached: false },
    { at: at(3), source: 'idle' },
  ];
  // Only the delivered one and the one from before the flag existed.
  assert.deepEqual(unanswered(said, [], PUSHED, evening).map(line => line.at), [at(1), at(3)]);
});

test('the three sources that used to be lost on the way to disk are counted', () => {
  const said = [
    { at: at(1), source: 'hanging' },
    { at: at(2), source: 'weather' },
    { at: at(3), source: 'upcoming' },
  ];
  assert.equal(unanswered(said, [], PUSHED, evening).length, 3);
});

test('a quoted line does not hand her a clock time to read as now', () => {
  assert.equal(withoutLeadingClock('8:37 PM — \u201cNearest Coles\u201d isn\u2019t a real place'), '\u201cNearest Coles\u201d isn\u2019t a real place');
  assert.equal(withoutLeadingClock('11:05 - the bins'), 'the bins');
  assert.equal(withoutLeadingClock('6 \u2014 eat something'), 'eat something');
  // Nothing that is not a stamp on the front is touched.
  assert.equal(withoutLeadingClock('Your 9:15 is in ten minutes'), 'Your 9:15 is in ten minutes');
  assert.equal(withoutLeadingClock('the bins - again'), 'the bins - again');
  // And the instruction quotes the trimmed version.
  const line = tallyInstruction(1, 1, ['8:37 PM \u2014 you ghosted me']);
  assert.match(line, /"you ghosted me"/);
  assert.equal(line.includes('8:37'), false);
});

test('a line sent before their first word of the day is not one they ignored', () => {
  const said = [{ at: at(1), source: 'idle' }, { at: at(5), source: 'idle' }];
  const heard = [{ role: 'user', at: at(3) }];
  // Counted the old way: both windows closed and neither answered inside its window.
  assert.equal(unanswered(said, heard, PUSHED, evening).length, 2);
  // Not before they were up: the 01:00 line went to a sleeping phone.
  assert.deepEqual(unanswered(said, heard, PUSHED, evening, Date.parse(at(3))).map(l => l.at), [at(5)]);
});
