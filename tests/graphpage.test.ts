// What the graph believes, on a page he can correct.

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExtraction, emptyGraph, isCurrent, type FactGraph } from '../electron/factgraph';
import { applyGraphPage, pageReportLine, readGraphPage, renderGraphPage } from '../electron/graphpage';

const NOW = new Date('2026-09-17T01:00:00Z');
const DAY = '2026-09-17';

function graph(): FactGraph {
  return {
    ...emptyGraph(),
    nextId: 20,
    entities: [
      { id: 'e0', name: 'Tommy', kind: 'person', aliases: [], firstSeen: '2026-08-04', lastSeen: DAY },
      { id: 'e3', name: 'Emma Wilson', kind: 'person', aliases: ['Emma'], firstSeen: '2026-08-04', lastSeen: DAY },
      { id: 'e38', name: 'Umart', kind: 'place', aliases: ['U-Mart'], firstSeen: '2026-08-17', lastSeen: '2026-08-17' },
      { id: 'e71', name: 'Happytel Rockingham', kind: 'organisation', aliases: [], firstSeen: '2026-08-30', lastSeen: '2026-08-30' },
    ],
    facts: [
      { id: 'f4', subject: 'e0', relation: 'partner of', object: 'e3', sentence: 'Tommy has a partner named Emma Wilson.', learned: '2026-08-04', confirmed: '2026-09-01', days: 5 },
      { id: 'f31', subject: 'e0', relation: 'works at', object: 'e38', sentence: 'Tommy works at Umart.', learned: '2026-08-17', confirmed: '2026-08-17', days: 1 },
      { id: 'f32', subject: 'e38', relation: 'located in', value: 'Belmont', sentence: 'Umart is located in Belmont.', learned: '2026-08-17', confirmed: '2026-09-01', days: 2 },
      { id: 'f74', subject: 'e0', relation: 'works at', object: 'e71', sentence: 'Tommy works at Happytel Rockingham every Sunday from 12-4:30.', learned: '2026-08-30', confirmed: '2026-08-30', days: 1 },
      { id: 'f9', subject: 'e0', relation: 'lives in', value: 'Joondalup', sentence: 'Tommy lives in Joondalup.', learned: '2026-08-05', confirmed: '2026-08-05', days: 1, until: '2026-08-20' },
    ],
  };
}

function written(): FactGraph {
  const g = graph();
  return { ...g, page: renderGraphPage(g, NOW).written };
}

