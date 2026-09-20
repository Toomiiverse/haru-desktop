// What her services cost, and what is left in them.
//
// The tally in apiusage.ts answers "who is she calling". This answers the two
// questions that come after it: how much has been spent on each, and how much
// is still there. They are different questions per service, and the honest
// answer comes from a different place per service — so nothing here averages
// them into one number and calls it spending.
//
// Three of them can be known, and are:
//
//  - OpenCode writes a cost and a token breakdown onto every assistant message
//    in its own database. That is a billed figure, from the thing that billed.
//  - Claude Code writes the usage of every message into its transcripts. There
//    is no cost in them, so the cost here is those token counts priced by the
//    table below — an estimate, and labelled as one everywhere it is shown.
//  - Venice reports the balance itself (venicebalance.ts). The spend is that
//    balance going down: a snapshot an hour, and the drop across a day is what
//    the day cost.
//
// The two that cannot are not made up. OpenAI and Google publish no balance an
// ordinary key can read and leave nothing on this disk, so what is shown for
// them is what is actually known: how often she called them. An invented dollar
// figure sitting next to two real ones is worse than a blank.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { localDateKey } from './dates';

export type DaySpend = { day: string; cost: number; tokens: number };

export type Balance = { amount: number; unit: string; level: 'fine' | 'low' | 'empty' };

/** Where a service's numbers come from, which is the difference between a fact and a guess. */
export type Basis = 'billed' | 'estimated' | 'balance' | 'calls';

export type ServiceSpend = {
  service: string;
  balance: Balance | null;
  /** Calls inside the window, for the services where that is all anyone can know. */
  calls: number;
  /** Ascending, one entry per day that had any, inside the window. */
  days: DaySpend[];
  today: number;
  week: number;
  month: number;
  tokens: number;
  basis: Basis;
  note: string;
};

export const SPEND_DAYS = 30;

/**
 * Anthropic's published rates, in dollars per million tokens, as of the date
 * below. A price table in a repository is wrong the moment the prices move and
 * stays wrong quietly, so the date travels with it and anything derived from it
 * is shown as an estimate. Claude Code's transcripts carry the token counts and
 * no price at all; this is the only way to turn one into the other.
 */
export const PRICED_AT = '2026-06-24';

/** Per million tokens. cacheRead is only set where the model prices reads off its own scale. */
type Price = { input: number; output: number; cacheRead?: number };

const CLAUDE_PRICES: [RegExp, Price][] = [
  [/^claude-(fable|mythos)-5-1/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/^claude-(fable|mythos)-5/, { input: 10, output: 50 }],
  [/^claude-opus-(5|4-[678])/, { input: 5, output: 25 }],
  [/^claude-sonnet-5/, { input: 2, output: 10 }],
  [/^claude-sonnet-4-6/, { input: 3, output: 15 }],
  [/^claude-haiku-4-5/, { input: 1, output: 5 }],
];

/** An unknown model is priced as Opus: the tier most of this traffic is, and a guess that errs high is the safer one for a bill. */
const DEFAULT_PRICE: Price = { input: 5, output: 25 };

export function priceFor(model: string): Price {
  const id = String(model ?? '').replace(/^.*[/:]/, '');
  for (const [pattern, price] of CLAUDE_PRICES) if (pattern.test(id)) return price;
  return DEFAULT_PRICE;
}

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

/**
 * What one message's usage cost.
 *
 * The cache split is the whole number, not a detail: a long agent turn is
 * almost entirely cache, where a read is a tenth of the input rate and a write
 * is above it — an hour-long write at twice. Priced as plain input, a day of
 * Claude Code reads several times more expensive than it was.
 */
