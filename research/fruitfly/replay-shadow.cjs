// Reproduce complete policy-2 sessions from numeric diagnostic inputs.
const fs = require('node:fs');
const { newAttentionState, stepAttention } = require('../../dist-test/electron/attention.js');
const [file, output] = process.argv.slice(2);
if (!file || !output) throw Error('Expected attention-shadow.jsonl and output.json');
const sessions = new Map();
let malformed = 0;
for (const name of [file + '.1', file]) {
  if (!fs.existsSync(name)) { if (name === file) throw Error('Log missing'); continue; }
  for (const line of fs.readFileSync(name, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { malformed++; continue; }
    if (row?.policy !== 2 || row.version !== 1 || row.mode !== 'shadow') continue;
    if (typeof row.session !== 'string' || !Number.isInteger(row.sequence)) { malformed++; continue; }
    if (!sessions.has(row.session)) sessions.set(row.session, []);
    sessions.get(row.session).push(row);
  }
}
const results = [];
for (const rows of sessions.values()) {
  // A rotated partial session cannot be initialized from the default state.
  const complete = rows.every((row, index) => row.sequence === index + 1);
  const result = { firstAt: rows[0].at, lastAt: rows.at(-1).at, complete,
    samples: rows.filter(row => row.kind === 'sample').length, replayed: 0,
    actionMismatches: 0, numericMismatches: 0, largestAbsoluteError: 0 };
  if (complete) {
    let state = newAttentionState();
    for (const row of rows) {
      if (row.kind !== 'sample') continue;
      const input = row.inputs;
      if (!input?.vitals || !input.environment || !Number.isFinite(Date.parse(row.at))) throw Error('Invalid sample inputs');
      state = stepAttention(state, { now: Date.parse(row.at), vitals: input.vitals,
        environment: input.environment, sinceInteractionMs: input.sinceInteractionMs ?? Infinity,
        activity: row.activity, baselineReady: row.baselineReady, blocked: row.blocked });
      const error = Math.max(Math.abs(state.novelty - row.novelty),
        ...Object.keys(state.scores).map(key => Math.abs(state.scores[key] - row.scores[key])));
      if (!Number.isFinite(error)) throw Error('Invalid recorded numeric state');
      result.replayed++;
      result.actionMismatches += Number(state.action !== row.action);
      result.numericMismatches += Number(error > 1e-12);
      result.largestAbsoluteError = Math.max(result.largestAbsoluteError, error);
    }
  }
  results.push(result);
}
const summary = { policy: 2, tolerance: 1e-12, malformed,
  sessions: results, samples: results.reduce((n, row) => n + row.samples, 0),
  replayed: results.reduce((n, row) => n + row.replayed, 0),
  actionMismatches: results.reduce((n, row) => n + row.actionMismatches, 0),
  numericMismatches: results.reduce((n, row) => n + row.numericMismatches, 0),
  limitations: ['Only sessions with all sequence numbers starting at one are replayed',
    'Null silence is interpreted as Infinity, matching valid unknown-history production input',
    'Reproducing diagnostics does not establish desirable behavior or correct client presence'] };
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (summary.malformed || summary.actionMismatches || summary.numericMismatches) process.exitCode = 1;
