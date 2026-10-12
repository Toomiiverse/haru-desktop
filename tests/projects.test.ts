// The things she is trying to do. Nothing here needs a model: the ladder, the
// gate that keeps a generated project in reach, the retention bias and the
// state machine are the parts that can be wrong without anyone noticing, so
// they are pinned down.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_MAX, ATTEMPTS_KEPT, HARDNESS, PROJECTS_CHARS, PROJECTS_SHOWN, RETENTION, SAME_IDEA, STEPS_TO_FINISH, STUCK_SHELVES,
  admits, advanceProject, asProject, beatenTwiceAt, childOf, dueForRevisit, isActive,
  hersOwn, judgeAttemptInput, judgeAttemptPrompt, needsHim, nowItStings, pickProject, projectInstruction,
  projectQuery, projectsNote, readAttemptVerdict, readProjects, revisit, roomForNew, sameIdea,
  settleFromRead, siblingOf, spawnInstruction, staleSpawns,
  needsSomethingNew, newProjectInstruction, standingIn, stepInstruction, type Attempt, type Project } from '../electron/projects';

const DAY = 24 * 3_600_000;
const now = Date.parse('2026-10-01T03:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function project(over: Partial<Project> = {}): Project {
  return { id: 'p1', interest: 'Bebop', text: 'to learn piano', since: '2026-09-01', nights: 0, status: 'declared', ...over };
}

function attempt(over: Partial<Attempt> = {}): Attempt {
  return { at: iso(now), step: 'work out the chords', outcome: 'no', by: 'read', measured: false, ...over };
}

test('readProjects keeps a want-shaped record whole, and asProject fills the rest in memory', () => {
  const old = { id: 'w1', interest: 'Hades', text: 'to get out of Elysium', since: '2026-09-03', nights: 2, status: 'working', note: 'still stuck' };
  const read = readProjects([old, { id: 'nope' }, null, 'no']);
  assert.equal(read.length, 1);
  assert.deepEqual(read[0], old, 'nothing added on the way in');
  const filled = asProject(read[0]);
  assert.equal(filled.hardness, HARDNESS.min);
  assert.deepEqual(filled.attempts, []);
  assert.equal(filled.bornOf, 'taste');
  assert.equal(filled.stuck, 0);
  assert.equal(filled.note, 'still stuck', 'her own words survive');
});

test('standing is the hardest rung she has finished, on the same scale as hardness', () => {
  const none = [project({ id: '1', status: 'working', nights: 9 })];
  assert.equal(standingIn(none, 'Bebop'), HARDNESS.min, 'nights alone prove nothing');
  const won = [project({ id: '1', status: 'done', hardness: 2, nights: 3 }), project({ id: '2', status: 'done', hardness: 1, nights: 5 })];
  assert.equal(standingIn(won, 'Bebop'), 3, 'a rung above the hardest she has done');
  const bruised = [...won, project({ id: '3', status: 'shelved', hardness: 3 }), project({ id: '4', status: 'shelved', hardness: 3 })];
  assert.equal(standingIn(bruised, 'Bebop'), 2, 'two that beat her say otherwise');
  const top = [project({ id: '1', status: 'done', hardness: HARDNESS.max })];
  assert.equal(standingIn(top, 'Bebop'), HARDNESS.max, 'and it stops at the top');
  assert.equal(standingIn(won, 'Nothing'), HARDNESS.min);
});

test('one she took on herself sits at the rung she is standing on', () => {
  const born = hersOwn('Bebop', 'To work out how a tritone substitution sounds.', '2026-10-01T00:00:00.000Z', 3);
  assert.equal(born.bornOf, 'her');
  assert.equal(born.hardness, 3);
  assert.equal(born.status, 'declared');
  assert.equal(born.text, 'work out how a tritone substitution sounds');
  assert.equal(hersOwn('Bebop', 'to do a thing', '2026-10-01T00:00:00.000Z', 99).hardness, HARDNESS.max);
  const asked = newProjectInstruction('Bebop', 'the jazz is the point', ['to learn piano']);
  assert.match(asked, /the jazz is the point/);
  assert.match(asked, /Not these, they are yours already: "to learn piano"/);
  assert.match(asked, /not waiting on anyone/);
});

