// Level 4: the gates on her own time, the ledger, and the note she reads back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HANDS, HER_HANDS_TOOLS, didNothing, handsNote, handsToday, keepHands, readHands, readHandsConfig, whyNotAct, type Moment } from '../electron/herhands';

test('the hands block reads forward', () => {
  assert.deepEqual(readHandsConfig(undefined), DEFAULT_HANDS);
  const set = readHandsConfig({ level: 4, hands: { enabled: false, perDay: 1, from: '10:00', to: '22:30', quietMinutes: 5, gapMinutes: 10 } });
  assert.deepEqual(set, { enabled: false, perDay: 1, from: '10:00', to: '22:30', quietMinutes: 5, gapMinutes: 10 });
  assert.equal(readHandsConfig({ hands: { from: '9am' } }).from, '09:00', 'a bad time falls back');
});

test('her time is level 4, awake, in hours, with him quiet and the day not spent', () => {
  const her: Moment = { level: 4, config: DEFAULT_HANDS, minutes: 14 * 60, asleep: false, speaking: false, idleMs: 30 * 60_000, sinceLastMs: 3 * 3_600_000, doneToday: 0, busy: false };
  assert.equal(whyNotAct(her), null);
  assert.match(whyNotAct({ ...her, level: 3 })!, /below level 4/);
  assert.match(whyNotAct({ ...her, asleep: true })!, /asleep/);
  assert.match(whyNotAct({ ...her, minutes: 2 * 60 })!, /outside her hours/);
  assert.match(whyNotAct({ ...her, idleMs: 4 * 60_000 })!, /he was here 4 min ago/);
  assert.match(whyNotAct({ ...her, sinceLastMs: 10 * 60_000 })!, /10 min ago/);
  assert.match(whyNotAct({ ...her, doneToday: 3 })!, /3 of 3 today/);
  assert.match(whyNotAct({ ...her, busy: true })!, /still running/);
  // Hours over midnight.
  const late = { ...her, config: { ...DEFAULT_HANDS, from: '20:00', to: '02:00' } };
  assert.equal(whyNotAct({ ...late, minutes: 60 }), null);
  assert.match(whyNotAct({ ...late, minutes: 12 * 60 })!, /outside/);
});

test('the ledger keeps what she did and counts the day', () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  let list = readHands([{ at: '2026-09-18T03:00:00Z', tool: 'read_manga', what: 'read some manga — Chainsaw Man', said: 'Denji is an idiot and I love him.' }, { bad: true }]);
  assert.equal(list.length, 1);
  list = keepHands(list, { at: '2026-09-18T05:00:00Z', tool: 'nothing', what: '', said: 'nothing for now' });
  list = keepHands(list, { at: '2026-09-17T05:00:00Z', tool: 'watch_anime', what: 'started fetching Naruto', said: 'Finally.' });
  assert.equal(handsToday(list, '2026-09-18', dayOf), 1, 'a pass that did nothing is not an act');
  const note = handsNote(list, Date.parse('2026-09-18T06:00:00Z'), dayOf, '2026-09-18');
  assert.match(note, /these happened/);
  assert.match(note, /today: you read some manga — Chainsaw Man — "Denji is an idiot/);
  assert.match(note, /2026-09-17: you started fetching Naruto/);
  assert.doesNotMatch(note, /nothing for now/);
  assert.equal(handsNote([], Date.now(), dayOf, '2026-09-18'), '');
});

test('"nothing for now" is nothing', () => {
  for (const said of ['Nothing for now.', 'not right now', "I'll leave it.", 'skip it', '']) assert.ok(didNothing(said), said);
  for (const said of ['Read two chapters of Chainsaw Man. Denji is an idiot.', 'Put Naruto on to fetch — about time.']) assert.ok(!didNothing(said), said);
});

test('her own tools are hers: no shell, no services, not his shelf, and no Minecraft for now', () => {
  for (const name of ['run_command', 'restart_haru', 'stop_service', 'restart_docker_container', 'get_manga', 'minecraft_do', 'power', 'change_setting']) {
    assert.ok(!(HER_HANDS_TOOLS as readonly string[]).includes(name), name);
  }
  assert.ok(!(HER_HANDS_TOOLS as readonly string[]).includes('read_manga'));
  assert.ok(!(HER_HANDS_TOOLS as readonly string[]).includes('play_pokemon'));
});
