// Reproduce complete policy-2/3 sessions from diagnostic inputs.
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
    if (![2, 3].includes(row?.policy) || row.version !== 1 || row.mode !== 'shadow') continue;
    if (typeof row.session !== 'string' || !Number.isInteger(row.sequence)) { malformed++; continue; }
    const key = row.policy + ':' + row.session;
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(row);
  }
}
const results = [];
for (const rows of sessions.values()) {
  // A rotated partial session cannot be initialized from the default state.
  const complete = rows.every((row, index) => row.sequence === index + 1);
  const result = { policy: rows[0].policy, firstAt: rows[0].at, lastAt: rows.at(-1).at, complete,
    samples: rows.filter(row => row.kind === 'sample').length, replayed: 0,
    actionMismatches: 0, proposalMismatches: 0, numericMismatches: 0, largestAbsoluteError: 0,
    webReplayed: 0, webActionMismatches: 0, webNumericMismatches: 0 };
  if (complete) {
    let state = newAttentionState(), webState = newAttentionState();
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
      if (row.policy === 3) {
        const idle = input.environment.idleSeconds;
        const proposal = typeof idle === 'number' && Number.isFinite(idle) && idle >= 0 ? state.action : null;
        result.proposalMismatches += Number(proposal !== row.proposedAction);
      }
      result.numericMismatches += Number(error > 1e-12);
      result.largestAbsoluteError = Math.max(result.largestAbsoluteError, error);
      if (row.webInput) {
        const recent = row.webInput.status === 'recent-input';
        if (!(recent && Number.isFinite(row.webInput.ageMs) && row.webInput.ageMs >= 0 && row.webInput.ageMs <= 300_000
            || row.webInput.status === 'unknown' && row.webInput.ageMs === null && row.webShadow === null)) throw Error('Invalid web input evidence');
        webState = stepAttention(webState, { now: Date.parse(row.at), vitals: input.vitals,
          environment: { ...input.environment, idleSeconds: recent ? row.webInput.ageMs / 1000 : Infinity },
          sinceInteractionMs: input.sinceInteractionMs ?? Infinity, activity: row.activity,
          baselineReady: row.baselineReady, blocked: row.blocked || !recent });
        result.webReplayed++;
        if (recent) {
          const webError = Math.max(Math.abs(webState.novelty - row.webShadow?.novelty),
            ...Object.keys(webState.scores).map(key => Math.abs(webState.scores[key] - row.webShadow?.scores?.[key])));
          if (!Number.isFinite(webError)) throw Error('Invalid web shadow state');
          result.webActionMismatches += Number(webState.action !== row.webShadow.action);
          result.webNumericMismatches += Number(webError > 1e-12);
        }
      }
    }
  }
  results.push(result);
}
const summary = { policies: [...new Set(results.map(row => row.policy))], tolerance: 1e-12, malformed,
  sessions: results, samples: results.reduce((n, row) => n + row.samples, 0),
  replayed: results.reduce((n, row) => n + row.replayed, 0),
  actionMismatches: results.reduce((n, row) => n + row.actionMismatches, 0),
  proposalMismatches: results.reduce((n, row) => n + row.proposalMismatches, 0),
  numericMismatches: results.reduce((n, row) => n + row.numericMismatches, 0),
  webReplayed: results.reduce((n, row) => n + row.webReplayed, 0),
  webActionMismatches: results.reduce((n, row) => n + row.webActionMismatches, 0),
  webNumericMismatches: results.reduce((n, row) => n + row.webNumericMismatches, 0),
  limitations: ['Only sessions with all sequence numbers starting at one are replayed',
    'Null silence is interpreted as Infinity, matching valid unknown-history production input',
    'Reproducing diagnostics does not establish desirable behavior or correct client presence'] };
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (summary.malformed || summary.actionMismatches || summary.proposalMismatches || summary.numericMismatches || summary.webActionMismatches || summary.webNumericMismatches) process.exitCode = 1;
