// Public, human-labelled regression check. Dataset text remains outside Git.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const [cache] = process.argv.slice(2);
const hash = text => createHash('sha256').update(text).digest('hex');
const read = file => fs.readFileSync(path.join(cache, file), 'utf8');
const labels = read('goemotions-labels.txt').trim().split(/\r?\n/);
const mapping = { neutral: 'neutral', joy: 'happy', curiosity: 'curious',
  annoyance: 'annoyed', embarrassment: 'embarrassed', nervousness: 'worried', surprise: 'surprised' };
const rows = read('goemotions-test.tsv').trim().split(/\r?\n/).map(line => {
  const [text, label, id] = line.split('\t');
  return { text, label: label.includes(',') ? null : labels[Number(label)], id };
});
if (rows.length !== 5427) throw Error('Unexpected test split size');
const cases = Object.entries(mapping).flatMap(([label, expected]) => {
  const eligible = rows.filter(row => row.label === label).sort((a, b) =>
    hash(`haru-goemotions-20260916:${a.id}`).localeCompare(hash(`haru-goemotions-20260916:${b.id}`)));
  if (eligible.length < 12) throw Error(`Too few ${label} examples`);
  return eligible.slice(0, 12).map(({ id, text }) => ({ id, text, expected, originalLabel: label, split: 'heldout' }));
});
if (cases.some(row => row.text.length > 600)) throw Error('Classifier would truncate a selected example');
const original = JSON.parse(read('emotion-job.json'));
const job = { ...original, cases };
fs.writeFileSync(path.join(cache, 'goemotions-job.json'), JSON.stringify(job, null, 2));
const manifest = {
  dataset: 'GoEmotions', source: 'https://github.com/google-research/google-research/tree/master/goemotions',
  paper: 'https://aclanthology.org/2020.acl-main.372/',
  sourceCommit: read('goemotions-source-commit.txt').replace(/^\uFEFF/, '').trim(),
  sourceSha256: Object.fromEntries(['goemotions-test.tsv', 'goemotions-labels.txt'].map(file => [file, hash(read(file))])),
  mapping, selection: '12 single-label comments per category; SHA-256 ordering of haru-goemotions-20260916:<id>',
  cases: cases.map(({ text, ...row }) => ({ ...row, textSha256: hash(text) })),
  calls: cases.length * job.seeds.length * job.prompts.length * 2,
  limitations: ['Reddit labels and companion delivery have different context and scope',
    'No determined, smug, bored, sleepy or affectionate coverage',
    'Balanced subset; not a representative estimate of overall dataset performance',
    'Seed and mood repetitions are not independent texts'],
};
fs.writeFileSync(path.join(__dirname, 'goemotions-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${cases.length} public lines, ${manifest.calls} calls`);
