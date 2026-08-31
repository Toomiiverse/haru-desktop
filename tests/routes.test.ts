// The road, from somebody who can see it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRoute, fixStatedRoute, parseRoute, plainRouteError, routeRequest, routeWords, ROUTES_URL } from '../electron/routes';

const google = { routes: [{ duration: '1860s', staticDuration: '1740s', distanceMeters: 33600, description: 'Kwinana Fwy/State Route 2' }] };

test('the request is coordinates only, traffic-aware, and asks for nothing it does not read', () => {
  const req = routeRequest({ lat: -32.0673, lon: 115.8287 }, { lat: -32.2898, lon: 115.7442 }, 'K');
  const body = JSON.parse(req.body);
  assert.equal(body.origin.location.latLng.latitude, -32.0673);
  assert.equal(body.routingPreference, 'TRAFFIC_AWARE_OPTIMAL');
  assert.equal(body.origin.address, undefined, 'never an address string — one routed a thousand kilometres north');
  assert.equal(req.headers['X-Goog-Api-Key'], 'K');
  assert.match(req.headers['X-Goog-FieldMask'], /routes\.duration,routes\.staticDuration,routes\.distanceMeters/);
});

test("what Google answers is reduced to minutes now, minutes normally, km and the road", () => {
  assert.deepEqual(parseRoute(google), { minutes: 31, typicalMinutes: 29, km: 33.6, via: 'Kwinana Fwy/State Route 2' });
  assert.deepEqual(parseRoute({ routes: [{ duration: '100s' }] }), { minutes: 2, typicalMinutes: 2, km: 0, via: '' });
  assert.equal(parseRoute({ routes: [] }), null);
  assert.equal(parseRoute({}), null);
});

test('in words: the traffic is said only when it is worth saying', () => {
  assert.match(routeWords({ minutes: 31, typicalMinutes: 29, km: 33.6, via: 'Kwinana Fwy' }, 'here'), /31 minutes from where they are right now, about the same as a normal day; 33\.6 km, via Kwinana Fwy/);
  assert.match(routeWords({ minutes: 33, typicalMinutes: 21, km: 23.7, via: '' }, 'home'), /33 minutes from home right now — slower than usual \(21 on a normal day\), so the traffic is heavy; 23\.7 km\./);
  assert.match(routeWords({ minutes: 20, typicalMinutes: 30, km: 20, via: 'x' }, 'here'), /quicker than usual/);
  assert.match(routeWords({ minutes: 31, typicalMinutes: 29, km: 33.6, via: '' }, 'here'), /quote them as they are/);
});

test('a refusal is said plainly, and a good answer comes back whole', async () => {
  const ok = async (url: string) => { assert.equal(url, ROUTES_URL); return { ok: true, status: 200, json: async () => google }; };
  assert.equal((await computeRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'K', ok)).minutes, 31);
  const off = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Routes API has not been used in project 123 before or it is disabled.' } }) });
  await assert.rejects(computeRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'K', off), /switched off on the Google project/);
  await assert.rejects(computeRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, '', ok), /no Google Maps key/);
  assert.equal(plainRouteError(403, { error: { message: 'You must enable Billing on the Google Cloud Project' } }), 'Google wants billing enabled on the project');
  assert.equal(plainRouteError(500, {}), 'Google answered 500');
});

test('the minutes, distance and roads she states become the route\'s; a right number and the rest of her line are left alone', () => {
  const route = { minutes: 18, typicalMinutes: 17, km: 9.7, via: 'Fitzgerald St and Alexander Dr/State Route 56' };
  assert.equal(fixStatedRoute('By car it’s about 10 minutes from where you are, via Stirling Hwy and Dianella Drive. Don’t dawdle. 🙄', route),
    'By car it’s 18 minutes from where you are, via Fitzgerald St and Alexander Dr/State Route 56. Don’t dawdle. 🙄');
  assert.equal(fixStatedRoute('18 minutes, about 9.7 km via Fitzgerald St and Alexander Dr/State Route 56. Go.', route), '18 minutes, about 9.7 km via Fitzgerald St and Alexander Dr/State Route 56. Go.');
  assert.equal(fixStatedRoute('roughly 45 minutes to an hour, 33 km.', route), '18 minutes, 9.7 km.');
  assert.equal(fixStatedRoute('about half an hour away.', route), '18 minutes away.');
  assert.equal(fixStatedRoute('18 minutes — 17 minutes on a normal day.', route), '18 minutes — 17 minutes on a normal day.', 'the typical time is hers to state too');
  assert.equal(fixStatedRoute('Get that CPU mounted in 10 minutes or else.', route), 'Get that CPU mounted in 18 minutes or else.', 'a duration she meant otherwise is the price of the rule — the route note tells her not to state others');
});

