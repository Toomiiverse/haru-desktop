import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceWorld, commandWorld, newWorld, readWorld, readWorldCommand, tickWorld, worldActions, worldNudgeCandidates, worldNote, worldView, moveToNeighborhood, type WorldState, type WorldActionId } from '../electron/world';
import { chooseWorldAction, localWorldEndpoint, WorldEngine, WORLD_THINK_GAP, WORLD_THINK_LIMIT } from '../electron/world-engine';
import { nudgeContentProblem } from '../electron/nudges';

const NOW = Date.parse('2026-09-27T12:00:00Z');
function doing(id: WorldActionId) { return commandWorld(newWorld(NOW), { type: 'suggest', action: id }, NOW); }

test('Willowbrook move-in preserves her existing history, clock, needs, plans and project progress', () => {
  const before = advanceWorld(doing('game'),10,NOW+1000);
  before.room.games=9; before.speed=1; before.brain.calls=4;
  const moved=moveToNeighborhood(before,NOW+2000);
  for(const key of ['startedAt','minute','updatedAt','running','speed','needs','projects','room','activity','brain','relationships'] as const) assert.deepEqual(moved[key],before[key],key);
  assert.deepEqual(moved.events.slice(0,-1),before.events);
  assert.equal(moved.events.at(-1)?.topic,'willowbrook');
  assert.equal(moved.sequence,before.sequence+1);
  assert.equal(before.neighborhood,undefined);
  assert.equal(moveToNeighborhood(moved,NOW+3000),moved);
  assert.deepEqual(readWorld(JSON.parse(JSON.stringify(moved)),NOW),moved);
  const view=worldView(moved).neighborhood!;
  assert.equal(view.game.npcs.length,7); assert.equal(moved.neighborhood!.game.npcs.length,6);
  assert.deepEqual(view.game.npcs.map((n:any)=>n.id),['lina','theo','maya','felix','jules','bea','haru']);
  assert.equal(new Map(view.walkers).get('haru').inside,'home');
});

test('server walkers arrive before visits finish; only completed visits enter Haru’s journal', () => {
  const base=moveToNeighborhood(newWorld(NOW),NOW); base.speed=1;
  const queued=commandWorld(base,{type:'suggest',action:'park'},NOW);
  const moving=advanceWorld(queued,.1,NOW+6000);
  assert.equal(new Map(moving.neighborhood!.walkers).get('haru').moving,true);
  assert.equal(moving.location,'home'); assert.equal(moving.events.length,base.events.length);
  assert.match(worldNote(moving),/walking toward Willow Park/);
  const arrived=advanceWorld(moving,6,NOW+7000);
  assert.equal(new Map(arrived.neighborhood!.walkers).get('haru').moving,false);
  assert.equal(arrived.location,'park'); assert.equal(arrived.events.length,base.events.length);
  const completed=advanceWorld(moving,moving.activity!.ends-moving.minute,NOW+8000);
  assert.equal(completed.activity,null); assert.equal(completed.events.at(-1)?.topic,'willowbrook-park');
  assert.match(worldNote(completed),/Completed a visit to Willow Park/);
  assert.doesNotMatch(worldNote(completed),/energy:|company:|curiosity:/);
  let s=completed;
  for(const id of ['cafe','library','market','studio','tea'] as const){
    s=commandWorld(s,{type:'suggest',action:id},s.updatedAt);
    s=advanceWorld(s,.01,s.updatedAt+1);
    s=advanceWorld(s,s.activity!.ends-s.minute,s.updatedAt+1);
    assert.equal(new Map(s.neighborhood!.walkers).get('haru').inside,id==='tea'?'home':id);
    assert.equal(readWorld(JSON.parse(JSON.stringify(s)),NOW).minute,s.minute);
  }
});

