// node scripts/attention-report.cjs /path/to/attention-shadow.jsonl
// Include the rotated file automatically; stream so log size does not dictate memory.
const fs = require('node:fs');
const readline = require('node:readline');
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/attention-report.cjs /path/to/attention-shadow.jsonl [policy=2]');
  const policy = Number(process.argv[3] ?? 2);
  if (![1, 2].includes(policy)) throw new Error('Policy must be 1 or 2');
  const counts = { samples: 0, baselineEligible: 0, shadowSpeak: 0, agreement: 0, switches: 0, transitions: 0, actualAsides: 0, repeatBlocked: 0, interactions: 0, malformed: 0 };
  const actions = {}, feedback = new Map();
  let last, totalMs = 0, maxMs = 0, firstAt, lastAt, lastAside, shortAsideGaps = 0;
  for (const name of [file + '.1', file]) {
    if (!fs.existsSync(name)) { if (name === file) throw new Error('Log not found: ' + file); continue; }
    const lines = readline.createInterface({ input: fs.createReadStream(name), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { counts.malformed++; continue; }
      if (!row || typeof row.session !== 'string' || row.version !== 1 || row.mode !== 'shadow' || !Number.isFinite(Date.parse(row.at))) { counts.malformed++; continue; }
      if ((row.policy ?? 1) !== policy) continue;
      firstAt ??= row.at; lastAt = row.at;
      if (row.kind === 'sample') {
        if (!['attend', 'investigate', 'speak', 'rest'].includes(row.action) || typeof row.baselineEligible !== 'boolean' || !Number.isFinite(row.computeMs)) { counts.malformed++; continue; }
        counts.samples++;
        actions[row.action] = (actions[row.action] || 0) + 1;
        counts.baselineEligible += Number(row.baselineEligible);
        counts.shadowSpeak += Number(row.action === 'speak');
        counts.agreement += Number((row.action === 'speak') === row.baselineEligible);
        if (last?.session === row.session) { counts.transitions++; counts.switches += Number(last.action !== row.action); }
        last = row;
        totalMs += row.computeMs; maxMs = Math.max(maxMs, row.computeMs);
      } else if (row.kind === 'aside') {
        counts.actualAsides++;
        if (lastAside?.session === row.session && Date.parse(row.at) - Date.parse(lastAside.at) < 600_000) shortAsideGaps++;
        lastAside = row;
      } else if (row.kind === 'repeat-blocked') counts.repeatBlocked++;
      else if (row.kind === 'interaction') counts.interactions++;
      else if (row.kind === 'feedback' && typeof row.id === 'string') feedback.set(row.id, row.reaction);
    }
  }
  console.log(JSON.stringify({
    mode: 'shadow', policy, firstAt, lastAt, ...counts, actions, shortAsideGaps,
    speechDecisionAgreement: counts.samples ? counts.agreement / counts.samples : null,
    actionSwitchRate: counts.transitions ? counts.switches / counts.transitions : null,
    meanComputeMs: counts.samples ? totalMs / counts.samples : null, maxComputeMs: counts.samples ? maxMs : null,
    feedback: { up: [...feedback.values()].filter(r => r === 'up').length, down: [...feedback.values()].filter(r => r === 'down').length },
    interpretation: 'Observational only. Baseline eligibility is not delivery. Feedback concerns existing replies, not shadow actions. Compute time excludes log IO and model latency. Short aside gaps include reminders; they are not automatically unwanted interruptions.',
  }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
