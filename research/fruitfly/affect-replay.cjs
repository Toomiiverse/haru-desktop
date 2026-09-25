// Stress, saturation and recovery of existing vitals under controlled events.
// These are numerical behaviours, not judgements of human-like emotion.
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_VITALS, driftVitals, applyEvent, spokenCues } = require('../../dist-test/electron/vitals.js');
const { emotionToVitals } = require('../../dist-test/electron/emotion.js');
const environment = { hour: 12, idleSeconds: 0, windowFocused: false, onBattery: false };
const settled = driftVitals(DEFAULT_VITALS, environment, 3600);
const emotion = label => ({ emotion: label, confidence: 1, energy: 0.7, intent: 'listen', focus: 'user' });
const scenarios = {
  neutral_20s: t => t < 300 && t % 20 === 0 ? ['emotion', 'neutral'] : null,
  worried_10s: t => t < 300 && t % 10 === 0 ? ['emotion', 'worried'] : null,
  worried_60s: t => t < 300 && t % 60 === 0 ? ['emotion', 'worried'] : null,
  annoyed_10s: t => t < 300 && t % 10 === 0 ? ['emotion', 'annoyed'] : null,
  alternating_10s: t => t < 300 && t % 10 === 0 ? ['emotion', t % 20 ? 'annoyed' : 'happy'] : null,
  praise_20s: t => t < 300 && t % 20 === 0 ? ['event', 'praised'] : null,
  criticism_20s: t => t < 300 && t % 20 === 0 ? ['event', 'criticised'] : null,
  single_worry_then_happy: t => t === 0 ? ['emotion', 'worried'] : t === 180 ? ['emotion', 'happy'] : null,
};
const results = {}, trace = ['scenario,seconds,energy,happiness,curiosity,affection,sleepiness,stress,focus'];
for (const [name, nextEvent] of Object.entries(scenarios)) {
  let state = { ...settled }, events = 0, firstHighStress = null, peakStress = 0, minHappiness = 1;
  let stressRecoveredAt = null, stateAt300;
  const cues = {};
  for (let seconds = 0; seconds <= 900; seconds += 5) {
    if (seconds) state = driftVitals(state, environment, 5);
    const event = nextEvent(seconds);
    if (event) {
      events++;
      state = event[0] === 'event' ? applyEvent(state, event[1]) : emotionToVitals(emotion(event[1]), state);
    }
    if (!Object.values(state).every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw Error(`Unbounded state in ${name}`);
    if (state.stress >= 0.95 && firstHighStress === null) firstHighStress = seconds;
    if (seconds >= 300 && Math.abs(state.stress - settled.stress) < 0.05 && stressRecoveredAt === null) stressRecoveredAt = seconds;
    if (seconds === 300) stateAt300 = { ...state };
    peakStress = Math.max(peakStress, state.stress);
    minHappiness = Math.min(minHappiness, state.happiness);
    for (const item of spokenCues(state)) cues[item.cue.name] = (cues[item.cue.name] ?? 0) + 1;
    trace.push([name, seconds, ...['energy', 'happiness', 'curiosity', 'affection', 'sleepiness', 'stress', 'focus'].map(key => state[key])].join(','));
  }
  results[name] = { events, firstStressAtLeast095Seconds: firstHighStress, peakStress, minimumHappiness: minHappiness,
    stressWithin005OfBaselineAfterBurstSeconds: stressRecoveredAt === null ? null : stressRecoveredAt - 300,
    stateAt300Seconds: stateAt300, stateAt900Seconds: state, cueSampleCounts: cues };
}
const output = process.argv[2] ?? __dirname;
fs.writeFileSync(path.join(output, 'affect-traces.csv'), trace.join('\n') + '\n');
fs.writeFileSync(path.join(__dirname, 'affect-results.json'), JSON.stringify({ environment, settled, results,
  limitations: ['Synthetic event streams with maximal classification confidence', 'Fixed active environment; affection is intentionally retained there',
    'Five-second numerical sampling', 'No alternative affect controller deployed; lower saturation is not automatically a better personality'],
}, null, 2));
console.log(Object.fromEntries(Object.entries(results).map(([name, value]) => [name, { events: value.events, firstHighStress: value.firstStressAtLeast095Seconds, recoverySeconds: value.stressWithin005OfBaselineAfterBurstSeconds }])));
