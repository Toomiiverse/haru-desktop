// The decisions that follow the power source, kept pure so they can be checked
// without a battery, a plug or a compositor.
//
// Both of these are the difference between a desktop and a laptop: how long the
// local model is held in the card's memory, and how often the pointer is read
// when nobody is moving it. Neither wants an Electron dependency to answer.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** On mains: an always-on box does nothing else with that VRAM. */
export const KEEP_ALIVE_MAINS = -1;
/** On battery: long enough that a reply still starts talking, short enough that
 *  the card is released between conversations. */
export const KEEP_ALIVE_BATTERY = '5m';

export type PowerSource = 'battery' | 'mains' | 'unknown';

/** One entry of /sys/class/power_supply, as the files that matter. */
export type Supply = { type?: string; status?: string; online?: string };

/**
 * Whichever is true of the kernel's own reading.
 *
 * Electron's `powerMonitor.isOnBatteryPower()` is asked first everywhere it
 * works, but on this laptop it is wrong: with BAT1 discharging and ACAD offline
 * it still answers "on mains", because its Linux implementation goes through
 * UPower and this desktop's UPower does not report to it. The sysfs reading is
 * the same source UPower reads from and cannot be wrong about the plug — so on
 * Linux that is the one that counts.
 *
 * A battery that is not discharging means charging or full, both of which are
 * mains; no battery at all is a desktop, also mains.
 */
export function powerSourceFrom(supplies: Supply[]): PowerSource {
  const batteries = supplies.filter(supply => (supply.type ?? '').trim().toLowerCase() === 'battery');
  if (batteries.some(battery => (battery.status ?? '').trim().toLowerCase() === 'discharging')) return 'battery';
  if (batteries.length) return 'mains';
  const mains = supplies.filter(supply => (supply.type ?? '').trim().toLowerCase() === 'mains');
  if (mains.length) return mains.some(supply => (supply.online ?? '').trim() === '1') ? 'mains' : 'unknown';
  return 'unknown';
}

export function readLinuxPowerSource(
  dir = '/sys/class/power_supply',
  readdir: (dir: string) => string[] = dir => readdirSync(dir) as unknown as string[],
  readFile: (file: string) => string = file => readFileSync(file, 'utf8'),
): PowerSource {
  let names: string[] = [];
  try { names = readdir(dir); } catch { return 'unknown'; }
  const supplies: Supply[] = names.map(name => {
    const read = (file: string) => { try { return readFile(path.join(dir, name, file)); } catch { return ''; } };
    return { type: read('type'), status: read('status'), online: read('online') };
  });
  return powerSourceFrom(supplies);
}

/**
 * What to ask Ollama for. `HARU_OLLAMA_KEEP_ALIVE` wins over both if set — as
 * seconds ("0" unloads between turns) or a Go duration ("10m").
 */
export function resolveKeepAlive(override: string | undefined, onBattery: boolean): number | string {
  const value = (override ?? '').trim();
  if (value) return /^-?\d+$/.test(value) ? Number(value) : value;
  return onBattery ? KEEP_ALIVE_BATTERY : KEEP_ALIVE_MAINS;
}

export const CURSOR_POLL_ACTIVE_MS = 33;
export const CURSOR_POLL_IDLE_MS = 250;
export const CURSOR_IDLE_AFTER_S = 30;

/**
 * How long to wait before reading the pointer again. Following it is what makes
 * her feel present, but a thirty-hertz poll of the whole screen for a cursor
 * that is not moving is a battery cost with nothing to show for it.
 */
export function cursorPollDelay(
  idleSeconds: number,
  activeMs = CURSOR_POLL_ACTIVE_MS,
  idleMs = CURSOR_POLL_IDLE_MS,
  idleAfterS = CURSOR_IDLE_AFTER_S,
): number {
  return idleSeconds >= idleAfterS ? idleMs : activeMs;
}
