// One line to his phone through Apple, for the scripts that run beside her
// (the watchdog, the Venice balance guard).
//
// The phone's push token lives in Core's authority config. The old desktop
// config.json stopped being written on 2026-09-28, and its token went stale:
// every watchdog alert from 10-16 to 10-21 came back 410 Unregistered. So the
// live config is read from Core first (read-only), and the old file is only a
// fallback for a machine without Core.

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const apns = require('../dist-electron/apns.js');

const CORE_DB = process.env.HARU_CORE_DB || path.join(homedir(), 'haru-core/data/haru-core.db');
const CONFIG = process.env.HARU_CONFIG || path.join(homedir(), '.config', 'haru-desktop', 'config.json');
export const DRY = process.env.HARU_WATCHDOG_DRY === '1';

/** Her live settings: Core's authority config, else the old desktop file, else {}. */
export function liveConfig() {
  // Only a machine without Core may use the old file: its token is known stale,
  // so a read failure here must be loud, not a quiet 410 later.
  if (!existsSync(CORE_DB)) {
    try { return JSON.parse(readFileSync(CONFIG, 'utf8')); } catch { return {}; }
  }
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(CORE_DB, { readOnly: true });
    try {
      const row = db.prepare("SELECT body FROM authority_documents WHERE name = 'config'").get();
      if (row?.body) return JSON.parse(row.body);
      console.warn(`[alert] Core at ${CORE_DB} has no 'config' document`);
    } finally { db.close(); }
  } catch (error) {
    console.warn(`[alert] could not read Core config at ${CORE_DB}:`, error instanceof Error ? error.message : error);
  }
  return {};
}

/** One line to every phone that asked. The 'system' switch can refuse it; the
 *  quiet hours cannot — an outage is not a nudge (the same rule the app keeps).
 *  One collapse id per kind, so a long outage stays a single notification. */
export async function alert(text, { tag = '[watchdog]', collapse = 'haru-system' } = {}) {
  const c = liveConfig();
  if (c?.push?.prefs?.system === false) { console.log(`${tag} system pushes are off — not alerting`); return false; }
  const conf = apns.readApnsConfig(c.apns);
  const devices = apns.readApnsDevices(c.apns?.devices);
  if (!conf || !devices.length) { console.warn(`${tag} nothing to alert with — no APNs device configured`); return false; }
  if (DRY) { console.log(`${tag} DRY would alert: ${text}`); return true; }
  const jwt = apns.apnsSigner(conf)();
  const payload = apns.apnsPayload('Haru 🌸', text, '/', collapse, { kind: 'system' });
  let sent = false;
  for (const device of devices) {
    try {
      const result = await apns.sendApns(device, payload, conf, jwt, collapse);
      console.log(`${tag} alert to "${String(device.name).slice(0, 40)}": ${result.status}${result.reason ? ` ${result.reason}` : ''}`);
      sent ||= result.status === 200;
    } catch (error) {
      console.warn(`${tag} could not reach Apple:`, error instanceof Error ? error.message : error);
    }
  }
  return sent;
}
