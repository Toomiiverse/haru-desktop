/**
 * His own shell from the phone's Code tab, as if he had SSHed in. One tmux session ("main") on a socket of
 * its own, so a dropped phone socket (the app backgrounded, a tunnel blip) reattaches to the same shell.
 * The tmux server runs as its own user unit, not under Haru's service: a deploy restart does not kill his
 * shell, and it does not inherit the service's NoNewPrivileges, so sudo works as it would over SSH.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import type { WebSocket } from 'ws';

const run = promisify(execFile);
const UNIT = 'haru-phone-shell';

/** The tmux socket, explicit so the client can never start a server of its own inside the service. */
export function terminalSocket(runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`) {
  return `${runtimeDir}/haru-phone.tmux`;
}

/** Node has no PTY of its own; Python's stdlib does. stdin/stdout are the bytes, fd 3 takes "rows cols" lines. */
export const PTY = `
import os, pty, select, struct, fcntl, termios, signal, sys
rows, cols = int(sys.argv[1]), int(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[3], sys.argv[3:])
def size(r, c): fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
def out(d):
    while d: d = d[os.write(1, d):]
size(rows, cols)
watch, rest = [0, 3, fd], b''
try:
    while True:
        for r in select.select(watch, [], [])[0]:
            d = os.read(r, 65536)
            if r == fd:
                if not d: raise EOFError
                out(d)
            elif r == 0:
                if not d: raise EOFError
                os.write(fd, d)
            elif not d: watch.remove(3)
            else:
                *lines, rest = (rest + d).split(b'\\n')
                for line in lines:
                    r2, c2 = map(int, line.split()); size(max(r2, 2), max(c2, 10))
except (EOFError, OSError):
    pass
os.kill(pid, signal.SIGHUP)
`;

async function ensureServer(socket: string) {
  // -D below keeps tmux in the foreground, so the unit is up exactly while the server is.
  if (await run('systemctl', ['--user', 'is-active', '--quiet', UNIT]).then(() => true, () => false) && existsSync(socket)) return;
  // A socket left by a dead server would let the client start a server of its own, inside Haru's service.
  rmSync(socket, { force: true });
  await run('systemd-run', ['--user', '--quiet', '--collect', `--unit=${UNIT}`, 'tmux', '-S', socket, '-D']).catch(() => {});
  for (let i = 0; i < 40 && !existsSync(socket); i++) await new Promise(r => setTimeout(r, 50));
  if (!existsSync(socket)) throw new Error('The shell server did not start.');
}

/** Binary frames are keystrokes and screen bytes; a text frame {"resize":[cols,rows]} follows the phone's size. */
export async function openTerminal(ws: WebSocket, { cols, rows, home }: { cols: number; rows: number; home: string }) {
  const socket = terminalSocket();
  try { await ensureServer(socket); }
  catch (error) { ws.close(1011, error instanceof Error ? error.message : 'No shell.'); return; }
  const fit = (n: unknown, low: number, fallback: number) => Number.isFinite(Number(n)) ? Math.min(500, Math.max(low, Math.round(Number(n)))) : fallback;
  // The client only draws; the shells live in the server, with the server's (his login's) environment, not Haru's.
  const child = spawn('python3', ['-c', PTY, String(fit(rows, 2, 24)), String(fit(cols, 10, 80)), 'tmux', '-S', socket, 'new-session', '-A', '-s', 'main', '-c', home], {
    cwd: home, stdio: ['pipe', 'pipe', 'ignore', 'pipe'],
    env: { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'C.UTF-8', USER: process.env.USER ?? '', TERM: 'xterm-256color' },
  });
  const control = child.stdio[3] as NodeJS.WritableStream;
  let paused = false;
  child.stdout!.on('data', (bytes: Buffer) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(bytes, { binary: true }, () => { if (paused && ws.bufferedAmount < 256 * 1024) { paused = false; child.stdout!.resume(); } });
    // A `cat` of a big file must not pile megabytes into the socket faster than the phone takes them.
    if (ws.bufferedAmount > 1024 * 1024) { paused = true; child.stdout!.pause(); }
  });
  child.stdin!.on('error', () => {}); control.on('error', () => {});
  ws.on('message', (data: Buffer, binary: boolean) => {
    if (binary) { child.stdin!.write(data); return; }
    try {
      const size = JSON.parse(data.toString()).resize;
      if (Array.isArray(size)) control.write(`${fit(size[1], 2, 24)} ${fit(size[0], 10, 80)}\n`);
    } catch { /* not a control frame */ }
  });
  // Closing the phone detaches; the shell keeps running in tmux for next time.
  ws.on('close', () => child.kill());
  child.on('exit', () => { if (ws.readyState === ws.OPEN) ws.close(1000, 'Shell closed.'); });
}
