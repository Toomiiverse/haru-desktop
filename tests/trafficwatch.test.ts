// "Let me know when the traffic eases": the ask, the stop, the threshold, and what she is told.

import test from 'node:test';
import assert from 'node:assert/strict';
import { easedEnough, easedPrompt, gaveUpFallback, stopsTrafficWatch, trafficWatchAsk, TRAFFIC_WATCH_KIND, watchJob, watchNote, WATCH_EVERY_MS, WATCH_FOR_MS } from '../electron/trafficwatch';

test('the ask is noticed however it is put, home unless a place is named', () => {
  // The message that went unkept on 2026-09-17.
  assert.deepEqual(trafficWatchAsk('Let me know when traffic loosens up so I can drive home without traffic'), { destination: 'home' });
  assert.deepEqual(trafficWatchAsk('Haru ping me when the traffic clears'), { destination: 'home' });
  assert.deepEqual(trafficWatchAsk('can you tell me once the roads are better?'), { destination: 'home' });
  assert.deepEqual(trafficWatchAsk('give me a heads up when traffic dies down'), { destination: 'home' });
  assert.deepEqual(trafficWatchAsk('let me know when the traffic to Rockingham eases off'), { destination: 'Rockingham' });
  assert.deepEqual(trafficWatchAsk('lmk if the freeway gets better'), { destination: 'home' });
});

test('not every mention of traffic is a watch', () => {
  for (const text of [
    'Can you check how the traffic is like going home?',
    'the traffic was awful today',
    'let me know when you finish reading',
    'tell me when the website traffic goes up',
    "I'll let you know when traffic eases",
  ]) {
    assert.equal(trafficWatchAsk(text), null, text);
  }
});

test('never mind, or leaving, calls it off; ordinary talk does not', () => {
  for (const text of ['never mind', 'stop watching the traffic', "I'm leaving now", 'heading home now', 'Haru forget it', "don't bother"]) {
    assert.equal(stopsTrafficWatch(text), true, text);
  }
  for (const text of ['I am leaving work at 6 tomorrow', 'never mind that, what about dinner?', 'stop it haha']) {
    assert.equal(stopsTrafficWatch(text), false, text);
  }
});

test('eased means back near a normal day', () => {
  assert.equal(easedEnough({ minutes: 24, typicalMinutes: 16 }), false);
  assert.equal(easedEnough({ minutes: 19, typicalMinutes: 16 }), true, 'three minutes over is normal enough');
  assert.equal(easedEnough({ minutes: 20, typicalMinutes: 16 }), false);
  assert.equal(easedEnough({ minutes: 69, typicalMinutes: 60 }), true, 'fifteen per cent on a long drive');
  assert.equal(easedEnough({ minutes: 70, typicalMinutes: 60 }), false);
  assert.equal(easedEnough({ minutes: 10, typicalMinutes: 0 }), false, 'no typical time, nothing to compare');
});

test('the job is one watch, re-read every few minutes, for two hours', () => {
  const now = Date.parse('2026-09-17T09:44:00Z');
  const job = watchJob('home', { name: 'home', lat: -32.06, lon: 115.82 }, now);
  assert.equal(job.id, TRAFFIC_WATCH_KIND);
  assert.equal(job.kind, TRAFFIC_WATCH_KIND);
  assert.equal(job.dueAt, now + WATCH_EVERY_MS);
  assert.deepEqual(job.schedule, { at: now + WATCH_EVERY_MS });
  assert.equal(job.payload?.until, now + WATCH_FOR_MS);
  assert.ok((job.expiresAt ?? 0) > now + WATCH_FOR_MS, 'the scheduler does not drop it before the last read');
});

test('what she is told is what the app will do, and no more', () => {
  const now = Date.parse('2026-09-17T09:44:00Z');
  const on = watchNote('home', { minutes: 24, typicalMinutes: 16 }, now, 'Australia/Perth', true);
  assert.match(on, /it is the app that does it/);
  assert.match(on, /every 5 minutes until 7:44 pm/i);
  assert.match(on, /24 minutes now, 16 on a normal day/);
  assert.match(on, /Do not say you will keep checking yourself/);
  assert.match(watchNote('home', { minutes: 17, typicalMinutes: 16 }, now, 'Australia/Perth', false), /It already has: 17 minutes now/);
  assert.match(watchNote('home', null, now, 'Australia/Perth', false), /nothing is watching it/);
  const eased = easedPrompt('home', { minutes: 18, typicalMinutes: 16, km: 17.2, via: 'State Route 2' }, now, now + 40 * 60_000);
  assert.match(eased, /40 minutes ago/);
  assert.match(eased, /18 minutes now \(16 on a normal day\), 17\.2 km via State Route 2/);
  assert.match(gaveUpFallback('Rockingham', { minutes: 40, typicalMinutes: 30 }), /Traffic to Rockingham never cleared — still 40 min against 30/);
});
