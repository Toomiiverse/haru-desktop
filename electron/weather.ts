import {corePolicySync} from './core-policy-sync';
// The weather where they are, and what has changed about it.
//
// Open-Meteo, because it needs no key and no account: a forecast for a pair
// of coordinates, asked for every quarter hour while she knows where they are.
// What she is told is a sentence, and what buzzes the phone is a change — rain
// due in a quarter of an hour, rain that has started or stopped, a sky that
// has turned, a temperature that has swung — each on its own cooldown, so a
// showery afternoon is one message and not twelve.

export type Sky = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

export type WeatherSample = {
  at: string;
  tempC: number;
  sky: Sky;
  raining: boolean;
  /** Millimetres in the last hour, as the forecast has it. */
  mm?: number;
  windKmh: number;
  isDay: boolean;
  /** Minutes until the first rain due in the next couple of hours, or null. */
  rainSoonMin: number | null;
  rainSoonProb: number;
  /** The first sky change in the hours ahead, if there is one. */
  turning: { inHours: number; to: Sky } | null;
  highC: number | null;
  lowC: number | null;
};

export type WeatherEvent = { kind: 'rain-soon' | 'rain-started' | 'rain-stopped' | 'sky-changed' | 'temp-swing' | 'storm-coming'; text: string };

export const WEATHER_POLL_MS = 15 * 60_000;
/** A reading older than this says nothing about now. */
export const WEATHER_STALE_MS = 45 * 60_000;

/** How close rain has to be before it is worth remarking on. */
export const RAIN_SOON_MIN = 45;

/**
 * How many of these she may bring up in a day, whatever kind they are.
 *
 * The cooldowns below are per kind and cannot see one another, so a showery day
 * satisfied several at once and he got five in a day on 2026-09-03. Weather is
 * a way into a conversation, and a third one in a day is not a way into
 * anything.
 */
export const WEATHER_A_DAY = 2;

/** How often each kind of change may buzz the phone. */
export const COOLDOWN_MS: Record<WeatherEvent['kind'], number> = {
  'rain-soon': 2 * 60 * 60_000,
  'rain-started': 60 * 60_000,
  'rain-stopped': 60 * 60_000,
  'sky-changed': 3 * 60 * 60_000,
  'temp-swing': 6 * 60 * 60_000,
  'storm-coming': 3 * 60 * 60_000,
};

export function weatherUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + '&current=temperature_2m,precipitation,weather_code,wind_speed_10m,is_day'
    + '&minutely_15=precipitation,precipitation_probability&forecast_minutely_15=8'
    + '&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
}

/** WMO weather codes, as words she can use. */
export function skyOf(code: number): Sky {
  return corePolicySync<any>('conversation-policy.skyOf',[code]);
}

type Payload = {
  utc_offset_seconds?: number;
  current?: { time?: string; temperature_2m?: number; precipitation?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
  minutely_15?: { time?: string[]; precipitation?: number[]; precipitation_probability?: number[] };
  hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[] };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
};

/** Open-Meteo's local-time stamps, back to an instant. */
function instant(local: string, offsetSeconds: number): number {
  return Date.parse(local.length === 16 ? `${local}:00Z` : `${local}Z`) - offsetSeconds * 1000;
}

export function readForecast(payload: unknown, nowMs = Date.now()): WeatherSample | null {
  return corePolicySync<any>('conversation-policy.readForecast',[payload,nowMs]);
}

const deg = (c: number) => `${Math.round(c)}°C`;

/**
 * What has changed since last time, worth a buzz. Each kind on its own
 * cooldown, and rain-soon only when it was not already raining and was not
 * already said for this shower.
 */
/** She reads a forecast, not the sky over them: said as such, and never as what is happening to them. */
// The truth guard, kept. What went with it — "say it as the forecast" — did
// not: it turned every one of these into a weather report read aloud, which is
// the opposite of what they are for now. She may treat the weather as hers,
// because it is; what she may not do is claim to see him in it.
const FORECAST_NOT_A_WINDOW = ' You have this from the forecast rather than a window, so do not tell them they are wet, caught in it, or out in it — you do not know that. If they say it is not raining where they are, they are right.';

/** How long their "it's not raining here" outranks the forecast's rain. */
export const DISPUTE_STANDS_MS = 2 * 60 * 60_000;

