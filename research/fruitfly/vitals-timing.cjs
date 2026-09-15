#!/usr/bin/env node
// Controlled timing comparison; no model or user-store access.
const fs = require('node:fs');
const path = require('node:path');
const { driftVitals, DEFAULT_VITALS } = require('../../dist-test/electron/vitals.js');
const environments = {
  work: { hour: 12, idleSeconds: 0, windowFocused: true, onBattery: false },
  sleep: { hour: 2, idleSeconds: 3600, windowFocused: false, onBattery: false },
};
const start = { ...DEFAULT_VITALS, stress: 0.9, happiness: 0.2 };
const results = {};
for (const [name, environment] of Object.entries(environments)) {
  results[name] = {};
  for (const cadence of [5, 20, 60, 300]) {
    let state = { ...start };
    const trajectory = [];
    for (let elapsed = cadence; elapsed <= 600; elapsed += cadence) {
      state = driftVitals(state, environment, cadence);
      trajectory.push({ seconds: elapsed, ...state });
    }
    results[name][cadence] = trajectory;
  }
}
const output = process.argv[2];
if (!output) throw Error('Expected output path');
fs.writeFileSync(output, JSON.stringify({ start, environments, results }, null, 2));
for (const [name, byCadence] of Object.entries(results)) {
  console.log(name, Object.fromEntries(Object.entries(byCadence).map(([cadence, rows]) => [cadence, rows.at(-1)])));
}
