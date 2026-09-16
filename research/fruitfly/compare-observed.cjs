// Offline, conditional comparison: same recorded client inputs for each policy.
// Run after npm test. This does not change Haru or infer whether a nudge is wanted.
const fs = require('node:fs');
const { newAttentionState, stepAttention } = require('../../dist-test/electron/attention.js');
const { shouldPipeUp } = require('../../dist-test/electron/opening.js');
const WARMUP_MS = 600_000;
const VITALS = ['energy', 'happiness', 'curiosity', 'affection', 'sleepiness', 'stress', 'focus'];

function compareObserved(rows, runs = 100) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 1000) throw Error('Expected 1–1000 seeded runs');
  const sessions = new Map();
  for (const row of rows) {
    if (row?.policy !== 3 || row.version !== 1 || row.mode !== 'shadow') continue;
    if (typeof row.session !== 'string' || !Number.isSafeInteger(row.sequence)) throw Error('Invalid session metadata');
    if (!sessions.has(row.session)) sessions.set(row.session, []);
    sessions.get(row.session).push(row);
  }
  const results = [];
  let skippedPartialSessions = 0, skippedPartialSamples = 0;
  for (const rows of sessions.values()) {
    if (!rows.every((row, index) => row.sequence === index + 1)) {
      skippedPartialSessions++; skippedPartialSamples += rows.filter(row => row.kind === 'sample').length; continue;
    }
    const samples = rows.filter(row => row.kind === 'sample');
    if (!samples.length) continue;
    let previousAt = -Infinity;
    for (const row of samples) {
      const { vitals, environment: env, sinceInteractionMs: silence } = row.inputs ?? {};
      const at = Date.parse(row.at), observation = row.observation;
      const known = typeof env?.idleSeconds === 'number' && Number.isFinite(env.idleSeconds) && env.idleSeconds >= 0;
      if (!Number.isFinite(at) || at < previousAt || typeof row.blocked !== 'boolean' || typeof row.activity !== 'string'
          || !VITALS.every(key => typeof vitals?.[key] === 'number' && Number.isFinite(vitals[key]) && vitals[key] >= 0 && vitals[key] <= 1)
          || !(silence === null || Number.isFinite(silence) && silence >= 0)
          || !env || !Number.isFinite(env.hour) || env.hour < 0 || env.hour >= 24
          || ![null, true, false].includes(env.windowFocused) || ![null, true, false].includes(env.onBattery)
          || !(env.idleSeconds === null || known)
          || !observation || (known
            ? !['browser', 'desktop', 'conversation'].includes(observation.source)
              || observation.availability !== (env.idleSeconds <= 300 ? 'recent-input' : 'idle')
            : observation.source !== null || observation.availability !== 'unknown')
          || observation.idleSeconds !== env.idleSeconds) throw Error('Invalid observed sample');
      previousAt = at;
    }
    const started = Date.parse(samples[0].at);
    const coverage = { samples: samples.length, unknown: 0, knownIdle: 0, recentInput: 0,
      blockedRecentInput: 0, unblockedRecentInput: 0, afterWarmupUnblockedRecentInput: 0 };
    const sources = { browser: 0, desktop: 0, conversation: 0 };
    for (const row of samples) {
      const status = row.observation.availability;
      if (status === 'unknown') coverage.unknown++;
      else {
        sources[row.observation.source]++;
        if (status === 'idle') coverage.knownIdle++;
        else {
          coverage.recentInput++;
          coverage[row.blocked ? 'blockedRecentInput' : 'unblockedRecentInput']++;
          coverage.afterWarmupUnblockedRecentInput += Number(!row.blocked && Date.parse(row.at) - started >= WARMUP_MS);
        }
      }
    }
    const trials = [];
    for (let seed = 1; seed <= runs; seed++) {
      let randomState = seed, baselineLast = -Infinity, simpleLast = -Infinity, state = newAttentionState();
      const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      const counts = { baseline: 0, simple: 0, fly: 0 };
      for (const row of samples) {
        const now = Date.parse(row.at), { vitals, environment } = row.inputs;
        const silence = row.inputs.sinceInteractionMs ?? Infinity;
        const blocked = row.blocked || now - started < WARMUP_MS;
        const available = row.observation.availability === 'recent-input';
        const reading = last => ({ minutesSinceUserSpoke: silence / 60_000,
          minutesSinceSheSpoke: (now - last) / 60_000, machineIdleSeconds: environment.idleSeconds,
          curiosity: vitals.curiosity, sleepiness: vitals.sleepiness });
        if (available && !blocked && shouldPipeUp(reading(baselineLast), random)) { counts.baseline++; baselineLast = now; }
        if (available && !blocked && shouldPipeUp(reading(simpleLast), () => 0)) { counts.simple++; simpleLast = now; }
        state = stepAttention(state, { now, vitals, environment, activity: row.activity,
          sinceInteractionMs: silence, baselineReady: null, blocked });
        if (available && state.action === 'speak') counts.fly++;
      }
      trials.push(counts);
    }
    const summarize = arm => {
      const values = trials.map(trial => trial[arm]);
      return { mean: values.reduce((a, b) => a + b, 0) / runs, min: Math.min(...values), max: Math.max(...values) };
    };
    results.push({ firstAt: samples[0].at, lastAt: samples.at(-1).at, coverage, sources,
      proposals: { baseline: summarize('baseline'), simple: summarize('simple'), fly: summarize('fly') } });
  }
  return { protocol: 'observed-input-comparison-v1', policy: 3, seededRuns: runs, warmupMs: WARMUP_MS,
    skippedPartialSessions, skippedPartialSamples, sessions: results,
    interpretation: 'Counterfactual proposals using identical recorded client observations, vitals and blockers. All arms get ten minutes of startup grace and independent proposal clocks. Baseline retains random timing; simple acts at the first eligible opportunity. Unknown input permits no proposal. Recorded vitals and conversation remain fixed, so these are not predictions of a changed conversation or user response. No helpfulness, preference or brain-map benefit is established. Warmup is analysis-only; no live policy is enabled.' };
}

if (require.main === module) {
  const [file, output] = process.argv.slice(2);
  if (!file || !output) throw Error('Expected attention-shadow.jsonl and output.json');
  const rows = [];
  for (const name of [file + '.1', file]) {
    if (!fs.existsSync(name)) { if (name === file) throw Error('Log missing'); continue; }
    for (const line of fs.readFileSync(name, 'utf8').split(/\r?\n/)) if (line.trim()) rows.push(JSON.parse(line));
  }
  const result = compareObserved(rows);
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { compareObserved };
