// A place, from somebody who has been there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, parsePlaces, placeAsk, placeNote, placeRequest, placeWords, plainPlaceError, searchGooglePlaces, PLACES_URL } from '../electron/placeinfo';

const happytel = { displayName: { text: 'Happytel Rockingham' }, formattedAddress: 'K031 Rockingham Centre, 1 Council Ave, Rockingham WA 6168, Australia', location: { latitude: -32.2779, longitude: 115.7318 }, types: ['store', 'point_of_interest'], rating: 4.8, userRatingCount: 658, businessStatus: 'OPERATIONAL', currentOpeningHours: { openNow: false, weekdayDescriptions: ['Monday: 9:00 am – 5:30 pm', 'Tuesday: 9:00 am – 5:30 pm', 'Wednesday: 9:00 am – 5:30 pm', 'Thursday: 9:00 am – 9:00 pm', 'Friday: 9:00 am – 5:30 pm', 'Saturday: 9:00 am – 5:00 pm', 'Sunday: 11:00 am – 5:00 pm'] } };
const suburb = { displayName: { text: 'Rockingham' }, formattedAddress: 'Rockingham WA 6168, Australia', location: { latitude: -32.2781, longitude: 115.7351 }, types: ['locality', 'political'] };
const road = { displayName: { text: 'Rockingham Road' }, formattedAddress: 'Rockingham Rd, Hamilton Hill WA 6163, Australia', location: { latitude: -32.09, longitude: 115.78 }, types: ['route'] };

test('the request is a text search biased to where they are, within Australia, asking only for what is read', () => {
  const req = placeRequest('Happytel Rockingham', 'K', { lat: -32.07, lon: 115.83 });
  const body = JSON.parse(req.body);
  assert.equal(body.textQuery, 'Happytel Rockingham');
  assert.equal(body.regionCode, 'AU');
  assert.equal(body.locationBias.circle.center.latitude, -32.07);
  assert.equal(body.locationBias.circle.radius, 30_000);
  assert.equal(req.headers['X-Goog-Api-Key'], 'K');
  assert.match(req.headers['X-Goog-FieldMask'], /currentOpeningHours\.openNow/);
  assert.equal(JSON.parse(placeRequest('Coles', 'K', null).body).locationBias, undefined, 'no position, no bias');
});

test('what Google answers becomes a found place with the facts on it', () => {
  const [shop, sub, rd] = parsePlaces({ places: [happytel, suburb, road] });
  assert.equal(shop.name, 'Happytel Rockingham, Rockingham');
  assert.equal(shop.kind, 'other');
  assert.equal(shop.address, 'K031 Rockingham Centre, 1 Council Ave, Rockingham WA 6168');
  assert.equal(shop.rating, 4.8); assert.equal(shop.ratings, 658); assert.equal(shop.openNow, false);
  assert.equal(shop.hours?.length, 7);
  assert.equal(sub.name, 'Rockingham', 'the suburb is not "Rockingham, Rockingham"');
  assert.equal(sub.kind, 'place');
  assert.equal(rd.kind, 'road');
  assert.equal(sub.rating, undefined, 'nothing invented for a suburb');
  assert.deepEqual(parsePlaces({}), []);
  assert.equal(areaOf('12 Smith St, Wembley WA 6014, Australia'), 'Wembley');
});

test('the words are the door first, then the rest, with today picked out of the week by name', () => {
  const [shop] = parsePlaces({ places: [happytel] });
  const words = placeWords(shop, 4);
  assert.match(words, /^Address: K031/);
  assert.match(words, /Rated 4\.8 on Google from 658 reviews\./);
  assert.match(words, /It is closed right now\./);
  assert.match(words, /Hours today — Thursday: 9:00 am – 9:00 pm\./);
  assert.doesNotMatch(words, /Monday/);
  const gone = parsePlaces({ places: [{ ...happytel, businessStatus: 'CLOSED_PERMANENTLY' }] })[0];
  assert.match(placeWords(gone, 1), /^Google lists it as permanently closed\./);
  assert.equal(placeWords({ name: 'Rockingham' }, 1), '', 'a suburb has nothing to say');
});

test('a Google refusal is said plainly, without the console link', () => {
  assert.equal(plainPlaceError(403, { error: { message: 'Places API (New) has not been used in project 123 before or it is disabled. Enable it by visiting https://console...' } }), 'the Places API is switched off on the Google project');
  assert.equal(plainPlaceError(403, { error: { message: 'The caller does not have permission' } }), 'Google refused the key');
});

test('the search posts to Google and parses the answer; a bad status is an error', async () => {
  let posted: { url: string; body: string } | null = null;
  const fetchImpl = async (url: string, init: { body: string }) => { posted = { url, body: init.body }; return { ok: true, status: 200, json: async () => ({ places: [happytel] }) }; };
  const found = await searchGooglePlaces('happytel', 'K', null, fetchImpl);
  assert.equal(posted!.url, PLACES_URL);
  assert.equal(found[0].rating, 4.8);
  await assert.rejects(searchGooglePlaces('happytel', 'K', null, async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'The caller does not have permission' } }) })), /refused the key/);
  await assert.rejects(searchGooglePlaces('happytel', '', null, fetchImpl), /no Google Maps key/);
});

test('the doors-and-hours questions are noticed, and the things that are not shops are not', () => {
  assert.deepEqual(placeAsk('is Coles still open?'), { destination: 'Coles', want: 'open' });
  assert.deepEqual(placeAsk('Is the Rockingham Bunnings open right now'), { destination: 'Rockingham Bunnings', want: 'open' });
  assert.deepEqual(placeAsk('what time does Happytel close today?'), { destination: 'Happytel', want: 'hours' });
  assert.deepEqual(placeAsk("what's Bunnings Rockingham's opening hours"), { destination: 'Bunnings Rockingham', want: 'hours' });
  assert.deepEqual(placeAsk('is Sushi Hub in Rockingham any good?'), { destination: 'Sushi Hub in Rockingham', want: 'rating' });
  assert.equal(placeAsk('is it open?'), null);
  assert.equal(placeAsk('is the door open'), null);
  assert.equal(placeAsk('are you open to that'), null);
  assert.equal(placeAsk('is the server still open'), null);
  assert.equal(placeAsk('what time does school close'), null);
});

test('her brief quotes the facts, or says nothing was found, and never asks for a route', () => {
  const [shop] = parsePlaces({ places: [happytel] });
  const note = placeNote({ destination: 'Happytel', want: 'open' }, shop, 1);
  assert.match(note, /whether it is open/);
  assert.match(note, /It is closed right now\./);
  assert.match(note, /Hours today — Monday/);
  assert.doesNotMatch(note, /button|route/);
  assert.match(placeNote({ destination: 'Narnia Cafe', want: 'hours' }, null, 1), /nothing was found by that name/);
  const bare = placeNote({ destination: 'Rockingham', want: 'rating' }, parsePlaces({ places: [suburb] })[0], 1);
  assert.match(bare, /Google has no hours or rating for it\./);
});
