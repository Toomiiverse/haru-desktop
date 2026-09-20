// Where their phone says they are, and the one sentence she gets about it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { absorb, describeWhereabouts, distanceM, forgetPlace, namePlace, placeAt, readSpot, readWhereabouts, SPOT_STALE_MS, whereForPage, type Whereabouts, knownHaunt, saidTheyWereGoing, unannouncedArrivalNote, withoutWhereDenials, ARRIVAL_FRESH_MS } from '../electron/whereabouts';

const NOW = new Date('2026-08-28T10:00:00Z');
const HOME = { lat: -31.9505, lon: 115.8605 };
const STORE = { lat: -31.9440, lon: 115.8720 }; // ~1.3 km off

const at = (spot: { lat: number; lon: number }, extra: Record<string, unknown> = {}, when = NOW) => readSpot({ ...spot, accuracy: 40, ...extra }, when)!;

function home(): Whereabouts {
  return namePlace(absorb({ ...readWhereabouts({}), enabled: true }, at(HOME)), 'home', NOW);
}

test('a spot is coordinates on the globe with a network she has a word for, rounded to what a phone can honestly claim', () => {
  const spot = readSpot({ lat: -31.95051234, lon: 115.86054321, accuracy: 33.6, net: 'cellular' }, NOW)!;
  assert.deepEqual(spot, { lat: -31.9505, lon: 115.8605, accuracy: 34, at: NOW.toISOString(), net: 'cellular' });
  assert.equal(readSpot({ lat: -31.95, lon: 115.86, net: 'carrier pigeon' }, NOW)!.net, 'unknown');
  assert.equal(readSpot({ lat: 91, lon: 0 }), null);
  assert.equal(readSpot({ lat: '-31.95', lon: 115.86 }), null);
  assert.equal(readSpot(null), null);
});

test('what is saved comes back, and junk does not', () => {
  const saved = { enabled: true, last: { lat: HOME.lat, lon: HOME.lon, accuracy: 40, at: NOW.toISOString(), net: 'wifi' }, places: [{ name: '  home ', lat: HOME.lat, lon: HOME.lon, radiusM: 150, added: 'x' }, { name: '', lat: 0, lon: 0 }, { name: 'nowhere', lat: 200, lon: 0 }] };
  const state = readWhereabouts(saved);
  assert.equal(state.enabled, true);
  assert.equal(state.last?.at, NOW.toISOString());
  assert.deepEqual(state.places.map(p => p.name), ['home']);
  assert.deepEqual(readWhereabouts(undefined), { enabled: false, last: null, places: [] });
});

test('distance is honest over a walk, and a place is the nearest one that reaches the spot', () => {
  assert.ok(Math.abs(distanceM(HOME, STORE) - 1320) < 60);
  const state = namePlace(absorb(home(), at(STORE)), 'the store', NOW);
  assert.equal(placeAt(state.places, at(HOME))?.name, 'home');
  assert.equal(placeAt(state.places, at(STORE))?.name, 'the store');
  assert.equal(placeAt(state.places, at({ lat: -31.9470, lon: 115.8660 })), null, 'between the two is neither');
  assert.equal(placeAt(state.places, at(HOME, { accuracy: 3000 })), null, 'a cell-tower fix names nothing');
  assert.equal(placeAt(state.places, at({ lat: HOME.lat + 0.002, lon: HOME.lon }, { accuracy: 300 }))?.name, 'home', 'a rough fix near home is still home');
});

test('naming a place again moves it; forgetting removes it; nothing is named with no spot to stand on', () => {
  let state = home();
  state = namePlace(absorb(state, at(STORE)), 'Home', NOW);
  assert.equal(state.places.length, 1);
  assert.equal(placeAt(state.places, at(STORE))?.name, 'Home');
  assert.equal(forgetPlace(state, 'home').places.length, 0);
  assert.equal(namePlace({ enabled: true, last: null, places: [] }, 'home').places.length, 0);
  assert.equal(namePlace(state, '   ').places.length, 1);
});