export function claudeCost(model: string, usage: ClaudeUsage): number {
  const price = priceFor(model);
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  const read = Number(usage.cache_read_input_tokens ?? 0);
  const fiveMinute = Number(usage.cache_creation?.ephemeral_5m_input_tokens ?? 0);
  const hour = Number(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  // An older transcript carries the total and not the split; a five-minute write is the common one.
  const split = fiveMinute + hour > 0 ? { fiveMinute, hour } : { fiveMinute: Number(usage.cache_creation_input_tokens ?? 0), hour: 0 };
  return (
    input * price.input
    + output * price.output
    + read * (price.cacheRead ?? price.input * 0.1)
    + split.fiveMinute * price.input * 1.25
    + split.hour * price.input * 2
  ) / 1_000_000;
}

export function tokensOf(usage: ClaudeUsage): number {
  return Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0)
    + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0);
}

/** Loose rows into one entry per day, oldest first, inside the window. */
export function foldDays(rows: { at: number; cost: number; tokens: number }[], now = new Date(), days = SPEND_DAYS): DaySpend[] {
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - (days - 1));
  const floor = localDateKey(oldest);
  const byDay = new Map<string, DaySpend>();
  for (const row of rows) {
    if (!Number.isFinite(row.at)) continue;
    const day = localDateKey(new Date(row.at));
    if (day < floor) continue;
    const held = byDay.get(day) ?? { day, cost: 0, tokens: 0 };
    held.cost += Number.isFinite(row.cost) ? row.cost : 0;
    held.tokens += Number.isFinite(row.tokens) ? row.tokens : 0;
    byDay.set(day, held);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The totals the panel leads with, from the days behind them. */
export function totals(days: DaySpend[], now = new Date()) {
  const today = localDateKey(now);
  const weekFrom = new Date(now);
  weekFrom.setDate(weekFrom.getDate() - 6);
  const week = localDateKey(weekFrom);
  return {
    today: days.filter(day => day.day === today).reduce((sum, day) => sum + day.cost, 0),
    week: days.filter(day => day.day >= week).reduce((sum, day) => sum + day.cost, 0),
    month: days.reduce((sum, day) => sum + day.cost, 0),
    tokens: days.reduce((sum, day) => sum + day.tokens, 0),
  };
}

export function spendFrom(service: string, rows: { at: number; cost: number; tokens: number }[], basis: Basis, note: string, now = new Date()): ServiceSpend {
  const days = foldDays(rows, now);
  return { service, balance: null, calls: 0, days, ...totals(days, now), basis, note };
}

// ---- Venice: the balance itself, and what its drops add up to --------------

export type BalanceSnapshot = { at: string; total: number };

/**
 * Spending read backwards out of a balance.
 *
 * Venice will say what is left but not what went. Between two snapshots the
 * balance either fell, which is spending, or rose, which is a top-up — and a
 * top-up is emphatically not negative spending, so a rise counts as nothing
 * rather than as a refund. Days are compared by their last snapshot, so a day
 * is the whole day rather than the hours the app happened to be up.
 */
export function balanceSpendDays(history: BalanceSnapshot[], now = new Date(), days = SPEND_DAYS): DaySpend[] {
  const lastOfDay = new Map<string, number>();
  for (const entry of [...history].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const at = Date.parse(String(entry.at));
    if (!Number.isFinite(at) || !Number.isFinite(entry.total)) continue;
    lastOfDay.set(localDateKey(new Date(at)), entry.total);
  }
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - (days - 1));
  const floor = localDateKey(oldest);
  const out: DaySpend[] = [];
  let previous: number | null = null;
  for (const [day, total] of [...lastOfDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fell = previous !== null && total < previous ? previous - total : 0;
    previous = total;
    if (day >= floor && fell > 0) out.push({ day, cost: fell, tokens: 0 });
  }
  return out;
}

/**
 * The balance history, kept small. One snapshot every half hour at most — the
 * balance is asked for on the hour, but a restart loop would otherwise write
 * one per boot — and a month of them, which is what the chart draws from.
 */
export function keepSnapshots(history: BalanceSnapshot[], entry: BalanceSnapshot, days = SPEND_DAYS): BalanceSnapshot[] {
  const at = Date.parse(entry.at);
  if (!Number.isFinite(at)) return history;
  const oldest = at - days * 86_400_000;
  const kept = history.filter(held => {
    const was = Date.parse(String(held.at));
    return Number.isFinite(was) && was > oldest && at - was >= 30 * 60_000;
  });
  return [...kept, entry].slice(-24 * days);
}

// ---- OpenCode: its own billed numbers, out of its own database -------------

/**
 * OpenCode keeps a cost and a token breakdown on every assistant message it
 * writes. Read through node:sqlite rather than a dependency, and read-only: the
 * file is open in another process most of the time, and a panel in a settings
 * page has no business being what breaks somebody's coding session.
 */
export function readOpenCodeSpend(dbFile: string, now = new Date(), days = SPEND_DAYS): { rows: { at: number; cost: number; tokens: number }[]; providers: Record<string, number> } {
  const empty = { rows: [] as { at: number; cost: number; tokens: number }[], providers: {} as Record<string, number> };
  if (!existsSync(dbFile)) return empty;
  type Database = { prepare(sql: string): { all(...params: unknown[]): unknown[] }; close(): void };
  let database: Database;
  try {
    // Required here rather than imported: a Node without node:sqlite should cost
    // this one panel and nothing else in the app.
    const sqlite = require('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => Database };
    database = new sqlite.DatabaseSync(dbFile, { readOnly: true });
  } catch { return empty; }
  try {
    const since = now.getTime() - days * 86_400_000;
    const found = database.prepare('select time_created, data from session_message where type = ? and time_created > ?').all('assistant', since) as { time_created: number; data: string }[];
    const rows: { at: number; cost: number; tokens: number }[] = [];
    const providers: Record<string, number> = {};
    for (const row of found) {
      let message: { cost?: number; tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } }; model?: { providerID?: string } };
      try { message = JSON.parse(row.data); } catch { continue; }
      if (typeof message.cost !== 'number') continue;
      const tokens = message.tokens ?? {};
      const total = Number(tokens.input ?? 0) + Number(tokens.output ?? 0) + Number(tokens.cache?.read ?? 0) + Number(tokens.cache?.write ?? 0);
      rows.push({ at: Number(row.time_created), cost: message.cost, tokens: total });
      const provider = message.model?.providerID;
      if (provider) providers[provider] = (providers[provider] ?? 0) + message.cost;
    }
    return { rows, providers };
  } catch { return empty; } finally {
    try { database.close(); } catch { /* it was already gone */ }
  }
}

