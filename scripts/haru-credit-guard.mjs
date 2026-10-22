#!/usr/bin/env node
// Tells his phone when one of the paid services she runs on is low or out.
//
// Two kinds of check, hourly:
//  - balance: providers with a free, read-only balance endpoint (Venice,
//    DeepSeek, Moonshot, OpenRouter). Warn once below LOW, again when out.
//  - refusals: providers with no balance endpoint (Baseten, Anthropic,
//    abliteration.ai). Her own task ledger records each refused call; a
//    payment refusal newer than that provider's last success means it is out.
//    Haru's own spending caps (daily_budget_exceeded, pool_budget_exceeded)
//    are hers, not the provider's, and never count.
//
// A level only alerts when it gets worse than what he was last told; it
// re-arms when the provider is back to ok. A failed check never alerts.
// HARU_WATCHDOG_DRY=1 logs instead of sending. `--selftest` checks the rules.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const LOW = Number(process.env.HARU_CREDIT_LOW_USD || 2);
const OUT = 0.25;
const ENV_FILE = process.env.HARU_CREDIT_ENV || path.join(homedir(), 'litellm/.env');
const TASKS_DB = process.env.HARU_TASKS_DB || path.join(homedir(), 'haru-core/data/haru-tasks.db');
const STATE = process.env.HARU_CREDIT_STATE || path.join(homedir(), '.local/state/haru-credit-guard.json');
const WINDOW_MS = 3 * 3600_000;   // a refusal older than this, with no traffic since, is not news
const TAG = '[credit-guard]';

// What each provider is for, said in the alert so he knows what has stopped.
const USES = {
  Baseten: 'her chat replies and tool planning',
  Venice: 'her mood reads and explorations',
  Anthropic: 'picture reading and weekly reviews on Opus',
  'abliteration.ai': 'her explorations',
  DeepSeek: 'the overnight route',
  Moonshot: 'the study route (Kimi)',
  OpenRouter: 'the MiMo coder',
};
const BALANCES = {
  Venice: { key: 'VENICE_API_KEY', url: 'https://api.venice.ai/api/v1/api_keys/rate_limits',
    read: j => ({ usd: Number(j.data?.balances?.USD), refused: j.data?.accessPermitted === false }) },
  DeepSeek: { key: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/user/balance',
    read: j => ({ usd: Number((j.balance_infos ?? []).find(b => b.currency === 'USD')?.total_balance), refused: j.is_available === false }) },
  Moonshot: { key: 'MOONSHOT_API_KEY', url: 'https://api.moonshot.ai/v1/users/me/balance',
    read: j => ({ usd: Number(j.data?.available_balance), refused: false }) },
  OpenRouter: { key: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/credits',
    read: j => ({ usd: Number(j.data?.total_credits) - Number(j.data?.total_usage), refused: false }) },
};
// Payment refusals as each provider words them (seen in the ledger, Oct 2026).
const PAYMENT = /insufficient usd or diem balance|credit balance is too low|not in good standing|check your current payment status|payment required/i;
const HOSTS = { 'inference.baseten.co': 'Baseten', 'api.venice.ai': 'Venice', 'api.anthropic.com': 'Anthropic', 'api.abliteration.ai': 'abliteration.ai',
  'api.deepseek.com': 'DeepSeek', 'api.moonshot.ai': 'Moonshot', 'openrouter.ai': 'OpenRouter' };
export function providerOf(model, reason = '') {
  const host = /^\S+ at (\S+) — /.exec(reason)?.[1];
  if (host && HOSTS[host]) return HOSTS[host];
  if (/anthropic/i.test(reason)) return 'Anthropic';
  if (/venice\.ai/i.test(reason)) return 'Venice';
  const m = String(model).toLowerCase();
  if (m.startsWith('zai-org/') || m.startsWith('deepseek-ai/')) return 'Baseten';
  if (m.startsWith('claude-')) return 'Anthropic';
  if (m.includes('abliterated-model')) return m.startsWith('abliteration-') ? 'Venice' : 'abliteration.ai';
  if (m.startsWith('olafangensan') || m.startsWith('venice-') || m === 'deepseek-v4-1-flash') return 'Venice';
  return null;
}

export function balanceLevel({ usd, refused }) {
  if (refused || usd < OUT) return 'out';
  return usd < LOW ? 'low' : 'ok';
}
/** out when the newest payment refusal is recent and no success came after it. */
export function refusalLevel(lastRefusal, lastSuccess, now) {
  return lastRefusal && now - lastRefusal <= WINDOW_MS && lastRefusal > (lastSuccess ?? 0) ? 'out' : 'ok';
}
const RANK = { ok: 0, low: 1, out: 2 };
export function decide(prev, now) { return { alert: RANK[now] > RANK[prev ?? 'ok'], level: now }; }
export function message(provider, lvl, usd) {
  const what = USES[provider] ?? 'some of her routes';
  if (lvl === 'low') return `${provider} is down to $${usd.toFixed(2)}. When it runs out, ${what} will stop working. Top it up soon.`;
  return `${provider} is out of credit${usd === undefined ? '' : ` ($${usd.toFixed(2)})`}. ${what[0].toUpperCase() + what.slice(1)} won't work until it's topped up.`;
}