test('the prompt gets words: the place, the network, how long ago — never a number she could read out', () => {
  const state = namePlace(absorb(home(), at(STORE, { net: 'cellular' })), 'the store', NOW);
  const line = describeWhereabouts(state, NOW.getTime() + 7 * 60_000);
  assert.match(line, /at the store, on mobile data, as of 7 minutes ago/);
  assert.doesNotMatch(line, /-?\d+\.\d{3,}/, 'no coordinates');
  assert.match(describeWhereabouts(absorb(state, at(HOME, { net: 'wifi' })), NOW.getTime() + 30_000), /at home, on Wi-Fi, as of just now/);
});

test('somewhere she has no name for is measured from home when she has one, and left vague when she has not', () => {
  const far = absorb(home(), at({ lat: -31.8, lon: 115.9 }));
  assert.match(describeWhereabouts(far, NOW.getTime()), /somewhere she has no name for, about 17 km from home/);
  const near = absorb(home(), at({ lat: -31.9530, lon: 115.8640 }));
  assert.match(describeWhereabouts(near, NOW.getTime()), /not far from home/);
  const homeless = absorb({ enabled: true, last: null, places: [] }, at(STORE));
  assert.match(describeWhereabouts(homeless, NOW.getTime()), /somewhere she has no name for, as of just now/);
});

test('off, silent, or stale says nothing at all', () => {
  const state = home();
  assert.equal(describeWhereabouts({ ...state, enabled: false }, NOW.getTime()), '');
  assert.equal(describeWhereabouts({ ...state, last: null }, NOW.getTime()), '');
  assert.equal(describeWhereabouts(state, NOW.getTime() + SPOT_STALE_MS + 1), '');
  assert.equal(describeWhereabouts(state, NOW.getTime() - 60_000), '', 'a spot from the future is not trusted either');
});

test('the page is told names and freshness, never coordinates', () => {
  const state = home();
  const page = whereForPage(state, NOW.getTime() + 60_000);
  assert.deepEqual(page, { enabled: true, at: 'home', fresh: true, net: 'unknown', places: ['home'] });
  assert.equal(JSON.stringify(page).includes('115.86'), false);
  assert.equal(whereForPage(state, NOW.getTime() + SPOT_STALE_MS * 2).fresh, false);
});

test('going somewhere counts as told only when they named it themselves', () => {
  assert.equal(saidTheyWereGoing('home', ['Just finished up work now Haru']), false, 'finishing work is not saying you are going home');
  assert.equal(saidTheyWereGoing('home', ['heading home now']), true);
  assert.equal(saidTheyWereGoing('home', ['on my way back to my place']), true);
  assert.equal(saidTheyWereGoing('home', []), false);
  assert.equal(saidTheyWereGoing('mums house', ['popping over to mums after this']), true);
  assert.equal(saidTheyWereGoing('mums house', ['off to the house']), false, '"the house" names nowhere');
  assert.equal(saidTheyWereGoing('The PC Project', ['at the pc project all morning']), true);
});

test('an unannounced arrival is a complaint she makes once, and stops being news after three hours', () => {
  const now = Date.parse('2026-08-31T11:00:00.000Z');
  const clock = (ms: number) => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Perth' }).format(new Date(ms));
  const note = unannouncedArrivalNote({ place: 'home', at: new Date(now - 22 * 60_000).toISOString() }, now, clock);
  assert.match(note, /Their phone put them at home 22 minutes ago, and they never said they were going/);
  assert.match(note, /make it a complaint, not a question/);
  assert.match(note, /Do not ask where they are: you know\./, 'she knows: the complaint is not a question about where');
  assert.match(unannouncedArrivalNote({ place: 'home', at: new Date(now - 90 * 60_000).toISOString() }, now, clock), /at \d/, 'over an hour is given as a clock time');
  assert.equal(unannouncedArrivalNote({ place: 'home', at: new Date(now - ARRIVAL_FRESH_MS - 1).toISOString() }, now, clock), '');
  assert.equal(unannouncedArrivalNote(null, now, clock), '');
});


// ---- her own denials must not teach the next one ----

