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
  if (code === 0) return 'clear';
  if (code <= 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code <= 48) return 'fog';
  if (code <= 57) return 'drizzle';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'rain';
  if (code <= 79 || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95) return 'storm';
  return 'rain';
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
  const p = (payload ?? {}) as Payload;
  const c = p.current;
  if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number') return null;
  const offset = typeof p.utc_offset_seconds === 'number' ? p.utc_offset_seconds : 0;
  const raining = (c.precipitation ?? 0) > 0.05 || ['drizzle', 'rain', 'storm'].includes(skyOf(c.weather_code));

  let rainSoonMin: number | null = null, rainSoonProb = 0;
  const m = p.minutely_15 ?? {};
  for (const [i, when] of (m.time ?? []).entries()) {
    const at = instant(when, offset);
    const minutes = Math.round((at - nowMs) / 60_000);
    if (minutes < -7 || minutes > 120) continue;
    const mm = m.precipitation?.[i] ?? 0, prob = m.precipitation_probability?.[i] ?? 0;
    if (mm > 0.05 || prob >= 60) { rainSoonMin = Math.max(0, minutes); rainSoonProb = prob; break; }
  }

  let turning: WeatherSample['turning'] = null;
  const h = p.hourly ?? {};
  const nowSky = skyOf(c.weather_code);
  for (const [i, when] of (h.time ?? []).entries()) {
    const hours = (instant(when, offset) - nowMs) / 3_600_000;
    if (hours < 0.5 || hours > 6) continue;
    const sky = skyOf(h.weather_code?.[i] ?? c.weather_code);
    if (sky !== nowSky) { turning = { inHours: Math.max(1, Math.round(hours)), to: sky }; break; }
  }

  return {
    at: new Date(nowMs).toISOString(),
    tempC: c.temperature_2m,
    sky: nowSky,
    raining,
    mm: c.precipitation ?? 0,
    windKmh: c.wind_speed_10m ?? 0,
    isDay: c.is_day !== 0,
    rainSoonMin: raining ? null : rainSoonMin,
    rainSoonProb,
    turning,
    highC: p.daily?.temperature_2m_max?.[0] ?? null,
    lowC: p.daily?.temperature_2m_min?.[0] ?? null,
  };
}

const deg = (c: number) => `${Math.round(c)}°C`;

/**
 * What has changed since last time, worth a buzz. Each kind on its own
 * cooldown, and rain-soon only when it was not already raining and was not
 * already said for this shower.
 */
/** She reads a forecast, not the sky over them: said as such, and never as what is happening to them. */
const FORECAST_NOT_A_WINDOW = ' This is what the forecast service says, not something you can see: say it as the forecast, and do not tell them they are wet, caught in it, or out in it — you do not know that. If they say it is not raining where they are, they are right.';

