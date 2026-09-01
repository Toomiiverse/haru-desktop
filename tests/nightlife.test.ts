// What she does while they are asleep, and the rule that it has to be true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { keepNights, MAX_PER_NIGHT, mentionsNight, NIGHT_GAP_MS, NIGHTS_KEPT, nightNoteInstruction, nightsInstruction, nightsOn, nightsToDrawOn, pickInstruction, tidyPick, timeForSomething, type Night, unlabel } from '../electron/nightlife';

const night = (day: string, about: string): Night => ({ day, at: `${day}T18:40:00.000Z`, about, note: 'It was all right.', sources: ['https://example.com'] });

test('nights are kept by the evening they belong to, and the log is bounded', () => {
  const nights = [night('2026-08-28', 'a'), night('2026-08-29', 'b'), night('2026-08-29', 'c')];
  assert.deepEqual(nightsOn(nights, '2026-08-29').map(n => n.about), ['b', 'c']);
  let kept: Night[] = [];
  for (let index = 0; index < NIGHTS_KEPT + 5; index++) kept = keepNights(kept, night('2026-08-29', `n${index}`));
  assert.equal(kept.length, NIGHTS_KEPT);
  assert.equal(kept[0].about, 'n5', 'the oldest go first');
});

test('two things a night, spaced out, and not on every tick', () => {
  const now = Date.parse('2026-08-30T18:00:00.000Z');
  const always = () => 0;
  assert.equal(timeForSomething([], null, now, always), true);
  // Already had its two.
  assert.equal(timeForSomething([night('d', 'a'), night('d', 'b')], null, now, always), false);
  assert.equal(timeForSomething([night('d', 'a')], null, now, always), true);
  // Too soon after the last one.
  assert.equal(timeForSomething([], now - NIGHT_GAP_MS + 60_000, now, always), false);
  assert.equal(timeForSomething([], now - NIGHT_GAP_MS, now, always), true);
  // And it is a chance, not a certainty, or every night would look the same.
  assert.equal(timeForSomething([], null, now, () => 0.99), false);
  assert.equal(MAX_PER_NIGHT, 2);
});

test('what comes back from the model is turned into something a search box takes', () => {
  assert.equal(tidyPick('deep sea gigantism'), 'deep sea gigantism');
  assert.equal(tidyPick('"how sourdough starters actually work"'), 'how sourdough starters actually work');
  assert.equal(tidyPick("I'd like to look up the history of neon signs"), 'the history of neon signs');
  assert.equal(tidyPick('Search: brutalist architecture Perth\n(that one)'), 'brutalist architecture Perth');
  assert.equal(tidyPick('why do cats knead.'), 'why do cats knead');
  // The model narrating the search, not the search.
  assert.equal(tidyPick('Searching Angel Beats plot holes deep now'), 'Angel Beats plot holes');
  assert.equal(tidyPick('Looking into deep sea gigantism tonight'), 'deep sea gigantism');
  // Not a search: one word, a speech, or nothing.
  assert.equal(tidyPick('cats'), null);
  assert.equal(tidyPick(''), null);
  assert.equal(tidyPick('Well I have been thinking for quite a while now about what it is that I might want to read about tonight'), null);
});

test('picking is offered their life without being confined to it', () => {
  const note = pickInstruction(['Tommy is building a website', 'Tommy has ADHD'], ['neon signs', 'sourdough']);
  assert.match(note, /they are asleep/);
  assert.match(note, /Tommy is building a website/);
  assert.match(note, /something of your own that has nothing to do with them/);
  assert.match(note, /"neon signs", "sourdough"/);
  assert.match(note, /three to eight words/);
  // With nothing known about them it still asks for something.
  assert.match(pickInstruction([], []), /Pick one thing to look up/);
});

test('the note may not go past what she actually read, and she did not watch it', () => {
  const note = nightNoteInstruction('deep sea gigantism', '1. Giant isopods — https://example.com — they get big');
  assert.match(note, /everything you know about it/);
  assert.match(note, /first person and the past tense/);
  assert.match(note, /do not invent a detail/);
  assert.match(note, /do not say you watched, played or went anywhere/);
  assert.match(note, /note to yourself/);
});

test('her night reaches the prompt as something that happened, with a limit on what she knows', () => {
  assert.equal(nightsInstruction([]), '');
  const said = nightsInstruction([night('2026-08-29', 'deep sea gigantism'), night('2026-08-29', 'neon signs')]);
  assert.match(said, /it did happen/);
  assert.match(said, /deep sea gigantism: It was all right\./);
  assert.match(said, /neon signs/);
  assert.match(said, /say you only read a bit about it rather than filling the gap/);
});

test('her night is offered to an unprompted line once, not as the opener of every one', () => {
  const nights = [night('2026-08-29', 'Murdoch Uni campus map route planning'), night('2026-08-29', 'Angel Beats plot holes')];
  assert.match(nightsToDrawOn(nights, ['You ghosted me.', 'Three messages, nothing back.']), /Murdoch/);
  // Having just brought it up, she is not handed it again.
  assert.equal(nightsToDrawOn(nights, ['Nine hours of silence? I had to drag a campus map across the Murdoch dirt.']), '');
  assert.equal(nightsToDrawOn(nights, ['read Angel Beats plot holes like they were my taxes']), '');
  // Only the last few lines count.
  assert.match(nightsToDrawOn(nights, ['about Angel Beats', 'a', 'b', 'c', 'd']), /Angel Beats/);
  assert.equal(mentionsNight('nothing to do with it', nights[0]), false);
  assert.equal(nightsToDrawOn([], []), '');
});

test('the labels a night was written with are said as sentences, not read out as labels', () => {
  const note = "Neon mess, high-octane. FAVOURITE: David's Sandevistan slow-mo. WANT: a brutal ending.";
  const said = unlabel(note);
  assert.doesNotMatch(said, /FAVOURITE:|WANT:/);
  assert.match(said, /The bit I rate above the rest is David's Sandevistan slow-mo\./);
  assert.match(said, /What I would like out of it is a brutal ending\./);
  assert.equal(unlabel('Just a plain note.'), 'Just a plain note.');
});

