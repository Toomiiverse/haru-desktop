// Level 4: the gates on her own time, the ledger, and the note she reads back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HANDS, HER_HANDS_TOOLS, didNothing, handsNote, handsToday, keepHands, readHands, readHandsConfig, whyNotAct, type Moment } from '../electron/herhands';

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

test('her own tools are hers: no shell, no services, not his shelf, and no Minecraft for now', () => {
  for (const name of ['run_command', 'restart_haru', 'stop_service', 'restart_docker_container', 'get_manga', 'minecraft_do', 'power', 'change_setting']) {
    assert.ok(!(HER_HANDS_TOOLS as readonly string[]).includes(name), name);
  }
  assert.ok((HER_HANDS_TOOLS as readonly string[]).includes('read_manga'));
  assert.ok((HER_HANDS_TOOLS as readonly string[]).includes('play_pokemon'));
});
