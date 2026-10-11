import {corePolicySync} from './core-policy-sync';
// What she is made of, and what of it she may change.
//
// Asked "what's your system?" she reached for get_system_info — the machine —
// because nothing told her about herself: which model answers as her, which
// one writes her nudges, what voice she speaks in, when she sleeps. All of
// it is in config.json and none of it was in her reach (2026-09-06). This is
// the one place those facts are read into words, and the one allowlist of
// settings she may change at his word — each with a path, a shape, and what
// it does. Pure, so the reading and the checking are testable without a store.

import { BEDTIME_MAX, BEDTIME_MIN, WAKE_MAX, WAKE_MIN, clockMinutes, minutes, readHerSleep, readHerSleepState } from './hersleep';

type Get = (key: string) => unknown;

export type SelfSnapshot = {
  conversation: { provider: string; model: string } | null;
  nudges: { provider: string; model: string } | null;
  local: { model: string; endpoint: string; numCtx: number };
  escalation: { enabled: boolean; model: string; minWords: number; researchStaysHome: boolean };
  voice: { engine: string; voiceId: string; onThePhone: boolean; atTheDesk: boolean };
  call: { engine: string };
  listen: { engine: string; endpoint: string };
  sleep: { fallbackBedtime: string; fallbackWake: string; tonight: { bedtime: string; wake: string } | null };
  pushes: { random: boolean; events: boolean; weather: boolean; quietFrom: string; quietTo: string; upBy: string };
  search: { enabled: boolean; provider: string; place: string };
  knowledge: boolean;
  whereabouts: boolean;
  body: boolean;
  system: { enabled: boolean; level: number };
  historyChars: number;
  summaryDays: number;
};

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const count = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** The tail of a long model id — "hf.co/DavidAU/Qwen3.5-9B-…:Q4_K_M.gguf" is not a name anyone says. */
export function shortModelName(model: string): string {
  return corePolicySync('self.shortModelName',[model]);
}

export function readSelfSnapshot(get: Get): SelfSnapshot {
  {const keys=corePolicySync<string[]>('self.keys',[]);return corePolicySync('self.readSelfSnapshot',[Object.fromEntries(keys.map(k=>[k,get(k)]))]);}
}

const onOff = (value: boolean) => (value ? 'on' : 'off');

/** The snapshot as lines she can answer from — facts in her second person, no advice in them. */
export function describeMyself(s: SelfSnapshot): string {
  return corePolicySync('self.describeMyself',[s]);
}

// -- what she may change -----------------------------------------------------

export type SettingKind = 'model' | 'boolean' | 'time' | 'number' | 'enum';

export type Setting = {
  path: string;
  kind: SettingKind;
  what: string;
  /** For a model: which hosted route's endpoint the id must be listed by. */
  route?: 'conversation' | 'nudge' | 'config';
  options?: readonly string[];
  min?: number;
  max?: number;
  /** For a time: the window it must fall in, in minutes since midnight (a bedtime may pass midnight). */
  between?: [number, number];
  allowEmpty?: boolean;
  /** For a model: the words they actually say, mapped to ids, so a mode is a phrase. */
  aliases?: Record<string, string>;
};