test('she is asked for something of her own when she is at nothing', () => {
  assert.ok(needsSomethingNew([]));
  assert.ok(needsSomethingNew([project({ status: 'done', nights: 4 }), project({ status: 'declared', nights: 0 })]), 'a wish is not something she is at');
  assert.equal(needsSomethingNew([project({ status: 'working', nights: 1 })]), false);
  const full = Array.from({ length: ACTIVE_MAX }, (_unused, index) => project({ id: `p${index}`, status: 'declared', nights: 0, bornOf: 'child' }));
  assert.equal(needsSomethingNew(full), false, 'and not when there is no room anyway');
});

test('sameIdea catches the same want in new words, which is how sixteen happened', () => {
  assert.ok(sameIdea('to learn piano just to play The Real Folk Blues badly', 'to learn the piano so I can play Real Folk Blues badly') >= SAME_IDEA);
  assert.ok(sameIdea('to learn piano badly', 'to get out of Elysium for once') < SAME_IDEA);
});

test('needsHim keeps a step hers, without tripping over a third party', () => {
  assert.ok(needsHim('to argue the ending with him'));
  assert.ok(needsHim('get him to watch it'));
  assert.ok(needsHim('find someone else who has seen it'));
  assert.ok(needsHim('work out what you think of it'));
  assert.equal(needsHim('work out which chords the verse uses'), false);
  assert.equal(needsHim('find out what the writers were thinking when they wrote it'), false, 'a third party is not him');
});

test('admits is the whole minimal criterion, and says which part refused', () => {
  const past = [project({ text: 'to learn piano just to play The Real Folk Blues badly' })];
  const fine = { text: 'to work out how a tritone substitution actually sounds', hardness: 3, substrate: 'read' as const };
  assert.deepEqual(admits(fine, past, 3), { ok: true });
  assert.deepEqual(admits(fine, past, 5), { ok: false, why: 'out-of-reach' }, 'two rungs above her is not a challenge, it is a wall');
  assert.deepEqual(admits({ ...fine, substrate: undefined }, past, 3), { ok: false, why: 'no-substrate' });
  assert.deepEqual(admits({ ...fine, text: 'to learn the piano so I can play Real Folk Blues badly' }, past, 3), { ok: false, why: 'duplicate' });
  assert.deepEqual(admits({ ...fine, text: 'to argue about it with him' }, past, 3), { ok: false, why: 'needs-him' });
  assert.deepEqual(admits({ ...fine, text: 'to win' }, past, 3), { ok: false, why: 'empty' });
  assert.deepEqual(admits({ ...fine, hardness: 4 }, past, 3), { ok: true }, 'one rung above is exactly the point');
});

test('pickProject goes back to the one she has put the most into', () => {
  const projects = [
    project({ id: 'a', nights: 0 }),
    project({ id: 'b', nights: 3 }),
    project({ id: 'c', nights: 1 }),
    project({ id: 'd', status: 'shelved', nights: 9 }),
  ];
  assert.equal(pickProject(projects, 'Bebop', () => 0.1)!.id, 'b', 'the busiest, and never the shelved one');
  assert.equal(pickProject(projects, 'Bebop', () => RETENTION + 0.01)!.id, 'a', 'and sometimes one of the others');
  assert.equal(pickProject(projects, 'Lain', () => 0.1), null);
  assert.equal(pickProject([], undefined, () => 0.1), null);
});

test('the verdict is read from the end, past whatever the model thought out loud', () => {
  assert.equal(readAttemptVerdict('<think>NO is tempting but…</think> DID'), 'did'.toUpperCase());
  assert.equal(readAttemptVerdict('PART'), 'PART');
  assert.equal(readAttemptVerdict('it is a NO'), 'NO');
  assert.equal(readAttemptVerdict('I cannot say'), null);
  assert.equal(readAttemptVerdict(''), null);
});

test('what came of the night comes from the reading, and only falls back to the coin when nothing answered', () => {
  assert.equal(settleFromRead('DID', 'nothing'), 'did');
  assert.equal(settleFromRead('PART', 'nothing'), 'part');
  assert.equal(settleFromRead('NO', 'nothing'), 'no');
  assert.equal(settleFromRead(null, 'nothing'), 'nothing', 'the judge would not say');
});

