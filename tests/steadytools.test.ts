// The tool table held steady for the day, so a hosted prompt cache survives it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chatTools, steadyTable, type ToolAvailability } from '../electron/tools';

// Asserted rather than declared: not every tree this runs in has the same fields.
const AVAILABLE = {
  choices: false, anilist: false, web: true, screen: false,
  search: { enabled: true, readPages: true, transcripts: false },
  knowledge: true, browser: false, claude: true, system: { enabled: true, level: 2 },
  hands: true, desktop: { launch: false, power: false }, knockedAwake: false, minecraft: false,
  booking: true, chats: true,
} as ToolAvailability;
const names = (tools: { function: { name: string } }[]) => tools.map(tool => tool.function.name);

test('a tool offered once today stays on the table, in the same order, whatever comes next', () => {
  const held = new Set<string>();
  const lay = (said: string, available = AVAILABLE) => names(steadyTable(chatTools(available, said), chatTools(available), held));
  const first = lay('hi');
  assert.ok(!first.includes('search_chats') && !first.includes('get_system_info'));
  const asked = lay('what was wrong with the server the other day?');
  assert.ok(asked.includes('search_chats') && asked.includes('get_system_info'));
  assert.deepEqual(lay('ok cool'), asked, 'small talk after it lays the identical table — the cache prefix holds');
  assert.deepEqual(lay('goodnight'), asked);
  const everything = names(chatTools(AVAILABLE));
  assert.deepEqual(asked, everything.filter(name => asked.includes(name)), 'always in chatTools order, never in the order they turned up');
});

test('held does not mean allowed: a tool switched off or out of hands drops out at once', () => {
  const held = new Set<string>();
  steadyTable(chatTools(AVAILABLE, 'what was that again'), chatTools(AVAILABLE), held);
  const off = { ...AVAILABLE, chats: false, system: { enabled: false, level: 0 } } as ToolAvailability;
  const table = names(steadyTable(chatTools(off, 'ok'), chatTools(off), held));
  assert.ok(!table.includes('search_chats') && !table.includes('get_system_info'), table.join(','));
});
