// What she has been spending, and on whose API.
//
// Every service Haru talks to — Google, AniList, Steam, Brave, the model
// endpoint, the voice server, Jellyfin — is reached the same way: a fetch, from
// somewhere in the app, at a host that names the service. Nobody was counting
// them. The first sign of a key being burned through was Google answering 429,
// or a bill, and the only way to answer "what is she actually calling" was to
// read the log by eye.
//
// So the count happens at the one place they all pass through. `counted` wraps
// a fetch and tallies the host it went to; the wrapper is what main.ts, google.ts,
// voice.ts and discord.ts reach for instead of the bare one, and everything they
// hand down to the modules that take an injected fetch is counted too.
//
// Per host and per day, because both questions get asked: which service is this,
// and is today unusual. Thirty days is kept — long enough for a monthly quota,
// short enough to stay a few hundred bytes — and the tally lives in memory and
// is flushed on a timer, because config.json is rewritten whole on every set
// and a counter that writes on every request would rewrite it thousands of
// times a day. See store.ts.
//
// Failures are counted beside the calls rather than thrown away: a service that
// is being called two hundred times and refusing all of them is the interesting
// case, and it looks identical to a healthy one if only successes are counted.

import { net } from 'electron';
import { localDateKey } from './dates';

/** host[:port] -> [calls, failures] */
type Day = Record<string, [number, number]>;
/** yyyy-mm-dd -> that day's hosts */
export type Usage = Record<string, Day>;

export type UsageRow = {
  service: string;
  host: string;
  today: number;
  week: number;
  month: number;
  failed: number;
  /** The last day it was called, as yyyy-mm-dd. */
  last: string;
};

const KEEP_DAYS = 30;

// A hostname is not a service name, and the difference matters on the ones that
// are shared: oauth2.googleapis.com and tasks.googleapis.com are one bill and
// one key. Anything not listed keeps its host, which reads fine for the things
// on his own network — they are named by the box they run on.
const NAMES: [RegExp, string][] = [
  [/(^|\.)googleapis\.com$/, 'Google'],
  [/(^|\.)google\.com$/, 'Google'],
  [/(^|\.)anilist\.co$/, 'AniList'],
  [/(^|\.)steampowered\.com$/, 'Steam'],
  [/(^|\.)discord\.com$/, 'Discord'],
  [/(^|\.)openai\.com$/, 'OpenAI'],
  [/(^|\.)openrouter\.ai$/, 'OpenRouter'],
  [/(^|\.)x\.ai$/, 'xAI'],
  [/(^|\.)venice\.ai$/, 'Venice'],
  [/(^|\.)search\.brave\.com$/, 'Brave Search'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)open-meteo\.com$/, 'Open-Meteo'],
  [/(^|\.)openstreetmap\.org$/, 'Nominatim'],
  [/(^|\.)youtube\.com$/, 'YouTube'],
  [/(^|\.)runpod\.net$/, 'RunPod'],
  [/:11434$/, 'Ollama'],
  [/:988[01]$/, 'GPT-SoVITS'],
  [/:8096$/, 'Jellyfin'],
];

/**
 * The key a call is filed under: the host, and the port when there is one, so
 * two local servers are two services. Empty for anything that is not a request
 * to a service — a file:// read goes through the same fetch and is not usage.
 */
export function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.host.toLowerCase() : '';
  } catch { return ''; }
}

export function serviceName(host: string): string {
  const bare = host.replace(/:\d+$/, '');
  for (const [pattern, name] of NAMES) if (pattern.test(host) || pattern.test(bare)) return name;
  return host;
}

function daysBack(n: number, now: Date): string {
  const then = new Date(now);
  then.setDate(then.getDate() - n);
  return localDateKey(then);
}

/**
 * The counter itself. Held in memory, handed its saved state on boot and asked
 * for a snapshot when something is ready to write it.
 */
export class ApiUsage {
  private days: Usage = {};
  /** Whether anything has been counted since the last snapshot, so a quiet app writes nothing. */
  dirty = false;

  constructor(saved?: unknown) { this.load(saved); }

  load(saved: unknown): void {
    this.days = {};
    if (!saved || typeof saved !== 'object') return;
    for (const [day, hosts] of Object.entries(saved as Usage)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hosts || typeof hosts !== 'object') continue;
      const kept: Day = {};
      for (const [host, pair] of Object.entries(hosts)) {
        if (Array.isArray(pair) && Number.isFinite(pair[0])) kept[host] = [Number(pair[0]), Number(pair[1]) || 0];
      }
      this.days[day] = kept;
    }
  }

  record(url: string, ok: boolean, now = new Date()): void {
    const host = hostOf(url);
    if (!host) return;
    const day = localDateKey(now);
    const hosts = (this.days[day] ??= {});
    const pair = (hosts[host] ??= [0, 0]);
    pair[0] += 1;
    if (!ok) pair[1] += 1;
    this.dirty = true;
  }

  /** Pruned to the last 30 days, for writing. Clears the dirty flag: the caller is about to save it. */
  snapshot(now = new Date()): Usage {
    const oldest = daysBack(KEEP_DAYS - 1, now);
    for (const day of Object.keys(this.days)) if (day < oldest) delete this.days[day];
    this.dirty = false;
    return this.days;
  }

  /** One row per service, busiest month first — what the panel shows. */
  report(now = new Date()): UsageRow[] {
    const today = localDateKey(now);
    const weekFrom = daysBack(6, now);
    const monthFrom = daysBack(KEEP_DAYS - 1, now);
    const rows = new Map<string, UsageRow>();
    for (const [day, hosts] of Object.entries(this.days)) {
      if (day < monthFrom) continue;
      for (const [host, [calls, failures]] of Object.entries(hosts)) {
        const service = serviceName(host);
        const row = rows.get(service) ?? { service, host, today: 0, week: 0, month: 0, failed: 0, last: day };
        row.month += calls;
        row.failed += failures;
        if (day >= weekFrom) row.week += calls;
        if (day === today) row.today += calls;
        if (day > row.last) { row.last = day; row.host = host; }
        rows.set(service, row);
      }
    }
    return [...rows.values()].sort((a, b) => b.month - a.month || a.service.localeCompare(b.service));
  }
}

type Fetcher = (url: any, init?: any) => Promise<{ ok: boolean }>;

/**
 * The same fetch, counted. A non-2xx answer is a call that was still spent — the
 * quota is gone either way — so it is counted, and counted again as a failure.
 */
export function counted<F extends Fetcher>(fetchImpl: F, usage: ApiUsage): F {
  return (async (url: any, init?: any) => {
    try {
      const response = await fetchImpl(url, init);
      usage.record(String(url), response?.ok !== false);
      return response;
    } catch (error) {
      usage.record(String(url), false);
      throw error;
    }
  }) as F;
}

/**
 * The one tally, and the fetch that feeds it. A singleton because the modules
 * that call out — main, google, voice, discord — have no other way to reach the
 * same counter without being handed one through four constructors, and there is
 * only ever one app. main.ts hands it what was saved on boot and writes it back.
 *
 * net is touched inside the wrapper rather than at import, so this module can be
 * imported by a test outside Electron, where `net` is not there at all.
 */
export const apiUsage = new ApiUsage();

export const trackedFetch = counted(
  ((url: Parameters<typeof net.fetch>[0], init?: Parameters<typeof net.fetch>[1]) => net.fetch(url, init)) as typeof net.fetch,
  apiUsage,
);
