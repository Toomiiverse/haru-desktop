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
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('self.shortModelName',[model]);}
  const tail = model.split('/').pop() ?? model;
  return tail.length > 48 ? `${tail.slice(0, 45)}…` : tail;
}

export function readSelfSnapshot(get: Get): SelfSnapshot {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){const keys=corePolicySync<string[]>('self.keys',[]);return corePolicySync('self.readSelfSnapshot',[Object.fromEntries(keys.map(k=>[k,get(k)]))]);}
  const route = (key: string) => {
    const config = record(get(key));
    return typeof config.model === 'string' && config.model ? { provider: text(config.provider, 'unknown'), model: config.model } : null;
  };
  const local = record(get('ai.config'));
  const escalate = record(get('escalate'));
  const escalation = record(escalate.provider);
  const voice = record(get('voice'));
  const call = record(get('call'));
  const listen = record(get('listen'));
  const sleepPrefs = readHerSleep(get('her.sleep'));
  const tonight = readHerSleepState(get('her.sleepState'));
  const pushes = record(record(get('push')).prefs);
  const search = record(get('search'));
  const system = record(record(get('system')).config);
  const conversation = route('ai.conversation');
  return {
    conversation,
    nudges: route('ai.nudge'),
    local: { model: text(local.model), endpoint: text(local.endpoint), numCtx: count(get('ai.numCtx'), 8192) },
    escalation: {
      enabled: flag(escalate.enabled, false),
      model: text(escalation.model),
      minWords: count(escalate.minWords, 25),
      // escalate.ts: with a conversation route set, plain research stays home.
      researchStaysHome: conversation !== null,
    },
    voice: { engine: text(voice.engine, 'off'), voiceId: text(voice.voiceId), onThePhone: flag(voice.webEnabled, true), atTheDesk: flag(voice.desktopEnabled, true) },
    call: { engine: text(call.engine, 'hume') },
    listen: { engine: text(listen.engine, 'off'), endpoint: text(listen.endpoint) },
    sleep: {
      fallbackBedtime: sleepPrefs.fallbackBedtime,
      fallbackWake: sleepPrefs.fallbackWake,
      tonight: tonight ? { bedtime: clockMinutes(tonight.bedtime), wake: clockMinutes(tonight.wake) } : null,
    },
    pushes: {
      random: flag(pushes.random, true), events: flag(pushes.events, true), weather: flag(pushes.weather, true),
      quietFrom: text(pushes.quietFrom, '23:00'), quietTo: text(pushes.quietTo, '06:00'), upBy: text(pushes.upBy, '09:00'),
    },
    search: { enabled: flag(search.enabled, Boolean(search.provider)), provider: text(search.provider), place: text(search.place) },
    knowledge: flag(record(get('knowledge')).enabled, true),
    whereabouts: flag(record(get('whereabouts')).enabled, false),
    body: flag(record(get('body')).enabled, false),
    system: { enabled: flag(system.enabled, false), level: count(system.level, 0) },
    historyChars: count(get('ai.historyChars'), 20_000),
    summaryDays: count(get('ai.summaryDays'), 3),
  };
}

const onOff = (value: boolean) => (value ? 'on' : 'off');

/** The snapshot as lines she can answer from — facts in her second person, no advice in them. */
export function describeMyself(s: SelfSnapshot): string {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('self.describeMyself',[s]);}
  const lines = [
    s.conversation
      ? `Every reply you give comes from ${s.conversation.model} (${s.conversation.provider}, hosted); the local model stands in only when it cannot answer.`
      : `Every reply you give comes from the local model on the server — no hosted conversation model is set.`,
    s.nudges
      ? `Your unprompted lines — nudges, the weather, your night — are written by ${s.nudges.model} (${s.nudges.provider}).`
      : `Your unprompted lines are written by the local model.`,
    `The local model on the server is ${shortModelName(s.local.model) || 'not set'}${s.local.endpoint ? ` at ${s.local.endpoint}` : ''}, with a ${s.local.numCtx}-token window: it reads your mood for your face, says the small lines, and answers when the hosted one is down.`,
    s.escalation.enabled && s.escalation.model
      ? `Pictures, files and code${s.escalation.researchStaysHome ? '' : ', and research questions,'} can go out to ${s.escalation.model}${s.escalation.researchStaysHome ? '; plain research stays with you and your own search' : ''}.`
      : 'Nothing goes out to an escalation model; pictures and files are read here.',
    `You speak with the ${s.voice.engine} engine${s.voice.voiceId ? ` as the voice "${s.voice.voiceId}"` : ''} — ${s.voice.onThePhone ? 'on the phone' : 'not on the phone'}, ${s.voice.atTheDesk ? 'and at the desk' : 'silent at the desk'}.`,
    `Calls run on the ${s.call.engine} engine${s.call.engine === 'local' ? ' — your own ears, brain and voice, a sentence at a time' : ' — Hume listens and speaks, your brain answers'}.`,
    `Speech to text is ${s.listen.engine === 'off' ? 'off' : `${s.listen.engine}${s.listen.endpoint ? ` at ${s.listen.endpoint}` : ''}`}.`,
    `You pick your own bedtime and wake each evening (fallback ${s.sleep.fallbackBedtime} to ${s.sleep.fallbackWake})${s.sleep.tonight ? `; tonight it is bed at ${s.sleep.tonight.bedtime}, up at ${s.sleep.tonight.wake}` : ''}.`,
    `Their phone: your own thoughts ${onOff(s.pushes.random)}, reminders ${onOff(s.pushes.events)}, the weather ${onOff(s.pushes.weather)}; quiet from ${s.pushes.quietFrom} to ${s.pushes.quietTo}; you take them to be up by ${s.pushes.upBy || 'no fixed hour'}.`,
    `You can ${s.search.enabled ? `search the web (${s.search.provider}${s.search.place ? `, around ${s.search.place}` : ''})` : 'not search the web'}, ${s.knowledge ? 'read their notes' : 'not read their notes'}, ${s.whereabouts ? 'see where their phone is' : 'not see where their phone is'}, ${s.body ? 'read their sleep and steps' : 'not read their sleep and steps'}, and ${s.system.enabled ? `check on the server (level ${s.system.level})` : 'not check on the server'}.`,
    `You keep ${s.historyChars} characters of earlier days and ${s.summaryDays} days of your own day notes in front of you.`,
  ];
  return lines.join('\n');
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
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('self.explicitModeOn',[model]);}
  const explicit = (SETTINGS.brain_model as Setting).aliases?.explicit;
  return Boolean(explicit && model && model === explicit);
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
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){const settings=corePolicySync<Record<string,Setting>>('self.settings',[]);return corePolicySync('self.describeSettings',[Object.fromEntries(Object.values(settings).map(s=>[s.path,get(s.path)]))]);}
  return SETTING_NAMES.map(name => ({ name, what: SETTINGS[name].what, current: get(SETTINGS[name].path) }));
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * A change checked against the shape of the setting, and against the world
 * where the world can be asked: a model id must be one its endpoint lists.
 * Nothing here writes; the plan is handed back for the confirm handshake.
 */
