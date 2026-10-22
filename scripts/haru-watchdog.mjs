#!/usr/bin/env node
// The half of the outage alert that runs when she cannot.
//
// She cannot tell him she is unreachable — a process that is not answering is
// not a process that can send a message. So something outside her asks, every
// half minute, whether her door still answers; after three misses it says one
// line to his phone through Apple; and after three minutes down it tries one
// restart of her service. The moment she answers, it stops and writes down
// when, and she reads that note on the way back up to send the "I'm back" half
// (liveness.ts).
//
// It is deliberately small and dependency-free: it needs Node, the compiled
// liveness and apns modules (no Electron import in either), and nothing else.
// If the machine itself is off, none of this runs — the come-back note covers
// that case, because only she can speak once the machine is back.
//
// Run by scripts/haru-watchdog.timer. Set HARU_WATCHDOG_DRY=1 to log without
// sending or restarting.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { EMPTY_LIVENESS, probeOutcome, readLivenessFile, writeLivenessFile, unreachableMessage } = require('../dist-electron/liveness.js');
import { liveConfig as config, alert, DRY } from './haru-alert.mjs';

const DOOR = process.env.HARU_WATCHDOG_DOOR || 'http://127.0.0.1:8787/api/health';
const STATE_FILE = process.env.HARU_LIVENESS_FILE || undefined;
const SERVICE = process.env.HARU_WATCHDOG_SERVICE || 'haru.service';
if (!['haru.service', 'haru-core-python.service'].includes(SERVICE)) throw Error('invalid_watchdog_service');
const PROBE_TIMEOUT_MS = 5_000;

function serviceActive() {
  try { return execFileSync('systemctl', ['--user', 'is-active', SERVICE], { encoding: 'utf8' }).trim() === 'active'; }
  catch { return false; }
}

async function doorAnswers() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(DOOR, { signal: controller.signal });
    if (!response.ok) return false;
    if (SERVICE === 'haru-core-python.service') {
      const token = readFileSync(path.join(homedir(), 'haru-core/data/service-migration/service.token'), 'utf8').trim();
      const ready = await fetch('http://127.0.0.1:8791/ready', { signal: controller.signal, headers: { authorization: 'Bearer ' + token } });
      return ready.ok && (await ready.json()).ready === true;
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function webDoorEnabled(c) {
  return Boolean(c && c.webAccess && c.webAccess.enabled && c.webAccess.hash);
}

const now = Date.now();
const c = config();
const up = serviceActive() && ((SERVICE === 'haru-core-python.service' || webDoorEnabled(c)) ? await doorAnswers() : true);
const before = readLivenessFile(STATE_FILE) ?? EMPTY_LIVENESS;
const { state, action, restartNow } = probeOutcome(before, up, now);
writeLivenessFile(state, STATE_FILE);
console.log(`[watchdog] ${up ? 'up' : 'down'} — failures ${state.failures}${state.downSince ? `, down since ${new Date(state.downSince).toISOString()}` : ''}${action === 'alert-down' ? ', alerting' : ''}${restartNow ? ', restarting ' + SERVICE : ''}`);

if (action === 'alert-down') await alert(unreachableMessage());

if (restartNow) {
  if (DRY) { console.log('[watchdog] DRY would restart ' + SERVICE); }
  else {
    try { execFileSync('systemctl', ['--user', 'restart', SERVICE]); console.log('[watchdog] restarted ' + SERVICE); }
    catch (error) { console.warn('[watchdog] restart failed:', error instanceof Error ? error.message : error); }
  }
}