test('a step that lands finishes it; three that go nowhere shelve it', () => {
  let p = asProject(project({ nights: 1, status: 'working' }));
  p = advanceProject(p, attempt({ outcome: 'no', note: 'the page was about his career' }), iso(now));
  assert.equal(p.status, 'working');
  assert.equal(p.stuck, 1);
  assert.equal(p.nights, 2);
  p = advanceProject(p, attempt({ outcome: 'part' }), iso(now));
  assert.equal(p.stuck, 0, 'getting part of the way is not being stuck');
  p = advanceProject(p, attempt({ outcome: 'nothing' }), iso(now));
  assert.equal(p.stuck, 0, 'being distracted is not the thing beating her');
  const before = advanceProject(advanceProject(p, attempt(), iso(now)), attempt(), iso(now));
  assert.equal(before.status, 'working');
  const after = advanceProject(before, attempt({ note: 'it would not move' }), iso(now));
  assert.equal(after.status, 'shelved');
  assert.equal(after.stuck, STUCK_SHELVES);
  assert.equal(after.shelved!.because, 'it would not move');
  assert.ok(nowItStings(before, after), 'and this is the one that costs her something');
  assert.equal(nowItStings(after, after), false, 'once, not every night after');
  const one = advanceProject(asProject(project({ nights: 2, status: 'working', step: 'the chords' })), attempt({ outcome: 'did', note: 'the chords were right there' }), iso(now));
  assert.equal(one.status, 'working', 'a step landing is not the want landing');
  assert.equal(one.landed, 1);
  assert.equal(one.step, undefined, 'and the next one is named from scratch');
  assert.equal(one.note, 'the chords were right there');
});

test('a want takes several steps, which is what makes it worth finishing', () => {
  let p = asProject(project({ status: 'working' }));
  for (let index = 0; index < STEPS_TO_FINISH - 1; index += 1) {
    p = advanceProject({ ...p, step: `step ${index}` }, attempt({ outcome: 'did' }), iso(now));
    assert.equal(p.status, 'working', `still going after ${index + 1}`);
  }
  p = advanceProject({ ...p, step: 'the last of it' }, attempt({ outcome: 'did', note: 'and that was that' }), iso(now));
  assert.equal(p.status, 'done');
  assert.equal(p.landed, STEPS_TO_FINISH);
  assert.equal(p.nights, STEPS_TO_FINISH, 'three nights at the very best, and never fewer');
});

test('attempts are capped so the store does not grow a history', () => {
  let p = asProject(project({ status: 'working' }));
  for (let index = 0; index < ATTEMPTS_KEPT + 6; index += 1) p = advanceProject({ ...p, status: 'working', stuck: 0 }, attempt({ outcome: 'part', step: `step ${index}` }), iso(now));
  assert.equal(p.attempts!.length, ATTEMPTS_KEPT);
  assert.equal(p.attempts!.at(-1)!.step, `step ${ATTEMPTS_KEPT + 5}`);
});

test('a project that lands seeds a harder one, and one that beats her twice seeds an easier way in', () => {
  const parent = asProject(project({ hardness: 2, note: 'the chords were right there' }));
  const child = childOf(parent, 'to play it through once without stopping', iso(now));
  assert.equal(child.hardness, 3);
  assert.equal(child.bornOf, 'child');
  assert.equal(child.parentId, parent.id);
  assert.equal(child.interest, 'Bebop');
  assert.equal(child.status, 'declared');
  assert.equal(childOf({ ...parent, hardness: HARDNESS.max }, 'to do the impossible thing', iso(now)).hardness, HARDNESS.max, 'the top is the top');
  const sibling = siblingOf(parent, 'to work out one bar of it', iso(now));
  assert.equal(sibling.hardness, 1);
  assert.equal(sibling.bornOf, 'sibling');
  assert.equal(siblingOf({ ...parent, hardness: HARDNESS.min }, 'to do a smaller thing', iso(now)).hardness, HARDNESS.min);
  const shelvedTwice = [project({ id: 's1', status: 'shelved', hardness: 2 }), project({ id: 's2', status: 'shelved', hardness: 2 })];
  assert.ok(beatenTwiceAt(shelvedTwice, parent));
  assert.equal(beatenTwiceAt([shelvedTwice[0]], parent), false, 'once is a bad fortnight');
});

