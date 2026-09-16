const fs = require('node:fs');
const { parseEmotion } = require('../../dist-test/electron/emotion.js');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const metadata = records.find(row => row.kind === 'metadata');
const rows = records.filter(row => row.kind === 'result');
const summary = {};
for (const variant of ['baseline', 'complete']) {
  summary[variant] = {};
  for (const split of ['development', 'heldout', 'challenge']) {
    const selected = rows.filter(row => row.variant === variant && row.split === split);
    const correct = row => parseEmotion(row.parsed)?.emotion === row.expected;
    summary[variant][split] = {
      calls: selected.length, distinctLines: new Set(selected.map(row => row.id)).size,
      labelMatches: selected.filter(correct).length,
      labelAgreement: selected.filter(correct).length / selected.length,
      unparseable: selected.filter(row => !parseEmotion(row.parsed)).length,
      byMood: Object.fromEntries(['calm', 'irritated'].map(mood => {
        const group = selected.filter(row => row.mood === mood);
        return [mood, { calls: group.length, labelMatches: group.filter(correct).length }];
      })),
      errors: selected.filter(row => !correct(row)).map(row => ({ id: row.id, mood: row.mood, seed: row.seed, predicted: row.parsed?.emotion ?? null })),
    };
  }
}
const durations = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
const output = { metadata, calls: rows.length, medianCallMs: durations[Math.floor(durations.length / 2)], summary,
  limitations: ['Hand-authored expected labels, not independent human judgements',
    '24 distinct held-out lines tested in two moods with two seeds; repeated calls are not independent texts',
    'Only the current local model tested; tone sharpening and rendered facial animation omitted',
    'Reported-emotion challenge remains sensitive to mood context; its neutral labels may not reflect the desired delivery'],
};
fs.writeFileSync(process.argv[3], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
