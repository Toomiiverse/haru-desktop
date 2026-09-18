// The Linux side of the machine controls.
//
// Everything in desktop.ts was written for Windows and said so: PowerShell for
// the running windows, the Start Menu for what can be opened, cmd/taskkill/
// shutdown for the power actions. None of that exists here, and the startup
// capability report used to name all five features off on Linux. This is the
// other half, done the way a Linux desktop actually answers the same questions:
//
//   what is in front of them   Hyprland's `hyprctl -j`, the same JSON its own
//                              dispatchers read
//   what is open               `hyprctl -j clients`
//   what can be opened         the freedesktop `.desktop` entries, launched
//                              through `gio`
//   the output volume          PipeWire's `wpctl`, or `pactl` where it is not
//   power, sleep, lock         systemd: `shutdown`, `systemctl`, `loginctl`
//
// Nothing here decides anything. It returns plain data and plain commands, and
// the platform switch lives in desktop.ts and capabilities.ts, the same way the
// Windows code returns its commands rather than running them — so the parsing
// can be tested against captured output with no compositor in sight.
//
// A location fix is deliberately absent: the only supported route is the
// GeoClue portal, which needs a session portal client this app does not have.
// The capability line says so rather than shipping a Wi-Fi geolocation to a
// third party nobody asked.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App, PowerAction, Running } from './desktop';

/** What a command answered, with a failed spawn normalised to code -1. */
export type Answer = { out: string; code: number };

/**
 * Run it and read it. Async rather than spawnSync because the caller is the
 * Electron main process: `hyprctl` is fast but it is not free, and a poll that
 * blocks the UI thread every second is a poll that is felt.
 */
export function run(file: string, args: string[], timeoutMs = 4000): Promise<Answer> {
  return new Promise(resolve => {
    let out = '';
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ out, code });
    };
    const child = spawn(file, args, { windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish(-1); }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    // A missing binary is an answer too — "not installed", not a throw.
    child.on('error', () => finish(-1));
    child.on('close', code => finish(code ?? -1));
  });
}

/** Is this command on PATH? Detection, not execution. */
export function onPath(command: string, pathEnv = process.env.PATH ?? ''): boolean {
  return pathEnv.split(path.delimiter).some(dir => dir !== '' && existsSync(path.join(dir, command)));
}

export type LinuxSupport = {
  /** A compositor that can say what is in front of them (Hyprland). */
  foreground: boolean;
  /** Something that can read and set the output volume. */
  audio: boolean;
  /** Something that can launch a `.desktop` entry. */
  apps: boolean;
  /** systemd/logind for power, sleep and lock. */
  power: boolean;
};

/**
 * What this Linux machine can actually do. Named once, here, so the capability
 * report, the desktop switch and the helper all answer from the same fact.
 */
export function detectLinuxSupport(): LinuxSupport {
  return {
    foreground: onPath('hyprctl'),
    audio: onPath('wpctl') || onPath('pactl'),
    apps: onPath('gio') || onPath('gtk-launch'),
    power: onPath('systemctl') || onPath('loginctl'),
  };
}

// -- what is in front of them -------------------------------------------------

export type ActiveWindow = {
  process: string;
  title: string;
  fullscreen: boolean;
  left: number; top: number; right: number; bottom: number;
};

/**
 * `hyprctl -j activewindow`, read into the shape the helper protocol uses.
 *
 * Hyprland reports `fullscreen` as 0 for none, 1 for maximised, 2 for a real
 * fullscreen and 3 for both; anything non-zero is what the moment is about. The
 * window carries its own rectangle, so the geometry is the window's rather than
 * the monitor's — the same thing the Windows helper measures, and the thing
 * `watchGaze` wants when deciding where she should look.
 */
export function parseActiveWindow(json: string): ActiveWindow | null {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const win = raw as { class?: string; title?: string; fullscreen?: number; at?: number[]; size?: number[] };
  const process = (win.class ?? '').trim();
  const [x, y] = Array.isArray(win.at) ? win.at.map(Number) : [NaN, NaN];
  const [w, h] = Array.isArray(win.size) ? win.size.map(Number) : [NaN, NaN];
  // No class at all is the empty `{}` Hyprland answers with when nothing is
  // focused, which is "nothing there", not a window called "".
  if (!process && !(win.title ?? '').trim()) return null;
  return {
    process,
    title: (win.title ?? '').trim(),
    fullscreen: Number(win.fullscreen ?? 0) !== 0,
    left: x, top: y,
    // Inclusive-ish edges: a hair inside the window still counts, the way the
    // Windows helper allows a pixel of slack.
    right: Number.isFinite(x) && Number.isFinite(w) ? x + w : NaN,
    bottom: Number.isFinite(y) && Number.isFinite(h) ? y + h : NaN,
  };
}

export async function activeWindow(): Promise<ActiveWindow | null> {
  const { out, code } = await run('hyprctl', ['-j', 'activewindow']);
  if (code !== 0) return null;
  return parseActiveWindow(out);
}

/**
 * Every windowed program, as `<name>|<title>` pairs. A class is what the
 * desktop calls the program — "firefox", "steam_app_1091500" — which is the
 * same key `gameFor` and `matchRunning` already match against.
 */
