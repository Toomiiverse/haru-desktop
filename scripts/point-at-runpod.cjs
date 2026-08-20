// Points her escalation at a RunPod serverless endpoint.
//
// The hard questions go out; everything else stays on whatever local model this
// machine runs. That split is the whole reason the server exists — sensitive
// things must never leave hardware you own, and they only stay put if the
// primary model is genuinely local.
//
// Reads from the environment, so the key never appears in a config-editing
// command that gets scrolled back to:
//   RUNPOD_API_KEY       your RunPod API key
//   RUNPOD_ENDPOINT_ID   the serverless endpoint id
//   RUNPOD_MODEL         optional; defaults to what check-runpod found
//
// Run check-runpod.cjs first. This writes config; that one tells you whether
// there is anything worth pointing at.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const key = (process.env.RUNPOD_API_KEY ?? '').trim();
const id = (process.env.RUNPOD_ENDPOINT_ID ?? '').trim();
const model = (process.env.RUNPOD_MODEL ?? 'Qwen/Qwen2.5-32B-Instruct-AWQ').trim();

if (!id) { console.error('  RUNPOD_ENDPOINT_ID is not set.'); process.exit(1); }

// Where electron-store keeps it, which differs per platform.
const CONFIG = process.platform === 'win32'
  ? path.join(process.env.APPDATA ?? '', 'haru-desktop', 'config.json')
  : path.join(os.homedir(), '.config', 'haru-desktop', 'config.json');

if (!fs.existsSync(CONFIG)) { console.error(`  no config at ${CONFIG} — has she ever run on this machine?`); process.exit(1); }

// She writes her whole config back on exit, so an edit made while she is
// running is silently undone. This has cost real work twice on this project.
console.log('  Make sure Haru is NOT running on this machine. Her config is rewritten on exit,');
console.log('  and an edit made underneath her is lost without a word.\n');

const raw = fs.readFileSync(CONFIG, 'utf8');
const config = JSON.parse(raw);

const backup = CONFIG.replace(/\.json$/, '.before-runpod.json');
if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw);

const before = config.escalate?.provider?.model ?? '(none)';
config.escalate = {
  ...(config.escalate ?? {}),
  enabled: true,
  minWords: config.escalate?.minWords ?? 30,
  provider: {
    provider: 'openai',
    model,
    endpoint: `https://api.runpod.ai/v2/${id}/openai/v1`,
    temperature: config.escalate?.provider?.temperature ?? 0.7,
  },
};

let wroteKey = false;
if (key) {
  if (process.platform === 'win32') {
    // Windows has a working keyring, so a key written here in the clear would be
    // a downgrade from what she already does. Refused rather than done quietly.
    console.log('  NOT writing the key: this machine can encrypt it properly.');
    console.log('  Put it in her settings under the self-hosted key instead, so it goes through safeStorage.');
  } else {
    // A headless box has no keyring, so this is the same "plain:" form she would
    // write herself. The file permissions below are the only thing protecting it.
    config.selfHostedApiKey = `plain:${key}`;
    wroteKey = true;
  }
}

fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

if (process.platform !== 'win32') {
  for (const file of [CONFIG, backup]) {
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  }
}

console.log(`  config:    ${CONFIG}`);
console.log(`  backup:    ${path.basename(backup)}`);
console.log(`  escalates: ${before} -> ${model}`);
console.log(`  endpoint:  ${config.escalate.provider.endpoint}`);
console.log(`  key:       ${wroteKey ? 'written as plain: (no keyring here) and the file is now chmod 600' : 'unchanged'}`);
console.log(`\n  Her primary model is untouched: ${config.ai?.config?.model ?? '(unset)'} at ${config.ai?.config?.endpoint ?? '(unset)'}`);
console.log('  That is deliberate. Only the hard questions go out; everything else stays here.');
