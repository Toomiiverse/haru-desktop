// Who is who in his life: the graph beside the memories.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyExtraction, asksAboutChange, dayChunks, emptyGraph, extractionPrompt, findEntity, isCurrent, isPassing, knownBlock,
  linkedFacts, linkedNote, matchTerms, mentionedEntities, nameKey, normalizeGraph, pruneGraph, readExtraction,
  USER_ENTITY, type Extraction, type FactGraph,
} from '../electron/factgraph';

const USER = 'Tommy';
const chunkAug30 = [
  'Tommy: Alright I finished work at Happytel Rockingham, heading to mum’s now',
  'Haru: Fine. Drive safe.',
  'Tommy: What if I made Ryan, who is the team lead of finance at The PC Project, allocate the points',
  'Tommy: I\'m going there with my mum and my stepdad Johnny',
].join('\n');

function read(graph: FactGraph, extraction: Extraction, day = '2026-08-30', chunk = chunkAug30) {
  return applyExtraction(graph, extraction, { day, chunk, userName: USER });
}

const aug30: Extraction = {
  entities: [
    { name: 'Happytel Rockingham', kind: 'organisation', aliases: ['Happytel'] },
    { name: 'Ryan', kind: 'person', aliases: [] },
    { name: 'The PC Project', kind: 'organisation', aliases: ['PC Project'] },
    { name: "Tommy's mum", kind: 'person', aliases: ['mum'] },
    { name: 'Johnny', kind: 'person', aliases: ['stepdad Johnny'] },
  ],
  facts: [
    { subject: 'Tommy', relation: 'works at', object: 'Happytel Rockingham', sentence: 'Tommy works at Happytel Rockingham.', since: '2026-08-30' },
    { subject: 'Ryan', relation: 'team lead at', object: 'The PC Project', sentence: 'Ryan is the finance team lead at The PC Project.' },
    { subject: 'Johnny', relation: 'stepfather of', object: 'Tommy', sentence: "Johnny is Tommy's stepfather." },
  ],
  ended: [],
};

test('a day becomes names and facts, the user is e0, and the chat date is not taken for a start date', () => {
  const { graph, report } = read(emptyGraph(), aug30);
  assert.equal(report.added, 3);
  assert.equal(graph.entities.find(entity => entity.id === USER_ENTITY)?.name, 'Tommy');
  const job = graph.facts.find(fact => fact.relation === 'works at')!;
  assert.equal(job.subject, USER_ENTITY);
  assert.equal(job.since, undefined, 'the measured slip: the day of the chat stamped on as since');
  assert.equal(job.learned, '2026-08-30');
  // An entity no fact uses is not kept — the mum was named and nothing said about her.
  assert.equal(graph.entities.some(entity => entity.name === "Tommy's mum"), false);
});

test('a name the text never says is refused, and so is anything about Haru or addressed to her', () => {
  const { graph, report } = read(emptyGraph(), {
    entities: [{ name: 'Eiffel Tower', kind: 'thing', aliases: [] }, { name: 'Haru', kind: 'person', aliases: [] }, { name: 'Ryan', kind: 'person', aliases: [] }],
    facts: [
      { subject: 'Eiffel Tower', relation: 'located in', value: 'Paris', sentence: 'The Eiffel Tower is in Paris.' },
      { subject: 'Haru', relation: 'companion of', object: 'Tommy', sentence: 'Haru is Tommy’s companion.' },
      { subject: 'Ryan', relation: 'friend of', object: 'Tommy', sentence: 'Ryan is your friend.' },
      { subject: 'Tommy', relation: 'owns', value: 'a yacht in Monaco', sentence: 'Tommy owns a yacht in Monaco.' },
    ],
    ended: [],
  });
  assert.equal(report.added, 0);
  assert.equal(graph.facts.length, 0);
  assert.ok(report.rejected.some(line => line.includes('Eiffel Tower')));
  assert.ok(report.rejected.some(line => line.includes('value not in his words')), 'a value nobody said is the model talking');
});

test('something new has to be in his words — her recital of the machine is not a fact about his life', () => {
  const chunk = 'Tommy: what are you running on\nHaru: An RTX 3060 with 12 GB, 298 GB free on the disk.\nTommy: cool cool thanks for telling me that';
  const { graph, report } = read(emptyGraph(), {
    entities: [{ name: 'RTX 3060', kind: 'device', aliases: [] }],
    facts: [
      { subject: 'Tommy', relation: 'owns', object: 'RTX 3060', sentence: 'Tommy owns an RTX 3060 with 12 GB.' },
      { subject: 'Tommy', relation: 'has storage', value: '298 GB free', sentence: 'Tommy has a server with 298 GB of storage.' },
    ],
    ended: [],
  }, '2026-08-30', chunk);
  assert.equal(graph.facts.length, 0);
  assert.ok(report.rejected.includes('entity "RTX 3060"'));
});