test('server NPCs keep living while no browser is open, keep private homes private, and survive reloads', () => {
  let s=moveToNeighborhood(newWorld(NOW,51),NOW);
  const first=JSON.stringify(s.neighborhood!.game.npcs);
  for(let day=0;day<7;day++){
    s=advanceWorld(s,1440,NOW+(day+1)*86400000);
    for(const [id,w] of s.neighborhood!.walkers){
      if(w.destination.startsWith('home'))assert.equal(w.destination,id==='haru'?'home':`home-${id}`);
      assert.ok(w.route.length<12);
    }
    assert.equal(s.neighborhood!.lastHour,Math.floor(s.minute/60));
    assert.equal(s.neighborhood!.game.day,worldView(s).clock.day);
    s=readWorld(JSON.parse(JSON.stringify(s)),NOW);
  }
  assert.notEqual(JSON.stringify(s.neighborhood!.game.npcs),first);
  assert.equal(s.neighborhood!.walkers.length,7);
  assert.ok(s.events.some(e=>e.topic.startsWith('willowbrook-')));
  const before=JSON.stringify(s); worldView(s);worldNote(s); assert.equal(JSON.stringify(s),before,'readers never tick or mutate');
  for(const malformed of [null,{},'bad']){
    const corrupt=structuredClone(s);corrupt.neighborhood!.walkers[0]=malformed as any;
    assert.throws(()=>readWorld(corrupt,NOW),/left intact/);
  }
  const corrupt=structuredClone(s);corrupt.neighborhood!.lastHour--;
  assert.throws(()=>readWorld(corrupt,NOW),/left intact/);
});

test('room movement and activity completion are separate; rewards arrive only at completion', () => {
  const start = doing('anime'); start.room.spot = 'bed';
  const moving = advanceWorld(start, 1, NOW + 1000);
  assert.equal(moving.location, 'home'); assert.equal(moving.room.episodes, 0);
  assert.equal(worldView(moving).current?.moving, true);
  assert.equal(moving.room.spot, 'bed');
  const there = advanceWorld(start, 3, NOW + 1000);
  assert.equal(there.room.spot, 'desk'); assert.equal(there.room.episodes, 0);
  const done = advanceWorld(start, 27, NOW + 2000);
  assert.equal(done.room.episodes, 1); assert.equal(done.events.at(-1)?.topic, 'afterlight');
  assert.equal(moving.activity?.by, 'visitor');
  assert.equal(start.room.episodes, 0, 'pure transitions leave prior snapshots untouched');
  assert.equal(worldView(done).people.length, 0);
});

test('all current activities stay in the apartment; night sleep and control validation still apply', () => {
  const s = newWorld(NOW);
  for (const id of ['plant', 'water', 'harvest', 'mina', 'ren', 'yui', 'walk']) {
    assert.equal(readWorldCommand({ type: 'suggest', action: id }), null);
    assert.throws(() => commandWorld(s, { type: 'suggest', action: id }, NOW), /not recognised/);
  }
  assert.ok(worldActions(s).every(a => a.place === 'home'));
  assert.ok(!worldActions(s).some(a => a.id === 'sleep'));
  s.minute = 23 * 60;
  assert.ok(worldActions(s).some(a => a.id === 'sleep'));
  assert.ok(worldActions(s).some(a => a.id === 'read'), 'her own books have no opening hours');
});

test('room projects and lighting persist across a serialized reload', () => {
  let s = newWorld(NOW);
  for (let i = 0; i < 4; i++) {
    s = commandWorld(s, { type: 'suggest', action: 'read' }, NOW + i);
    s = advanceWorld(s, i === 0 ? 52 : 50, NOW + i + 1);
    s = readWorld(JSON.parse(JSON.stringify(s)), NOW + i + 1);
  }
  assert.equal(s.projects.books, 1); assert.equal(s.projects.reading, 0);
  assert.equal(s.events.at(-1)?.kind, 'milestone');
  const played = advanceWorld(doing('game'), 45, NOW + 1000);
  const lit = commandWorld(played, { type: 'lighting', value: 'warm' }, NOW + 1000);
  const loaded = readWorld(JSON.parse(JSON.stringify(lit)), NOW);
  assert.equal(loaded.room.games, 1); assert.equal(loaded.room.lighting, 'warm');
  assert.equal(readWorldCommand({ type: 'lighting', value: 'flash' }), null);
});