// ---- Claude Code: the transcripts, priced ----------------------------------

/**
 * Every assistant message Claude Code writes carries its usage. Only files
 * touched inside the window are opened, and only lines that mention usage are
 * parsed: a session transcript runs to megabytes and there are dozens of them.
 */
export function readClaudeCodeSpend(projectsRoot: string, now = new Date(), days = SPEND_DAYS): { rows: { at: number; cost: number; tokens: number }[]; models: Record<string, number> } {
  const rows: { at: number; cost: number; tokens: number }[] = [];
  const models: Record<string, number> = {};
  if (!existsSync(projectsRoot)) return { rows, models };
  const since = now.getTime() - days * 86_400_000;
  let folders: string[];
  try { folders = readdirSync(projectsRoot); } catch { return { rows, models }; }
  for (const folder of folders) {
    const directory = path.join(projectsRoot, folder);
    let files: string[];
    try { files = readdirSync(directory).filter(name => name.endsWith('.jsonl')); } catch { continue; }
    for (const name of files) {
      const file = path.join(directory, name);
      try { if (statSync(file).mtimeMs < since) continue; } catch { continue; }
      let text: string;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let entry: { timestamp?: string; message?: { model?: string; usage?: ClaudeUsage } };
        try { entry = JSON.parse(line); } catch { continue; }
        const usage = entry.message?.usage;
        const model = String(entry.message?.model ?? '');
        const at = Date.parse(String(entry.timestamp ?? ''));
        // A synthetic turn carries a usage block of zeros and no model at all.
        if (!usage || !model || !Number.isFinite(at) || at < since) continue;
        const cost = claudeCost(model, usage);
        rows.push({ at, cost, tokens: tokensOf(usage) });
        models[model] = (models[model] ?? 0) + cost;
      }
    }
  }
  return { rows, models };
}