test('a day is not a life, and trivia is not his', () => {
  for (const passing of ["Tommy dropped off a customer's PC in Ellenbrook.", 'Tommy uses an Intel Ultra 7 K in a customer build.', 'Tommy messaged Connor today.', 'Tommy plans to go hiking this weekend.', 'Tommy picked up the motherboard from Umart.', "Tommy attends Ammie's birthday party at 8pm.", 'Tommy has an appointment with Sam next Friday.']) {
    assert.equal(isPassing(passing), true, passing);
  }
  for (const lasting of ['Tommy works at Happytel Rockingham every Sunday.', "Scarlett's birthday is 28 August.", 'Tommy wants a Nintendo Switch 2.', 'Tommy is a student at Murdoch University.']) {
    assert.equal(isPassing(lasting), false, lasting);
  }
  const chunk = 'Tommy: how far is Jandakot from Rockingham anyway\nTommy: I work at Happytel Rockingham on Sundays';
  const { graph, report } = read(emptyGraph(), {
    entities: [{ name: 'Jandakot', kind: 'place', aliases: [] }, { name: 'Rockingham', kind: 'place', aliases: [] }, { name: 'Happytel Rockingham', kind: 'organisation', aliases: [] }],
    facts: [
      { subject: 'Jandakot', relation: 'distance to', object: 'Rockingham', sentence: 'Jandakot is 34 km from Rockingham.' },
      { subject: 'Happytel Rockingham', relation: 'located in', object: 'Rockingham', sentence: 'Happytel Rockingham is in Rockingham.' },
      { subject: 'Tommy', relation: 'works at', object: 'Happytel Rockingham', sentence: 'Tommy works at Happytel Rockingham on Sundays.' },
    ],
    ended: [],
  }, '2026-08-30', chunk);
  assert.deepEqual(graph.facts.map(fact => fact.sentence).sort(), ['Happytel Rockingham is in Rockingham.', 'Tommy works at Happytel Rockingham on Sundays.']);
  assert.ok(report.rejected.some(line => line.includes('(not his)')));
});

test('the same fact told again on another day is confirmed, not added — even told the other way round', () => {
  const first = read(emptyGraph(), aug30).graph;
  const chunk = "Tommy: Ryan from The PC Project, the finance team lead, sorted it\nTommy: and Johnny my stepdad came too";
  const { graph, report } = read(first, {
    entities: [{ name: 'Ryan', kind: 'person', aliases: [] }, { name: 'PC Project', kind: 'organisation', aliases: [] }, { name: 'Johnny', kind: 'person', aliases: [] }],
    facts: [
      { subject: 'Ryan', relation: 'is team lead at', object: 'PC Project', sentence: 'Ryan is the finance team lead at The PC Project.' },
      { subject: 'Tommy', relation: 'stepson of', object: 'Johnny', sentence: "Johnny is Tommy's stepdad." },
    ],
    ended: [],
  }, '2026-09-02', chunk);
  assert.equal(report.added, 0);
  assert.equal(report.confirmed, 2);
  const lead = graph.facts.find(fact => fact.relation === 'team lead at')!;
  assert.equal(lead.days, 2);
  assert.equal(lead.confirmed, '2026-09-02');
  assert.equal(graph.entities.filter(entity => nameKey(entity.name, USER) === 'pc project').length, 1, 'PC Project is The PC Project');
});

test('a first name finds the full name, and a fuller name takes over from a first name', () => {
  const graph = emptyGraph();
  graph.entities.push({ id: 'e1', name: 'Emma', kind: 'person', aliases: [], firstSeen: '2026-08-01', lastSeen: '2026-08-01' });
  graph.facts.push({ id: 'f2', subject: 'e1', relation: 'girlfriend of', object: USER_ENTITY, sentence: "Emma is Tommy's girlfriend.", learned: '2026-08-01', confirmed: '2026-08-01', days: 1 });
  graph.nextId = 3;
  const { graph: after } = read(graph, {
    entities: [{ name: 'Emma Wilson', kind: 'person', aliases: ['Emma'] }],
    facts: [{ subject: 'Emma Wilson', relation: 'born on', value: '28 January 2006', sentence: 'Emma Wilson was born on 28 January 2006.' }],
    ended: [],
  }, '2026-08-05', 'Tommy: Emma Wilson, born 28 January 2006, is my girlfriend');
  const emma = after.entities.find(entity => entity.id === 'e1')!;
  assert.equal(emma.name, 'Emma Wilson');
  assert.deepEqual(emma.aliases, ['Emma']);
  assert.equal(after.facts.filter(fact => fact.subject === 'e1').length, 2);
  assert.equal(findEntity(after, 'emma', USER)?.id, 'e1');
  assert.equal(findEntity(after, "Tommy's girlfriend", USER), undefined, 'a description is not a name');
});