test('the previous neighbourhood save migrates once without losing progress or manufacturing a completed trip', () => {
  const base = newWorld(NOW);
  const legacy = { ...base, version: 1, room: undefined, location: 'garden', focus: 'garden',
    projects: { reading: 50, books: 3, sketches: 9, albums: 2 },
    relationships: { mina: 32, ren: 16, yui: 40 }, inventory: { seeds: 6, basil: 9 },
    recent: ['plant', 'water'], suggested: { id: 'yui', by: 'visitor' },
    activity: { id: 'water', from: 'garden', started: 530, arrived: 530, ends: 550, by: 'routine', manual: false } };
  const migrated = readWorld(legacy, NOW + 1000);
  assert.equal(migrated.version, 2); assert.equal(migrated.location, 'home');
  assert.equal(migrated.activity, null); assert.equal(migrated.suggested, null);
  assert.equal(migrated.minute, legacy.minute); assert.equal(migrated.startedAt, legacy.startedAt);
  assert.deepEqual(migrated.projects, legacy.projects); assert.deepEqual(migrated.inventory, legacy.inventory);
  assert.deepEqual(migrated.relationships, legacy.relationships);
  assert.deepEqual(migrated.events.slice(0, -1), legacy.events);
  assert.equal(migrated.events.at(-1)?.kind, 'arrival');
  assert.deepEqual(readWorld(migrated, NOW + 2000), migrated, 'migration is idempotent');
  assert.equal(legacy.location, 'garden'); assert.equal(legacy.activity.id, 'water');
  assert.throws(() => readWorld({ ...legacy, activity: { ...legacy.activity, id: 'corrupt' } }, NOW), /left intact/);
  assert.throws(() => readWorld({ ...migrated, room: { ...migrated.room, games: -1 } }, NOW), /left intact/);
  assert.throws(() => readWorld({ ...migrated, version: 3 }, NOW), /left intact/);
});

test('old neighbourhood milestones stay in history; room gaming milestones can become grounded nudges', () => {
  const s = newWorld(NOW);
  s.events.push({ id: 'world-2', at: new Date(NOW).toISOString(), minute: 540, kind: 'milestone', topic: 'basil',
    text: 'Harvested basil in the earlier town.', line: 'A harvest.', manual: false, source: 'virtual-world' });
  s.sequence = 2;
  const migrated = readWorld({ ...s, version: 1, room: undefined }, NOW + 1);
  assert.equal(worldNudgeCandidates(migrated, NOW + 2).length, 0);
  assert.ok(migrated.events.some(e => e.topic === 'basil'));
  migrated.room.games = 4;
  const queued = commandWorld(migrated, { type: 'suggest', action: 'game' }, NOW + 1);
  const played = advanceWorld(queued, 45, NOW + 1000);
  const candidates = worldNudgeCandidates(played, NOW + 2000);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].subject.key, 'world:neon-circuit');
  assert.match(candidates[0].subject.instruction!, /virtual apartment/);
  assert.equal(nudgeContentProblem(candidates[0].subject, 'Five gaming sessions in my virtual apartment. The RGB clearly helps.', [], NOW), null);
});

test('world pause, speed changes, clock rollback and downtime do not invent time', () => {
  const s = newWorld(NOW);
  assert.equal(tickWorld(s, NOW + 10_000).minute, 542);
  assert.equal(tickWorld(s, NOW + 2 * 86_400_000).minute, 540);
  assert.strictEqual(tickWorld(s, NOW - 1000), s);
  const paused = commandWorld(s, { type: 'running', value: false }, NOW + 10_000);
  assert.equal(tickWorld(paused, NOW + 20_000).minute, 542);
  const fast = commandWorld(s, { type: 'speed', value: 60 }, NOW + 10_000);
  assert.equal(tickWorld(fast, NOW + 20_000).minute, 552);
  assert.throws(() => commandWorld(s, { type: 'advance', minutes: 30 }, NOW), /Pause/);
});

test('world controls cannot write arbitrary state or execute unknown actions', () => {
  for (const input of [null, [], {}, { type: 'speed', value: 999999 }, { type: 'advance', minutes: 9999 },
    { type: 'suggest', action: 'teleport' }, { type: 'running', value: 'false' }, { type: 'focus', value: '<script>' }, { type: 'reset' }]) assert.equal(readWorldCommand(input), null);
  assert.throws(() => advanceWorld(newWorld(NOW), Infinity, NOW));
  assert.throws(() => advanceWorld(newWorld(NOW), -1, NOW));
  assert.throws(() => readWorld({ version: 2 }, NOW), /left intact/);
  for (const corrupt of [{ ...newWorld(NOW), activity: {} }, { ...newWorld(NOW), needs: {} }, { ...newWorld(NOW), events: [null] }]) assert.throws(() => readWorld(corrupt, NOW));
});

