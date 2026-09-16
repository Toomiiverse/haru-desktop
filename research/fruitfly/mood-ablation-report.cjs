const fs = require('node:fs');
const path = require('node:path');
const { parseEmotion } = require('../../dist-test/electron/emotion.js');
const manifest = require('./mood-ablation-manifest.json');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const rows = records.filter(row => row.kind === 'result');
if (rows.length !== manifest.calls) throw Error(`Incomplete run: ${rows.length}/${manifest.calls}`);
const key = row => [row.id, row.mood, row.seed, row.variant].join(':');
const indexed = new Map(rows.map(row => [key(row), row]));
if (indexed.size !== rows.length) throw Error('Duplicate calls');
const matches = row => parseEmotion(row.parsed)?.emotion === row.expected;
const count = group => ({ calls: group.length, matches: group.filter(matches).length,
  agreement: group.filter(matches).length / group.length,
  unparseable: group.filter(row => !parseEmotion(row.parsed)).length,
  predictedLabels: group.reduce((counts, row) => {
    const label = parseEmotion(row.parsed)?.emotion ?? 'invalid';
    counts[label] = (counts[label] ?? 0) + 1; return counts;
  }, {}) });
const summary = {}, comparisons = {};
for (const split of ['public_dev', 'challenge']) {
  summary[split] = {};
  for (const variant of manifest.variants) {
    const group = rows.filter(row => row.variant === variant && row.split === split);
    const byLabel = Object.fromEntries([...new Set(group.map(row => row.expected))].map(label =>
      [label, count(group.filter(row => row.expected === label))]));
    summary[split][variant] = { ...count(group), byLabel,
      macroAgreement: Object.values(byLabel).reduce((total, row) => total + row.agreement, 0) / Object.keys(byLabel).length,
      byMood: Object.fromEntries(['calm', 'irritated'].map(mood => [mood, count(group.filter(row => row.mood === mood))])),
    };
  }
  comparisons[split] = {};
  for (const variant of ['words_first', 'no_mood']) {
    const changes = [], lineDeltas = [];
    for (const item of manifest.cases.filter(row => row.split === split)) {
      const deltas = [];
      for (const mood of ['calm', 'irritated']) for (const seed of [17, 43]) {
        const baseline = indexed.get(key({ id: item.id, mood, seed, variant: 'current' }));
        const candidate = indexed.get(key({ id: item.id, mood, seed, variant }));
        if (!baseline || !candidate || baseline.expected !== item.expected || candidate.expected !== item.expected) throw Error('Unexpected case set');
        const delta = Number(matches(candidate)) - Number(matches(baseline));
        deltas.push(delta);
        if (delta) changes.push({ id: item.id, expected: item.expected, mood, seed, delta,
          before: baseline.parsed?.emotion ?? null, after: candidate.parsed?.emotion ?? null });
      }
      lineDeltas.push({ id: item.id, meanDifference: deltas.reduce((a, b) => a + b, 0) / deltas.length });
    }
    comparisons[split][variant] = { becameCorrect: changes.filter(row => row.delta > 0).length,
      becameIncorrect: changes.filter(row => row.delta < 0).length, changes, lineDeltas };
  }
}
let noMoodLabelDisagreements = 0;
for (const item of manifest.cases) for (const seed of [17, 43]) {
  const a = indexed.get(key({ id: item.id, mood: 'calm', seed, variant: 'no_mood' }));
  const b = indexed.get(key({ id: item.id, mood: 'irritated', seed, variant: 'no_mood' }));
  noMoodLabelDisagreements += Number(a.parsed?.emotion !== b.parsed?.emotion);
}
const result = { metadata: records.find(row => row.kind === 'metadata'), calls: rows.length,
  distinctPublicLines: manifest.cases.filter(row => row.split === 'public_dev').length,
  summary, comparisons, noMoodLabelDisagreements, limitations: manifest.limitations };
fs.writeFileSync(path.join(__dirname, 'mood-ablation-results.json'), JSON.stringify(result, null, 2) + '\n');
for (const [split, methods] of Object.entries(summary)) {
  console.log(split, Object.fromEntries(Object.entries(methods).map(([name, row]) => [name,
    { calls: row.calls, matches: row.matches, agreement: row.agreement, macroAgreement: row.macroAgreement,
      byMood: row.byMood }])), { noMoodLabelDisagreements });
}