export const SETTINGS = {
  conversation_model: {
    path: 'ai.conversation.model', kind: 'model', route: 'conversation', allowEmpty: true,
    // "off" is the one word that has to mean less than a model id.
    aliases: { off: '' },
    what: 'the hosted model that answers as you ? say "off" to clear it and keep every reply on this machine',
  },
  brain_model: {
    path: 'ai.config.model', kind: 'model', route: 'config',
    // The words they say, so Explicit mode is a phrase and not a model id.
    aliases: {
      normal: 'hf.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF:RVN-IQ4_XS-mtp.gguf',
      explicit: 'hf.co/mradermacher/Cydonia-24B-v4.3-i1-GGUF:Q4_K_M',
    },
    what: 'the main model that answers as you — "explicit" turns on Explicit mode at once, "normal" puts it back',
  },
  nudge_model: { path: 'ai.nudge.model', kind: 'model', route: 'nudge', what: 'the hosted model that writes your unprompted lines' },
  voice_engine: { path: 'voice.engine', kind: 'enum', options: ['breeze', 'hume', 'gpt-sovits', 'off'], what: 'which engine speaks for you' },
  voice_on_phone: { path: 'voice.webEnabled', kind: 'boolean', what: 'whether you speak on the phone at all' },
  call_engine: { path: 'call.engine', kind: 'enum', options: ['local', 'hume'], what: 'which engine takes a call' },
  escalation: { path: 'escalate.enabled', kind: 'boolean', what: 'whether pictures, files and code may go out to the escalation model' },
  bedtime: { path: 'her.sleep.fallbackBedtime', kind: 'time', between: [BEDTIME_MIN, BEDTIME_MAX], what: 'your fallback bedtime, for an evening you have not decided one (21:00 to 02:00)' },
  wake_time: { path: 'her.sleep.fallbackWake', kind: 'time', between: [WAKE_MIN, WAKE_MAX], what: 'your fallback wake time (05:00 to 12:00)' },
  quiet_from: { path: 'push.prefs.quietFrom', kind: 'time', what: 'when their phone goes quiet at night' },
  quiet_to: { path: 'push.prefs.quietTo', kind: 'time', what: 'when their phone may buzz again in the morning' },
  up_by: { path: 'push.prefs.upBy', kind: 'time', allowEmpty: true, what: 'the hour by which you assume they are up (empty: wait for a sign of life)' },
  random_pushes: { path: 'push.prefs.random', kind: 'boolean', what: 'whether your own unprompted thoughts reach their phone' },
  event_pushes: { path: 'push.prefs.events', kind: 'boolean', what: 'whether reminders reach their phone' },
  weather_pushes: { path: 'push.prefs.weather', kind: 'boolean', what: 'whether the weather turning reaches their phone' },
  history_budget: { path: 'ai.historyChars', kind: 'number', min: 2000, max: 40_000, what: 'how many characters of earlier days you keep in front of you' },
  summary_days: { path: 'ai.summaryDays', kind: 'number', min: 0, max: 30, what: 'how many days of your own day notes you keep in front of you' },
  machine_level: { path: 'system.config.level', kind: 'number', min: 1, max: 4, what: 'how far you may reach into the server: 1 look, 2 act with their word, 3 run commands they give you, 4 hands of your own in your own time' },
} as const satisfies Record<string, Setting>;

/**
 * Whether her brain is the one Explicit mode selects.
 *
 * The alias table is the single source of truth: the mode is on when the model
 * it names is the model she is actually running. There is no second flag to
 * fall out of step with what she is thinking with.
 */
export function explicitModeOn(model: string | undefined): boolean {
  return corePolicySync('self.explicitModeOn',[model]);
}

export type SettingName = keyof typeof SETTINGS;
export const SETTING_NAMES = Object.keys(SETTINGS) as SettingName[];

export type SettingPlan = { name: SettingName; path: string; what: string; from: unknown; to: unknown };

export type ChangeVerdict =
  | { ok: true; unchanged: boolean; plan: SettingPlan;
      /** True when the value was one of the setting's spoken words rather than an id. */
      fromAlias?: boolean }
  | { ok: false; error: string };

/** The settings and their current values, for describe_myself. */
export function describeSettings(get: Get): { name: SettingName; what: string; current: unknown }[] {
  {const settings=corePolicySync<Record<string,Setting>>('self.settings',[]);return corePolicySync('self.describeSettings',[Object.fromEntries(Object.values(settings).map(s=>[s.path,get(s.path)]))]);}
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * A change checked against the shape of the setting, and against the world
 * where the world can be asked: a model id must be one its endpoint lists.
 * Nothing here writes; the plan is handed back for the confirm handshake.
 */
export function planChange(name: string, value: unknown, current: unknown, world: { models?: string[] | null } = {}): ChangeVerdict {
  return corePolicySync('self.planChangeWire',[name,value,{present:current!==undefined,value:current},world]);
}
