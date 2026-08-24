// Wires her voice on this machine: merges the voice config staged on the desktop,
// with its paths already rewritten for Linux.
//
// Run with Haru STOPPED — she holds the config in memory and writes it back on
// any change, so a merge under a running app is silently undone.
//
//   node merge-voice.js ~/haru-voice/voice.json
//
const fs = require('fs'), path = require('path'), os = require('os');
const { execSync } = require('child_process');

const incoming = process.argv[2] || path.join(os.homedir(), 'haru-voice', 'voice.json');
if (!fs.existsSync(incoming)) { console.error(`  no such file: ${incoming}`); process.exit(1); }

const CONFIG = path.join(os.homedir(), '.config', 'haru-desktop', 'config.json');
if (!fs.existsSync(CONFIG)) { console.error(`  no config at ${CONFIG}`); process.exit(1); }

let running = '';
try { running = execSync('pgrep -af "electron \\." || true', { encoding: 'utf8' }).trim(); } catch { /* pgrep absent */ }
if (running) {
  console.error('  She is still running:\n    ' + running.split('\n')[0]);
  console.error('\n  Stop her first or this is overwritten:\n    pkill -f "electron \\."');
  process.exit(1);
}

const { voice } = JSON.parse(fs.readFileSync(incoming, 'utf8'));
if (!voice) { console.error('  that file has no voice config in it'); process.exit(1); }

// Every clip is checked before anything is written. A missing reference does not
// fail loudly at speech time — it changes or kills the voice quietly, which is
// far worse to diagnose later than refusing now.
const missing = [];
const check = (clip, what) => { if (clip && !fs.existsSync(clip)) missing.push(`${what}: ${clip}`); };
check(voice.voice, 'main reference');
for (const [emotion, ref] of Object.entries(voice.emotionVoices ?? {})) check(ref?.clip, emotion);

console.log('  --- her references ---');
console.log('   ' + (fs.existsSync(voice.voice ?? '') ? 'ok  ' : 'MISS') + ' main       ' + path.basename(voice.voice ?? '(none)'));
for (const [emotion, ref] of Object.entries(voice.emotionVoices ?? {})) {
  if (!ref?.clip) continue;
  console.log('   ' + (fs.existsSync(ref.clip) ? 'ok  ' : 'MISS') + ' ' + emotion.padEnd(11) + path.basename(ref.clip).slice(0, 46));
}

if (missing.length) {
  console.error(`\n  ${missing.length} reference(s) are not on disk — nothing has been written.`);
  console.error('  Did ~/haru-voice/clips make it across?\n');
  for (const m of missing.slice(0, 5)) console.error('   ' + m);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const backup = CONFIG + '.before-voice-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(CONFIG, backup);

config.voice = voice;
fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

console.log(`\n  backed up to ${path.basename(backup)}`);
console.log('  engine   : ' + voice.engine);
console.log('  endpoint : ' + voice.endpoint);
console.log('  transcript: "' + String(voice.referenceText ?? '').slice(0, 70) + '"');
console.log('\n  Start her again, then Setup → Voice → Test voice.');