// ---- Who is on a meter, and who is on a plan -------------------------------

/**
 * Whether Claude Code on this machine is billed by the token or covered by a
 * subscription. It decides what the number beside it means: on a plan those
 * tokens are what the plan is worth, not money that left an account, and a
 * panel that calls that "spent" is lying about a bill nobody received.
 */
export function claudeOnAPlan(home: string): boolean {
  try {
    return /"subscriptionCreatedAt"\s*:\s*"/.test(readFileSync(path.join(home, '.claude.json'), 'utf8'));
  } catch { return false; }
}

export type SpendInput = {
  home: string;
  /** The last balance Venice reported, and the snapshots behind it. */
  venice: { usd: number; diem: number } | null;
  veniceHistory: BalanceSnapshot[];
  veniceLowUsd: number;
  /** Calls inside the window, per service, from the tally in apiusage.ts. */
  calls: Record<string, number>;
  now?: Date;
};

/**
 * The five she is pointed at, in the order they were asked for, each answered
 * from the best thing that can answer it — and no better.
 */
export function collectSpend(input: SpendInput): ServiceSpend[] {
  const now = input.now ?? new Date();
  const calls = (service: string) => input.calls[service] ?? 0;
  const out: ServiceSpend[] = [];

  const veniceDays = balanceSpendDays(input.veniceHistory, now);
  const veniceTotal = input.venice ? input.venice.usd + input.venice.diem : null;
  out.push({
    service: 'Venice',
    balance: veniceTotal === null ? null : {
      amount: veniceTotal,
      unit: input.venice && input.venice.diem ? `$${input.venice.usd.toFixed(2)} + ${input.venice.diem.toFixed(2)} diem` : 'USD',
      level: veniceTotal <= 0.01 ? 'empty' : veniceTotal < input.veniceLowUsd ? 'low' : 'fine',
    },
    calls: calls('Venice'),
    days: veniceDays,
    ...totals(veniceDays, now),
    basis: 'balance',
    note: veniceTotal === null
      ? 'No balance read yet. It is asked for on the hour while a Venice model is set.'
      : 'What Venice says is left. The daily figures are the drop between one day and the next, so a top-up reads as nothing rather than as a refund.',
  });

  const claude = readClaudeCodeSpend(path.join(input.home, '.claude', 'projects'), now);
  const onAPlan = claudeOnAPlan(input.home);
  const claudeSpend = spendFrom('Claude', claude.rows, 'estimated',
    onAPlan
      ? `Your subscription covers this — it is what those tokens would have cost at the published rates of ${PRICED_AT}, not money spent.`
      : `Estimated: Claude Code records the tokens and not the price, so these are its own token counts at the published rates of ${PRICED_AT}.`,
    now);
  claudeSpend.calls = calls('Claude');
  out.push(claudeSpend);

  for (const service of ['OpenAI', 'Google']) {
    out.push({
      service, balance: null, calls: calls(service), days: [], today: 0, week: 0, month: 0, tokens: 0, basis: 'calls',
      note: `Neither a balance nor a bill is readable without an organisation key, and nothing is kept on this machine — so this is what is known: calls she made in the last ${SPEND_DAYS} days.`,
    });
  }

  const opencode = readOpenCodeSpend(path.join(input.home, '.local', 'share', 'opencode', 'opencode.db'), now);
  const opencodeSpend = spendFrom('OpenCode', opencode.rows, 'billed',
    Object.keys(opencode.providers).length
      ? `Billed, from OpenCode's own record of every message: ${Object.entries(opencode.providers).sort((a, b) => b[1] - a[1]).map(([name, cost]) => `${name} $${cost.toFixed(2)}`).join(', ')}.`
      : 'Billed, from OpenCode’s own record of every message it was charged for.',
    now);
  opencodeSpend.calls = calls('OpenCode');
  out.push(opencodeSpend);

  return out;
}