test('she is only at so many things at once, and a wish is not a thing she is at', () => {
  const at = Array.from({ length: ACTIVE_MAX }, (_unused, index) => project({ id: `p${index}`, status: 'working', nights: 1 }));
  assert.equal(roomForNew(at), false);
  assert.ok(roomForNew(at.slice(1)));
  assert.ok(roomForNew([...at.slice(1), project({ id: 'done', status: 'done', nights: 4 })]), 'a finished one is not in her way');
  // The ten declared-and-never-touched wants in the live store would otherwise
  // have locked the ladder shut for good.
  const wishes = Array.from({ length: 10 }, (_unused, index) => project({ id: `w${index}`, status: 'declared', nights: 0 }));
  assert.ok(roomForNew([...at.slice(2), ...wishes]), 'a want her tastes declared and she never went near is a wish');
  const spawned = Array.from({ length: ACTIVE_MAX }, (_unused, index) => project({ id: `s${index}`, status: 'declared', nights: 0, bornOf: 'child' }));
  assert.equal(roomForNew(spawned), false, 'but one she thought of herself counts from the moment it exists');
});

test('she goes back to the one that beat her once she has grown past it', () => {
  const shelvedAt = iso(now - 30 * DAY);
  const projects = [
    project({ id: 'gone', status: 'shelved', hardness: 2, nights: 4, shelved: { at: shelvedAt, because: 'it would not move' } }),
    project({ id: 'won1', status: 'done', hardness: 2, nights: 4 }),
    project({ id: 'won2', status: 'done', hardness: 2, nights: 4 }),
  ];
  const back = dueForRevisit(projects, now);
  assert.equal(back!.id, 'gone');
  assert.equal(dueForRevisit(projects, Date.parse(shelvedAt) + 3 * DAY), null, 'not while it is still sore');
  assert.equal(dueForRevisit([projects[0]], now), null, 'and not until she has actually got better');
  const again = revisit(back!, iso(now));
  assert.equal(again.status, 'working');
  assert.equal(again.bornOf, 'revisit');
  assert.equal(again.stuck, 0);
  assert.equal(again.shelved, undefined);
  assert.equal(again.nights, 4, 'the nights she already put in are still hers');
});

test('a spawned project nobody went near is a note, not a project', () => {
  const projects = [
    project({ id: 'spawn', bornOf: 'child', since: '2026-08-01', nights: 0, status: 'declared' }),
    project({ id: 'fresh', bornOf: 'child', since: '2026-09-28', nights: 0, status: 'declared' }),
    project({ id: 'taste', bornOf: 'taste', since: '2026-08-01', nights: 0, status: 'declared' }),
    project({ id: 'worked', bornOf: 'child', since: '2026-08-01', nights: 2, status: 'working' }),
  ];
  assert.deepEqual(staleSpawns(projects, now).map(one => one.id), ['spawn']);
});

test('the block line is tight, busiest first, and says what she gave up on', () => {
  const long = 'x'.repeat(400);
  const projects = [
    ...[3, 9, 1, 7, 5].map((nights, index) => project({ id: `w${index}`, interest: `I${index}`, text: `to do thing ${index}`, nights, status: 'working', hardness: 2, note: long, step: long, attempts: [attempt({ outcome: 'part' })] })),
    project({ id: 'gone', text: 'to get out of Elysium', status: 'shelved', nights: 6, shelved: { at: iso(now - 2 * DAY), because: 'the game just loops' } }),
    project({ id: 'back', text: 'to read it in Japanese', status: 'working', nights: 1, bornOf: 'revisit' }),
  ];
  const note = projectsNote(projects, now);
  const lines = note.split('\n').slice(1);
  assert.equal(lines.filter(line => /night \d/.test(line)).length, PROJECTS_SHOWN, 'four of the things she is at');
  assert.match(lines[0], /You gave up on/, 'the newest thing that happened to her leads');
  assert.match(lines[1], /I1:/, 'then nine nights in, ahead of the rest');
  assert.match(note, /You gave up on get out of Elysium after 6 nights: the game just loops\. It is still sore\./);
  assert.match(note, /You went back to read it in Japanese/);
  assert.ok(note.length <= PROJECTS_CHARS, `it has to fit the block (was ${note.length})`);
  assert.equal(projectsNote(projects, now), note, 'and the same input gives the same line');
  assert.ok(note.includes('…'), 'and says where it was clipped');
  assert.equal(projectsNote([project({ nights: 0 })], now), '', 'nothing worked on, nothing said');
  assert.equal(projectsNote([{ ...project({ id: 'gone', status: 'shelved', nights: 2, shelved: { at: iso(now - 30 * DAY), because: 'old' } }) }], now), '', 'a sore that has healed is not news');
});

