// The two halves of the tool layer, and whether they agree.
//
// chatTools decides what is on the table; runChatTool is what runs when one is
// called. While they lived 1,400 lines apart in main.ts nothing could compare
// them, and the two ways they drift are both silent: a tool offered with no
// handler answers "Unknown tool" to a model that did exactly as it was told,
// and a handler for a tool never offered is dead code nobody trips over.
//
// The rest is the half that actually enforces things. Every permission is
// checked twice — once when the table is laid, once when the call arrives — and
// it is the second one that matters, because a model can name a tool it was
// never offered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chatTools, machineRelevant, runChatTool, type ToolAvailability, type ToolDeps } from '../electron/tools';
import type { ToolCall } from '../electron/provider';

const EVERYTHING: ToolAvailability = {
  choices: true,
  journal: true,
  anilist: true,
  web: false,
  search: { enabled: true, readPages: true, transcripts: true },
  knowledge: true,
  system: { enabled: true, level: 2 },
  hands: true,
  desktop: { launch: true, power: true },
};

const NOTHING: ToolAvailability = {
  choices: false,
  journal: false,
  anilist: false,
  web: false,
  search: { enabled: false, readPages: false, transcripts: false },
  knowledge: false,
  system: { enabled: false, level: 0 },
  hands: false,
  desktop: { launch: false, power: false },
};

const offered = (available: ToolAvailability) =>
  chatTools(available).map(tool => tool.function.name);

/**
 * A stand-in for the running app. Everything answers empty or off, so a handler
 * that is reached returns its own "there is nothing to do" rather than touching
 * a store, a socket or the machine.
 */
function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    CHAT_TIMEZONE: 'Europe/London',
    net: { fetch: async () => new Response('') },
    store: { get: () => undefined, getBlocks: () => [], transaction: (run) => run() },
    getCheckIns: () => ({ entries: [] }),
    setCheckIns: () => {},
    getJournal: () => [],
    writeJournal: () => undefined,
    noteJournalAsked: () => {},
    getKept: () => [],
    addKeptItem: (item) => ({ id: 'new', done: false, ...item }),
    toggleKept: () => {},
    removeKept: () => {},
    updateKept: () => null,
    getMemories: () => [],
    setMemories: () => {},
    addMemory: () => null,
    setBlocks: () => {},
    blockSources: () => ({ character: { identity: '', style: '' }, profile: { nickname: '', occupation: '', about: '' }, memories: [], sessions: [] }),
    getWardrobeControls: () => [],
    sendToWindows: () => {},
    getInterests: () => [],
    setInterests: () => {},
    readSystemConfig: () => ({ enabled: false, level: 0, allowlist: [] }),
    getKnowledgeConfig: () => ({ enabled: false, contextChunks: 4, threshold: 0.2, contextChars: 2000 }),
    getKnowledgeEmbedder: () => null,
    knowledgeStore: () => ({ chunks: [], documents: [] }),
    tryEmbedQuery: async () => null,
    memoryVectors: () => new Map(),
    touchChunks: () => {},
    getSearchKey: () => '',
    handsAllowed: () => false,
    onWeb: () => false,
    markPageRead: () => {},
    setPendingChoices: () => {},
    requestRestart: () => {},
    lastResults: () => [],
    lastSearchQuery: () => '',
    rememberSearch: () => {},
    runSystemCommand: async () => ({ ok: true }),
    ...overrides,
  };
}

const call = (name: string, args: Record<string, unknown> = {}): ToolCall =>
  ({ id: 'c1', function: { name, arguments: args } });

const run = (name: string, args: Record<string, unknown> = {}, said = '', over: Partial<ToolDeps> = {}) =>
  runChatTool(call(name, args), said, deps(over));

