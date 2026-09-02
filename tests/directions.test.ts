// The way somewhere: noticing the ask, naming the place, and the link she never types.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDestination, directionsAsk, directionsAskFrom, directionsNote, streetAddress, withoutMapsLinks, claimsTraffic, destinationNamed, dropRouteTalk, googleMapsLink, mapsLink, matchNamedPlace, startingPoint, withDirections } from '../electron/directions';
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

test('asking about traffic is asking for the road', () => {
  assert.equal(directionsAsk('How’s the traffic from Murdoch into Perth this morning?')?.destination, 'Perth');
  assert.equal(directionsAsk('How long does it take to get to Rockingham from here right now?')?.destination, 'Rockingham');
  assert.equal(directionsAsk('traffic to the airport?')?.destination, 'the airport');
  assert.equal(directionsAsk('the traffic was awful today'), null);
});

test('the note carries the road when Google has answered, the straight line otherwise', () => {
  const where = { enabled: true, last: { lat: -32.07, lon: 115.83, accuracy: 10, at: new Date().toISOString(), net: 'wifi' }, places: [] } as never;
  const found = { name: 'Rockingham WA', lat: -32.29, lon: 115.74 };
  const ask = directionsAsk('how long to Rockingham')!;
  assert.match(directionsNote(ask, found, where, Date.now(), 'By car it is 31 minutes from where they are right now.'), /By car it is 31 minutes/);
  const withRoad = directionsNote(ask, found, where, Date.now(), 'By car it is 31 minutes from where they are right now.');
  assert.match(withRoad, /yours to say/, 'with the route in hand the numbers are hers');
  assert.match(withRoad, /Do not say you cannot check the traffic/);
  assert.doesNotMatch(withRoad, /made up and will be cut/, 'the old line contradicted the numbers above it');
  assert.match(directionsNote(ask, found, where), /It is about \d+(\.\d)? km from where they are\./);
});

test('what Google knows about the place rides along after the distance, and nothing when it knows nothing', () => {
  const where = { enabled: false, places: [], last: null } as unknown as Parameters<typeof directionsNote>[2];
  const found = { name: 'Bunnings Rockingham', lat: -32.28, lon: 115.74 };
  const note = directionsNote({ destination: 'Bunnings', nearest: false }, found, where, Date.now(), undefined, 'It is open right now. Hours today — Monday: 6:30 am – 9:00 pm.');
  assert.match(note, /Found: Bunnings Rockingham\. It is open right now\. Hours today — Monday: 6:30 am – 9:00 pm\. The app/);
  assert.doesNotMatch(directionsNote({ destination: 'Bunnings', nearest: false }, found, where), /undefined/);
});

test('a street address is picked out of what they wrote, suburb and all, and time words are not one', () => {
  assert.equal(streetAddress('I’m popping out to pick up a CPU at 40 Boddington Circuit. And yes - I stopped for coffee'), '40 Boddington Circuit');
  assert.equal(streetAddress('This one: 40 boddington circuit, Dianella'), '40 boddington circuit, Dianella');
  assert.equal(streetAddress('meet at 2/62 Fitzgerald St, Northbridge WA 6003 please'), '2/62 Fitzgerald St, Northbridge WA 6003');
  assert.equal(streetAddress('40 Boddington Circuit tomorrow'), '40 Boddington Circuit');
  assert.equal(streetAddress('it is a 5 minutes drive'), null);
  assert.equal(streetAddress('back in 20 mins'), null);
  assert.equal(streetAddress('no address here'), null);
});

