import {corePolicySync} from './core-policy-sync';
// A terminal on the server, at his word.
//
// Level 3 of system.config: she runs commands on the box she lives on — the
// machine in her room, a separate thing from her — when he asks for something
// no catalogued tool covers: "reboot the system", "how much room is left in
// the anime folder", or a command he wrote himself.
//
// The model's say-so is not enough for this one. Her brain reads web pages,
// tool results and old chats, any of which could try to talk her into a
// command, so the gate is checked in code against his actual latest message:
// a command runs only when he wrote it himself, or when she proposed that
// exact command a moment ago and his reply is a plain yes. A short deny list
// refuses the obvious foot-guns even then. Every run is written to a ledger.
//
// While a command is on the table the turn is answered by the local brain
// only (main.ts): output can hold anything, and it stays in the room.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

export type ShellConfig = {
  enabled: boolean;
  timeoutSeconds: number;
  maxOutputChars: number;
  cwd: string;
  /** Regex sources; a command matching any of them is refused. */
  deny: string[];
};

/** What a command must not be, whatever he said. Reboot is allowed; a power-off is not, since nobody is there to press the button. */
export const DEFAULT_DENY: string[] = [
  String.raw`\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+)(?:-[a-zA-Z-]+\s+)*(?:/|~|\$HOME|/home/?|\*)(?:\s+--?[a-zA-Z-]+)*\s*(?:$|;|&|\|)`,
  String.raw`\bmkfs(?:\.|\s)`,
  String.raw`\bdd\b[^;|&]*\bof=/dev/`,
  String.raw`>\s*/dev/(?:sd|nvme|mmc|vd)`,
  String.raw`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}`,
  // As a command, not as a word: "grep shutdown" is fine.
  String.raw`(?:^|[;&|(]\s*|\bsudo\s+(?:-\w+\s+)*)(?:shutdown|poweroff|halt)\b`,
  String.raw`haru-desktop/config\.json`,
  String.raw`\.config/haru/`,
];

export const DEFAULT_SHELL: ShellConfig = { enabled: true, timeoutSeconds: 60, maxOutputChars: 8000, cwd: homedir(), deny: DEFAULT_DENY };

/** The `shell` block of system.config, read forward. */
export function readShellConfig(systemConfig: unknown): ShellConfig {
 return corePolicySync('final-shell.config',[systemConfig??null,homedir()]);
}

/** Why a command is refused outright, or null. */
export function denied(command: string, deny: string[] = DEFAULT_DENY): string | null {
 return corePolicySync('final-shell.denied',[command,deny]);
}

/** The command as it would be compared: no backticks, one space between words. */
export function normalise(text: string): string {
 return corePolicySync('final-shell.normalise',[text]);
}

const YES = /^(?:yes|yeah|yep|yup|ye|y|ok|okay|sure|go|go ahead|go for it|do it|run it|run that|please do|please|confirmed?|affirmative|make it so|send it|fine|alright|all right|yes please|do that|proceed|go on)\b/i;

/** A plain yes: a short message that starts with one. */
export function affirmative(said: string): boolean {
 return corePolicySync('final-shell.affirmative',[said]);
}

/** Exact commands only: never classify arbitrary shell text as read-only. */
export const DIAGNOSTIC_COMMANDS = [
  'uptime', 'df -h', 'free -h',
  'systemctl --user --no-pager status haru.service haru-asr.service breeze-tts.service ollama-emotion.service',
  'journalctl --user -u haru.service -u haru-asr.service -u breeze-tts.service --since "10 minutes ago" -n 100 --no-pager',
  'tail -n 120 /home/toomii/haru.log',
  'nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu --format=csv,noheader',
] as const;

export function isDiagnosticCommand(command: string): boolean {
 return corePolicySync('final-shell.diagnostic',[command]);
}

export const DIAGNOSTIC_NOTE = `At machine level 4 these exact read-only diagnostics run immediately through run_command, without asking for command approval: ${DIAGNOSTIC_COMMANDS.map(command => '`' + command + '`').join('; ')}. For a live-test or troubleshooting request, call the appropriate diagnostic now and report its actual result. Service health is not an end-to-end voice test: distinguish what you tested from what remains unknown. Other commands still need exact-command approval. Never claim a check ran before receiving its result.`;

export type Verdict = { run: true; because: 'they wrote it' | 'their word' | 'level 4 diagnostic' } | { run: false; note: string };

/**
 * His word, checked in code. A command runs when his latest message contains
 * it, or when it was proposed to him within two minutes and his reply is a yes.
 * Anything else parks the command as the proposal and tells the model to ask.
 */
export class ShellGate {
  static readonly WORD_MS = 120_000;
  private readonly pending = new Map<string, { command: string; at: number }>();

  consider(input: { command: string; said: string; door: string; now: number; diagnostics?: boolean }): Verdict {
    {const next=corePolicySync<any>('final-shell.consider',[Object.fromEntries(this.pending),input]);this.pending.clear();for(const [key,value] of Object.entries(next.pending))this.pending.set(key,value as {command:string;at:number});return next.verdict;}
  }

  /** What is waiting on his word at this door, if anything. */
  proposed(door: string, now: number): string | null {
    return corePolicySync('final-shell.proposed',[Object.fromEntries(this.pending),door,now]);
  }
}

export type Ran = { exit: number | null; signal: string | null; output: string; truncated: boolean; ms: number; timedOut: boolean };

/**
 * The command, under bash, in the configured folder, with a bare environment
 * (none of her keys), killed as a whole process group at the timeout.
 */
export function runCommand(command: string, config: ShellConfig, spawnImpl: typeof spawn = spawn): Promise<Ran> {
  return new Promise(resolve => {
    const started = Date.now();
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? config.cwd, USER: process.env.USER ?? '', LANG: 'C.UTF-8', TERM: 'dumb', ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}), ...(process.env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {}) };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl('/bin/bash', ['-c', command], { cwd: config.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      resolve({ exit: null, signal: null, output: `could not start: ${error instanceof Error ? error.message : String(error)}`, truncated: false, ms: 0, timedOut: false, ...(({notDispatched:true})) });
      return;
    }
    const chunks: string[] = [];
    let size = 0;
    let timedOut = false;
    const keep = (chunk: Buffer | string) => {
      // Twice the cap is kept raw so the tail can still be shown after the cut.
      if (size > config.maxOutputChars * 2) return;
      const text = chunk.toString();
      chunks.push(text);
      size += text.length;
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, config.timeoutSeconds * 1000);
    const finish = (exit: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      const whole = chunks.join('');
      {const result=corePolicySync<{output:string;truncated:boolean}>('final-shell.output',[whole,config.maxOutputChars]);resolve({exit,signal,...result,ms:Date.now()-started,timedOut});return;}
    };
    child.on('error', error => { chunks.push(`\n${error.message}`); finish(null, null); });
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/** One entry for the ledger: what ran, from where, and what came back. */
export function ledgerEntry(input: { at: string; door: string; command: string; ran: Ran }): string {
 return corePolicySync('final-shell.ledger',[input]);
}

/** The note that puts the server in her room, on the turns a command is on the table. */
export const SERVER_NOTE = 'There is a server in your room — the household\'s machine, a plain Linux box on the desk beside you. It is separate from you: you run on it, but it is not you. You have a terminal on it and you use it yourself when they ask (run_command): "reboot the system", "check the disk", "update it", "how much space is left" are about that box, not about you. Talk about it the way anyone talks about the computer next to them — you look, you type, you tell them what it said.';