test('an ended fact is dated, not deleted, and the fact that replaces it points back', () => {
  const first = read(emptyGraph(), aug30).graph;
  const job = first.facts.find(fact => fact.relation === 'works at')!;
  const chunk = 'Tommy: I quit Happytel Rockingham on 2026-09-10, I work full time at The PC Project now';
  const { graph, report } = read(first, {
    entities: [{ name: 'The PC Project', kind: 'organisation', aliases: [] }],
    facts: [{ subject: 'Tommy', relation: 'works at', object: 'The PC Project', sentence: 'Tommy works full time at The PC Project.' }],
    ended: [{ id: job.id, until: '2026-09-10' }, { id: 'f999' }],
  }, '2026-09-12', chunk);
  assert.equal(report.ended, 1);
  const old = graph.facts.find(fact => fact.id === job.id)!;
  assert.equal(isCurrent(old), false);
  assert.equal(old.until, '2026-09-10');
  const now = graph.facts.find(fact => fact.sentence.includes('full time'))!;
  assert.equal(old.supersededBy, now.id);
});

test('a fact can only be ended by a part of the day that names it', () => {
  const first = read(emptyGraph(), aug30).graph;
  const ryan = first.facts.find(fact => fact.relation === 'team lead at')!;
  const { graph, report } = read(first, { entities: [], facts: [], ended: [{ id: ryan.id }] }, '2026-09-12', 'Tommy: long day, nothing new');
  assert.equal(report.ended, 0);
  assert.equal(isCurrent(graph.facts.find(fact => fact.id === ryan.id)!), true);
});

test('a second birthday for the same person corrects the first', () => {
  const chunk = "Tommy: Scarlett's birthday is 25 August";
  const one = read(emptyGraph(), {
    entities: [{ name: 'Scarlett', kind: 'person', aliases: [] }],
    facts: [{ subject: 'Scarlett', relation: 'birthday', value: '28 August', sentence: "Scarlett's birthday is 28 August." }],
    ended: [],
  }, '2026-08-27', "Tommy: Scarlett's birthday is 28 August").graph;
  const { graph } = read(one, {
    entities: [{ name: 'Scarlett', kind: 'person', aliases: [] }],
    facts: [{ subject: 'Scarlett', relation: 'birthday', value: '25 August', sentence: "Scarlett's birthday is 25 August." }],
    ended: [],
  }, '2026-08-29', chunk);
  const current = graph.facts.filter(fact => fact.relation === 'birthday' && isCurrent(fact));
  assert.equal(current.length, 1);
  assert.match(current[0].sentence, /25 August/);
});

test('a lowercase alias is a common noun and never names anyone — family words excepted', () => {
  assert.deepEqual(matchTerms({ id: 'e5', name: 'The PC Project', kind: 'organisation', aliases: ['the shop', 'work', 'PC Project'], firstSeen: '', lastSeen: '' }, USER), ['pc project']);
  assert.deepEqual(matchTerms({ id: 'e6', name: "Tommy's mum", kind: 'person', aliases: ['mum'], firstSeen: '', lastSeen: '' }, USER), ['mum']);
});

function builtGraph(): FactGraph {
  let graph = read(emptyGraph(), aug30).graph;
  graph = read(graph, {
    entities: [{ name: "Tommy's mum", kind: 'person', aliases: ['mum'] }, { name: 'Johnny', kind: 'person', aliases: [] }],
    facts: [
      { subject: "Tommy's mum", relation: 'lives in', value: 'Perth', sentence: "Tommy's mum lives in Perth." },
      { subject: 'Johnny', relation: 'ex-husband of', object: "Tommy's mum", sentence: "Johnny was married to Tommy's mum and they later divorced." },
    ],
    ended: [],
  }, '2026-09-02', "Tommy: my mum lives in Perth. Johnny was married to my mum, they divorced later").graph;
  return graph;
}

test('reply time: the facts about who the message names, and one step further, never through the user', () => {
  const graph = builtGraph();
  assert.deepEqual(mentionedEntities(graph, "going to mums house, Johnny's there", USER).map(entity => entity.name).sort(), ['Johnny', "Tommy's mum"]);
  const linked = linkedFacts(graph, 'is johnny coming', { userName: USER });
  const sentences = linked.map(entry => entry.fact.sentence);
  assert.ok(sentences.includes("Johnny is Tommy's stepfather."));
  assert.ok(sentences.includes("Tommy's mum lives in Perth."), 'one step out: the mum Johnny was married to');
  assert.equal(sentences.includes('Tommy works at Happytel Rockingham.'), false, 'nothing reached through Tommy');
  assert.equal(linkedFacts(graph, 'what should I eat', { userName: USER }).length, 0, 'nobody named, nothing added');
  assert.deepEqual(mentionedEntities(graph, 'heading to happytel', USER).map(entity => entity.name), ['Happytel Rockingham'], 'he says the first word of a name that is nobody else\'s');
  assert.ok(linkedFacts(graph, 'how is she', { context: 'saw mum today', userName: USER }).length, 'the message before names her');
});

