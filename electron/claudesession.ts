// A Claude Code session on this machine, opened at his word and driven from his phone.
//
// `claude --bg --remote-control <name>` starts a background session that shows
// up in the Claude app (Code) and at a claude.ai/code link. She opens, lists and
// stops them; everything that happens inside one is between him and Claude, in
// the Claude app, behind his own account and its own permission prompts.
//
// That is why she never hands a session a task. Her hands are off on the phone
// and on Discord because what she reads there can be somebody else's words
// (see handsAllowed in main.ts). An idle session nobody but him can drive is
// safe to open from anywhere; a session that starts working on a sentence she
// wrote is a shell a web page could reach. So: open, list, stop — nothing else.

import { realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ClaudeCodeConfig = {
  enabled: boolean;
  /** The CLI. Absolute, because the service's PATH does not include ~/.local/bin. */
  binary: string;
  /** Where a session works when she is not told a folder. */
  dir: string;
  /** Handed to --permission-mode; null leaves it to his own Claude settings. */
  permissionMode: string | null;
};

/** Every mode but bypassPermissions: skipping his prompts is his call to make in the app, not hers. */
export const CLAUDE_PERMISSION_MODES = ['acceptEdits', 'auto', 'default', 'dontAsk', 'plan'] as const;

export function readClaudeCodeConfig(saved: unknown, home = os.homedir()): ClaudeCodeConfig {
  const record = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');
  const mode = text(record.permissionMode);
  return {
    enabled: record.enabled === true,
    binary: text(record.binary) || path.join(home, '.local', 'bin', 'claude'),
    dir: text(record.dir) || home,
    permissionMode: (CLAUDE_PERMISSION_MODES as readonly string[]).includes(mode) ? mode : null,
  };
}

/** One she opened, kept so she can give the link back and stop only her own. */
export type OpenedSession = { id: string; name: string; dir: string; url: string | null; at: string };

export const SESSIONS_KEPT = 10;

export function readOpenedSessions(saved: unknown): OpenedSession[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry): entry is OpenedSession => Boolean(entry) && typeof entry === 'object'
      && typeof (entry as OpenedSession).id === 'string' && /^[0-9a-f]{8}$/.test((entry as OpenedSession).id)
      && typeof (entry as OpenedSession).dir === 'string' && typeof (entry as OpenedSession).at === 'string')
    .map(entry => ({ ...entry, name: typeof entry.name === 'string' ? entry.name : entry.id, url: typeof entry.url === 'string' ? entry.url : null }))
    .slice(-SESSIONS_KEPT);
}

/** `claude logs` is a terminal recording; the link is in there between colour codes. */
export function plainText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ' ').replace(/\x1b[\]P^_][\s\S]*?(?:\x07|\x1b\\)/g, ' ');
}

/** The short id `claude --bg` prints: "backgrounded · 2c4feebf (idle — send a prompt to start)". */
export function backgroundedId(stdout: string): string | null {
  return plainText(stdout).match(/backgrounded\s*·\s*([0-9a-f]{8})\b/)?.[1] ?? null;
}

/** The session's own link, once Remote Control has connected. The last one wins: a reconnect prints a new line. */
export function sessionUrl(log: string): string | null {
  const found = plainText(log).match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/g);
  return found ? found[found.length - 1] : null;
}

/** The background sessions still alive, by short id, from `claude agents --json`. */
export function liveSessions(json: string): Map<string, { status: string; cwd: string }> {
  const live = new Map<string, { status: string; cwd: string }>();
  let rows: unknown;
  try { rows = JSON.parse(json); } catch { return live; }
  if (!Array.isArray(rows)) return live;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { id, kind, status, state, cwd } = row as Record<string, unknown>;
    if (kind !== 'background' || typeof id !== 'string') continue;
    live.set(id, { status: typeof status === 'string' ? status : typeof state === 'string' ? state : 'unknown', cwd: typeof cwd === 'string' ? cwd : '' });
  }
  return live;
}

export type DirLookup = { isDir(p: string): boolean; real(p: string): string };

export const LOCAL_DIRS: DirLookup = {
  isDir: p => { try { return statSync(p).isDirectory(); } catch { return false; } },
  real: p => { try { return realpathSync(p); } catch { return p; } },
};

/**
 * The folder a session works in, from what she was told.
 *
 * Inside his home only, and it has to exist: "haru-desktop", "~/pc-project-ops"
 * and "/home/toomii/haru-ios" all land in the same place, and anything that
 * resolves outside home is refused rather than quietly moved.
 */
