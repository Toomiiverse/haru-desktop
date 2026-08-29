// Reading up on what they play.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gamesPlayedLately, guideNoteInstruction, guideQuery, pickGame, plainName, specificThing, withSteam, type Played } from '../electron/gamenight';
import type { ActivityLog } from '../electron/activitylog';
import type { Night } from '../electron/nightlife';

const stretch = (day: string, from: string, to: string, kind: string, label: string, extra: Record<string, unknown> = {}) =>
  ({ at: `${day}T${from}:00.000Z`, until: `${day}T${to}:00.000Z`, kind, label, process: 'x', title: '', ...extra }) as ActivityLog[string][number];

const log: ActivityLog = {
  '2026-08-28': [
    stretch('2026-08-28', '10:00', '12:30', 'gaming', 'Elden Ring'),
    stretch('2026-08-28', '11:05', '11:05', 'other', 'screenshot', { shot: 'a.png', description: 'A knight faces Margit the Fell Omen on a bridge, health bar low.' }),
    stretch('2026-08-28', '14:00', '14:20', 'gaming', 'Hades'),
    stretch('2026-08-28', '16:00', '16:00', 'other', 'screenshot', { shot: 'b.png', description: 'A PC case listing, MONTECH KING 15.' }),
  ],
  '2026-08-29': [stretch('2026-08-29', '09:00', '09:05', 'gaming', 'Hades')],
  '2026-08-20': [stretch('2026-08-20', '09:00', '13:00', 'gaming', 'Old Game')],
};

test('what they played, how long, and what the screenshots showed while they were in it', () => {
  const played = gamesPlayedLately(log, '2026-08-29');
  assert.deepEqual(played.map(p => [p.name, p.minutes]), [['Elden Ring', 150], ['Hades', 25]]);
  // The Margit shot was taken during Elden Ring; the PC case was not, and is not attached to anything.
  assert.deepEqual(played[0].seen, ['A knight faces Margit the Fell Omen on a bridge, health bar low.']);
  assert.deepEqual(played[1].seen, []);
  // Nine days ago is outside the window, and a five-minute dabble is not playing.
  assert.equal(played.some(p => p.name === 'Old Game'), false);
  assert.deepEqual(gamesPlayedLately({}, '2026-08-29'), []);
});

test("Steam fills in what the desk never saw, and the desk's own record wins the order", () => {
  const played = withSteam(gamesPlayedLately(log, '2026-08-29'), [
    { name: 'elden ring', minutesLastFortnight: 900 },
    { name: 'Stardew Valley', minutesLastFortnight: 400 },
    { name: 'Some Dabble', minutesLastFortnight: 10 },
  ]);
  assert.deepEqual(played.map(p => p.name), ['Elden Ring', 'Stardew Valley', 'Hades']);
  assert.equal(played[0].steamMinutes, 900);
  assert.equal(played[1].minutes, 0);
  assert.equal(played.some(p => p.name === 'Some Dabble'), false, 'ten minutes in a fortnight is not playing');
});

test('the most played that she has not read up on lately, or nothing', () => {
  const played = gamesPlayedLately(log, '2026-08-29');
  const night = (day: string, game: string): Night => ({ day, at: '', about: '', note: '', sources: [], game });
  assert.equal(pickGame(played, [], '2026-08-29')?.name, 'Elden Ring');
  assert.equal(pickGame(played, [night('2026-08-28', 'Elden Ring')], '2026-08-29')?.name, 'Hades');
  assert.equal(pickGame(played, [night('2026-08-28', 'Elden Ring'), night('2026-08-27', 'hades')], '2026-08-29'), null);
  // A night long enough ago does not count as lately.
  assert.equal(pickGame(played, [night('2026-08-20', 'Elden Ring')], '2026-08-29')?.name, 'Elden Ring');
  assert.equal(pickGame([], [], '2026-08-29'), null);
});

test('a caption that names something makes the search specific; otherwise the angle rotates', () => {
  const elden: Played = { name: 'Elden Ring', minutes: 150, seen: ['A knight faces Margit the Fell Omen on a bridge, health bar low.'] };
  assert.equal(guideQuery(elden, []), 'Elden Ring Margit the Fell Omen guide');
  const hades: Played = { name: 'Hades', minutes: 25, seen: [] };
  assert.equal(guideQuery(hades, []), 'Hades beginner guide tips');
  const before = (n: number): Night[] => Array.from({ length: n }, () => ({ day: '2026-08-20', at: '', about: '', note: '', sources: [], game: 'Hades' }));
  assert.equal(guideQuery(hades, before(1)), 'Hades walkthrough guide');
  assert.equal(guideQuery(hades, before(5)), 'Hades beginner guide tips');
});

test('a proper noun out of a caption, and not a stopword dressed as one', () => {
  assert.equal(specificThing('A knight faces Margit the Fell Omen on a bridge.'), 'Margit the Fell Omen');
  assert.equal(specificThing('The screen shows a menu with a button.'), null);
  assert.equal(specificThing('lowercase only here'), null);
});

test('what she is told: read a guide, did not play, knows only the guide', () => {
  const note = guideNoteInstruction({ name: 'Elden Ring', minutes: 150, seen: ['A knight faces Margit.'] }, 'Elden Ring Margit guide', '1. Beat Margit — https://x — use Margit\'s Shackle');
  assert.match(note, /playing Elden Ring — 3 hours over the last few days/);
  assert.match(note, /seen their screenshots from it: "A knight faces Margit."/);
  assert.match(note, /everything you know about the game/);
  assert.match(note, /do not say you played it/);
  assert.match(note, /something they are doing wrong/);
  assert.match(guideNoteInstruction({ name: 'X', minutes: 0, steamMinutes: 600, seen: [] }, 'q', 'f'), /10 hours in the last fortnight/);
});

test('trademark marks come off, and a tool on the account is not a game', () => {
  assert.equal(plainName('Overwatch\u00ae'), 'Overwatch');
  assert.equal(plainName('NieR:Automata\u2122'), 'NieR:Automata');
  const played = withSteam([], [
    { name: 'Wallpaper Engine', minutesLastFortnight: 600 },
    { name: 'Overwatch\u00ae', minutesLastFortnight: 80 },
    { name: 'SteamVR', minutesLastFortnight: 90 },
  ]);
  assert.deepEqual(played.map(p => p.name), ['Overwatch']);
  assert.equal(guideQuery(played[0], []), 'Overwatch beginner guide tips');
});