export function weatherEvents(previous: WeatherSample | null, current: WeatherSample, notified: Record<string, number>, nowMs = Date.now()): WeatherEvent[] {
  const fresh = (kind: WeatherEvent['kind']) => nowMs - (notified[kind] ?? 0) >= COOLDOWN_MS[kind];
  const out: WeatherEvent[] = [];
  if (!current.raining && current.rainSoonMin !== null && current.rainSoonMin <= 45 && fresh('rain-soon')) {
    const when = current.rainSoonMin <= 5 ? 'any minute now' : `in about ${current.rainSoonMin} minutes`;
    out.push({ kind: 'rain-soon', text: `The forecast has rain due where they are ${when}${current.rainSoonProb ? ` (${current.rainSoonProb}% likely)` : ''}. It is ${deg(current.tempC)} and ${current.sky} there right now.${FORECAST_NOT_A_WINDOW}` });
  }
  if (previous) {
    // Drizzle is a weather code, not a shower: a forecast model's "drizzle" over
    // a dry shop earned "It's raining, you're wet". Real rain, or measurable
    // drizzle, is a push; a code alone is not.
    const shower = current.raining && (current.sky !== 'drizzle' || (current.mm ?? 0) >= 0.3);
    if (shower && !previous.raining && fresh('rain-started')) out.push({ kind: 'rain-started', text: `The forecast says it has started raining where they are (${current.sky}). ${deg(current.tempC)}.${FORECAST_NOT_A_WINDOW}` });
    if (!current.raining && previous.raining && fresh('rain-stopped')) out.push({ kind: 'rain-stopped', text: `The rain has stopped where they are; it is ${current.sky} now, ${deg(current.tempC)}.` });
    const swing = current.tempC - previous.tempC;
    if (Math.abs(swing) >= 5 && fresh('temp-swing')) out.push({ kind: 'temp-swing', text: `It has ${swing < 0 ? 'dropped' : 'climbed'} ${Math.round(Math.abs(swing))} degrees where they are since she last looked: ${deg(current.tempC)} now.` });
    const notable = (sky: Sky) => sky === 'clear' || sky === 'overcast' || sky === 'fog' || sky === 'snow';
    if (current.sky !== previous.sky && !current.raining && !previous.raining && notable(current.sky) && fresh('sky-changed')) {
      out.push({ kind: 'sky-changed', text: `The sky where they are has turned from ${previous.sky} to ${current.sky}. ${deg(current.tempC)}.` });
    }
  }
  if (current.turning?.to === 'storm' && current.sky !== 'storm' && fresh('storm-coming')) {
    out.push({ kind: 'storm-coming', text: `A thunderstorm is forecast where they are in about ${current.turning.inHours} hour${current.turning.inHours === 1 ? '' : 's'}.` });
  }
  return out;
}

/**
 * Weather talk in a line of hers, so she is not handed the temperature twice
 * running. Deliberately broad — a degree sign, a sky, or the word itself.
 */
const WEATHER_TALK = /-?\d+\s*°|\bdegrees?\b|\brain(?:ing|y)?\b|\bsunny\b|\bclouds?\b|\bcloudy\b|\bovercast\b|\bhumid\b|\bmuggy\b|\bwind(?:y)?\b|\bstorm\w*\b|\bdrizzl\w*\b|\bchilly\b|\bfreezing\b|\bweather\b|\bforecast\b/i;

export function mentionsWeather(line: string): boolean {
  return WEATHER_TALK.test(line ?? '');
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
export function weatherToDrawOn(sample: WeatherSample | null, where: string, recentLines: string[], nowMs = Date.now()): string {
  if (recentLines.slice(-WEATHER_RECENT_LINES).some(mentionsWeather)) return '';
  const facts = weatherFacts(sample, where, nowMs);
  return facts ? `${facts}. Background only: they have not asked, and it is not what this is about.` : '';
}

/** The readings themselves, with no instruction attached about what to do with them. */
function weatherFacts(sample: WeatherSample | null, where: string, nowMs: number): string {
  if (!sample) return '';
  const age = nowMs - Date.parse(sample.at);
  if (!Number.isFinite(age) || age < 0 || age > WEATHER_STALE_MS) return '';
  const parts = [`${where} it is ${deg(sample.tempC)} and ${sample.raining ? 'raining' : sample.sky}${sample.windKmh >= 30 ? `, windy (${Math.round(sample.windKmh)} km/h)` : ''}`];
  if (sample.highC !== null && sample.lowC !== null) parts.push(`today's range ${deg(sample.lowC)} to ${deg(sample.highC)}`);
  if (sample.rainSoonMin !== null && sample.rainSoonMin <= 120) parts.push(`rain due in about ${sample.rainSoonMin <= 5 ? 'a few' : sample.rainSoonMin} minutes`);
  else if (sample.turning) parts.push(`turning ${sample.turning.to} in about ${sample.turning.inHours} hour${sample.turning.inHours === 1 ? '' : 's'}`);
  return parts.join('; ');
}

/** The one line the prompt gets when they have asked, or nothing when the reading is old. */
export function describeWeather(sample: WeatherSample | null, where: string, nowMs = Date.now()): string {
  const facts = weatherFacts(sample, where, nowMs);
  return facts ? `${facts}. That is the actual weather, from a forecast service, as of a few minutes ago — use it rather than guessing, and do not say you cannot check.` : '';
}