test('every tool she can be offered has a handler behind it', async () => {
  // Called with no arguments, so each handler answers its own "nothing to do"
  // and touches nothing. The system tools are offered but switched off in the
  // deps, which is what keeps this from shelling out to nvidia-smi and docker —
  // their group check answers first, and answering at all is the proof wanted.
  for (const name of offered(EVERYTHING)) {
    const reply = await run(name, {}, 'go on then', { readSystemConfig: () => ({ enabled: false, level: 0, allowlist: [] }) });
    assert.ok(!reply.includes('Unknown tool'), `${name} is offered but nothing handles it`);
  }
});

test('a tool nobody offers is refused by name, so the check above is not vacuous', async () => {
  const reply = await run('summon_a_horse');
  assert.match(reply, /Unknown tool .*summon_a_horse/);
});

test('no handler is dead code — every one is reachable from some setting', async () => {
  // The inverse of the first test. Anything runChatTool answers for should be
  // something chatTools can actually put on the table.
  const reachable = new Set(offered(EVERYTHING));
  const handled = [
    'note_check_in', 'save_journal_entry', 'look_up_anime', 'convert_picture',
    'open_app', 'close_app', 'power', 'read_web_page', 'read_video_transcript', 'offer_choices', 'search_web',
    'show_wardrobe', 'remember_about_user', 'core_memory_append', 'core_memory_replace', 'core_memory_rethink',
    'create_kept_item', 'complete_kept_item', 'update_kept_item', 'delete_kept_item',
    'get_system_info', 'get_gpu_info', 'get_processes', 'get_docker_status',
    'get_service_status', 'diagnose_system', 'restart_docker_container',
    'start_service', 'stop_service', 'restart_haru', 'look_up_knowledge', 'adopt_interest',
  ];
  for (const name of handled) {
    assert.ok(reachable.has(name), `${name} has a handler but is never offered to anyone`);
  }
  assert.equal(reachable.size, handled.length, 'the table and the dispatcher have drifted apart');
});

test('switched off means not on the table', () => {
  const bare = offered(NOTHING);
  for (const name of ['search_web', 'read_web_page', 'read_video_transcript', 'look_up_knowledge', 'look_up_anime',
                      'save_journal_entry', 'offer_choices', 'open_app', 'close_app', 'power',
                      'get_system_info', 'restart_haru']) {
    assert.ok(!bare.includes(name), `${name} should not be offered when it is switched off`);
  }
  // A check-in is a note about a moment, and those happen with or without a diary.
  assert.ok(bare.includes('note_check_in'));
  assert.ok(bare.includes('create_kept_item'));
});

test('reading pages is offered separately from searching', () => {
  const searchOnly = offered({ ...NOTHING, search: { enabled: true, readPages: false, transcripts: false } });
  assert.ok(searchOnly.includes('search_web'));
  assert.ok(!searchOnly.includes('read_web_page'));
});

test('the machine tools need a permission level, not just being switched on', () => {
  const looking = offered({ ...NOTHING, system: { enabled: true, level: 1 } });
  assert.ok(looking.includes('get_system_info'), 'level one may look');
  assert.ok(!looking.includes('restart_haru'), 'level one may not touch');
  assert.ok(!looking.includes('start_service'));

  const acting = offered({ ...NOTHING, system: { enabled: true, level: 2 } });
  assert.ok(acting.includes('restart_haru'));
});

test('no hands means no hands, whatever the desktop settings say', () => {
  const noHands = offered({ ...NOTHING, hands: false, desktop: { launch: true, power: true } });
  assert.ok(!noHands.includes('open_app'));
  assert.ok(!noHands.includes('power'));

  const hands = offered({ ...NOTHING, hands: true, desktop: { launch: true, power: true } });
  assert.deepEqual(
    ['open_app', 'close_app', 'power'].filter(name => hands.includes(name)),
    ['open_app', 'close_app', 'power'],
  );
});