export function resolveSessionDir(
  asked: string,
  config: Pick<ClaudeCodeConfig, 'dir'>,
  home: string,
  fs: DirLookup = LOCAL_DIRS,
): { dir: string } | { error: string } {
  const wanted = asked.trim();
  let candidate: string;
  if (!wanted) candidate = config.dir;
  else if (wanted === '~') candidate = home;
  else if (wanted.startsWith('~/')) candidate = path.join(home, wanted.slice(2));
  else if (path.isAbsolute(wanted)) candidate = wanted;
  else candidate = path.join(home, wanted);
  if (!fs.isDir(candidate)) return { error: `There is no folder "${wanted || candidate}" in their home.` };
  const real = fs.real(candidate);
  const realHome = fs.real(home);
  if (real !== realHome && !real.startsWith(realHome + path.sep)) return { error: `"${wanted}" is outside their home folder — sessions only open inside it.` };
  return { dir: real };
}

/** What the session is called in the Claude app. One line, short, never empty. */
export function sessionName(asked: string, dir: string): string {
  const cleaned = asked.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned || `Haru · ${path.basename(dir) || 'home'}`;
}

/**
 * The launch, wrapped in a transient scope of its own.
 *
 * `claude --bg` starts Claude's background daemon on demand, and a daemon
 * started from inside haru.service lives in its cgroup — so the next restart of
 * Haru would take every session she opened down with her. systemd-run --scope
 * gives it a cgroup that outlives her.
 */
export function launchCommand(config: ClaudeCodeConfig, name: string, systemdRun: string | null): { file: string; args: string[] } {
  const claude = [config.binary, '--bg', '--remote-control', name, '--name', name];
  if (config.permissionMode) claude.push('--permission-mode', config.permissionMode);
  if (!systemdRun) return { file: claude[0], args: claude.slice(1) };
  return { file: systemdRun, args: ['--user', '--scope', '--collect', '--quiet', '--', ...claude] };
}

export type Run = (file: string, args: string[], options: { cwd?: string; timeoutMs: number }) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export type SessionHost = {
  config: ClaudeCodeConfig;
  run: Run;
  systemdRun: string | null;
  sleep(ms: number): Promise<void>;
  /** How long to wait for the link before handing back the session without one. */
  linkWaitMs?: number;
};

async function linkFor(host: SessionHost, id: string, waitMs: number): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const logs = await host.run(host.config.binary, ['logs', id], { timeoutMs: 10_000 });
    const url = sessionUrl(logs.stdout);
    if (url || Date.now() >= deadline) return url;
    await host.sleep(1500);
  }
}

export async function openSession(host: SessionHost, dir: string, name: string, nowIso: string): Promise<{ session: OpenedSession } | { error: string }> {
  const { file, args } = launchCommand(host.config, name, host.systemdRun);
  const launched = await host.run(file, args, { cwd: dir, timeoutMs: 60_000 });
  const id = backgroundedId(launched.stdout) ?? backgroundedId(launched.stderr);
  if (!id) {
    const why = plainText(`${launched.stderr}\n${launched.stdout}`).replace(/\s+/g, ' ').trim().slice(0, 240);
    return { error: `Claude did not start${why ? `: ${why}` : ''}` };
  }
  const url = await linkFor(host, id, host.linkWaitMs ?? 25_000);
  return { session: { id, name, dir, url, at: nowIso } };
}

/** Hers that are still running, links filled in where the first look missed them. */
export async function listSessions(host: SessionHost, opened: OpenedSession[]): Promise<{ sessions: (OpenedSession & { status: string })[] } | { error: string }> {
  const agents = await host.run(host.config.binary, ['agents', '--json'], { timeoutMs: 20_000 });
  if (!agents.ok) return { error: 'Claude would not list its sessions.' };
  const live = liveSessions(agents.stdout);
  const sessions: (OpenedSession & { status: string })[] = [];
  for (const session of opened) {
    const alive = live.get(session.id);
    if (!alive) continue;
    const url = session.url ?? await linkFor(host, session.id, 0);
    sessions.push({ ...session, url, status: alive.status });
  }
  return { sessions };
}

export async function stopSession(host: SessionHost, id: string): Promise<{ stopped: boolean; error?: string }> {
  const stopped = await host.run(host.config.binary, ['stop', id], { timeoutMs: 30_000 });
  if (stopped.ok) return { stopped: true };
  return { stopped: false, error: plainText(`${stopped.stderr} ${stopped.stdout}`).replace(/\s+/g, ' ').trim().slice(0, 200) || 'Claude would not stop it.' };
}
