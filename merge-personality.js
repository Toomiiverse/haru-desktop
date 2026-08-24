// Merges Haru's personality into the config on this machine, leaving everything
// machine-specific alone.
//
// Run this with Haru STOPPED. She holds the whole config in memory and writes it
// back on any change, so a merge made underneath a running app is silently
// undone the next time she saves anything — the exact way an earlier edit to her
// memory was lost on the desktop.
//
//   node merge-personality.js ~/haru-personality.json
//
const fs = require('fs'), path = require('path'), os = require('os');

const incoming = process.argv[2];
if (!incoming) { console.error('  usage: node merge-personality.js <haru-personality.json>'); process.exit(1); }

const CONFIG = path.join(os.homedir(), '.config', 'haru-desktop', 'config.json');
if (!fs.existsSync(CONFIG)) { console.error(`  no config at ${CONFIG} — has she been run once on this machine?`); process.exit(1); }

// Refuse to run while she is up, rather than silently losing the work.
const { execSync } = require('child_process');
let running = '';
try { running = execSync('pgrep -af "electron \\." || true', { encoding: 'utf8' }).trim(); } catch { /* pgrep absent */ }
if (running) {
  console.error('  She is still running:\n    ' + running.split('\n')[0]);
  console.error('\n  Stop her first, or this merge will be overwritten the moment she saves:');
  console.error('    pkill -f "electron \\."');
  process.exit(1);
}

const hers = JSON.parse(fs.readFileSync(incoming, 'utf8'));
const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

// Kept, whatever the incoming file says: these belong to this machine.
const THIS_MACHINE = ['webAccess', 'ai', 'voice', 'live2d', 'listen', 'google', 'search', 'searchApiKey',
  'remoteApiKey', 'openaiApiKey', 'selfHostedApiKey', 'escalate', 'screenshots', 'watching', 'desktop',
  'gaming', 'roam', 'startup', 'companion', 'audio', 'vision', 'voiceLauncher'];

const backup = CONFIG + '.before-merge-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(CONFIG, backup);

const applied = [], refused = [];
for (const [key, value] of Object.entries(hers)) {
  if (THIS_MACHINE.includes(key)) { refused.push(key); continue; }
  config[key] = value;
  applied.push([key, JSON.stringify(value).length]);
}

fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

console.log(`  backed up to ${path.basename(backup)}\n`);
console.log('  --- merged in ---');
for (const [key, bytes] of applied.sort((a, b) => b[1] - a[1])) console.log('   ' + key.padEnd(12) + (bytes / 1024).toFixed(1).padStart(7) + ' KB');
if (refused.length) console.log('\n  --- refused, this machine keeps its own ---\n   ' + refused.join(', '));
console.log('\n  --- untouched on this machine ---');
console.log('   webAccess : ' + (config.webAccess?.username ? `password still set for "${config.webAccess.username}"` : 'NONE — check before restarting'));
console.log('   ai        : ' + (config.ai?.config?.endpoint ?? 'unset') + '  ' + (config.ai?.config?.model ?? ''));
console.log('\n  Start her again, then check she knows you: ask her what she remembers.');