if (process.argv.includes('--selftest')) {
  assert.equal(balanceLevel({ usd: 9.89, refused: false }), 'ok');
  assert.equal(balanceLevel({ usd: 1.5, refused: false }), 'low');
  assert.equal(balanceLevel({ usd: 0.066, refused: false }), 'out');
  assert.equal(balanceLevel({ usd: 5, refused: true }), 'out');
  const t = 1_800_000_000_000;
  assert.equal(refusalLevel(t - 60_000, t - 3600_000, t), 'out');
  assert.equal(refusalLevel(t - 3600_000, t - 60_000, t), 'ok');          // recovered since
  assert.equal(refusalLevel(t - 4 * 3600_000, null, t), 'ok');            // stale
  assert.equal(refusalLevel(null, null, t), 'ok');
  assert.deepEqual(decide(undefined, 'out'), { alert: true, level: 'out' });
  assert.deepEqual(decide('low', 'low'), { alert: false, level: 'low' });
  assert.deepEqual(decide('out', 'ok'), { alert: false, level: 'ok' });
  assert.equal(providerOf('zai-org/GLM-5.3-Fast', 'zai-org/GLM-5.3-Fast at inference.baseten.co — please check your current payment status.'), 'Baseten');
  assert.equal(providerOf('claude-opus-5-5', 'Your credit balance is too low to access the Anthropic API.'), 'Anthropic');
  assert.equal(providerOf('abliterated-model-large-v2', 'abliterated-model-large-v2 at api.abliteration.ai — Billing account is not in good standing'), 'abliteration.ai');
  assert.equal(providerOf('olafangensan-glm-4.7-flash-heretic', 'Insufficient USD or Diem balance'), 'Venice');
  assert.ok(PAYMENT.test('Your credit balance is too low to access the Anthropic API'));
  assert.ok(!PAYMENT.test('zai-org/GLM-5.3-Fast at inference.baseten.co — daily_budget_exceeded (Setup → x)'));
  assert.match(message('Baseten', 'out'), /chat replies/);
  console.log(`${TAG} selftest ok`);
  process.exit(0);
}

function keys() {
  const out = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
async function balances() {
  const env = keys(), out = {};
  for (const [name, b] of Object.entries(BALANCES)) {
    if (!env[b.key]) continue;
    try {
      const r = await fetch(b.url, { headers: { authorization: 'Bearer ' + env[b.key] }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const reading = b.read(await r.json());
      if (!Number.isFinite(reading.usd)) throw Error('no balance in reply');
      out[name] = { ...reading, level: balanceLevel(reading) };
    } catch (error) {
      console.warn(`${TAG} ${name}: could not read the balance (${error instanceof Error ? error.message : error})`);
    }
  }
  return out;
}
function refusals(now) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(TASKS_DB, { readOnly: true });
  try {
    const since = now - 24 * 3600_000, seen = {};
    for (const row of db.prepare('SELECT model, status, reason, updatedAt FROM tasks WHERE updatedAt >= ? AND updatedAt <= ?').all(since, now)) {
      const p = providerOf(row.model, row.reason ?? '');
      if (!p || BALANCES[p]) continue;   // balance-checked providers are judged by their balance
      const s = (seen[p] ??= { lastRefusal: null, lastSuccess: null });
      if (row.status === 'completed') s.lastSuccess = Math.max(s.lastSuccess ?? 0, row.updatedAt);
      else if (PAYMENT.test(row.reason ?? '')) s.lastRefusal = Math.max(s.lastRefusal ?? 0, row.updatedAt);
    }
    return Object.fromEntries(Object.entries(seen).map(([p, s]) => [p, { ...s, level: refusalLevel(s.lastRefusal, s.lastSuccess, now) }]));
  } finally { db.close(); }
}

const { alert } = await import('./haru-alert.mjs');
const now = Number(process.env.HARU_CREDIT_NOW) || Date.now();   // HARU_CREDIT_NOW: replay a past moment (testing)
let state = {};
try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch { /* first run */ }
const readings = { ...await balances() };
try { Object.assign(readings, refusals(now)); } catch (error) { console.warn(`${TAG} could not read her task ledger (${error instanceof Error ? error.message : error})`); }
const next = { ...state };
for (const [provider, r] of Object.entries(readings)) {
  const { alert: tell, level } = decide(state[provider]?.level, r.level);
  console.log(`${TAG} ${provider}: ${r.usd !== undefined ? '$' + r.usd.toFixed(2) + ' ' : ''}${level}${tell ? ' — alerting' : ''}`);
  // Only remember a worse level once he has actually been told, so a failed push retries next hour.
  const told = tell ? await alert(message(provider, level, r.usd), { tag: TAG, collapse: 'haru-credit-' + provider.toLowerCase().replace(/[^a-z]/g, '') }) : false;
  if (!tell || told) next[provider] = { level, usd: r.usd ?? null, at: new Date(now).toISOString() };
}
mkdirSync(path.dirname(STATE), { recursive: true });
writeFileSync(STATE, JSON.stringify(next, null, 1));
