// Things of her own: picked, kept, deepened, and argued.

import test from 'node:test';
import assert from 'node:assert/strict';
import { addressesSomeone, adopt, ADOPT_ODDS, adoptInstruction, deepen, deepenInstruction, isOneOfTheirs, MAX_INTERESTS, nightQuery, NOBODY_HERE, parseAdoption, parseDeepening, pickTonight, tastesInstruction, unaddressed, type Interest } from '../electron/tastes';

const interest = (over: Partial<Interest> = {}): Interest => ({ id: 'a', kind: 'game', name: 'Hollow Knight', because: 'it looked lonely', since: '2026-08-20', nights: 2, lastAt: '2026-08-27T18:00:00.000Z', stance: 'Bleak and beautiful, and the map is a crime.', ...over });

test('what she is told when picking something up keeps hers off theirs', () => {
  const note = adoptInstruction(['Tommy plays Overwatch'], [interest()], { games: ['Big Walk', 'Overwatch'], interests: ['Tommy watches Angel Beats'] });
  assert.match(note, /Games they have been playing: Big Walk, Overwatch/);
  assert.match(note, /Tommy watches Angel Beats/);
  assert.match(note, /not a game they play, not a series they have named/);
  assert.match(note, /You already have: Hollow Knight \(game\)/);
  assert.match(note, /KIND: game \| anime/);
  assert.equal(note.includes('book'), false);
});

test("the model's answer is read in its fixed shape, and anything else is refused", () => {
  assert.deepEqual(parseAdoption('KIND: anime\nNAME: "Made in Abyss"\nBECAUSE: because cute things should not be allowed to hurt that much.'),
    { kind: 'anime', name: 'Made in Abyss', because: 'because cute things should not be allowed to hurt that much.' });
  assert.equal(parseAdoption('Kind: Manga\nName: Berserk\nBecause: x')?.kind, 'anime');
  assert.equal(parseAdoption('I think I would like to try Hollow Knight because it looks fun'), null);
  assert.equal(parseAdoption('KIND: vibe\nNAME: sadness\nBECAUSE: x'), null);
  // Only the two kinds there are arguments about.
  assert.equal(parseAdoption('KIND: book\nNAME: Dune\nBECAUSE: x'), null);
  assert.equal(parseAdoption('KIND: music\nNAME: Radiohead\nBECAUSE: x'), null);
  assert.equal(parseAdoption('KIND: video game\nNAME: Celeste\nBECAUSE: x')?.kind, 'game');
  assert.equal(parseAdoption('KIND: game\nNAME: \nBECAUSE: x'), null);
  assert.equal(parseAdoption('KIND: game\nNAME: ' + 'a '.repeat(30) + '\nBECAUSE: x'), null);
});

test('hers is never one of theirs', () => {
  const theirs = ['Overwatch', 'Big Walk', 'Tommy has been watching Angel Beats lately', 'NieR:Automata'];
  assert.equal(isOneOfTheirs('Overwatch', theirs), true);
  assert.equal(isOneOfTheirs('overwatch', theirs), true);
  assert.equal(isOneOfTheirs('Angel Beats', theirs), true);
  assert.equal(isOneOfTheirs('NieR Automata', theirs), true);
  assert.equal(isOneOfTheirs('Hollow Knight', theirs), false);
  assert.equal(isOneOfTheirs('', theirs), true);
});

test('a different angle each night, so the second night is not the first again', () => {
  const a = interest({ nights: 0 });
  const queries = [0, 1, 2, 6].map(nights => nightQuery({ ...a, nights }));
  assert.equal(queries[0], 'Hollow Knight review');
  assert.notEqual(queries[0], queries[1]);
  assert.equal(queries[0], queries[3], 'wraps around');
  assert.match(nightQuery(interest({ kind: 'anime', name: 'Made in Abyss', nights: 1 })), /Made in Abyss best character/);
});