test('the note groups by who was named, marks history, and says it is background', () => {
  const graph = read(builtGraph(), {
    entities: [{ name: 'Happytel Rockingham', kind: 'organisation', aliases: [] }],
    facts: [],
    ended: [{ id: builtGraph().facts.find(fact => fact.relation === 'works at')!.id, until: '2026-09-10' }],
  }, '2026-09-12', 'Tommy: I left Happytel Rockingham').graph;
  const plain = linkedNote(graph, linkedFacts(graph, 'happytel called me', { userName: USER }));
  assert.equal(plain, '', 'history is not offered unprompted, and a name with nothing current adds no heading');
  const asked = linkedNote(graph, linkedFacts(graph, 'when did I stop working at Happytel', { userName: USER }));
  assert.match(asked, /^Who and what that message names/);
  assert.match(asked, /Happytel Rockingham:\n- Tommy works at Happytel Rockingham\. \(no longer true, since 10 Sept\)/);
  const current = linkedNote(graph, linkedFacts(graph, 'is johnny coming', { userName: USER }));
  assert.match(current, /- Johnny is Tommy's stepfather\. \(came up once, 30 Aug\)/, 'one mention, dated, so it is held lightly');
  assert.ok(linkedNote(graph, linkedFacts(graph, 'johnny and mum', { userName: USER }), 200).length <= 200);
  assert.equal(asksAboutChange('does he still work there'), false);
  assert.equal(asksAboutChange('where did I used to work'), true);
});

test('what the model is shown as known: the names, and ids for the facts about who this part names', () => {
  const graph = builtGraph();
  const block = knownBlock(graph, 'Tommy: Johnny rang', USER);
  assert.match(block, /^Johnny \(person/m);
  assert.match(block, /f\d+: Johnny is Tommy's stepfather\./);
  assert.equal(block.includes("Tommy's mum lives in Perth"), false, 'not named in this part');
  assert.match(extractionPrompt(USER), /Call him "Tommy"/);
});

test('a day is cut into pieces, and a piece where he barely speaks is not worth a call', () => {
  const messages = [
    { role: 'user', content: 'x'.repeat(500) },
    { role: 'assistant', content: 'y'.repeat(900) },
    { role: 'user', content: 'z'.repeat(500) },
    { role: 'system', content: 'ignored' },
  ];
  const chunks = dayChunks(messages, USER, 700);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].startsWith('Tommy: xxx'));
  assert.equal(dayChunks([{ role: 'user', content: 'ok' }, { role: 'assistant', content: 'Fine.' }], USER).length, 0);
});

test('what comes back is read leniently, and the file is read defensively', () => {
  const parsed = readExtraction('```json\n{"entities":[{"name":"Sudin","kind":"alien"}],"facts":[{"subject":"Sudin","relation":"co-founder of","object":"The PC Project","sentence":"Sudin co-founded The PC Project."},{"subject":"","relation":"x","sentence":"y"}],"ended":"none"}\n```');
  assert.equal(parsed?.entities[0].kind, 'thing');
  assert.equal(parsed?.facts.length, 1);
  assert.deepEqual(parsed?.ended, []);
  assert.equal(readExtraction('no json here'), null);
  const normal = normalizeGraph({ entities: [{ id: 'e3', name: 'Sudin', kind: 'person', aliases: 'nope' }], facts: [{ id: 'f9', subject: 'e3', relation: 'x', sentence: 'Sudin.', object: 'e404' }, { id: 'f4', subject: 'e3', relation: 'x', sentence: 'Sudin is.' }], read: { '2026-09-01': 12, bad: 'x' } });
  assert.equal(normal.entities[0].aliases.length, 0);
  assert.deepEqual(normal.facts.map(fact => fact.id), ['f4'], 'a fact pointing at nothing is dropped');
  assert.deepEqual(normal.read, { '2026-09-01': 12 });
  assert.equal(normal.nextId, 5);
  assert.deepEqual(normalizeGraph('garbage'), emptyGraph());
});

test('past the cap, unconfirmed history goes first and nothing is left pointing at what went', () => {
  const graph = builtGraph();
  graph.facts[0].until = '2026-09-01';
  const pruned = pruneGraph(graph, graph.facts.length - 1);
  assert.equal(pruned.facts.length, graph.facts.length - 1);
  assert.equal(pruned.facts.some(fact => fact.id === graph.facts[0].id), false);
});