test('world time produces varied, bounded progress over a month without getting stuck', () => {
  let s = newWorld(NOW, 55);
  const actions = new Set<string>();
  for (let day = 0; day < 30; day++) {
    s = advanceWorld(s, 1440, NOW + day * 86_400_000);
    for (const e of s.events) actions.add(e.topic);
    for (const n of Object.values(s.needs)) assert.ok(n >= 0 && n <= 100);
    assert.ok(s.inventory.seeds >= 0);
    assert.ok(s.events.length <= 100);
    readWorld(JSON.parse(JSON.stringify(s)), NOW);
  }
  assert.ok(actions.size >= 9, Array.from(actions).join(', '));
  assert.ok(s.projects.books >= 1); assert.ok(s.projects.albums >= 1); assert.ok(s.room.games >= 1); assert.ok(s.room.episodes >= 1); assert.equal(s.location, 'home');
  assert.equal(s.minute, 540 + 30 * 1440);
  assert.equal(new Set(s.events.map(e => e.id)).size, s.events.length);
});

test('world nudge sources exclude routine work, skipped time, expired events and paused worlds', () => {
  const s = doing('read'); s.projects.reading = 75;
  const completed = advanceWorld(s, 52, NOW + 1000);
  const candidates = worldNudgeCandidates(completed, NOW + 2000);
  assert.equal(candidates.length, 1); assert.match(candidates[0].subject.material, /VIRTUAL GAME WORLD/);
  assert.equal(candidates[0].subject.kind, 'own'); assert.equal(candidates[0].subject.revision, completed.events.at(-1)?.id);
  assert.equal(worldNudgeCandidates(advanceWorld(s, 52, NOW + 1000, true), NOW + 2000).length, 0);
  assert.equal(worldNudgeCandidates({ ...completed, running: false }, NOW + 2000).length, 0);
  assert.equal(worldNudgeCandidates(completed, NOW + 7 * 3_600_000).length, 0);
  assert.equal(worldNudgeCandidates(advanceWorld(doing('tea'), 22, NOW + 1000), NOW + 2000).length, 0);
  assert.match(worldNote(completed), /simulated experiences/);
  assert.match(worldNote(completed), /Finished reading/);
});

test('world nudges must preserve the virtual setting in the actual outgoing words', () => {
  const s = doing('read'); s.projects.reading = 75;
  const subject = worldNudgeCandidates(advanceWorld(s, 52, NOW + 1000), NOW + 2000)[0].subject;
  assert.match(nudgeContentProblem(subject, 'Finished a book at the library.', [], NOW)!, /virtual/);
  assert.equal(nudgeContentProblem(subject, 'Finished the mystery in my little town. Suspicious timetables deserve scrutiny.', [], NOW), null);
});

function harness(think: (s: WorldState, signal: AbortSignal) => Promise<WorldActionId | null> = async () => 'sketch') {
  let saved: unknown, now = NOW, quiet = true;
  const e = new WorldEngine({ load: () => saved, save: s => { saved = structuredClone(s); }, now: () => now,
    day: () => new Date(now).toISOString().slice(0, 10), quiet: () => quiet, think });
  e.initialize();
  return { e, advance: (ms: number) => { now += ms; }, quiet: (on: boolean) => { quiet = on; }, clear: () => { saved = undefined; } };
}

test('world local planner is quiet-only, reserves attempts and obeys daily caps', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return 'sketch'; });
  h.quiet(false); await h.e.plan(); assert.equal(calls, 0);
  h.quiet(true);
  for (let i = 0; i < WORLD_THINK_LIMIT + 2; i++) {
    h.e.command({ type: 'focus', value: 'creative' });
    await h.e.plan(); h.advance(WORLD_THINK_GAP + 1);
  }
  assert.equal(calls, WORLD_THINK_LIMIT); assert.equal(h.e.state().brain.calls, WORLD_THINK_LIMIT);
  h.advance(86_400_000); h.e.command({ type: 'focus', value: 'creative' }); await h.e.plan();
  assert.equal(calls, WORLD_THINK_LIMIT + 1);
});

