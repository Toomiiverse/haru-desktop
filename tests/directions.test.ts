// The way somewhere: noticing the ask, naming the place, and the link she never types.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDestination, directionsAsk, directionsNote, dropRouteTalk, googleMapsLink, mapsLink, matchNamedPlace, startingPoint, withDirections } from '../electron/directions';
import { absorb, namePlace, readSpot, readWhereabouts, type Whereabouts } from '../electron/whereabouts';

const NOW = new Date('2026-08-28T10:00:00Z');
const HOME = { lat: -31.9505, lon: 115.8605 };
const COLES = { name: 'Coles, Wembley', lat: -31.9330, lon: 115.7990 };

function withHome(): Whereabouts {
  const spot = readSpot({ ...HOME, accuracy: 30, net: 'wifi' }, NOW)!;
  return namePlace(absorb({ ...readWhereabouts({}), enabled: true }, spot), 'home', NOW);
}

test('the ask is noticed in the ways people put it, and the destination comes out clean', () => {
  const cases: [string, string][] = [
    ['directions to Coles Wembley', 'Coles Wembley'],
    ['Haru, can you get me directions to the airport please?', 'the airport'],
    ['how do I get to Kings Park from here?', 'Kings Park'],
    ['take me home', 'home'],
    ['drive me to "Optus Stadium"', 'Optus Stadium'],
    ['whats the route to my place', 'place'],
    ['how far is Fremantle', 'Fremantle'],
    ['navigate to 12 Cambridge St, Wembley', '12 Cambridge St, Wembley'],
  ];
  for (const [text, destination] of cases) assert.equal(directionsAsk(text)?.destination, destination, text);
  assert.equal(directionsAsk("where's the nearest petrol station?")?.nearest, true);
  assert.equal(directionsAsk('find me the closest coles')?.destination, 'coles');
});

test('not every mention of a way is an ask for one', () => {
  for (const text of ['take me seriously', 'get me there', 'I found my way to sleep eventually', 'the route the model takes', 'how far is it', 'directions to', 'what a way to go', 'x'.repeat(301)]) {
    assert.equal(directionsAsk(text), null, text);
  }
  assert.equal(cleanDestination('  "the Store"  '), 'the Store');
  assert.equal(cleanDestination('my mum’s house'), 'mum’s house');
});

test('a place she knows by name needs no map, and "my place" is home', () => {
  const where = namePlace(absorb(withHome(), readSpot({ ...COLES, accuracy: 20 }, NOW)!), 'the store', NOW);
  assert.equal(matchNamedPlace('home', where.places)?.name, 'home');
  assert.equal(matchNamedPlace('place', where.places)?.name, 'home');
  assert.equal(matchNamedPlace('store', where.places)?.name, 'the store');
  assert.equal(matchNamedPlace('The Store', where.places)?.name, 'the store');
  assert.equal(matchNamedPlace('airport', where.places), null);
});

test('"from here" is a fresh fix, else home, else nothing to measure from', () => {
  const where = withHome();
  assert.equal(startingPoint(where, NOW.getTime() + 60_000)?.known, 'here');
  assert.equal(startingPoint(where, NOW.getTime() + 5 * 3600_000)?.known, 'home');
  assert.equal(startingPoint({ enabled: false, last: null, places: [] }, NOW.getTime()), null);
});

test('the link is built from coordinates, opens a route, and is never typed by her', () => {
  assert.equal(mapsLink(COLES), 'https://maps.apple.com/?daddr=-31.93300,115.79900&dirflg=d');
  assert.equal(googleMapsLink(COLES), 'https://www.google.com/maps/dir/?api=1&destination=-31.93300,115.79900');
  const reply = withDirections('Fine. Try not to get lost in a supermarket. 🙄  ', COLES);
  assert.equal(reply, 'Fine. Try not to get lost in a supermarket. 🙄\n\n[Directions to Coles](https://maps.apple.com/?daddr=-31.93300,115.79900&dirflg=d)');
});

test('what she is told: the place, how far, that a button is coming — or that nothing was found', () => {
  const ask = { destination: 'Coles Wembley', nearest: false };
  const note = directionsNote(ask, COLES, withHome(), NOW.getTime() + 60_000);
  assert.match(note, /Found: Coles, Wembley\. It is about 6\.1 km from where they are\./);
  assert.match(note, /anything you say about the route would be made up and will be cut/);
  assert.doesNotMatch(note, /https?:/);
  const nothing = directionsNote(ask, null, withHome(), NOW.getTime());
  assert.match(nothing, /nothing was found by that name\. Say so/);
  assert.match(nothing, /none will be attached/);
  const blind = directionsNote(ask, null, { enabled: false, last: null, places: [] });
  assert.match(blind, /does not know where they are/);
  const here = directionsNote({ destination: 'home', nearest: false }, { name: 'home', ...HOME }, withHome(), NOW.getTime());
  assert.match(here, /already there/);
});

test('"the nearest Coles" is a Coles, searched near them', () => {
  assert.deepEqual(directionsAsk('directions to the nearest coles'), { destination: 'coles', nearest: true });
  assert.deepEqual(directionsAsk('how do I get to the closest petrol station?'), { destination: 'petrol station', nearest: true });
  assert.deepEqual(directionsAsk('take me to Murdoch University'), { destination: 'Murdoch University', nearest: false });
});

test('roads, buses and journey times she made up are cut; her own words stay; her first sentence always survives', () => {
  const said = '🙄 You’re at The PC Project. Murdoch University is ~14 km away.\n\n- Drive: ~15–20 mins via Canning Hwy or St Georges Terrace.\n- Bus: 950/951 from Fitzgerald St area (~30–40 mins).\n- Park: main campus lots fill fast; aim for early.\n\nDon’t wander around like a lost freshman.';
  assert.equal(dropRouteTalk(said), '🙄 You’re at The PC Project. Murdoch University is ~14 km away.\n\nDon’t wander around like a lost freshman.');
  assert.equal(dropRouteTalk('Take the freeway south, then turn left onto Murdoch Drive. Try not to get lost.'), 'Try not to get lost.');
  assert.equal(dropRouteTalk('Head south on the freeway for 20 mins.'), 'Head south on the freeway for 20 mins.', 'nothing else to keep');
  assert.equal(dropRouteTalk('Fine. Go. 🙄'), 'Fine. Go. 🙄');
});

test('a travel-time question is a route question', () => {
  assert.equal(directionsAsk('how long does it take to get to Rockingham?')?.destination, 'Rockingham');
  assert.equal(directionsAsk('How long does it take to get from Murdoch University to Rockingham?')?.destination, 'Rockingham');
  assert.equal(directionsAsk('how long to mums house')?.destination, 'mums house');
  assert.equal(directionsAsk('travel time to Perth Airport please')?.destination, 'Perth Airport');
  assert.equal(directionsAsk('eta to the airport')?.destination, 'the airport');
  // Not a journey.
  assert.equal(directionsAsk('how long does it take to boil an egg?'), null);
  assert.equal(directionsAsk('how long until you stop nagging me'), null);
});
