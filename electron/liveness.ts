// Whether she is still there, written down by the watchdog and read back by the
// app. Nothing on this machine can tell him she is gone while the machine
// itself is off, so the alert is in two halves that meet in one small file:
//
//   the watchdog (scripts/haru-watchdog.mjs, on a half-minute timer) asks her
//   door whether it is answering and writes down when it last did, then says
//   so once when it stops; and the app, on the way back up, reads that note
//   and says how long she was away.
//
// The watchdog owns the "I have gone quiet" push — only it is running when the
// app is not. The app owns the "I am back" push, because it is the one that
// comes back. Two sends, one for each half, so an outage never arrives twice.
//
// The state machine lives here, apart from the disk and the network, so both
// halves have one answer and it can be tested without either.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Where the watchdog writes and the app reads. Under the user's own state. */
export function livenessPath(): string {
  return path.join(homedir(), '.local', 'state', 'haru', 'liveness.json');
}

export type LivenessState = {
  /** When the door last answered, ms. Zero before the first probe. */
  lastAliveAt: number;
  /** When the current outage began, ms; zero while she is up. */
  downSince: number;
  /** When the watchdog raised the phone for this outage, ms; zero while none is outstanding. */
  downAlertedAt: number;
  /** Failed probes in a row, so a single blip does not buzz the phone. */
  failures: number;
  /** When the watchdog tried a restart this outage, ms; zero when it has not. */
  restartedAt: number;
};

export const EMPTY_LIVENESS: LivenessState = { lastAliveAt: 0, downSince: 0, downAlertedAt: 0, failures: 0, restartedAt: 0 };

/** Failed probes in a row before she is called unreachable — three is ~90s. */
export const DEFAULT_FAIL_THRESHOLD = 3;
/** How long she is unreachable before the watchdog tries one restart. */
export const DEFAULT_RESTART_AFTER_MS = 3 * 60_000;
/**
 * The gap at which the app says she was away. Above any deploy — stopping and
 * starting her is seconds — and below anything a person would call an outage.
 * The watchdog's note is at most half a minute stale, so this is the gap it
 * reports and not the shape of the file.
 */
export const DOWNTIME_NOTICE_MS = 2 * 60_000;

const count = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** What was on disk, trusted only as far as it is a number. */
export function readLiveness(saved: unknown): LivenessState {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  return {
    lastAliveAt: count(record.lastAliveAt),
    downSince: count(record.downSince),
    downAlertedAt: count(record.downAlertedAt),
    failures: Math.floor(count(record.failures)),
    restartedAt: count(record.restartedAt),
  };
}

export function readLivenessFile(file = livenessPath()): LivenessState | null {
  try {
    return readLiveness(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

export function writeLivenessFile(state: LivenessState, file = livenessPath()): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // Not writing down what it saw is not a reason to stop watching.
  }
}

export type ProbeAction = 'none' | 'alert-down';
export type ProbeOutcome = { state: LivenessState; action: ProbeAction; restartNow: boolean };

export type ProbeOptions = {
  failThreshold?: number;
  restartAfterMs?: number;
};

/**
 * One probe, folded into the state and turned into what to do about it. Pure:
 * pass whether the door answered and the clock, get back the next state, the
 * one action (alert the phone once per outage) and whether to restart.
 */
export function probeOutcome(state: LivenessState, up: boolean, now: number, options: ProbeOptions = {}): ProbeOutcome {
  const failThreshold = options.failThreshold ?? DEFAULT_FAIL_THRESHOLD;
  const restartAfterMs = options.restartAfterMs ?? DEFAULT_RESTART_AFTER_MS;
  if (up) {
    return {
      state: { lastAliveAt: now, downSince: 0, downAlertedAt: 0, failures: 0, restartedAt: 0 },
      action: 'none',
      restartNow: false,
    };
  }
  const failures = state.failures + 1;
  const downSince = state.downSince || now;
  const reached = failures >= failThreshold;
  // Sounded once: the phone is told the first time she crosses the threshold
  // and not on every probe after, or an afternoon down would be fifty buzzes.
  const downAlertedAt = state.downAlertedAt || (reached ? now : 0);
  // A restart is tried once per outage, after she has been down long enough
  // that this is not one of his own deploys.
  const restartNow = state.restartedAt === 0 && now - downSince >= restartAfterMs;
  return {
    state: { lastAliveAt: state.lastAliveAt, downSince, downAlertedAt, failures, restartedAt: restartNow ? now : state.restartedAt },
    action: reached && !state.downAlertedAt ? 'alert-down' : 'none',
    restartNow,
  };
}

/** "40 seconds", "12 minutes", "3 h 5 min", "2 days". */
export function formatGap(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${Math.max(2, minutes)} minutes`;
  const hours = Math.floor(minutes / 60);
  const leftover = minutes % 60;
  if (hours < 24) return leftover ? `${hours} h ${leftover} min` : `${hours} h`;
  const days = Math.round(hours / 24);
  return days <= 1 ? 'a day' : `${days} days`;
}

/** The watchdog's line: she is not answering and the machine is still up. */
export function unreachableMessage(): string {
  return "I've gone quiet. The machine is still running, but my door has stopped answering — nothing of me is reachable right now.";
}

/** The app's line, on the way back up: how long the gap was. */
export function backMessage(goneMs: number): string {
  return `I'm back. I was down for ${formatGap(goneMs)}.`;
}