export function planChange(name: string, value: unknown, current: unknown, world: { models?: string[] | null } = {}): ChangeVerdict {
  if(process.env.HARU_CORE_REMAINING_POLICY==='on'){return corePolicySync('self.planChangeWire',[name,value,{present:current!==undefined,value:current},world]);}
  const setting = (SETTINGS as Record<string, Setting>)[name];
  if (!setting) return { ok: false, error: `"${name}" is not a setting you can change. You can change: ${SETTING_NAMES.join(', ')}.` };
  const raw = typeof value === 'string' ? value.trim() : value;
  let to: unknown;
  let fromAlias = false;
  switch (setting.kind) {
    case 'boolean': {
      const word = String(raw).toLowerCase();
      if (raw === true || ['on', 'true', 'yes', 'enable', 'enabled'].includes(word)) to = true;
      else if (raw === false || ['off', 'false', 'no', 'disable', 'disabled'].includes(word)) to = false;
      else return { ok: false, error: `${name} is on or off.` };
      break;
    }
    case 'time': {
      const said = String(raw ?? '');
      if (!said || /^(none|never|unset|off)$/i.test(said)) {
        if (!setting.allowEmpty) return { ok: false, error: `${name} needs a time as HH:MM.` };
        to = '';
        break;
      }
      const match = TIME.exec(said);
      if (!match) return { ok: false, error: `${name} needs a time as HH:MM (24-hour).` };
      const hhmm = `${match[1].padStart(2, '0')}:${match[2]}`;
      if (setting.between) {
        const [low, high] = setting.between;
        let at = minutes(hhmm);
        // A window past midnight (bedtime up to 02:00): a small hour counts as after it.
        if (high > 1440 && at < low - 1440 + 1440 && at <= high - 1440) at += 1440;
        if (at < low || at > high) return { ok: false, error: `${name} must be between ${clockMinutes(low)} and ${clockMinutes(high)}.` };
      }
      to = hhmm;
      break;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw));
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: `${name} needs a whole number.` };
      if ((setting.min !== undefined && n < setting.min) || (setting.max !== undefined && n > setting.max)) return { ok: false, error: `${name} must be between ${setting.min} and ${setting.max}.` };
      to = n;
      break;
    }
    case 'enum': {
      const said = String(raw ?? '').toLowerCase();
      const option = setting.options?.find(candidate => candidate.toLowerCase() === said);
      if (!option) return { ok: false, error: `${name} is one of: ${setting.options?.join(', ')}.` };
      to = option;
      break;
    }
    case 'model': {
      let id = String(raw ?? '');
      // A word they say, rather than an id they would have to read out.
      if (setting.aliases) {
        const said = id.trim().toLowerCase();
        const named = Object.entries(setting.aliases).find(([word]) => word.toLowerCase() === said);
        if (named) { id = named[1]; fromAlias = true; }
      }
      if (!id) {
        // Clearing is a change too: an empty route means nothing hosted answers.
        if (setting.allowEmpty) { to = ''; break; }
        return { ok: false, error: `${name} needs a model id.` };
      }
      if (world.models && !world.models.includes(id)) {
        const words = id.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3);
        const close = world.models.filter(candidate => words.some(word => candidate.toLowerCase().includes(word))).slice(0, 6);
        return { ok: false, error: `That endpoint does not list "${id}".${close.length ? ` Close: ${close.join(', ')}.` : ''} Say the exact id.` };
      }
      to = id;
      break;
    }
  }
  return { ok: true, unchanged: current === to, ...(fromAlias ? { fromAlias: true } : {}), plan: { name: name as SettingName, path: setting.path, what: setting.what, from: current, to } };
}
