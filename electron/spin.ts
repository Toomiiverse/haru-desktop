import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Haru working Spin, the user's music player, from her own screen. Spin runs a small control server on 127.0.0.1
 * (spin-desktop electron/control.ts) and leaves its port and a token in APPDATA/spin-desktop/control.json. This
 * starts Spin hidden when it is not running, sends it her commands, and passes on everything it reports (state, the
 * song's lyrics and singing track, levels) for her HUD; the HUD's own open/fold/command beats are sent the same way.
 */
export type MusicAction = 'open' | 'play' | 'pause' | 'resume' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'close';
export const MUSIC_ACTIONS: MusicAction[] = ['open', 'play', 'pause', 'resume', 'next', 'previous', 'volume_up', 'volume_down', 'close'];
type Control = { port: number; token: string };
export type MusicEvent = { type: string } & Record<string, unknown>;

const controlFile = () => path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'spin-desktop', 'control.json');
// Spin from its source folder (the build the user runs) if it is there, else the installed copy.
const SPIN_SOURCE = path.join(os.homedir(), 'spin-desktop');
const SPIN_INSTALLED = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'spin-desktop', 'Spin.exe');
const VOLUME_STEP = 0.15, LAUNCH_WAIT_MS = 25_000;

function readControl(): Control | null {
  try {
    const value = JSON.parse(readFileSync(controlFile(), 'utf8')) as Partial<Control>;
    return typeof value.port === 'number' && typeof value.token === 'string' ? { port: value.port, token: value.token } : null;
  } catch { return null; }
}

function launchSpin(): boolean {
  const electron = path.join(SPIN_SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe');
  const [file, args] = existsSync(electron) && existsSync(path.join(SPIN_SOURCE, 'dist-electron', 'main.js')) ? [electron, [SPIN_SOURCE, '--hidden']]
    : existsSync(SPIN_INSTALLED) ? [SPIN_INSTALLED, ['--hidden']] : [null, []];
  if (!file) return false;
  spawn(file, args as string[], { cwd: file === electron ? SPIN_SOURCE : path.dirname(file), detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

export function createSpin(onEvent: (event: MusicEvent) => void) {
  let connected: Control | null = null;
  let playing = false, hasSong = false;

  // Spin's reports as they come: kept on one open stream while Spin runs.
  async function listen(control: Control): Promise<boolean> {
    let response: Response;
    try { response = await fetch(`http://127.0.0.1:${control.port}/events?token=${control.token}`); } catch { return false; }
    if (!response.ok || !response.body) return false;
    connected = control;
    void (async () => {
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (!block.startsWith('data: ')) continue;
            const event = JSON.parse(block.slice(6)) as MusicEvent;
            if (event.type === 'state') { playing = Boolean(event.playing); hasSong = Boolean(event.song); }
            onEvent(event);
          }
        }
      } catch { /* Spin closed */ }
      if (connected === control) connected = null;
      onEvent({ type: 'gone' });
    })();
    return true;
  }

  // Spin reachable, started hidden if it is not running (its single-instance lock makes a second start harmless).
  async function ensure(): Promise<Control | null> {
    if (connected) return connected;
    const known = readControl();
    if (known && await listen(known)) return known;
    if (!launchSpin()) return null;
    const until = Date.now() + LAUNCH_WAIT_MS;
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const control = readControl();
      if (control && control.token !== known?.token && await listen(control)) return control;
    }
    return null;
  }

  async function send(control: Control, cmd: string, value?: string | number) {
    try {
      const response = await fetch(`http://127.0.0.1:${control.port}/command`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-spin-token': control.token }, body: JSON.stringify({ cmd, value }), signal: AbortSignal.timeout(4000),
      });
      return response.ok;
    } catch { connected = null; return false; }
  }

  /** One of her music actions: the HUD is told first (it opens, reacts or folds), then Spin acts. */
  async function run(action: MusicAction, query = '') {
    if (action === 'close') { onEvent({ type: 'fold' }); if (connected) await send(connected, 'pause'); return; }
    onEvent({ type: action === 'open' || action === 'play' ? 'open' : 'command', action, query });
    const control = await ensure();
    if (!control) { onEvent({ type: 'notice', text: 'Spin is not available on this PC' }); return; }
    if (action === 'open') { if (!playing) await send(control, hasSong ? 'resume' : 'play', ''); }
    else if (action === 'play') await send(control, 'play', query);
    else if (action === 'pause') await send(control, 'pause');
    else if (action === 'resume') await send(control, 'resume');
    else if (action === 'next') await send(control, 'next');
    else if (action === 'previous') await send(control, 'previous');
    else if (action === 'volume_up') await send(control, 'volumeBy', VOLUME_STEP);
    else if (action === 'volume_down') await send(control, 'volumeBy', -VOLUME_STEP);
  }

  return { run };
}