test('the desk-only tools stay off the table on the web', () => {
  const onWeb = offered({ ...EVERYTHING, web: true });
  for (const name of ['show_wardrobe', 'look_up_anime', 'offer_choices']) {
    assert.ok(!onWeb.includes(name), `${name} should not be offered to the phone`);
  }
  // Everything else she can do on the desk is still there for a web chat.
  assert.ok(onWeb.includes('remember_about_user'));
  assert.ok(onWeb.includes('search_web'));
  assert.ok(onWeb.includes('convert_picture'));

  const atDesk = offered({ ...EVERYTHING, web: false });
  for (const name of ['show_wardrobe', 'look_up_anime', 'offer_choices']) {
    assert.ok(atDesk.includes(name), `${name} should be offered at the desk`);
  }
});

test('the desk-only tools are refused again where they actually run on the web', async () => {
  // The table is not the guarantee: a model can name a tool it was never offered.
  for (const name of ['show_wardrobe', 'look_up_anime', 'offer_choices']) {
    const reply = await run(name, { title: 'spice and wolf', choices: ['a', 'b'] }, '', { onWeb: () => true });
    assert.match(reply, /Not on the phone/, `${name} ran on the web`);
  }
  // And still answer at the desk.
  const reply = await run('look_up_anime', { title: 'spice and wolf' }, '', { onWeb: () => false });
  assert.ok(!reply.includes('Not on the phone'));
});

test('the hands check is enforced again where the tool actually runs', async () => {
  // The table is not the guarantee. A model can name a tool it was never
  // offered, and this is the half that runs.
  for (const name of ['open_app', 'close_app', 'power']) {
    const reply = await run(name, { name: 'spotify', action: 'shutdown' }, '', { handsAllowed: () => false });
    assert.match(reply, /Not now/, `${name} ran without hands`);
  }
});

test('a machine action refuses below permission level two', async () => {
  const reply = await run('restart_haru', { confirm: true }, '', {
    readSystemConfig: () => ({ enabled: true, level: 1, allowlist: ['restart_haru'] }),
  });
  assert.match(reply, /not permitted at the current permission level/);
});

test('a machine action refuses when it is not on the allowlist', async () => {
  const reply = await run('restart_haru', { confirm: true }, '', {
    readSystemConfig: () => ({ enabled: true, level: 2, allowlist: [] }),
  });
  assert.match(reply, /not on the allowlist/);
});

test('a machine action asks before it acts, and only then restarts', async () => {
  const permitted = { readSystemConfig: () => ({ enabled: true, level: 2, allowlist: ['restart_haru'] }) };
  let restarted = false;

  const asked = await run('restart_haru', {}, '', permitted);
  assert.match(asked, /"confirm":true/, 'it should ask first rather than act');
  assert.match(asked, /Do not act yet/);

  const confirmed = await run('restart_haru', { confirm: true }, '', {
    ...permitted,
    requestRestart: () => { restarted = true; },
  });
  assert.match(confirmed, /"restarting":true/);
  assert.ok(restarted, 'and the restart is requested, not performed mid-reply');
});

test('a service she is not permitted to control is refused by name', async () => {
  const reply = await run('start_service', { name: 'sshd', confirm: true }, '', {
    readSystemConfig: () => ({ enabled: true, level: 2, allowlist: ['start_service'] }),
  });
  assert.match(reply, /not a service I am permitted to control/);
});

test('"it is not done" is not the same as "cancel it"', async () => {
  // Found the hard way: deleting what they only meant to un-tick loses the task
  // entirely, and nothing they can say afterwards brings it back.
  const open = [{ id: '1', title: 'Bins', date: '2026-08-20', kind: 'task' as const, done: false }];
  const reply = await run('delete_kept_item', { title: 'Bins' }, "I haven't done the bins yet", { getKept: () => open });
  assert.match(reply, /which is not the same as cancelling it/);
  assert.match(reply, /complete_kept_item with undo/);
});

test('cancelling something really does delete it', async () => {
  const open = [{ id: '1', title: 'Bins', date: '2026-08-20', kind: 'task' as const, done: false }];
  let removed = '';
  const reply = await run('delete_kept_item', { title: 'Bins' }, 'forget the bins, it is cancelled',
    { getKept: () => open, removeKept: (id) => { removed = id; } });
  assert.match(reply, /"deleted":"Bins"/);
  assert.equal(removed, '1');
});