test('world delayed model result cannot undo a visitor control or overwrite tick progress', async () => {
  let finish!: (id: WorldActionId | null) => void;
  let signal: AbortSignal | undefined;
  const h = harness(async (_s, sig) => { signal = sig; return new Promise(resolve => { finish = resolve; }); });
  const pending = h.e.plan();
  await h.e.plan(); assert.equal(h.e.state().brain.calls, 1);
  h.e.command({ type: 'focus', value: 'reading' });
  assert.equal(signal!.aborted, true);
  finish('sketch'); await pending;
  assert.equal(h.e.state().focus, 'reading'); assert.equal(h.e.state().suggested, null);
  assert.doesNotMatch(h.e.state().brain.status, /is choosing/);
  h.advance(WORLD_THINK_GAP + 1);
  const next = h.e.plan(); h.advance(10_000); h.e.tick();
  const minute = h.e.state().minute;
  finish('sketch'); await next;
  assert.equal(h.e.state().minute, minute); assert.equal(h.e.state().suggested?.id, 'sketch');
});

test('world planner failures retain the attempt and allow local routines to continue', async () => {
  const h = harness(async () => { throw new Error('offline'); });
  await h.e.plan(); await h.e.plan();
  assert.equal(h.e.state().brain.calls, 1);
  h.advance(10_000); h.e.tick(); assert.equal(h.e.state().minute, 542);
  assert.match(h.e.state().brain.status, /unavailable/);
  h.advance(100); h.clear();
  const first = h.e.state().startedAt;
  h.advance(1000); assert.equal(h.e.state().startedAt, first, 'a full Haru reset creates one new world');
  assert.equal(h.e.view().neighborhood!.game.npcs.length,7,'an intentional reset still creates the connected neighborhood');
});

test('world planner only contacts loopback Ollama and validates model output against the menu', async () => {
  for (const endpoint of ['https://api.openai.com', 'http://127.0.0.1.evil.test', 'file:///tmp/x', 'http://user:secret@localhost', 'http://localhost/redirect', 'http://localhost?to=remote'])
    assert.equal(localWorldEndpoint({ provider: 'ollama', model: 'test', endpoint }), null);
  const config = { provider: 'ollama', model: 'local', endpoint: 'http://127.0.0.1:11436' };
  assert.equal(localWorldEndpoint({ ...config, provider: 'openai' }), null);
  let calls = 0;
  const fake = (async (url, init) => {
    calls++; assert.equal(url, 'http://127.0.0.1:11436/api/chat'); assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body)); assert.equal(body.think, false); assert.equal(body.options.num_predict, 100);
    return new Response(JSON.stringify({ message: { content: '{"action":"harvest"}' } }));
  }) as typeof fetch;
  assert.equal(await chooseWorldAction(config, { identity: 'Haru', style: 'sharp' }, newWorld(NOW), fake, new AbortController().signal), null);
  assert.equal(await chooseWorldAction({ ...config, endpoint: 'https://example.com' }, { identity: '', style: '' }, newWorld(NOW), fake, new AbortController().signal), null);
  assert.equal(calls, 1);
});

test('world planning can share the chat runner context without changing its token budget', async () => {
  const contexts: number[] = [];
  const fake = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    contexts.push(body.options.num_ctx);
    assert.equal(body.options.num_predict, 100);
    assert.equal(body.keep_alive, -1);
    return new Response(JSON.stringify({ message: { content: '{"action":"harvest"}' } }));
  }) as typeof fetch;
  const config = { provider: 'ollama', model: 'local', endpoint: 'http://127.0.0.1:11436' };
  await chooseWorldAction(config, { identity: 'Haru', style: 'sharp' }, newWorld(NOW), fake, new AbortController().signal, 20480);
  await chooseWorldAction(config, { identity: 'Haru', style: 'sharp' }, newWorld(NOW), fake, new AbortController().signal);
  assert.deepEqual(contexts, [20480, 4096]);
});
