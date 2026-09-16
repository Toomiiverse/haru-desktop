// Offline sensitivity check. Recorded vitals, gates and events stay fixed;
// only the attention policy's host-idle input is changed after direct contact.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { newAttentionState, stepAttention } = require('../../dist-test/electron/attention.js');
const { driftVitals, DEFAULT_VITALS } = require('../../dist-test/electron/vitals.js');

function audit(rows, from = -Infinity) {
  const sessions = new Map();
  for (const row of rows) {
    if (row?.version !== 1 || row.policy !== 2 || row.mode !== 'shadow') continue;
    if (typeof row.session !== 'string' || !Number.isInteger(row.sequence)) throw Error('Invalid session metadata');
    if (!sessions.has(row.session)) sessions.set(row.session, []);
    sessions.get(row.session).push(row);
  }
  const totals = { samples: 0, completeSessions: 0, skippedPartialSessions: 0, replayed: 0,
    interactions: 0, actualAsides: 0, baselineEligible: 0, recordedSpeech: 0, contactAwareSpeech: 0,
    recentContactWhileHostIdle: 0, changedIdleReadings: 0, changedActions: 0, hostActive: 0, hostFocused: 0 };
  const transitions = {};
  let firstAt = null, lastAt = null;
  for (const events of sessions.values()) {
    if (!events.every((row, index) => row.sequence === index + 1)) { totals.skippedPartialSessions++; continue; }
    totals.completeSessions++;
    let original = newAttentionState(), contact = newAttentionState();
    for (const row of events) {
      const now = Date.parse(row.at);
      if (!Number.isFinite(now)) throw Error('Invalid event time');
      const selected = now >= from;
      if (selected && row.kind === 'interaction') totals.interactions++;
      if (selected && row.kind === 'aside') totals.actualAsides++;
      if (row.kind !== 'sample') continue;
      const { vitals, environment, sinceInteractionMs } = row.inputs ?? {};
      if (!vitals || !environment || !Number.isFinite(environment.idleSeconds) || environment.idleSeconds < 0
          || !Object.values(vitals).every(Number.isFinite)
          || !(sinceInteractionMs === null || Number.isFinite(sinceInteractionMs) && sinceInteractionMs >= 0)) {
        throw Error('Invalid sample inputs');
      }
      const silence = sinceInteractionMs ?? Infinity;
      const input = { now, vitals, environment, sinceInteractionMs: silence,
        activity: row.activity, baselineReady: row.baselineReady, blocked: row.blocked };
      original = stepAttention(original, input);
      const error = Math.max(Math.abs(original.novelty - row.novelty),
        ...Object.keys(original.scores).map(key => Math.abs(original.scores[key] - row.scores?.[key])));
      if (original.action !== row.action || !Number.isFinite(error) || error > 1e-12) throw Error('Recorded replay mismatch');
      totals.replayed++;
      // Deliberate contact is evidence of input at that instant, not continuing
      // attention. This is a five-minute sensitivity assumption, not a sensor.
      const idleSeconds = silence <= 300_000 ? Math.min(environment.idleSeconds, silence / 1000) : environment.idleSeconds;
      contact = stepAttention(contact, { ...input, environment: { ...environment, idleSeconds } });
      if (!selected) continue;
      firstAt ??= row.at; lastAt = row.at;
      totals.samples++;
      totals.baselineEligible += Number(row.baselineEligible);
      totals.recordedSpeech += Number(row.action === 'speak');
      totals.contactAwareSpeech += Number(contact.action === 'speak');
      totals.recentContactWhileHostIdle += Number(silence < 180_000 && environment.idleSeconds > 300);
      totals.changedIdleReadings += Number(idleSeconds !== environment.idleSeconds);
      totals.changedActions += Number(contact.action !== row.action);
      totals.hostActive += Number(environment.idleSeconds <= 300);
      totals.hostFocused += Number(environment.windowFocused === true);
      const pair = row.action + ' -> ' + contact.action;
      transitions[pair] = (transitions[pair] || 0) + 1;
    }
  }
  return { from: Number.isFinite(from) ? new Date(from).toISOString() : null, firstAt, lastAt, ...totals, transitions };
}

// Independent controlled probe of mood drift, not a reconstruction of live mood:
// one hour at noon, no emotional events, same start, direct contact every minute.
function moodProbe() {
  const arms = { hostReadings: { ...DEFAULT_VITALS }, contactIdleOnly: { ...DEFAULT_VITALS },
    contactIdleWithoutHostFocus: { ...DEFAULT_VITALS } };
  for (let seconds = 20; seconds <= 3600; seconds += 20) {
    for (const key of Object.keys(arms)) {
      arms[key] = driftVitals(arms[key], { hour: 12, idleSeconds: key === 'hostReadings' ? 12 * 86400 : seconds % 60,
        onBattery: false, windowFocused: key !== 'contactIdleWithoutHostFocus' }, 20);
    }
  }
  return { description: 'Synthetic one hour at noon, contact every minute, 20-second ticks, no emotion events. Unfocused is an assumption, not measured client focus.', arms };
}

if (require.main === module) {
  const [file, output, fromISO] = process.argv.slice(2);
  if (!file || !output || (fromISO && !Number.isFinite(Date.parse(fromISO)))) throw Error('Expected log, output.json, optional start ISO');
  const rows = [], inputs = [];
  for (const name of [file + '.1', file]) {
    if (!fs.existsSync(name)) { if (name === file) throw Error('Log missing'); continue; }
    const bytes = fs.readFileSync(name);
    inputs.push({ part: name === file ? 'current' : 'rotated', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    rows.push(...bytes.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)));
  }
  const result = { experiment: 'offline-input-sensitivity-v1', inputs, observed: audit(rows, fromISO ? Date.parse(fromISO) : -Infinity),
    syntheticMoodProbe: moodProbe(), limitations: [
      'Complete sessions replayed from their start; start time filters reporting, not policy state',
      'Alternative holds recorded vitals and blockers fixed; it is not a full closed-loop behavioral prediction',
      'Five-minute contact evidence expires before the existing eight-to-fifteen-minute speech patience; contact alone cannot establish later availability',
      'Phone page polling and synced foreground history are not evidence of recent keyboard, mouse or touch input',
      'No production actions or mood are changed; no user preference or brain-map benefit is established',
    ] };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { audit, moodProbe };