test('a page cannot be opened before anything has been searched for', async () => {
  const reply = await run('read_web_page', { result: 1 }, '', {
    store: { get: () => ({ enabled: true, readPages: true }), getBlocks: () => [], transaction: (r) => r() },
  });
  assert.match(reply, /no search results to open/);
});

test('a block that does not exist is named, not silently ignored', async () => {
  const reply = await run('core_memory_append', { label: 'nonsense', content: 'x' });
  assert.match(reply, /no memory block called .*nonsense/);
});

test('a title that matches nothing hands back the list, so the next round can correct itself', async () => {
  // Seen live: the model pasted the user's whole sentence in as the title,
  // matched nothing, and read the bare error back out loud in assistant-speak.
  const kept = [
    { id: '1', title: 'Scarlett Birthday Party', date: '2026-08-29', kind: 'event' as const, done: false },
    { id: '2', title: 'Get Scarlett a birthday present', date: '2026-08-28', kind: 'task' as const, done: false },
  ];
  const reply = await run('delete_kept_item', { title: 'Its not till later today @5pm' }, '', { getKept: () => kept });
  // The reply is JSON, so the quotes around each title arrive escaped — match
  // the words, not the quoting.
  assert.match(reply, /Scarlett Birthday Party/, 'the real titles should ride along');
  assert.match(reply, /Get Scarlett a birthday present/);
  assert.match(reply, /call this again with that item's own title/, 'the retry is the point of another round');
  assert.match(reply, /Never read this message back/, 'or she recites the error in assistant-speak');
});

test('an empty list says so instead of naming nothing', async () => {
  const reply = await run('update_kept_item', { title: 'anything', date: 'tomorrow' }, '', { getKept: () => [] });
  assert.match(reply, /list is empty/);
  assert.match(reply, /your own voice/);
});

test('a miss on complete only offers items on the right side of done', async () => {
  const kept = [
    { id: '1', title: 'Bins', date: '2026-08-28', kind: 'task' as const, done: true },
    { id: '2', title: 'Dentist', date: '2026-08-28', kind: 'task' as const, done: false },
  ];
  const reply = await run('complete_kept_item', { title: 'zzz nothing zzz' }, '', { getKept: () => kept });
  assert.match(reply, /Dentist/, 'the open item is a candidate');
  assert.ok(!reply.includes('Bins'), 'the finished one is not — it cannot be ticked off again');
});

test('adopt_interest takes up a show they told her about, and refuses a duplicate', async () => {
  let interests: unknown[] = [];
  const withInterests = (over: Partial<ToolDeps> = {}) => deps({
    getInterests: () => interests as { id: string; kind: 'game' | 'anime'; name: string; because: string; since: string; nights: number; lastAt: string; stance: string }[],
    setInterests: (next) => { interests = next; },
    ...over,
  });
  const reply = await runChatTool(call('adopt_interest', { title: 'Frieren', kind: 'anime' }), 'have you seen frieren, you would love it', withInterests());
  assert.match(reply, /Taken up: Frieren/);
  assert.equal(interests.length, 1);
  assert.equal((interests[0] as { name: string }).name, 'Frieren');
  assert.match((interests[0] as { because: string }).because, /they told you about it/);
  // A second adoption of the same title is refused.
  const again = await runChatTool(call('adopt_interest', { title: 'frieren', kind: 'anime' }), 'did you try frieren', withInterests());
  assert.match(again, /already one of yours/);
  assert.equal(interests.length, 1, 'nothing was added');
  // Manga is not one of hers yet.
  const manga = await runChatTool(call('adopt_interest', { title: 'Vinland Saga', kind: 'manga' }), 'read vinland saga', withInterests());
  assert.match(manga, /kind/);
  assert.equal(interests.length, 1);
});

test('machineRelevant is broad enough to keep the heavy tools for machine and app talk', () => {
  for (const said of ['check the server', 'is the gpu ok', 'why is the ram full', 'docker up?', 'is the disk nearly full', 'my pc is slow', 'open discord', 'shut the computer down', 'make this an icon', 'what services are running', 'how is the machine doing']) {
    assert.equal(machineRelevant(said), true, `should keep tools for: ${said}`);
  }
  for (const said of ['morning', "how's your day", 'what did you do last night', 'tell me about chainsaw man', "let's get lunch"]) {
    assert.equal(machineRelevant(said), false, `should drop tools for: ${said}`);
  }
});

test('the tool table drops the machine and app groups on turns that are not about them', () => {
  const onTable = (latest: string) => chatTools(EVERYTHING, latest).map(tool => tool.function.name);
  const chat = onTable("what's up");
  assert.ok(!chat.includes('get_gpu_info'), 'no system tools on a chat turn');
  assert.ok(!chat.includes('diagnose_system'));
  assert.ok(!chat.includes('open_app') && !chat.includes('power') && !chat.includes('convert_picture'));
  assert.ok(chat.includes('create_kept_item') && chat.includes('adopt_interest') && chat.includes('remember_about_user'), 'the thinking tools stay');
  const machine = onTable('why is the gpu at 100%');
  assert.ok(machine.includes('get_gpu_info') && machine.includes('diagnose_system') && machine.includes('open_app') && machine.includes('power') && machine.includes('convert_picture'), 'machine talk keeps them');
  // Empty latest (no user turn yet) offers everything — the safe default.
  const bare = onTable('');
  assert.ok(bare.includes('get_gpu_info') && bare.includes('power'));
});

test('core_memory_rethink rewrites a block and supersedes the lines it replaced', async () => {
  const records: Record<string, unknown>[] = [
    { id: 'r1', text: 'Does not like being nagged', kind: 'preference', createdAt: 'd', mentions: 3 },
    { id: 'r2', text: 'Prefers longer, more substantive replies', kind: 'preference', createdAt: 'd', mentions: 2 },
  ];
  let memories = records as never[];
  const mem = {
    getMemories: () => memories,
    setMemories: (next: never[]) => { memories = next; },
    addMemory: (text: string, kind: string) => {
      const record = { id: 'new', text, kind, createdAt: 'd', mentions: 0 };
      memories = [...memories, record as never];
      return { record, created: true };
    },
  };
  const blockOverrides: Partial<ToolDeps> = {
    getMemories: mem.getMemories,
    setMemories: mem.setMemories,
    addMemory: mem.addMemory as never,
    blockSources: () => ({ character: { identity: '', style: '' }, profile: { nickname: 'Tommy', occupation: '', about: '' }, memories: memories as never[], sessions: [] }),
  };
  // The default block set, with preferences editable and persona read-only.
  const blocks = [
    { id: 'block-persona', label: 'persona', description: '', limit: 5000, read_only: true },
    { id: 'block-preferences', label: 'preferences', description: '', limit: 5000, read_only: false },
  ];
  const d = deps({
    ...blockOverrides,
    store: { get: () => undefined, getBlocks: () => blocks, transaction: (run) => run() },
  });
  const reply = await runChatTool(call('core_memory_rethink', { label: 'preferences', new_value: 'Dislikes nagging; wants substantive replies.' }), 'rewrite it', d);
  assert.match(reply, /Rewrote the preferences block/);
  // The rewrite itself was proposed to the engine, and the old lines are superseded.
  assert.ok(memories.some(m => (m as { id: string }).id === 'new'), 'the rewrite went through the engine');
  assert.equal((memories.find(m => (m as { id: string }).id === 'r1') as { supersededBy?: string } | undefined)?.supersededBy, 'new');
  assert.equal((memories.find(m => (m as { id: string }).id === 'r2') as { supersededBy?: string } | undefined)?.supersededBy, 'new');
  // The persona block is read-only.
  const refused = await runChatTool(call('core_memory_rethink', { label: 'persona', new_value: 'anything' }), 'rewrite it', d);
  assert.match(refused, /read-only/);
});
