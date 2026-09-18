// Her Game Boy from her side: the config, the move she answers with, the words the game is put into, and the rules of a sitting.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POKEMON, PokemonLink, afterTurn, describeGame, newSitting, parseMove, readPokemonConfig, runNote, sittingSummary, validAction, whyNotStart, whyStop, type Fetcher, type GameState, type Moment } from '../electron/pokemon';

const STATE: GameState = {
  player: { name: 'HARU', money: 3000, badges: ['Boulder'], badge_count: 1, facing: 'up', position: { x: 12, y: 8 } },
  map: { map_id: 2, map_name: 'PEWTER CITY' },
  party: [{ nickname: 'ZENI', species: 'Squirtle', level: 14, hp: 30, max_hp: 39, status: null, moves: ['Tackle', 'Bubble'] }],
  bag: [{ item: 'Potion', quantity: 2 }],
  battle: null,
  dialog: { active: false },
};

test('the block reads forward', () => {
  assert.deepEqual(readPokemonConfig(undefined), DEFAULT_POKEMON);
  assert.deepEqual(readPokemonConfig({ pokemon: { enabled: false, url: 'http://x:1/', sessionMinutes: 1, tickSeconds: 1000, minutesPerDay: 60, saveEvery: 5 } }),
    { enabled: false, url: 'http://x:1', sessionMinutes: 5, tickSeconds: 300, minutesPerDay: 60, saveEvery: 5 });
});

test('only the worker\'s grammar is an action, and her answer is read out of whatever surrounds it', () => {
  for (const ok of ['walk_up', 'press_a', 'press_start', 'hold_b_30', 'wait_60', 'a_until_dialog_end', 'PRESS_A']) assert.ok(validAction(ok), ok);
  for (const bad of ['walk_north', 'press_x', 'hold_a_9999', 'wait_0', 'fly_to_pallet', 'rm -rf', '']) assert.ok(!validAction(bad), bad);
  const move = parseMove('Sure!\n```json\n{"thought": "Brock first.", "actions": ["walk_up", "fly", "press_a", "walk_up", "walk_up", "walk_up", "walk_up", "walk_up", "walk_up", "walk_up"]}\n```');
  assert.deepEqual(move, { thought: 'Brock first.', actions: ['walk_up', 'press_a', 'walk_up', 'walk_up', 'walk_up', 'walk_up', 'walk_up', 'walk_up'] });
  assert.equal(parseMove('{"thought": "hm", "actions": ["teleport"]}'), null);
  assert.equal(parseMove('no json here'), null);
});

