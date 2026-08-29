// The weather where they are, and what has changed about it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsWeather, weatherToDrawOn, WEATHER_RECENT_LINES, COOLDOWN_MS, describeWeather, readForecast, skyOf, weatherEvents, weatherUrl, WEATHER_STALE_MS, type WeatherSample } from '../electron/weather';

// 16:30 in Perth (UTC+8) on 2026-08-28, as Open-Meteo stamps it.
const NOW = Date.parse('2026-08-28T08:30:00Z');
const local = (h: number, m: number) => `2026-08-28T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function payload(over: Record<string, unknown> = {}) {
  return {
    utc_offset_seconds: 28800,
    current: { time: local(16, 30), temperature_2m: 16.8, precipitation: 0, weather_code: 0, wind_speed_10m: 15, is_day: 1 },
    minutely_15: { time: [local(16, 30), local(16, 45), local(17, 0), local(17, 15), local(17, 30), local(17, 45), local(18, 0), local(18, 15)], precipitation: [0, 0, 0, 0, 0, 0, 0, 0], precipitation_probability: [0, 0, 0, 0, 0, 0, 0, 0] },
    hourly: { time: Array.from({ length: 24 }, (_, h) => local(h, 0)), temperature_2m: Array.from({ length: 24 }, () => 15), weather_code: Array.from({ length: 24 }, () => 0) },
    daily: { temperature_2m_max: [19.4], temperature_2m_min: [9.8] },
    ...over,
  };
}

test('a forecast becomes a reading: temperature, sky, wind, the day’s range, and no rain in sight', () => {
  const sample = readForecast(payload(), NOW)!;
  assert.equal(sample.tempC, 16.8); assert.equal(sample.sky, 'clear'); assert.equal(sample.raining, false);
  assert.equal(sample.rainSoonMin, null); assert.equal(sample.turning, null);
  assert.deepEqual([sample.highC, sample.lowC], [19.4, 9.8]);
  assert.equal(readForecast({}, NOW), null);
  assert.match(weatherUrl(-31.9505, 115.8605), /latitude=-31\.951&longitude=115\.861.*minutely_15=precipitation/);
});

test('rain due in a quarter of an hour is read off the quarter-hour slots; a storm later off the hours', () => {
  const p = payload();
  (p.minutely_15 as { precipitation: number[] }).precipitation[1] = 0.4;
  (p.minutely_15 as { precipitation_probability: number[] }).precipitation_probability[1] = 80;
  (p.hourly as { weather_code: number[] }).weather_code[19] = 95;
  const sample = readForecast(p, NOW)!;
  assert.equal(sample.rainSoonMin, 15); assert.equal(sample.rainSoonProb, 80);
  assert.deepEqual(sample.turning, { inHours: 3, to: 'storm' });
  assert.equal(skyOf(61), 'rain'); assert.equal(skyOf(3), 'overcast'); assert.equal(skyOf(45), 'fog'); assert.equal(skyOf(71), 'snow'); assert.equal(skyOf(99), 'storm');
});

test('what buzzes the phone: rain soon, rain started and stopped, a sky turned, a swing — each on its own cooldown', () => {
  const clear = readForecast(payload(), NOW)!;
  const soon: WeatherSample = { ...clear, rainSoonMin: 15, rainSoonProb: 80 };
  const first = weatherEvents(clear, soon, {}, NOW);
  assert.equal(first.length, 1); assert.equal(first[0].kind, 'rain-soon'); assert.match(first[0].text, /in about 15 minutes \(80% likely\)/);
  assert.deepEqual(weatherEvents(clear, soon, { 'rain-soon': NOW - 60_000 }, NOW), [], 'already said for this shower');
  assert.equal(weatherEvents(clear, soon, { 'rain-soon': NOW - COOLDOWN_MS['rain-soon'] }, NOW).length, 1, 'said again two hours on');

  const wet: WeatherSample = { ...clear, raining: true, sky: 'rain', tempC: 14 };
  assert.deepEqual(weatherEvents(clear, wet, {}, NOW).map(e => e.kind), ['rain-started']);
  assert.deepEqual(weatherEvents(wet, clear, {}, NOW).map(e => e.kind), ['rain-stopped']);
  assert.deepEqual(weatherEvents(null, wet, {}, NOW), [], 'nothing to compare with yet');

  const overcast: WeatherSample = { ...clear, sky: 'overcast' };
  assert.deepEqual(weatherEvents(clear, overcast, {}, NOW).map(e => e.kind), ['sky-changed']);
  assert.deepEqual(weatherEvents(clear, { ...clear, sky: 'cloudy' }, {}, NOW), [], 'a few clouds is not news');
  const cold: WeatherSample = { ...clear, tempC: 10.5 };
  const swing = weatherEvents(clear, cold, {}, NOW);
  assert.equal(swing[0].kind, 'temp-swing'); assert.match(swing[0].text, /dropped 6 degrees/);
  const storm: WeatherSample = { ...clear, turning: { inHours: 2, to: 'storm' } };
  assert.deepEqual(weatherEvents(clear, storm, {}, NOW).map(e => e.kind), ['storm-coming']);
});

test('the prompt gets one line, with the range and what is coming, and nothing once the reading is old', () => {
  const sample = readForecast(payload(), NOW)!;
  const line = describeWeather(sample, 'Where they are', NOW + 5 * 60_000);
  assert.match(line, /^Where they are it is 17°C and clear; today's range 10°C to 19°C\./);
  assert.match(line, /do not say you cannot check/);
  assert.match(describeWeather({ ...sample, rainSoonMin: 30, raining: false }, 'At home', NOW), /rain due in about 30 minutes/);
  assert.match(describeWeather({ ...sample, turning: { inHours: 2, to: 'overcast' } }, 'At home', NOW), /turning overcast in about 2 hours/);
  assert.equal(describeWeather(sample, 'Where they are', NOW + WEATHER_STALE_MS + 1), '');
  assert.equal(describeWeather(null, 'Where they are', NOW), '');
});

test('weather talk in her own line is spotted however she phrases it', () => {
  for (const line of ['You are home in 15°C', 'it is 15 degrees out', 'still raining on you', 'a bit muggy', 'windy and you are hiding', 'storming later', 'the forecast says so', 'cloudy air'])
    assert.equal(mentionsWeather(line), true, line);
  for (const line of ['You ghosted my last text.', 'Three messages and nothing back.', 'The bins are still out there.', ''])
    assert.equal(mentionsWeather(line), false, line);
});

test('she is not handed the temperature again while it is still in her mouth', () => {
  const at = new Date().toISOString();
  const sample = { at, tempC: 15, sky: 'cloudy', raining: false, windKmh: 8, highC: 18, lowC: 11, rainSoonMin: null, turning: null } as never;
  const fresh = weatherToDrawOn(sample, 'At home', ['You ghosted me.', 'Three messages, nothing back.']);
  assert.match(fresh, /15/);
  // And without the line that told her to use it — that one belongs to an answer.
  assert.equal(fresh.includes('use it rather than guessing'), false);
  assert.match(fresh, /Background only/);
  // Having just said it, she is not given it again.
  assert.equal(weatherToDrawOn(sample, 'At home', ['You are home in 15°C and hiding.']), '');
  assert.equal(weatherToDrawOn(sample, 'At home', ['it is raining and you are still in bed']), '');
  // Only the last few count, so it comes back once she has moved on.
  const old = ['You are home in 15°C.', 'a', 'b', 'c', 'd'];
  assert.equal(old.length > WEATHER_RECENT_LINES, true);
  assert.match(weatherToDrawOn(sample, 'At home', old), /15/);
  // Nothing to report is still nothing.
  assert.equal(weatherToDrawOn(null, 'At home', []), '');
});