test('an errand takes the address they gave a message earlier; an address alone, or a bare ask, after a directions question is the question', () => {
  const before = ['I’m popping out to pick up a CPU at 40 Boddington Circuit. And yes - I did stop for coffee'];
  assert.deepEqual(directionsAskFrom('Give me directions to pick up the cpu', before), { destination: '40 Boddington Circuit', nearest: false });
  assert.deepEqual(directionsAskFrom('I meant directions to the Dianella address to pick up the CPU', [...before, 'Give me directions to pick up the cpu']), { destination: '40 Boddington Circuit', nearest: false });
  assert.deepEqual(directionsAskFrom('This one: 40 Boddington Circuit', ['Give me directions to pick up the cpu', 'That’s where I work btw']), { destination: '40 Boddington Circuit', nearest: false });
  assert.deepEqual(directionsAskFrom('Give me the directions please', ['This one: 40 Boddington Circuit']), { destination: '40 Boddington Circuit', nearest: false });
  assert.deepEqual(directionsAskFrom('how do I get there?', ['This one: 40 Boddington Circuit']), { destination: '40 Boddington Circuit', nearest: false });
  assert.equal(directionsAskFrom('Give me directions to pick up the cpu', ['no address anywhere']), null, 'an errand with no address is not searched for as a place');
  // Home is not a place they name, and "back" is how they say it.
  assert.deepEqual(directionsAskFrom("What's the traffic like going back", []), { destination: 'home', nearest: false });
  assert.deepEqual(directionsAskFrom('hows the traffic heading home', []), { destination: 'home', nearest: false });
  assert.deepEqual(directionsAskFrom('how long will it take', ['alright, on my way back']), { destination: 'home', nearest: false }, 'said just before');
  assert.deepEqual(directionsAskFrom("what's the traffic like", ['heading to Umart then']), { destination: 'Umart', nearest: false }, 'a named place still wins');
  assert.equal(directionsAskFrom("what's the traffic like", []), null, 'nowhere named and nowhere implied is still nowhere');
  assert.equal(directionsAskFrom('This one: 40 Boddington Circuit', ['what a day']), null, 'an address with no question before it is just an address');
  assert.equal(directionsAskFrom('Give me the directions please', []), null);
  assert.deepEqual(directionsAskFrom('directions to Bunnings Rockingham', before), { destination: 'Bunnings Rockingham', nearest: false }, 'a real place is still itself');
  assert.deepEqual(directionsAskFrom('directions to Get Wines Direct', before), { destination: 'Get Wines Direct', nearest: false }, 'a shop whose name starts with a verb is a shop');
});

test('a maps link is taken out of the text, hers or the app\'s, and plain words are left alone', () => {
  assert.equal(withoutMapsLinks('Don’t dawdle. 🙄\n\n[Directions to The PC Project](https://maps.apple.com/?daddr=-31.94527,115.85322&dirflg=d)'), 'Don’t dawdle. 🙄');
  assert.equal(withoutMapsLinks('[Directions to 40 Boddington Circuit](https://maps.apple.com/?daddr=-31.9727,115.8478&dirflg=d)'), '');
  assert.equal(withoutMapsLinks('Here: https://www.google.com/maps/dir/?api=1&destination=-32.1,115.8 go.'), 'Here: go.');
  assert.equal(withoutMapsLinks('Get that CPU mounted.'), 'Get that CPU mounted.');
});

test('a journey question takes the place from the same breath, or the message before it', () => {
  assert.equal(destinationNamed("I'm going to Starbucks in Murdoch then work"), 'Starbucks in Murdoch');
  assert.equal(destinationNamed('stopping by Bunnings on the way'), 'Bunnings');
  assert.equal(destinationNamed('going to the shops'), null, 'no name, nothing to look up');
  assert.deepEqual(directionsAskFrom("I'm going to Starbucks in Murdoch then work so how long will that take? Is traffic bad this morning?", []), { destination: 'Starbucks in Murdoch', nearest: false });
  assert.deepEqual(directionsAskFrom('is traffic bad this morning?', ['heading to Murdoch University shortly']), { destination: 'Murdoch University', nearest: false });
  assert.equal(directionsAskFrom('how long will that take?', ['what a day']), null, 'nothing named, nothing invented');
});

test('a claim about the roads is recognised, so it can be cut when nothing was looked up', () => {
  assert.equal(claimsTraffic("Traffic's already thick. Don't dawdle."), true);
  assert.equal(claimsTraffic("You'll hit the main drag, then the inner loop"), true);
  assert.equal(claimsTraffic('the roads are clear'), true);
  assert.equal(claimsTraffic('Eat your dinner and stop stalling.'), false);
  assert.equal(dropRouteTalk("Traffic's already thick. Get moving.").includes('thick'), false, 'and cut');
});