test('her denial that she can see where they are is dropped once she can', () => {
  const said = [
    { role: 'user', content: "How come you can't see my screen or where I am" },
    { role: 'assistant', content: "I just can't. That's how I'm built." },
    { role: 'assistant', content: 'No location tracking, no screen peeking, no secret camera in your pocket.' },
    { role: 'assistant', content: "\u{1F624} I can't see your location, your screen, or what you're doing." },
    { role: 'assistant', content: "You're at The PC Project, as your phone says." },
  ];
  const kept = withoutWhereDenials(said, true).map(m => m.content);
  assert.equal(kept.length, 3, `dropped the wrong number: ${JSON.stringify(kept)}`);
  assert.ok(kept.some(c => c.includes('The PC Project')), 'the true reply must survive');
  assert.ok(kept.some(c => c.startsWith('How come')), 'his own message is never touched');
  assert.ok(!kept.some(c => /location tracking/i.test(c)));
});

test('a denial made when she genuinely had nothing stands', () => {
  const said = [{ role: 'assistant', content: "I can't see your location right now." }];
  assert.equal(withoutWhereDenials(said, false).length, 1);
});

test('ordinary replies that merely mention seeing are left alone', () => {
  const said = [
    { role: 'assistant', content: "I can't see why you'd drive there." },
    { role: 'assistant', content: 'You know I can see where you are, so stop asking.' },
    { role: 'assistant', content: "I don't know what you want me to say." },
  ];
  assert.equal(withoutWhereDenials(said, true).length, 3);
});

test('turning up where she knows they always are is not turning up unannounced', () => {
  // The three she actually has written down (2026-09-20).
  const known = [
    'Tommy works at Happytel Rockingham every Sunday from 12-4:30pm only',
    'They worked at Happytel Rockingham every Sunday from 12-4:30',
    'Works at The PC Project shop during the week, not just Sundays at Happytel',
    'Live with girlfriend Emma in student lodgings at Murdoch.',
  ];
  // The arrival that cost him a third of her irritation on a Sunday at noon.
  assert.equal(knownHaunt('Happytel, Rockingham', known, 'sunday'), true);
  // A memory that names Sundays is no licence for a Tuesday.
  assert.equal(knownHaunt('Happytel, Rockingham', known, 'tuesday'), false);
  // "during the week" covers a weekday and not the weekend — and the Sunday in
  // that same sentence belongs to Happytel, not to the shop.
  assert.equal(knownHaunt('The PC Project', known, 'wednesday'), true);
  assert.equal(knownHaunt('The PC Project', known, 'saturday'), false);
  assert.equal(knownHaunt('The PC Project', known, 'sunday'), false);
  assert.equal(knownHaunt('The PC Project', ['Tommy is usually working at The PC Project shop during the week'], 'saturday'), false);
  // A weekend job is the other way round.
  assert.equal(knownHaunt('Jewel Cafe', ['Works at Jewel Cafe on weekends'], 'saturday'), true);
  assert.equal(knownHaunt('Jewel Cafe', ['Works at Jewel Cafe on weekends'], 'monday'), false);
  // Somewhere she knows nothing about is still a slight.
  assert.equal(knownHaunt('Dome', known, 'sunday'), false);
  assert.equal(knownHaunt('Scarlett’s house', known, 'sunday'), false);
});

test('a place she merely remembers them going once is no licence', () => {
  const once = ['They visited their mother’s house after work', 'Went to the S&R Orchard Blossom Festival in Walliston with Emma', 'Picked up a new CPU at 40 Boddington Circuit'];
  assert.equal(knownHaunt('Walliston', once, 'sunday'), false, 'went once is not a routine');
  assert.equal(knownHaunt('Boddington Circuit', once, 'monday'), false);
  // "on Thursday" is a day something happened; "on Thursdays" is a routine.
  // The singular excused going home every Thursday, on the strength of one
  // memory about starting admin work (2026-09-20).
  assert.equal(knownHaunt('Murdoch', ['They started admin work from Murdoch on Thursday'], 'thursday'), false);
  assert.equal(knownHaunt('Murdoch', ['They do admin work from Murdoch on Thursdays'], 'thursday'), true);
  // Nothing to go on at all.
  assert.equal(knownHaunt('Happytel', [], 'sunday'), false);
  assert.equal(knownHaunt('', ['works at Happytel every Sunday'], 'sunday'), false);
  // A place whose only words are vague ones cannot match on them.
  assert.equal(knownHaunt('the shop', ['works at the shop every day'], 'sunday'), false, '"shop" names half the places anyone has');
});
