#!/usr/bin/env node
// Makes (or re-makes) the EVI configuration on Hume's side: her cloned voice,
// the brain hook's URL, and the timeouts that keep a forgotten call short.
//
//   node scripts/evi-config.mjs                       # create, print the id
//   node scripts/evi-config.mjs --config-id <id>      # new version of an existing one
//   node scripts/evi-config.mjs --url https://…:8443/api/evi/chat/completions
//   node scripts/evi-config.mjs --voice <octave voice id>
//
// Reads the Hume key from config.json (the plain: form this box stores it in)
// and never prints it. The hook secret is not Hume's to keep — it is sent in
// session settings at the start of every call (see evi.ts) — so nothing here
// touches it. Then: scripts/install-evi.sh <the id it prints>.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

// Hume is further than 250 ms from here; see the same line in main.ts.
setDefaultAutoSelectFamilyAttemptTimeout(5_000);

const HARU_CLONE_VOICE = 'c84f5efd-f6ab-40d4-9a47-23f27cfaa524';
const DEFAULT_URL = 'https://haruserver.tail6da04d.ts.net:8443/api/evi/chat/completions';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const url = flag('--url', DEFAULT_URL);
const voice = flag('--voice', HARU_CLONE_VOICE);
const existing = flag('--config-id', '');
if (!/^https:\/\/.+\/chat\/completions$/.test(url)) { console.error('The hook URL must be https and end in /chat/completions:', url); process.exit(2); }

const cfg = JSON.parse(readFileSync(`${homedir()}/.config/haru-desktop/config.json`, 'utf8'));
const stored = String(cfg.humeApiKey ?? '');
if (!stored.startsWith('plain:')) { console.error('humeApiKey is not stored in the plain: form this script can read.'); process.exit(2); }
const apiKey = stored.slice('plain:'.length);

// Her words come from the hook, and Hume refuses a prompt beside a custom
// language model ("Prompt use is not supported"), so there is none: the
// voice carries the delivery.
const body = {
  evi_version: '3',
  name: 'Haru',
  voice: { provider: 'CUSTOM_VOICE', id: voice },
  language_model: { model_provider: 'CUSTOM_LANGUAGE_MODEL', model_resource: url },
  ellm_model: { allow_short_responses: false },
  event_messages: {
    on_new_chat: { enabled: false },
    on_inactivity_timeout: { enabled: false },
    on_max_duration_timeout: { enabled: false },
  },
  timeouts: {
    inactivity: { enabled: true, duration_secs: 300 },
    max_duration: { enabled: true, duration_secs: 1800 },
  },
  nudges: { enabled: false },
};

const target = existing ? `https://api.hume.ai/v0/evi/configs/${encodeURIComponent(existing)}` : 'https://api.hume.ai/v0/evi/configs';
const response = await fetch(target, {
  method: 'POST',
  headers: { 'X-Hume-Api-Key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await response.text();
if (!response.ok) { console.error(`Hume said ${response.status}:`, text.slice(0, 600)); process.exit(1); }
const made = JSON.parse(text);
console.log(`config id: ${made.id}`);
console.log(`version:   ${made.version}`);
console.log(`voice:     ${made.voice?.name ?? made.voice?.id ?? voice}`);
console.log(`hook:      ${made.language_model?.model_resource ?? url}`);
console.log(`next:      scripts/install-evi.sh ${made.id} ${url}`);