test('deepening is written from the old view and what was read, and asks for a favourite and a want', () => {
  const note = deepenInstruction(interest(), 'Hollow Knight review', '1. review — https://x — great');
  assert.match(note, /took it up 2 nights ago because: "it looked lonely"/);
  assert.match(note, /What you thought of it before tonight: "Bleak and beautiful/);
  assert.match(note, /FAVOURITE:/);
  assert.match(note, /WANT:/);
  assert.match(note, /no saying you played, watched or went anywhere/);
  assert.match(deepenInstruction(interest({ nights: 0, stance: '' }), 'q', 'f'), /took it up tonight/);
  assert.match(deepenInstruction(interest({ nights: 0, stance: '' }), 'q', 'f'), /no settled view of it yet/);
});

test("what comes back is a stance plus the two lines, and 'none' means none", () => {
  const got = parseDeepening('Still bleak, still beautiful, and the review agreed the map is a crime.\nFAVOURITE: Hornet\nWANT: finish the Path of Pain, then tell him it is better than his walking game');
  assert.equal(got?.stance, 'Still bleak, still beautiful, and the review agreed the map is a crime.');
  assert.equal(got?.favourite, 'Hornet');
  assert.match(got?.wants ?? '', /Path of Pain/);
  const bare = parseDeepening('Fine, it is good and the ending earns it, which is more than most manage.\nFAVOURITE: none yet\nWANT: nothing');
  assert.equal(bare?.favourite, undefined);
  assert.equal(bare?.wants, undefined);
  assert.equal(parseDeepening('ok'), null);
  assert.equal(parseDeepening(''), null);
});

test('tonight goes to the one left longest, not to last night\'s', () => {
  const now = Date.parse('2026-08-29T18:00:00.000Z');
  const a = interest({ id: 'a', lastAt: '2026-08-25T18:00:00.000Z' });
  const b = interest({ id: 'b', name: 'B', lastAt: '2026-08-28T20:00:00.000Z' }); // last night: rested? 22h < 20h? no — 22h >= 20h, rested
  const c = interest({ id: 'c', name: 'C', lastAt: '2026-08-29T10:00:00.000Z' }); // eight hours ago: not rested
  assert.equal(pickTonight([a, b, c], now, () => 0)?.id, 'a');
  assert.notEqual(pickTonight([c], now, () => 0), null, 'with only an unrested one, it is still spent on something');
  assert.equal(pickTonight([], now), null);
  // The rare roll picks from the rested pool, never the unrested one.
  const picks = new Set(Array.from({ length: 20 }, (_, i) => pickTonight([a, b, c], now, () => 0.8 + (i % 3) * 0.05)?.id));
  assert.equal(picks.has('c'), false);
});

test('adopting and deepening keep the list bounded and move the view', () => {
  let list: Interest[] = [];
  for (let i = 0; i < MAX_INTERESTS + 2; i++) list = adopt(list, { kind: 'game', name: `T${i}`, because: 'why not' }, '2026-08-29', '2026-08-29T18:00:00.000Z');
  assert.equal(list.length, MAX_INTERESTS);
  assert.equal(list[0].name, 'T2', 'the oldest fall off');
  const id = list[0].id;
  const after = deepen(list, id, { stance: 'A settled view of some length, sharpened tonight.', favourite: 'the middle bit' }, '2026-08-30T18:00:00.000Z');
  assert.equal(after[0].nights, 1);
  assert.equal(after[0].favourite, 'the middle bit');
  // A night that says nothing new about the favourite keeps the old one.
  const again = deepen(after, id, { stance: 'Another view, long enough to count as one.' }, '2026-08-31T18:00:00.000Z');
  assert.equal(again[0].favourite, 'the middle bit');
  assert.equal(again[0].nights, 2);
  assert.ok(ADOPT_ODDS > 0 && ADOPT_ODDS < 1);
});

test('her things reach the prompt as views to hold, and an unsettled one does not', () => {
  assert.equal(tastesInstruction([interest({ stance: '' })]), '');
  const said = tastesInstruction([interest({ favourite: 'Hornet', wants: 'finish it' })]);
  assert.match(said, /Things of your own — not theirs/);
  assert.match(said, /Hollow Knight \(game, yours for 2 nights\): Bleak and beautiful/);
  assert.match(said, /The bit of it you rate above the rest is Hornet\./, 'a sentence, not a label she can read out');
  assert.match(said, /You want to finish it\./);
  assert.match(said, /when they rate something you think is worse, say so and say why/);
  assert.match(said, /say you have only read about it/);
});

test('a note that opens by addressing someone is a message, and the addressed part comes off', () => {
  const bossy = "Listen up, subordinate. The Reze arc? It's not cute romance — it's survival wrapped in a pretty package. Most people rate Pochita highest, which is pathetic.";
  assert.equal(addressesSomeone(bossy), true);
  assert.equal(unaddressed(bossy), "The Reze arc? It's not cute romance — it's survival wrapped in a pretty package. Most people rate Pochita highest, which is pathetic.");
  assert.equal(addressesSomeone("Look, you probably think this is your chance to relax. Don't get cocky."), true);
  // A view is a view.
  assert.equal(addressesSomeone("Bleak and beautiful, and the map is a crime. Hornet carries the whole thing."), false);
  assert.equal(unaddressed("Bleak and beautiful."), "Bleak and beautiful.");
  // All of it addressed: kept rather than emptied, so the retry has something to replace.
  assert.equal(unaddressed("You idiot. You never listen."), "You idiot. You never listen.");
  assert.match(NOBODY_HERE, /note to yourself/);
});
