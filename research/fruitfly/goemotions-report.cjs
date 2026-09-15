const fs = require('node:fs');
const path = require('node:path');
const { parseEmotion } = require('../../dist-test/electron/emotion.js');
const manifest = require('./goemotions-manifest.json');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const rows = records.filter(row => row.kind === 'result');
if (rows.length !== manifest.calls) throw Error(`Incomplete run: ${rows.length}/${manifest.calls}`);
const key = row => [row.id, row.mood, row.seed, row.variant].join(':');
const indexed = new Map(rows.map(row => [key(row), row]));
if (indexed.size !== rows.length) throw Error('Duplicate calls');
const matches = row => parseEmotion(row.parsed)?.emotion === row.expected;
const count = group => ({ calls: group.length, matches: group.filter(matches).length,
  agreement: group.filter(matches).length / group.length,
  unparseable: group.filter(row => !parseEmotion(row.parsed)).length });
const summary = {};
for (const variant of ['baseline', 'complete']) {
  const group = rows.filter(row => row.variant === variant);
  summary[variant] = { ...count(group),
    byMood: Object.fromEntries(['calm', 'irritated'].map(mood => [mood, count(group.filter(row => row.mood === mood))])),
    byLabel: Object.fromEntries(Object.values(manifest.mapping).map(label => [label, count(group.filter(row => row.expected === label))])),
  };
}
const changes = [], lineDeltas = [];
for (const item of manifest.cases) {
  const deltas = [];
  for (const mood of ['calm', 'irritated']) for (const seed of [17, 43]) {
    const baseline = indexed.get(key({ id: item.id, mood, seed, variant: 'baseline' }));
    const complete = indexed.get(key({ id: item.id, mood, seed, variant: 'complete' }));
    if (!baseline || !complete || baseline.expected !== item.expected || complete.expected !== item.expected) throw Error('Unexpected case set');
    const delta = Number(matches(complete)) - Number(matches(baseline));
    deltas.push(delta);
    if (delta) changes.push({ id: item.id, expected: item.expected, mood, seed, delta,
      before: baseline.parsed?.emotion ?? null, after: complete.parsed?.emotion ?? null });
  }
  lineDeltas.push({ id: item.id, meanDifference: deltas.reduce((a, b) => a + b, 0) / deltas.length });
}
const result = { metadata: records.find(row => row.kind === 'metadata'), distinctLines: manifest.cases.length,
  calls: rows.length, summary, becameCorrect: changes.filter(row => row.delta > 0).length,
  becameIncorrect: changes.filter(row => row.delta < 0).length, changes, lineDeltas,
  limitations: manifest.limitations };
fs.writeFileSync(path.join(__dirname, 'goemotions-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ summary, becameCorrect: result.becameCorrect, becameIncorrect: result.becameIncorrect }, null, 2));
