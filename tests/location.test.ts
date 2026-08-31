// Places by name, through the map service, near where they are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readWindowsLocation, searchPlaces } from '../electron/location';

const hits = [
  { name: 'Coles', display_name: 'Coles, Cambridge Street, Wembley, Perth, Western Australia', lat: '-31.9330', lon: '115.7990', address: { suburb: 'Wembley', city: 'Perth', state: 'Western Australia' } },
  { name: '', display_name: 'Coles Express, Subiaco, Perth', lat: '-31.9480', lon: '115.8250', address: { suburb: 'Subiaco', city: 'Perth' } },
  { name: 'Nowhere', lat: 'x', lon: 'y' },
];

test('the search is biased around them, and every hit comes back named and placed', async () => {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => { asked.push(url); return { ok: true, json: async () => hits } as unknown as Response; };
  const found = await searchPlaces('coles', fetchImpl, { lat: -31.95, lon: 115.86 });
  // The old shape, exactly; `kind` is checked on its own below.
  assert.deepEqual(found.map(({ kind, ...rest }) => rest), [
    { name: 'Coles, Wembley', lat: -31.933, lon: 115.799 },
    { name: 'Coles Express, Subiaco', lat: -31.948, lon: 115.825 },
  ]);
  assert.match(asked[0], /q=coles&limit=5/);
  assert.match(asked[0], /viewbox=115\.740,-31\.830,115\.980,-32\.070&bounded=0/);
});

test('with nowhere to bias from, the configured place is added to the words; a refusal is an error', async () => {
  const asked: string[] = [];
  await searchPlaces('coles', async (url: string) => { asked.push(url); return { ok: true, json: async () => [] } as unknown as Response; }, null, 'Perth, Australia');
  assert.match(asked[0], /q=coles%2C%20Perth%2C%20Australia/);
  assert.doesNotMatch(asked[0], /viewbox/);
  await assert.rejects(searchPlaces('coles', async () => ({ ok: false, status: 429 } as unknown as Response), null), /429/);
});

test('"the nearest" bounds the search to the box; an ordinary ask only ranks by it', async () => {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => { asked.push(url); return { ok: true, json: async () => [] } as unknown as Response; };
  await searchPlaces('coles', fetchImpl, { lat: -31.95, lon: 115.86 }, '', { bounded: true });
  await searchPlaces('coles', fetchImpl, { lat: -31.95, lon: 115.86 }, '');
  assert.match(asked[0], /bounded=1/);
  assert.match(asked[1], /bounded=0/);
});

test('a location fix says it is Windows only rather than failing to spawn', async () => {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  try {
    await assert.rejects(readWindowsLocation(), /Windows only/);
  } finally {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }
});

test('a hit knows whether it is a road or a place', async () => {
  const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => [
    { name: 'Rockingham Road', display_name: 'Rockingham Road, Hamilton Hill', lat: '-32.08', lon: '115.78', class: 'highway', type: 'primary', address: { suburb: 'Hamilton Hill' } },
    { name: 'Rockingham', display_name: 'Rockingham, WA', lat: '-32.28', lon: '115.73', class: 'place', type: 'town', address: { state: 'Western Australia' } },
  ] })) as never;
  const hits = await searchPlaces('Rockingham', fetchImpl, { lat: -32.0, lon: 115.8 }, 'Perth, Australia');
  assert.deepEqual(hits.map(h => h.kind), ['road', 'place']);
});
