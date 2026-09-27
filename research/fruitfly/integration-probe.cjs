// Synthetic integration checks, not evidence of user preference or brain-map benefit.
// Run after compiling tests: node research/fruitfly/integration-probe.cjs output.json
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { ActivityObservations } = require('../../dist-test/electron/activity-observation.js');
const { AttentionRuntime, ATTENTION_POLICY } = require('../../dist-test/electron/attention.js');
const { DEFAULT_VITALS, driftVitals } = require('../../dist-test/electron/vitals.js');
const { shouldPipeUp } = require('../../dist-test/electron/opening.js');

const cases = [
  { name: 'active-desktop', desktop: true },
  { name: 'active-browser', browser: true },
  { name: 'conversation', browser: true, conversation: true },
  { name: 'quiet-reading-no-input' },
  { name: 'idle-desktop', desktop: true, idle: true },
  { name: 'overnight-unknown', hour: 0 },
  { name: 'offline-reconnect', desktop: true, reconnect: true },
  { name: 'delayed-ticks', desktop: true, tick: 60 },
];
const runs = 100;
const results = cases.map(scenario => {
  const counts = { baseline: [], simple: [], fly: [] };
  let representative;
  for (let seed = 1; seed <= runs; seed++) {
    let randomState = seed;
    const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const observations = new ActivityObservations(), runtime = new AttentionRuntime();
    let corrected = { ...DEFAULT_VITALS }, oldHost = { ...DEFAULT_VITALS };
    let lastContact = scenario.conversation ? 0 : -Infinity, lastBaseline = -Infinity, lastSimple = -Infinity;
    let baseline = 0, simple = 0, fly = 0, unknown = 0, known = 0;
    let computeMs = 0;
    const tick = scenario.tick || 20;
    for (let seconds = tick; seconds <= 3600; seconds += tick) {
      const now = 1_000_000 + seconds * 1000;
      const offline = scenario.reconnect && seconds > 600 && seconds < 1800;
      if (scenario.desktop && !offline) observations.note('pc', {
        kind: 'desktop', client: 'synthetic-desktop', sequence: seconds, sampleAgeMs: 0,
        idleSeconds: scenario.idle ? 3600 + seconds : 5, windowFocused: false, onBattery: false,
      }, now);
      if (scenario.browser) observations.note('phone', { kind: 'input', client: 'synthetic-browser', sequence: seconds }, now);
      if (scenario.conversation && seconds % 60 === 0) { lastContact = seconds; observations.conversation(now); }
      const observation = observations.read(now);
      const environment = { hour: scenario.hour ?? 12, idleSeconds: observation.idleSeconds,
        windowFocused: observation.windowFocused, onBattery: observation.onBattery };
      corrected = driftVitals(corrected, environment, tick);
      oldHost = driftVitals(oldHost, { hour: environment.hour, idleSeconds: 12 * 86400,
        windowFocused: true, onBattery: false }, tick);
      const available = observation.availability === 'recent-input';
      if (observation.availability === 'unknown') unknown++; else known++;
      const blocked = environment.hour === 0 || seconds - lastContact < 180;
      const eligible = last => available && !blocked && shouldPipeUp({
        minutesSinceUserSpoke: (seconds - lastContact) / 60,
        minutesSinceSheSpoke: (seconds - last) / 60, machineIdleSeconds: environment.idleSeconds,
        curiosity: corrected.curiosity, sleepiness: corrected.sleepiness,
      }, () => 0);
      // Corrected-input baseline retains its random timing. Simple control uses
      // the same patience/availability gates and acts at the first eligible tick.
      if (eligible(lastBaseline) && shouldPipeUp({
        minutesSinceUserSpoke: (seconds - lastContact) / 60, minutesSinceSheSpoke: (seconds - lastBaseline) / 60,
        machineIdleSeconds: environment.idleSeconds, curiosity: corrected.curiosity, sleepiness: corrected.sleepiness,
      }, random)) { baseline++; lastBaseline = seconds; }
      if (eligible(lastSimple)) { simple++; lastSimple = seconds; }
      const started = performance.now();
      const proposal = runtime.advance({ now, vitals: corrected, environment, activity: 'working',
        sinceInteractionMs: (seconds - lastContact) * 1000, baselineReady: null, blocked });
      computeMs += performance.now() - started;
      if (proposal.proposedAction === 'speak') {
        assert.ok(available && !blocked, 'proposal must preserve availability and conversation/sleep gates');
        fly++;
      }
      if (observation.availability === 'unknown') assert.equal(proposal.proposedAction, null);
      assert.ok(Object.values(corrected).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    }
    counts.baseline.push(baseline); counts.simple.push(simple); counts.fly.push(fly);
    representative = { knownTicks: known, unknownTicks: unknown, correctedMood: corrected, oldVirtualHostMood: oldHost,
      meanComputeMs: computeMs / (known + unknown) };
  }
  const summarize = values => ({ mean: values.reduce((a, b) => a + b, 0) / runs, min: Math.min(...values), max: Math.max(...values) });
  return { scenario: scenario.name, proposals: Object.fromEntries(Object.entries(counts).map(([name, values]) => [name, summarize(values)])),
    ...representative };
});
for (const name of ['conversation', 'quiet-reading-no-input', 'idle-desktop', 'overnight-unknown']) {
  const row = results.find(row => row.scenario === name);
  assert.ok(Object.values(row.proposals).every(value => value.max === 0), name);
}
const output = { policy: ATTENTION_POLICY, method: 'Eight synthetic one-hour scenarios, 100 seeded baseline runs each. Same corrected observations/vitals for all three policies. Simple means first eligible opportunity. No model calls or messages. Proposal counts are not helpfulness scores.',
  limitations: ['Controlled assumptions, not observed user sessions', 'Live baseline still uses existing host delivery gates during this shadow-only milestone',
    'Unknown may mean quiet reading, disconnection or absence; these are not distinguished',
    'Final mood is a synthetic fixed-hour comparison, not a reconstruction of Haru\'s live state',
    'Compute timing is illustrative and excludes logging, IO and model generation'],
  results };
if (!process.argv[2]) throw Error('Expected output.json');
fs.writeFileSync(process.argv[2], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(results.map(row => ({ scenario: row.scenario, ...row.proposals,
  known: row.knownTicks, unknown: row.unknownTicks })), null, 2));
