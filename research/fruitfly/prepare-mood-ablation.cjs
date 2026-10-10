const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const cache = process.argv[2];
const hash = text => createHash('sha256').update(text).digest('hex');
const read = file => fs.readFileSync(path.join(cache, file), 'utf8');
const source = read('goemotions-dev.tsv');
const labels = read('goemotions-labels.txt').trim().split(/\r?\n/);
const previous = require('./goemotions-manifest.json');
const oldIds = new Set(previous.cases.map(row => row.id));
const rows = source.trim().split(/\r?\n/).map(line => {
  const [text, label, id] = line.split('\t');
  return { text, label: label.includes(',') ? null : labels[Number(label)], id };
});
if (rows.length !== 5426) throw Error('Unexpected dev split size');
const cases = Object.entries(previous.mapping).flatMap(([label, expected]) =>
  rows.filter(row => row.label === label).sort((a, b) =>
    hash(`haru-mood-ablation-20260916:${a.id}`).localeCompare(hash(`haru-mood-ablation-20260916:${b.id}`)))
    .slice(0, 20).map(({ id, text }) => ({ id, text, expected, originalLabel: label, split: 'public_dev' })));
if (cases.length !== 128 || cases.some(row => oldIds.has(row.id) || row.text.length > 600)) throw Error('Unexpected sample/overlap/truncation');
const original = JSON.parse(read('emotion-job.json'));
cases.push(...original.cases.filter(row => row.split === 'challenge'));
const instruction = ' Use the words of the line as the main evidence. Background mood may resolve an ambiguous line, but must not override an emotion clearly expressed in the words.';
const prompts = original.prompts.map(prompt => {
  const current = prompt.complete;
  const no_mood = current.replace(/For context she is currently .*?\. /, '');
  if (no_mood === current) throw Error('Background mood sentence not found');
  return { mood: prompt.mood, current, words_first: current + instruction, no_mood };
});
const job = { cases, prompts, variants: ['current', 'words_first', 'no_mood'], schema: original.schema, seeds: original.seeds };
fs.writeFileSync(path.join(cache, 'mood-ablation-job.json'), JSON.stringify(job, null, 2));
const manifest = { source: previous.source, sourceCommit: previous.sourceCommit, split: 'official dev',
  sourceSha256: hash(source), selection: 'Up to 20 single-label examples/category by SHA-256 order of haru-mood-ablation-20260916:<id>',
  mapping: previous.mapping, addedInstruction: instruction.trim(), prompts, variants: job.variants,
  cases: cases.map(({ text, ...row }) => ({ ...row, textSha256: hash(text) })),
  calls: cases.length * prompts.length * job.seeds.length * job.variants.length,
  limitations: ['Exploratory follow-up motivated by an earlier separate-split result',
    'Mapped Reddit labels do not establish preferable companion delivery',
    'Unequal category sizes: eight nervousness examples and twenty for each other category',
    'No-mood prompts are identical across nominal moods; those repetitions are duplicate controls',
    'Six reported-emotion challenge lines were previously seen; reported separately',
    'No production prompt or personality change from this experiment'] };
fs.writeFileSync(path.join(__dirname, 'mood-ablation-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${cases.length} lines, ${manifest.calls} calls`);