export function parseClients(json: string): Running[] {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, Running>();
  for (const item of raw) {
    const rec = item as { class?: string; title?: string };
    const name = (rec.class ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, title: (rec.title ?? '').trim() });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function running(): Promise<Running[]> {
  const { out, code } = await run('hyprctl', ['-j', 'clients']);
  if (code !== 0) return [];
  return parseClients(out);
}

/** Ask it to close, the same politeness as Windows' taskkill without /F. */
export async function closeApp(app: Running): Promise<void> {
  await run('hyprctl', ['dispatch', 'closewindow', `class:^(${app.name})$`]);
}

// -- what can be opened ------------------------------------------------------

/** Where a desktop keeps its applications, per-user first. */
export const APP_DIRS = [
  path.join(os.homedir(), '.local/share/applications'),
  '/usr/local/share/applications',
  '/usr/share/applications',
  path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
  '/var/lib/flatpak/exports/share/applications',
  '/var/lib/snapd/desktop/applications',
];

/** Things that are in the menu and are not what anyone means. */
const NOT_AN_APP = /(uninstall|readme|release notes|help|documentation|website|homepage|manual|support|report a bug|licence|license)/i;

/**
 * The `Name` and `Exec` a `.desktop` file offers, or null when it is not a
 * thing to open. `NoDisplay`/`Hidden` entries are exactly the "not an app"
 * the Windows side filters by name, and `Type=Application` is the difference
 * between a launcher and a link to a web page.
 */
export function parseDesktopEntry(text: string): { name: string; exec: string } | null {
  let name = '';
  let exec = '';
  let type = '';
  let hidden = false;
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 0 || line.startsWith('#')) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    // Localised keys (Name[de]) are skipped; the plain one is the fallback
    // every desktop reads, and it is the one this app can reason about.
    if (key === 'Name') name ||= value;
    else if (key === 'Exec') exec ||= value;
    else if (key === 'Type') type = value;
    else if (key === 'NoDisplay' || key === 'Hidden') hidden ||= value.toLowerCase() === 'true';
  }
  if (hidden || type !== 'Application' || !name || !exec) return null;
  return { name, exec };
}

export function findApps(
  roots = APP_DIRS,
  readdir: (dir: string) => string[] = dir => readdirSync(dir) as unknown as string[],
  readFile: (file: string) => string = file => readFileSync(file, 'utf8'),
  exists: (file: string) => boolean = existsSync,
): App[] {
  const found = new Map<string, App>();
  for (const root of roots) {
    if (!exists(root)) continue;
    let entries: string[] = [];
    try { entries = readdir(root); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith('.desktop')) continue;
      const full = path.join(root, entry);
      let parsed: { name: string; exec: string } | null = null;
      try { parsed = parseDesktopEntry(readFile(full)); } catch { continue; }
      if (!parsed) continue;
      if (NOT_AN_APP.test(parsed.name)) continue;
      // First wins, so the per-user menu beats the machine-wide one.
      const key = parsed.name.toLowerCase();
      if (!found.has(key)) found.set(key, { name: parsed.name, target: full });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Opened through `gio`, which understands the entry's own `Exec` line —
 * including the field codes, which a hand-rolled split would mangle.
 */
export function launch(app: App): void {
  const child = spawn('gio', ['launch', app.target], { detached: true, stdio: 'ignore' });
  child.unref();
}

// -- the output volume -------------------------------------------------------

/** "Volume: 0.35" or "Volume: 0.35 [MUTED]". */
export function parseWpctlVolume(text: string): number | null {
  const match = /Volume:\s*([0-9]*\.?[0-9]+)/.exec(text ?? '');
  if (!match) return null;
  const level = Number(match[1]);
  return Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : null;
}

/** "front-left: 32768 /  50% / ..." — the first percentage is the sink's. */
export function parsePactlVolume(text: string): number | null {
  const match = /Volume:.*?(\d+)%/.exec(text ?? '');
  if (!match) return null;
  const level = Number(match[1]) / 100;
  return Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : null;
}

export async function readVolume(): Promise<number | null> {
  if (onPath('wpctl')) {
    const { out, code } = await run('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@']);
    if (code === 0) return parseWpctlVolume(out);
  }
  if (onPath('pactl')) {
    const { out, code } = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    if (code === 0) return parsePactlVolume(out);
  }
  return null;
}

/** The duck. Acknowledged only once the change has actually gone in. */
export async function setVolume(level: number): Promise<void> {
  const clamped = Math.max(0, Math.min(1, level));
  if (onPath('wpctl')) {
    const { code } = await run('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', clamped.toFixed(3)]);
    if (code === 0) return;
  }
  if (onPath('pactl')) await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${Math.round(clamped * 100)}%`]);
}

// -- power, sleep and lock ---------------------------------------------------

/**
 * systemd's own words. A shutdown or restart is scheduled a minute out, which
 * is what makes it cancellable — `shutdown -c` is the same call-off Windows'
 * `shutdown /a` provides, and systemd posts its own wall warning in between.
 * Sleep and lock are instant and are undone by hand, so they carry no timer.
 */
export function powerCommand(action: PowerAction): { file: string; args: string[] } {
  switch (action) {
    case 'shutdown': return { file: 'shutdown', args: ['-h', '+1'] };
    case 'restart': return { file: 'shutdown', args: ['-r', '+1'] };
    case 'sleep': return { file: 'systemctl', args: ['suspend'] };
    case 'lock': return { file: 'loginctl', args: ['lock-session'] };
  }
}

export async function runPower(action: PowerAction): Promise<void> {
  const { file, args } = powerCommand(action);
  const child = spawn(file, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

export async function cancelPower(): Promise<void> {
  const child = spawn('shutdown', ['-c'], { detached: true, stdio: 'ignore' });
  child.unref();
}
