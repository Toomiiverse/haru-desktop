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
