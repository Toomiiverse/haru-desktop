// node scripts/attention-report.cjs /path/to/attention-shadow.jsonl
// Include the rotated file; a first pass joins delayed baseline decisions.
const fs = require('node:fs');
const readline = require('node:readline');
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/attention-report.cjs /path/to/attention-shadow.jsonl [policy=3]');
  const policy = Number(process.argv[3] ?? 3);
  if (![1, 2, 3].includes(policy)) throw new Error('Policy must be 1, 2 or 3');
  const counts = { samples: 0, comparableSamples: 0, unresolvedBaseline: 0, unknownProposals: 0,
    duplicateBaselines: 0, baselineEligible: 0, shadowSpeak: 0, agreement: 0, switches: 0, transitions: 0, actualAsides: 0, repeatBlocked: 0, interactions: 0, malformed: 0 };
  const baselines = new Map();
  const tickKey = row => row.session + ':' + row.tickId;
  const validBaseline = row => Number.isSafeInteger(row.tickId) && row.tickId > 0
    && typeof row.ready === 'boolean' && typeof row.blocked === 'boolean'
    && row.baselineEligible === (row.ready && !row.blocked);
  const validHeader = row => row && typeof row.session === 'string' && row.version === 1
    && row.mode === 'shadow' && Number.isFinite(Date.parse(row.at));
  if (policy === 3) {
    for (const name of [file + '.1', file]) {
      if (!fs.existsSync(name)) continue;
      const lines = readline.createInterface({ input: fs.createReadStream(name), crlfDelay: Infinity });
      for await (const line of lines) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (!validHeader(row) || row.policy !== policy || row.kind !== 'baseline') continue;
        const key = tickKey(row);
        if (baselines.has(key)) { counts.duplicateBaselines++; baselines.set(key, null); }
        else baselines.set(key, validBaseline(row) ? row.baselineEligible : null);
      }
    }
  }
  const actions = {}, feedback = new Map();
  const activityCoverage = { unknown: 0, browser: 0, desktop: 0, conversation: 0 };
  const idleOutcomes = { attempted: 0, accepted: 0, suppressed: 0, failed: 0 };
  const speechDecisions = { bothPropose: 0, baselineOnly: 0, shadowOnly: 0, bothSilent: 0 };
  const inputCoverage = { measured: 0, hostActive: 0, hostIdleOverFiveMinutes: 0, hostWindowFocused: 0,
    recentDirectContact: 0, recentContactWhileHostIdle: 0, unblockedHostActive: 0 };
  const webInputComparison = { instrumented: 0, recentInput: 0, unknown: 0, changedActions: 0,
    hostIdleDespiteWebInput: 0, hostPolicySpeechOnKnownInput: 0, webPolicySpeech: 0 };
  let last, totalMs = 0, maxMs = 0, firstAt, lastAt, lastAside, shortAsideGaps = 0;
  for (const name of [file + '.1', file]) {
    if (!fs.existsSync(name)) { if (name === file) throw new Error('Log not found: ' + file); continue; }
    const lines = readline.createInterface({ input: fs.createReadStream(name), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { counts.malformed++; continue; }
      if (!validHeader(row)) { counts.malformed++; continue; }
      if ((row.policy ?? 1) !== policy) continue;
      firstAt ??= row.at; lastAt = row.at;
      if (row.kind === 'sample') {
        if (!['attend', 'investigate', 'speak', 'rest'].includes(row.action)
            || !(typeof row.baselineEligible === 'boolean' || policy === 3 && row.baselineEligible === null)
            || !Number.isFinite(row.computeMs)) { counts.malformed++; continue; }
        const proposed = policy === 3 ? row.proposedAction : row.action;
        if (!(proposed === null || ['attend', 'investigate', 'speak', 'rest'].includes(proposed))) { counts.malformed++; continue; }
        const baseline = row.baselineEligible === null ? (baselines.get(tickKey(row)) ?? null) : row.baselineEligible;
        counts.samples++;
        actions[row.action] = (actions[row.action] || 0) + 1;
        counts.baselineEligible += Number(baseline === true);
        counts.shadowSpeak += Number(proposed === 'speak');
        counts.unresolvedBaseline += Number(baseline === null);
        counts.unknownProposals += Number(proposed === null);
        if (baseline !== null && proposed !== null) {
          counts.comparableSamples++;
          counts.agreement += Number((proposed === 'speak') === baseline);
          speechDecisions[baseline ? (proposed === 'speak' ? 'bothPropose' : 'baselineOnly')
            : (proposed === 'speak' ? 'shadowOnly' : 'bothSilent')]++;
        }
        if (row.observation) {
          const source = row.observation.source;
          if (row.observation.availability === 'unknown') activityCoverage.unknown++;
          else if (['browser', 'desktop', 'conversation'].includes(source)) activityCoverage[source]++;
          else counts.malformed++;
        }
        const environment = row.inputs?.environment;
        const silence = row.inputs?.sinceInteractionMs;
        if (environment && Number.isFinite(environment.idleSeconds) && environment.idleSeconds >= 0) {
          inputCoverage.measured++;
          const active = environment.idleSeconds <= 300;
          const direct = Number.isFinite(silence) && silence >= 0 && silence < 180_000;
          inputCoverage.hostActive += Number(active);
          inputCoverage.hostIdleOverFiveMinutes += Number(!active);
          inputCoverage.hostWindowFocused += Number(environment.windowFocused === true);
          inputCoverage.recentDirectContact += Number(direct);
          inputCoverage.recentContactWhileHostIdle += Number(direct && !active);
          inputCoverage.unblockedHostActive += Number(active && row.blocked === false);
        }
        if (row.webInput) {
          if (row.webInput.status === 'unknown' && row.webInput.ageMs === null && row.webShadow === null) {
            webInputComparison.instrumented++; webInputComparison.unknown++;
          } else if (row.webInput.status === 'recent-input' && Number.isFinite(row.webInput.ageMs)
              && row.webInput.ageMs >= 0 && row.webInput.ageMs <= 300_000
              && ['attend', 'investigate', 'speak', 'rest'].includes(row.webShadow?.action)) {
            webInputComparison.instrumented++; webInputComparison.recentInput++;
            webInputComparison.changedActions += Number(row.action !== row.webShadow.action);
            webInputComparison.hostIdleDespiteWebInput += Number(environment?.idleSeconds > 300);
            webInputComparison.hostPolicySpeechOnKnownInput += Number(row.action === 'speak');
            webInputComparison.webPolicySpeech += Number(row.webShadow.action === 'speak');
          } else counts.malformed++;
        }
        if (last?.session === row.session) { counts.transitions++; counts.switches += Number(last.action !== row.action); }
        last = row;
        totalMs += row.computeMs; maxMs = Math.max(maxMs, row.computeMs);
      } else if (row.kind === 'baseline') {
        if (!validBaseline(row)) counts.malformed++;
      } else if (row.kind === 'outcome') {
        if (row.source === 'idle' && Object.hasOwn(idleOutcomes, row.stage)) idleOutcomes[row.stage]++;
        else counts.malformed++;
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
    speechDecisions, inputCoverage, activityCoverage, webInputComparison, idleOutcomes,
    baselineProposalOverlap: speechDecisions.bothPropose + speechDecisions.baselineOnly
      ? speechDecisions.bothPropose / (speechDecisions.bothPropose + speechDecisions.baselineOnly) : null,
    shadowProposalOverlap: speechDecisions.bothPropose + speechDecisions.shadowOnly
      ? speechDecisions.bothPropose / (speechDecisions.bothPropose + speechDecisions.shadowOnly) : null,
    speechDecisionAgreement: counts.comparableSamples ? counts.agreement / counts.comparableSamples : null,
    actionSwitchRate: counts.transitions ? counts.switches / counts.transitions : null,
    meanComputeMs: counts.samples ? totalMs / counts.samples : null, maxComputeMs: counts.samples ? maxMs : null,
    feedback: { up: [...feedback.values()].filter(r => r === 'up').length, down: [...feedback.values()].filter(r => r === 'down').length },
    interpretation: 'Observational only. Unknown proposals and unresolved/duplicate baseline results are excluded from agreement, not counted as silence. Agreement can be dominated by both policies staying silent. Proposal overlap is not accuracy. Baseline eligibility is not delivery. In policy 3, legacy inputCoverage host-named fields describe selected client/conversation evidence; activityCoverage identifies its source. Recent input does not prove continuing availability. Feedback concerns existing replies. Compute time excludes log IO and model latency. Short aside gaps include reminders.',
  }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