test('the page: his heading first, one line per current fact with a hidden id, history struck at the end', () => {
  const { text, written: shown } = renderGraphPage(graph(), NOW);
  assert.match(text, /^---\ntags: \[haru\/graph\]/);
  assert.match(text, /\*\*Wrong\?\*\* Delete the line/);
  assert.ok(text.indexOf('## Tommy %%e0%%') < text.indexOf('## Umart %%e38%%'));
  assert.match(text, /## Tommy %%e0%%\n- Tommy has a partner named Emma Wilson\. %%f4%%\n- Tommy works at Umart\. %%f31%%\n- Tommy works at Happytel/);
  assert.match(text, /## Umart %%e38%%\n\*Also: U-Mart\*\n- Umart is located in Belmont\. %%f32%%/);
  assert.match(text, /## No longer true\n- ~~Tommy lives in Joondalup\.~~ \(until 2026-08-20\) %%f9%%\n$/);
  assert.equal(text.includes('## Emma Wilson'), false, 'nothing of her own to say, no heading');
  assert.deepEqual(shown.facts.f9, { sentence: 'Tommy lives in Joondalup.', struck: true });
  const back = readGraphPage(text);
  assert.equal(back.facts.size, 5);
  assert.deepEqual(back.facts.get('f9'), { text: 'Tommy lives in Joondalup.', struck: true });
  assert.equal(back.headings.get('e38'), 'Umart');
  assert.deepEqual(back.added, []);
  const unchanged = applyGraphPage(written(), back, DAY, NOW);
  assert.equal(pageReportLine(unchanged.report), '', 'reading its own page back changes nothing');
});

test('his edits: a deleted line is forgotten and rejected, struck is history, unstruck is true again, reworded and added lines are his', () => {
  const edited = renderGraphPage(graph(), NOW).text
    .replace('- Tommy works at Umart. %%f31%%\n', '')
    .replace('- Tommy works at Happytel Rockingham every Sunday from 12-4:30. %%f74%%', '- ~~Tommy works at Happytel Rockingham every Sunday from 12-4:30.~~ %%f74%%')
    .replace('- ~~Tommy lives in Joondalup.~~ (until 2026-08-20) %%f9%%', '- Tommy lives in Joondalup. %%f9%%')
    .replace('- Umart is located in Belmont. %%f32%%', '- Umart is the computer store in Belmont where he buys parts. %%f32%%')
    .replace('## Umart %%e38%%', '## Umart Belmont %%e38%%')
    .replace('## Tommy %%e0%%\n', '## Tommy %%e0%%\n- Tommy is studying at Murdoch University.\n')
    + '\n## Miso\n- Miso is his cat.\n';
  const { graph: after, report } = applyGraphPage(written(), readGraphPage(edited), DAY, NOW);
  assert.equal(after.facts.some(fact => fact.id === 'f31'), false);
  assert.equal(after.rejected?.length, 1);
  assert.equal(isCurrent(after.facts.find(fact => fact.id === 'f74')!), false);
  assert.equal(after.facts.find(fact => fact.id === 'f74')!.until, DAY);
  assert.equal(isCurrent(after.facts.find(fact => fact.id === 'f9')!), true);
  assert.equal(after.facts.find(fact => fact.id === 'f32')!.sentence, 'Umart is the computer store in Belmont where he buys parts.');
  const umart = after.entities.find(entity => entity.id === 'e38')!;
  assert.equal(umart.name, 'Umart Belmont');
  assert.deepEqual(umart.aliases.sort(), ['U-Mart', 'Umart'].sort());
  assert.ok(after.facts.some(fact => fact.subject === 'e0' && fact.sentence === 'Tommy is studying at Murdoch University.'));
  const miso = after.entities.find(entity => entity.name === 'Miso')!;
  assert.ok(after.facts.some(fact => fact.subject === miso.id && fact.sentence === 'Miso is his cat.'));
  assert.match(pageReportLine(report), /^forgot 1 \("Tommy works at Umart\."\), 1 no longer true, 1 true again, 1 reworded, 2 added, 1 renamed$/);
});

test('what he deleted is not learned again, but other facts about the same place still are', () => {
  const { graph: corrected } = applyGraphPage(written(), readGraphPage(renderGraphPage(graph(), NOW).text.replace('- Tommy works at Umart. %%f31%%\n', '')), DAY, NOW);
  const chunk = 'Tommy: back at Umart again, work was slow\nTommy: bought a new case at Umart';
  const { graph: next, report } = applyExtraction(corrected, {
    entities: [{ name: 'Umart', kind: 'place', aliases: [] }],
    facts: [
      { subject: 'Tommy', relation: 'employed at', object: 'Umart', sentence: 'Tommy works at Umart.' },
      { subject: 'Tommy', relation: 'buys parts from', object: 'Umart', sentence: 'Tommy buys PC parts from Umart.' },
    ],
    ended: [],
  }, { day: '2026-09-18', chunk, userName: 'Tommy' });
  assert.ok(report.rejected.some(line => line.includes('he said it is wrong')));
  assert.equal(next.facts.some(fact => fact.sentence === 'Tommy works at Umart.'), false);
  assert.ok(next.facts.some(fact => fact.sentence === 'Tommy buys PC parts from Umart.'));
  assert.equal(next.rejected?.length, 1, 'the rejection survives a read of the day');
  assert.ok(next.page, 'and so does what the page showed');
});

test('a page that lost most of its lines at once, or was never written, changes nothing', () => {
  const many = graph();
  for (let i = 0; i < 20; i++) many.facts.push({ id: `f${100 + i}`, subject: 'e0', relation: 'likes', value: `thing ${i}`, sentence: `Tommy likes thing number ${i}.`, learned: DAY, confirmed: DAY, days: 1 });
  const shown = { ...many, page: renderGraphPage(many, NOW).written };
  const text = renderGraphPage(many, NOW).text;
  const truncated = text.slice(0, text.indexOf('%%f31%%'));
  const { graph: after, report } = applyGraphPage(shown, readGraphPage(truncated), DAY, NOW);
  assert.equal(after, shown);
  assert.match(report.distrusted ?? '', /lines gone at once/);
  const blank = applyGraphPage(written(), readGraphPage('# Who is who\n\n(nothing here)\n'), DAY, NOW);
  assert.equal(blank.graph.facts.length, graph().facts.length, 'a blank page is not a page of deletions');
  const never = applyGraphPage(graph(), readGraphPage(''), DAY, NOW);
  assert.equal(never.graph.facts.length, graph().facts.length);
});