// "It's not raining here", "no rain here", "it's dry out": their window
// against the forecast's model, and the window wins.
const DISPUTES_RAIN = /\b(?:it(?:'s|’s| is|s)?|its|it’s)\s+(?:not|isn(?:'|’)?t|ain(?:'|’)?t)\s+(?:even\s+|actually\s+|really\s+)?raining\b|\bnot raining\b|\bno rain\b(?! (?:due|forecast|coming))|\b(?:it(?:'s|’s| is)|its)\s+(?:bone\s+)?dry\s+(?:here|out|outside|at\b)|\bhasn(?:'|’)?t (?:been )?rain(?:ed|ing)\b|\bstopped raining\b/i;

/** They said it is not raining where they are. */
export function disputesRain(text: string): boolean {
  return corePolicySync<any>('conversation-policy.disputesRain',[text]);
}

export function disputeStands(disputedAtMs: number | undefined, nowMs: number): boolean {
  return corePolicySync<any>('conversation-policy.disputeStands',[disputedAtMs??null,nowMs]);
}

export function weatherEvents(previous: WeatherSample | null, current: WeatherSample, notified: Record<string, number>, nowMs = Date.now(), disputedAtMs?: number): WeatherEvent[] {
  return corePolicySync<any>('conversation-policy.weatherEvents',[previous,current,notified,nowMs,disputedAtMs??null]);
}

/**
 * Weather talk in a line of hers, so she is not handed the temperature twice
 * running. Deliberately broad — a degree sign, a sky, or the word itself.
 */
const WEATHER_TALK = /-?\d+\s*°|\bdegrees?\b|\brain(?:ing|y)?\b|\bsunny\b|\bclouds?\b|\bcloudy\b|\bovercast\b|\bhumid\b|\bmuggy\b|\bwind(?:y)?\b|\bstorm\w*\b|\bdrizzl\w*\b|\bchilly\b|\bfreezing\b|\bweather\b|\bforecast\b/i;

export function mentionsWeather(line: string): boolean {
  return corePolicySync<any>('conversation-policy.mentionsWeather',[line]);
}

/** How many of her own recent unprompted lines are looked at before offering it again. */
export const WEATHER_RECENT_LINES = 4;

/**
 * The weather for a line nobody asked for, which is not the same thing as the
 * weather for an answer.
 *
 * describeWeather below ends by telling her to use it rather than guess — right
 * when they have asked what it is like out, and quite wrong as standing context
 * for every unprompted line, where it reads as an instruction to mention the
 * temperature. She duly did: five of fourteen consecutive nudges opened with
 * it, three of them with the same "you're home in 15°C" construction, and it
 * became her stock way of starting a sentence.
 *
 * The lever is not a rule telling her to stop — she is copying the most
 * concrete fact in front of her, and the fix is to stop putting it there. So it
 * is withheld whenever she has mentioned the weather in her last few unprompted
 * lines, and offered without the instruction to use it. Genuine turns in the
 * weather have their own channel (weatherEvents, pushed as a `weather` aside)
 * and do not depend on this.
 */
export function weatherToDrawOn(sample: WeatherSample | null, where: string, recentLines: string[], nowMs = Date.now(), disputedAtMs?: number): string {
  return corePolicySync<any>('conversation-policy.weatherToDrawOn',[sample,where,recentLines,nowMs,disputedAtMs??null]);
}

/** The readings themselves, with no instruction attached about what to do with them. */
function weatherFacts(sample: WeatherSample | null, where: string, nowMs: number, disputedAtMs?: number): string {
  if (!sample) return '';
  const age = nowMs - Date.parse(sample.at);
  if (!Number.isFinite(age) || age < 0 || age > WEATHER_STALE_MS) return '';
  const disputed = disputeStands(disputedAtMs, nowMs);
  const sky = sample.raining ? (disputed ? `${sample.sky === 'drizzle' || sample.sky === 'rain' || sample.sky === 'storm' ? 'overcast' : sample.sky} (the forecast says rain, but they told you it is not raining where they are — their word wins, do not mention rain)` : 'raining') : sample.sky;
  const parts = [`${where} it is ${deg(sample.tempC)} and ${sky}${sample.windKmh >= 30 ? `, windy (${Math.round(sample.windKmh)} km/h)` : ''}`];
  if (sample.highC !== null && sample.lowC !== null) parts.push(`today's range ${deg(sample.lowC)} to ${deg(sample.highC)}`);
  if (!disputed && sample.rainSoonMin !== null && sample.rainSoonMin <= 120) parts.push(`rain due in about ${sample.rainSoonMin <= 5 ? 'a few' : sample.rainSoonMin} minutes`);
  else if (sample.turning) parts.push(`turning ${sample.turning.to} in about ${sample.turning.inHours} hour${sample.turning.inHours === 1 ? '' : 's'}`);
  return parts.join('; ');
}

/** The one line the prompt gets when they have asked, or nothing when the reading is old. */
export function describeWeather(sample: WeatherSample | null, where: string, nowMs = Date.now(), disputedAtMs?: number): string {
  return corePolicySync<any>('conversation-policy.describeWeather',[sample,where,nowMs,disputedAtMs??null]);
}
