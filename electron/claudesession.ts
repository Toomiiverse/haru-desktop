import {corePolicySync} from './core-policy-sync';
// A Claude Code session on this machine, opened at his word and driven from his phone.
//
// `claude --bg --remote-control <name>` starts a background session that shows
// up in the Claude app (Code) and at a claude.ai/code link. She opens, lists and
// stops them; everything that happens inside one is between him and Claude, in
// the Claude app, behind his own account and its own permission prompts.
//
// That is why she never hands a session a task. Her hands are off on the phone
// because what she reads there can be somebody else's words
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
 return corePolicySync('final-sessions.config',[saved??null,home]);
}

/** One she opened, kept so she can give the link back and stop only her own. */
export type OpenedSession = { id: string; name: string; dir: string; url: string | null; at: string };

export const SESSIONS_KEPT = 10;

export function readOpenedSessions(saved: unknown): OpenedSession[] {
 return corePolicySync('final-sessions.opened',[saved??null]);
}

/** `claude logs` is a terminal recording; the link is in there between colour codes. */
export function plainText(raw: string): string {
 return corePolicySync('final-sessions.plain',[raw]);
}

/** The short id `claude --bg` prints: "backgrounded · 2c4feebf (idle — send a prompt to start)". */
export function backgroundedId(stdout: string): string | null {
 return corePolicySync('final-sessions.background',[stdout]);
}

/** The session's own link, once Remote Control has connected. The last one wins: a reconnect prints a new line. */
export function sessionUrl(log: string): string | null {
 return corePolicySync('final-sessions.link',[log]);
}

/** The background sessions still alive, by short id, from `claude agents --json`. */
export function liveSessions(json: string): Map<string, { status: string; cwd: string }> {
 return new Map(Object.entries(corePolicySync<Record<string,{status:string;cwd:string}>>('final-sessions.live',[json])));
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
 {const candidate=corePolicySync<string>('final-sessions.candidate',[asked,config,home]);return corePolicySync('final-sessions.resolved',[asked,candidate,{isDir:fs.isDir(candidate),real:fs.real(candidate),realHome:fs.real(home)}]);}
}

/** What the session is called in the Claude app. One line, short, never empty. */
export function sessionName(asked: string, dir: string): string {
 return corePolicySync('final-sessions.name',[asked,dir]);
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
 return corePolicySync('final-sessions.launch',[config,name,systemdRun]);
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
 throw Error('use_core_session_program');
}

/** Hers that are still running, links filled in where the first look missed them. */
export async function listSessions(host: SessionHost, opened: OpenedSession[]): Promise<{ sessions: (OpenedSession & { status: string })[] } | { error: string }> {
 throw Error('use_core_session_program');
}

export async function stopSession(host: SessionHost, id: string): Promise<{ stopped: boolean; error?: string }> {
 throw Error('use_core_session_program');
}
