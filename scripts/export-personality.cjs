// Sanitised export of Haru's personality state, for carrying her across or
// staging a merge without shipping the sensitive past in plaintext.
//
//   node export-personality.cjs [out.json] [--with-chat] [--with-checkins]
//
// Defaults: writes haru-personality.json next to the source config, strips the
// chat archive and check-in notes, and excludes machine-specific keys (the
// same THIS_MACHINE list merge-personality.js refuses) plus every saved secret.
//
// The check-in notes and the raw conversation are the two parts of the store
// that read as a private diary; everything else — memories, summaries, kept
// items, journal ratings, haunts, following, the profile — is personality, not
// diary, and goes along.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOURCE = process.env.HARU_CONFIG_FILE
  || (process.platform === 'win32'
    ? path.join(process.env.APPDATA, 'haru-desktop', 'config.json')
    : path.join(os.homedir(), '.config', 'haru-desktop', 'config.json'));

// The keys that describe this machine rather than her, so they never travel.
const THIS_MACHINE = ['webAccess', 'ai', 'voice', 'live2d', 'listen', 'google', 'search', 'searchApiKey', 'remoteApiKey', 'openaiApiKey', 'veniceApiKey', 'selfHostedApiKey', 'escalate', 'screenshots', 'watching', 'desktop', 'gaming', 'roam', 'startup', 'companion', 'audio', 'vision', 'voiceLauncher', 'jellyfin', 'checkinSource', 'checkinSourcePassword', 'discordToken'];

const withChat = process.argv.includes('--with-chat');
const withCheckins = process.argv.includes('--with-checkins');
const outArg = process.argv.find(arg => arg.endsWith('.json') && !arg.startsWith('--'));

function fail(message) {
  console.error(`export-personality: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) fail(`no config at ${SOURCE}`);
let config;
try {
  config = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
} catch (error) {
  fail(`could not read ${SOURCE}: ${error.message}`);
}

const out = {};
for (const [key, value] of Object.entries(config)) {
  if (THIS_MACHINE.includes(key)) continue;
  if (typeof value === 'string' && (value.startsWith('enc:') || value.startsWith('plain:'))) continue;
  out[key] = value;
}

if (!withChat) {
  delete out.chat;
  console.warn('stripped chat.archive, chat.messages and chat.asides (use --with-chat to keep them)');
}
if (!withCheckins && out.checkins) {
  console.warn(`stripped ${Array.isArray(out.checkins?.entries) ? out.checkins.entries.length : '?'} check-in note(s) (use --with-checkins to keep them)`);
  delete out.checkins;
}

const target = outArg || path.join(path.dirname(SOURCE), 'haru-personality.json');
fs.writeFileSync(target, JSON.stringify(out, null, 2));
const size = (fs.statSync(target).size / 1024).toFixed(1);
console.log(`wrote ${target} (${size} KB)`);
console.log(`memory: ${out.memories?.length ?? 0}, sessions: ${out.memory?.sessions?.length ?? 0}, kept: ${out.kept?.items?.length ?? 0}, haunts: ${Object.keys(out.haunts ?? {}).length}`);
if (!out.profile || !out.profile.nickname) console.warn('no profile in the export — this looks like an empty store');