#!/usr/bin/env node
// Giving her the second model on a machine with no Setup window.
//
// Setup is desktop-only, and on the server that means a remote desktop to an
// Xvfb screen nobody has. But everything Setup writes is two entries in
// config.json, and the key already has a headless format — the plain: prefix
// decryptSecret reads, kept exactly as readable as everything else in that
// file, which is why the file must be chmod 600 and this script makes it so.
//
// Run it ON the server, WITH HER STOPPED — one process, one writer, and the
// running app would overwrite this edit at its next save:
//
//   pkill -f "electron \."
//   node scripts/second-brain.cjs
//   ./update.sh
//
// The key is typed here and written straight to the file beside you. It does
// not travel anywhere except, later, to the provider it belongs to.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const PROVIDERS = {
  xai: { endpoint: 'https://api.x.ai/v1', keyField: 'remoteApiKey', hint: 'grok-4' },
  openai: { endpoint: 'https://api.openai.com/v1', keyField: 'openaiApiKey', hint: 'gpt-4o' },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = question => new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
const askHidden = question => new Promise(resolve => {
  process.stdout.write(question);
  const write = rl._writeToOutput;
  rl._writeToOutput = () => {};
  rl.question('', answer => { rl._writeToOutput = write; process.stdout.write('\n'); resolve(answer.trim()); });
});

(async () => {
  // One process, one writer. Refused rather than warned about.
  try {
    execSync('pgrep -f "electron \\\\."', { stdio: 'pipe' });
    console.error('She is running. Stop her first: pkill -f "electron \\."');
    process.exit(1);
  } catch { /* not running, which is what we need */ }

  const file = path.join(os.homedir(), '.config', 'haru-desktop', 'config.json');
  if (!fs.existsSync(file)) { console.error(`No ${file} — has she ever run here?`); process.exit(1); }
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));

  const name = (await ask('Which company answers the hard ones — xai or openai? ')).toLowerCase();
  const chosen = PROVIDERS[name];
  if (!chosen) { console.error('One of: xai, openai.'); process.exit(1); }

  const model = await ask(`Which model? It must be one that can see pictures (e.g. ${chosen.hint}): `) || chosen.hint;
  const key = await askHidden('The API key (typed blind, written only to config.json here): ');
  if (!key) { console.error('No key, no second model.'); process.exit(1); }

  // A wrong key fails later as a silent fallback to the local model, which is
  // the failure this whole script exists to end — so it is checked now.
  try {
    const answer = await fetch(`${chosen.endpoint}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!answer.ok) { console.error(`${chosen.endpoint} refused that key: ${answer.status}. Nothing written.`); process.exit(1); }
    const listed = ((await answer.json()).data ?? []).map(entry => entry.id);
    if (listed.length && !listed.includes(model)) {
      console.warn(`Note: "${model}" is not in the ${listed.length} models that key can list. Writing it anyway — the list is not always complete.`);
    } else {
      console.log('The key works.');
    }
  } catch (error) {
    console.error(`Could not reach ${chosen.endpoint}: ${error.message}. Nothing written.`);
    process.exit(1);
  }

  // The same two entries Setup writes, in the same shapes main.ts reads:
  // escalate carries the switch, the word bar and the provider in one object
  // (the dot-path trap), and the key sits top-level under its own field.
  const existing = (config.escalate && typeof config.escalate === 'object') ? config.escalate : {};
  config.escalate = {
    enabled: existing.enabled === true,
    minWords: typeof existing.minWords === 'number' ? existing.minWords : 25,
    provider: { provider: name, model, endpoint: chosen.endpoint },
  };
  config[chosen.keyField] = 'plain:' + key;

  fs.writeFileSync(file, JSON.stringify(config, null, '\t'));
  fs.chmodSync(file, 0o600);
  console.log(`Written. ${model} at ${chosen.endpoint}, key under ${chosen.keyField}, config.json now 600.`);
  console.log('Pictures and anything asked from the phone will go to it; desk chat stays local' +
    (config.escalate.enabled ? ' below ' + config.escalate.minWords + ' words.' : ' unless escalation is switched on in Setup.'));
  console.log('Now start her again: ./update.sh');
  rl.close();
})();