test('the game is put into words: where, who, the text box, the battle, the screen', () => {
  const text = describeGame(STATE, '# # #\n. @ .\n', [], 'Heading for the gym.', true);
  assert.match(text, /Where: PEWTER CITY at \(12, 8\), facing up\. Badges: 1 \(Boulder\)\. Money: 3000\./);
  assert.match(text, /Party: ZENI \(Squirtle\) L14 30\/39 HP — Tackle, Bubble\./);
  assert.match(text, /The screen:\n# # #/);
  // Words up: they are shown, and the walking grid is left out — she cannot walk anyway.
  const talking = describeGame(STATE, '# # #\n. @ .\n', ['BROCK: I took', 'you for granted.'], '', false);
  assert.match(talking, /Words on the screen:\n  BROCK: I took\n  you for granted\./);
  assert.doesNotMatch(talking, /The screen:/);
  const menu = describeGame(STATE, '', ['>NEW GAME', 'OPTION'], '', false);
  assert.match(menu, /  >NEW GAME\n  OPTION/);
  assert.match(text, /Last turn you thought: "Heading for the gym\."/);
  assert.match(text, /not moved for a few turns/);
  // Before a game exists the worker reads junk ("Pallet Town at 0,0", a name of question marks): she is told it is the title screen.
  const boot = describeGame({ player: { name: '???????????', position: { x: 0, y: 0 } }, map: { map_id: 0, map_name: 'Pallet Town' }, party: [] }, '. @ .', [], '', false);
  assert.match(boot, /has not started yet/);
  assert.match(boot, /press_start/);
  assert.doesNotMatch(boot, /Pallet Town/);
  const intro = describeGame({ player: { name: '???????????' }, map: { map_id: 0, map_name: 'Pallet Town' }, party: [] }, '', ['Hello there!', 'Welcome to the'], '', false);
  assert.match(intro, /nowhere yet/);
  assert.match(intro, /Hello there!/);
  const fight = describeGame({ ...STATE, dialog: null, battle: { in_battle: true, type: 'wild', enemy: { species: 'Rattata', level: 3, hp: 9, max_hp: 12 } } }, '', [], '', false);
  assert.match(fight, /IN A BATTLE \(wild\): against Rattata L3 9\/12 HP\./);
});

test('a sitting ends when he speaks, at bedtime, on time, or on her share of the day', () => {
  const sitting = newSitting(1_000_000, STATE, 'her');
  const base: Moment = { now: 1_000_000 + 10 * 60_000, lastUserActivityAt: 0, asleep: false, speaking: false, workerUp: true, playedTodayMs: 0 };
  assert.equal(whyStop(sitting, base, DEFAULT_POKEMON), null);
  assert.match(whyStop(sitting, { ...base, lastUserActivityAt: 1_000_000 + 60_000 }, DEFAULT_POKEMON)!, /talking to her/);
  assert.match(whyStop(sitting, { ...base, asleep: true }, DEFAULT_POKEMON)!, /bedtime/);
  assert.match(whyStop(sitting, { ...base, now: 1_000_000 + 31 * 60_000 }, DEFAULT_POKEMON)!, /30 minutes is a sitting/);
  assert.match(whyStop(sitting, { ...base, playedTodayMs: 85 * 60_000 }, DEFAULT_POKEMON)!, /share of the day/);
  assert.match(whyStop(sitting, { ...base, workerUp: false }, DEFAULT_POKEMON)!, /went quiet/);
  // "Go play" from him starts it: his message a moment before the start is not him interrupting.
  assert.equal(whyStop(sitting, { ...base, lastUserActivityAt: 1_000_000 + 2_000 }, DEFAULT_POKEMON), null);
  assert.match(whyNotStart({ ...base, workerUp: false }, DEFAULT_POKEMON, null)!, /no ROM yet/);
  assert.match(whyNotStart(base, DEFAULT_POKEMON, sitting)!, /already playing/);
  assert.match(whyNotStart({ ...base, playedTodayMs: 90 * 60_000 }, DEFAULT_POKEMON, null)!, /share of the day/);
  assert.equal(whyNotStart(base, DEFAULT_POKEMON, null), null);
});

test('standing still is noticed, and the sitting leaves a true line behind', () => {
  let sitting = newSitting(0, STATE, 'her');
  sitting = afterTurn(sitting, { thought: 'Up.', actions: ['walk_up'] }, STATE);
  sitting = afterTurn(sitting, { thought: 'Up again.', actions: ['walk_up'] }, STATE);
  assert.equal(sitting.stillFor, 2);
  const moved = { ...STATE, player: { ...STATE.player, position: { x: 4, y: 13 } }, map: { map_id: 54, map_name: 'PEWTER GYM' } };
  // A text box that moves on is not standing still.
  assert.equal(afterTurn(afterTurn(newSitting(0, STATE, 'her'), null, STATE, ['Hello there!']), null, STATE, ['Welcome to the']).stillFor, 0);
  sitting = afterTurn(sitting, { thought: 'In.', actions: ['walk_up'] }, moved);
  assert.equal(sitting.stillFor, 0);
  const summary = sittingSummary(sitting, moved, 25 * 60_000, 'he is talking to her');
  assert.match(summary, /Played for 25 min \(3 turns\): PEWTER CITY → PEWTER GYM; 1 badge\(s\); party ZENI L14\. Stopped because he is talking to her\. Last thought: "In\."/);
  assert.match(runNote(moved, summary, false), /Your Pokémon Red run .* 1 badge\(s\), party ZENI L14, last seen in PEWTER GYM\. Last sitting: Played for 25 min/);
  assert.equal(runNote(null, '', false), '');
});

test('the link speaks the worker\'s API, and a worker that is not there is simply not up', async () => {
  const calls: { url: string; body?: string }[] = [];
  const fetch: Fetcher = async (url, init) => {
    calls.push({ url, body: init?.body });
    if (url.endsWith('/health')) return { ok: true, status: 200, text: async () => '{"status":"ok","emulator_ready":true}' };
    if (url.endsWith('/state')) return { ok: true, status: 200, text: async () => JSON.stringify(STATE) };
    if (url.endsWith('/map/ascii')) return { ok: true, status: 200, text: async () => '. @ .' };
    if (url.endsWith('/screen/text')) return { ok: true, status: 200, text: async () => '{"lines":[">NEW GAME","OPTION"]}' };
    if (url.endsWith('/action')) return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, state_after: STATE }) };
    if (url.endsWith('/save')) return { ok: true, status: 200, text: async () => '{}' };
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  const link = new PokemonLink(DEFAULT_POKEMON, fetch);
  assert.equal(await link.up(), true);
  assert.equal((await link.state()).player?.name, 'HARU');
  assert.equal(await link.map(), '. @ .');
  assert.deepEqual(await link.text(), ['>NEW GAME', 'OPTION']);
  assert.equal((await link.act(['walk_up']))?.player?.badge_count, 1);
  await link.save('auto');
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/action'))!.body!), { actions: ['walk_up'] });
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/save'))!.body!), { name: 'auto' });
  const down = new PokemonLink(DEFAULT_POKEMON, async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(await down.up(), false);
  assert.deepEqual(await down.text(), []);
});
