// Run npm test first, then node scripts/attention-compare.cjs [repo-directory].
// Offline, fixed-input replay. Counts proposals, not delivered messages.
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || process.cwd());
const { newAttentionState, stepAttention } = require(path.join(root, 'dist-test/electron/attention.js'));
const { shouldPipeUp } = require(path.join(root, 'dist-test/electron/opening.js'));
const { DEFAULT_VITALS, driftVitals, applyEvent } = require(path.join(root, 'dist-test/electron/vitals.js'));
const alert = { ...DEFAULT_VITALS, energy: 1, curiosity: 1, focus: 0, stress: 0, sleepiness: 0 };
const scenarios = [
  { name: 'Default vitals, active desk', vitals: DEFAULT_VITALS },
  { name: 'Alert and curious', vitals: alert },
  { name: 'Focused work', vitals: { ...alert, energy: 0.9, curiosity: 0.75, focus: 0.9, stress: 0.1, sleepiness: 0.15 } },
  { name: 'Category changes every 2 min', vitals: alert, novelty: true },
  { name: 'User speaks every 5 min', vitals: alert, conversation: true },
  { name: 'Sleeping, inactive desk', vitals: { ...DEFAULT_VITALS, sleepiness: 0.95, energy: 0.05 }, away: true },
  { name: 'Speech gate always blocked', vitals: alert, blocked: true },
  { name: '24 hours: work, evening, sleep, feedback', vitals: DEFAULT_VITALS, drifting: true, duration: 86400 },
];
const rows = scenarios.map(scenario => {
  const trials = [];
  for (let seed = 1; seed <= 100; seed++) {
    let rng = seed, state = newAttentionState(), lastBaseline = -Infinity, lastContact = 0, vitals = { ...scenario.vitals };
    let baseline = 0, shadow = 0, firstBaseline = null, firstShadow = null, switches = 0, previous;
    const actions = { attend: 0, investigate: 0, speak: 0, rest: 0 };
    const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
    for (let seconds = 0; seconds < (scenario.duration || 3600); seconds += 20) {
      const hour = scenario.drifting ? (8 + Math.floor(seconds / 3600)) % 24 : scenario.away ? 3 : 12;
      const active = !scenario.away && (!scenario.drifting || (hour >= 8 && hour < 22));
      const environment = { hour, idleSeconds: active ? 0 : 3600, onBattery: hour >= 19, windowFocused: scenario.drifting && active && seconds % 1800 < 300 };
      if ((scenario.conversation && seconds % 300 === 0) || (scenario.drifting && active && seconds % 1800 === 0)) lastContact = seconds;
      const sinceUser = seconds - lastContact;
      if (scenario.drifting) {
        if (active && seconds % 3600 === 0) vitals = applyEvent(vitals, hour % 2 ? 'praised' : 'criticised');
        vitals = driftVitals(vitals, environment, 20);
      }
      // Both policies get the same outside events; each keeps its own speech clock.
      const blocked = Boolean(scenario.blocked) || sinceUser < 180;
      const ready = shouldPipeUp({
        minutesSinceUserSpoke: sinceUser / 60, minutesSinceSheSpoke: (seconds - lastBaseline) / 60,
        machineIdleSeconds: environment.idleSeconds,
        curiosity: vitals.curiosity, sleepiness: vitals.sleepiness,
      }, random);
      if (ready && !blocked) { baseline++; lastBaseline = seconds; firstBaseline ??= seconds / 60; }
      state = stepAttention(state, {
        now: 1_000_000 + seconds * 1000, vitals, environment,
        activity: !active ? 'other' : scenario.drifting ? (hour < 17 ? 'coding' : 'watching') : scenario.novelty && Math.floor(seconds / 120) % 2 ? 'gaming' : 'working',
        sinceInteractionMs: sinceUser * 1000, baselineReady: ready, blocked,
      });
      actions[state.action]++;
      if (previous && previous !== state.action) switches++;
      previous = state.action;
      if (state.action === 'speak') { shadow++; firstShadow ??= seconds / 60; }
      assert.ok(Object.values(state.scores).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
      if (blocked || !active) assert.notEqual(state.action, 'speak');
      if (scenario.conversation) assert.notEqual(state.action, 'speak');
      if (sinceUser < 180) assert.equal(state.action, 'attend');
    }
    trials.push({ baseline, shadow, firstBaseline, firstShadow, actions, switches });
  }
  const average = key => Number((trials.reduce((sum, trial) => sum + trial[key], 0) / trials.length).toFixed(2));
  const firsts = trials.map(t => t.firstBaseline).filter(t => t !== null).sort((a,b) => a-b);
  return {
    scenario: scenario.name, simulatedHours: (scenario.duration || 3600) / 3600, baselineProposalsMean: average('baseline'), baselineRange: [Math.min(...trials.map(t => t.baseline)), Math.max(...trials.map(t => t.baseline))],
    shadowProposals: trials[0].shadow, firstBaselineMedianMin: firsts.length ? Number(firsts[Math.floor(firsts.length / 2)].toFixed(2)) : null,
    firstShadowMin: trials[0].firstShadow, shadowActions: trials[0].actions, shadowSwitches: trials[0].switches,
  };
});
assert.ok(rows.find(row => row.simulatedHours === 24).shadowProposals > 0, 'ordinary daytime activity must not stay silent forever');
const baseInput = {
  now: 1_000_000, vitals: DEFAULT_VITALS,
  environment: { hour: 12, idleSeconds: 0, onBattery: false, windowFocused: false },
  activity: 'working', sinceInteractionMs: Infinity, baselineReady: false, blocked: false,
};
let cold = newAttentionState(), warm = newAttentionState();
for (let i = 0; i < 180; i++) {
  const reading = { ...baseInput, now: 1_000_000 + i * 20_000 };
  cold = stepAttention(cold, reading);
  warm = stepAttention(warm, { ...reading, sinceInteractionMs: i < 9 ? i * 20_000 : Infinity });
}
assert.equal(cold.action, 'attend');
assert.equal(warm.action, cold.action);
const output = {
  policy: 2,
  method: '100 seeded baseline runs per scenario; 20-second ticks; fixed vitals for one-hour cases plus a 24-hour drifting-vitals case with half-hourly daytime contact and alternating hourly feedback; conversation at minute zero; independent proposal clocks; no LLM, delivery, reminder generation or live user experiments.',
  scenarios: rows,
  hysteresisProbe: { description: 'Same default vitals for an hour: restart with no recent contact versus initial direct contact.', coldAction: cold.action, warmAction: warm.action, coldScores: cold.scores, warmScores: warm.scores },
  caveat: 'Proposal counts are not measured unwanted interruptions or user preference. Baseline handles only speak/silent; other shadow actions have no equivalent baseline category.',
};
console.log(JSON.stringify(output, null, 2));
