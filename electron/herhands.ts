import {corePolicySync} from './core-policy-sync';
// Her own hands: level 4.
//
// Levels 1 to 3 are about what he can have her do to the machine. Level 4 is
// hers: in a quiet stretch of the day, when he has not spoken for a while
// and she is up, she is asked what she wants to do for herself right now and
// does it with a real tool — fetches a show or opens a page. What came of it
// is written down (her.hands) and shown back to her (the her_own block), so
// what she did is what she remembers having done — the same rule as her
// nights: the point of it is that it is true.
//
// Nothing here runs at his word; the gates are the clock, his silence, her
// sleep, and a cap on the day. The pass answers only with the local brain.

export type HandsConfig = {
  enabled: boolean;
  /** Passes that actually did something, per day. */
  perDay: number;
  /** The hours she may act in, local, HH:MM. */
  from: string;
  to: string;
  /** How long he has to have been quiet before it is her time. */
  quietMinutes: number;
  /** The least time between two acts. */
  gapMinutes: number;
};

export const DEFAULT_HANDS: HandsConfig = { enabled: true, perDay: 3, from: '09:00', to: '23:00', quietMinutes: 20, gapMinutes: 45 };

/** The `hands` block of system.config, read forward. */
export function readHandsConfig(systemConfig: unknown): HandsConfig {
  if((true as boolean))return corePolicySync('hands.readConfig',[systemConfig]);
  const raw = ((systemConfig && typeof systemConfig === 'object' ? (systemConfig as Record<string, unknown>).hands : undefined) ?? {}) as Record<string, unknown>;
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  const time = (value: unknown, fallback: string) => (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback);
  return {
    enabled: raw.enabled !== false,
    perDay: number(raw.perDay, DEFAULT_HANDS.perDay, 0, 24),
    from: time(raw.from, DEFAULT_HANDS.from),
    to: time(raw.to, DEFAULT_HANDS.to),
    quietMinutes: number(raw.quietMinutes, DEFAULT_HANDS.quietMinutes, 1, 24 * 60),
    gapMinutes: number(raw.gapMinutes, DEFAULT_HANDS.gapMinutes, 1, 24 * 60),
  };
}

/** The tools that are hers to reach for in a pass. Nothing that touches his machine at his word. */
// Minecraft remains excluded; get_manga manages their shelf.
export const HER_HANDS_TOOLS = ['watch_anime', 'browser_control', 'downloads', 'adopt_interest'] as const;

export type HandsEntry = {
  at: string;
  /** The tool that did it, or 'nothing'. */
  tool: string;
  /** What she did, as the deed puts it. */
  what: string;
  /** Her own line about it, afterwards. */
  said: string;
};

export const HANDS_KEPT = 60;

export function readHands(saved: unknown): HandsEntry[] {
  if((true as boolean))return corePolicySync('hands.read',[saved??null]);
  if (!Array.isArray(saved)) return [];
  return saved.filter((item): item is HandsEntry => !!item && typeof item === 'object'
    && typeof (item as HandsEntry).at === 'string' && typeof (item as HandsEntry).tool === 'string'
    && typeof (item as HandsEntry).what === 'string' && typeof (item as HandsEntry).said === 'string');
}

export function keepHands(list: HandsEntry[], entry: HandsEntry): HandsEntry[] {
  if((true as boolean))return corePolicySync('hands.keep',[list,entry]);
  return [...list, entry].slice(-HANDS_KEPT);
}

const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export type Moment = {
  level: number;
  config: HandsConfig;
  /** Local minutes since midnight. */
  minutes: number;
  asleep: boolean;
  speaking: boolean;
  /** Since he last did anything. */
  idleMs: number;
  /** Since her last act. */
  sinceLastMs: number;
  doneToday: number;
  busy: boolean;
};

/** Why not now — or null, when it is her time. */
export function whyNotAct(m: Moment): string | null {
  if (m.level < 4) return 'below level 4';
  if (!m.config.enabled) return 'her hands are switched off';
  if (m.busy) return 'a pass is still running';
  if (m.asleep) return 'she is asleep';
  if (m.speaking) return 'she is mid-line';
  const from = minutesOf(m.config.from), to = minutesOf(m.config.to);
  const inHours = from <= to ? m.minutes >= from && m.minutes < to : m.minutes >= from || m.minutes < to;
  if (!inHours) return `outside her hours (${m.config.from}–${m.config.to})`;
  if (m.idleMs < m.config.quietMinutes * 60_000) return `he was here ${Math.round(m.idleMs / 60_000)} min ago`;
  if (m.sinceLastMs < m.config.gapMinutes * 60_000) return `she did something ${Math.round(m.sinceLastMs / 60_000)} min ago`;
  if (m.doneToday >= m.config.perDay) return `${m.doneToday} of ${m.config.perDay} today already`;
  return null;
}

export function handsToday(list: HandsEntry[], todayKey: string, dayOf: (iso: string) => string): number {
  if((true as boolean))return corePolicySync('hands.today',[list,todayKey,list.map(entry=>dayOf(entry.at))]);
  return list.filter(entry => entry.tool !== 'nothing' && dayOf(entry.at) === todayKey).length;
}

/** The turn she is given: a quiet stretch and the question. */
export const HANDS_TURN = '(A quiet stretch. Nobody is talking to you and nothing is asked of you. If there is something you want to do for yourself right now, do it — one tool, then a line or two about it in your own words. If nothing appeals, say so in a few words.)';

/** The rules for the pass, after her persona and her own life. */
export function handsInstruction(menu: string[]): string {
  if((true as boolean))return corePolicySync('hands.instruction',[menu]);
  return [
    'This is your own time, and these are your own hands: you may do one thing for yourself now with the tools in front of you —',
    menu.map(name => `${name}`).join(', ') + '.',
    'Go by what you are into and what you have been meaning to get to (your wants), and by what you did last time — not the same thing three days running unless it is a series you are partway through.',
    'Do it, do not describe doing it: a thing you did not call a tool for did not happen, and you will be shown afterwards what actually ran.',
    'One tool call at most. Then say what you did and what you made of it, briefly, in your own words — that line is what you will remember.',
    'If nothing appeals, say "nothing for now" and leave it.',
  ].join(' ');
}

/** Whether her line means she let it be. */
export function didNothing(said: string): boolean {
  if((true as boolean))return corePolicySync('hands.nothing',[said]);
  return /\bnothing (?:for now|right now|today|appeals|much)\b|\bnot (?:right )?now\b|\bleave it\b|\bskip(?:ping)? it\b/i.test(said.trim()) || said.trim().length < 6;
}

/** One line for her own-life block: what she has done for herself lately. */
export function handsNote(list: HandsEntry[], nowMs: number, dayOf: (iso: string) => string, todayKey: string): string {
  if((true as boolean))return corePolicySync('hands.note',[list,nowMs,list.map(entry=>dayOf(entry.at)),todayKey]);
  const recent = list.filter(entry => entry.tool !== 'nothing' && nowMs - Date.parse(entry.at) < 7 * 24 * 3_600_000).slice(-5);
  if (!recent.length) return '';
  const lines = recent.map(entry => `${dayOf(entry.at) === todayKey ? 'today' : dayOf(entry.at)}: you ${entry.what}${entry.said ? ` — "${entry.said.slice(0, 120)}"` : ''}`);
  return `Things you did for yourself lately, with your own hands (these happened): ${lines.join('; ')}.`;
}