test('what she is asked for is a step she can take alone, and the search is the step', () => {
  const p = project({ nights: 2, status: 'working', step: 'work out which chords the verse uses' });
  assert.equal(projectQuery(p), 'how to work out which chords the verse uses');
  assert.equal(projectQuery(project()), 'how to learn piano', 'no step yet, so the want itself');
  const step = stepInstruction(p, [attempt({ step: 'find the sheet music', outcome: 'no' })]);
  assert.match(step, /find the sheet music — got nowhere/);
  assert.match(step, /on your own/);
  assert.match(step, /not waiting for anyone/);
  const instruction = projectInstruction(p, 'no', 'the reading');
  assert.match(instruction, /3rd night/);
  assert.match(instruction, /which chords the verse uses/);
  assert.match(instruction, /still beating you/);
  assert.match(projectInstruction(p, 'did', 'the reading'), /could go and do the thing now/);
  assert.match(spawnInstruction({ ...p, note: 'the chords were right there' }, 'child'), /harder version/);
  assert.match(spawnInstruction(p, 'sibling'), /beaten you twice/);
  assert.match(judgeAttemptPrompt(), /DID or PART or NO/);
  assert.match(judgeAttemptInput(p, 'what she read'), /Tonight's step: work out which chords the verse uses/);
});

test('the sixteen wants she already has survive the whole of this', () => {
  const live = JSON.parse(JSON.stringify(REAL_WANTS)) as Project[];
  const read = readProjects(live);
  assert.equal(read.length, 16, 'every one of them still reads');
  assert.equal(read.reduce((sum, one) => sum + one.nights, 0), 6);
  assert.deepEqual(read.filter(one => one.note).map(one => one.note), REAL_WANTS.filter(one => one.note).map(one => one.note), 'her notes, byte for byte');
  assert.equal(read.filter(isActive).length, 16);
  const worked = read.filter(one => one.status === 'working');
  const note = projectsNote(worked.map(one => ({ ...asProject(one), nights: one.nights })), now);
  assert.ok(note.length < 900, `and the block line fits (was ${note.length})`);
  const picked = pickProject(read, 'Cyberpunk: Edgerunners', () => 0.1);
  assert.ok(picked, 'and she can still be given one to work on');
});

// The five she had actually worked on at 2026-09-20, plus enough of the eleven
// she had only declared to make the count real. Trimmed of nothing that matters.
const REAL_WANTS: Project[] = [
  { id: 'r4jbcwq9', interest: 'Chainsaw Man', text: 'To argue the ending with him — whether Denji actually learned anything from it or just got stronger and forgot again.', since: '2026-08-30', nights: 2, status: 'working', note: 'I spent two nights researching the ending but got distracted; I now think Denji is still just a dog who learned nothing, so the whole arc felt like a waste of time.' },
  { id: 'qhieoj5l', interest: 'Serial Experiments Lain', text: "to find someone else who's seen it so I can argue about whether Lain actually existed", since: '2026-09-03', nights: 0, status: 'declared' },
  { id: 'm9vgxaxq', interest: 'Hades', text: "to get out of Elysium for once — I'm stuck", since: '2026-09-03', nights: 1, status: 'working', note: 'I spent tonight staring at the Docks and that stupid bag on the stairs; I keep trying to choose the right words but the game just loops, and I am still stuck.' },
  { id: 'l9sxyjmh', interest: 'Cowboy Bebop', text: 'to learn piano just to play The Real Folk Blues badly', since: '2026-09-03', nights: 2, status: 'working', note: 'I finally stopped trying to play The Real Folk Blues well and just started stomping the wrong chords with my left hand while humming.' },
  { id: '1l6byd6y', interest: 'Ghost in the Shell: SAC_2045', text: 'season 2 to stop treating AI like a cartoon villain and get back to dissecting power, consent, and what "ghost" even means when the machine does the remembering', since: '2026-08-31', nights: 1, status: 'working', note: 'I read through that page, but it did not give me the specifics.' },
  ...Array.from({ length: 11 }, (_unused, index) => ({ id: `d${index}`, interest: index % 2 ? 'Cyberpunk: Edgerunners' : 'Control: Ultimate Edition', text: `to see thing number ${index} through to the end of it`, since: '2026-09-1' + (index % 9), nights: 0, status: 'declared' as const })),
];
