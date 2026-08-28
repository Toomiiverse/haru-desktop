// Places by name, through the map service, near where they are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPlaces } from '../electron/location';

const hits = [
  { name: 'Coles', display_name: 'Coles, Cambridge Street, Wembley, Perth, Western Australia', lat: '-31.9330', lon: '115.7990', address: { suburb: 'Wembley', city: 'Perth', state: 'Western Australia' } },
  { name: '', display_name: 'Coles Express, Subiaco, Perth', lat: '-31.9480', lon: '115.8250', address: { suburb: 'Subiaco', city: 'Perth' } },
  { name: 'Nowhere', lat: 'x', lon: 'y' },
];

test('the search is biased around them, and every hit comes back named and placed', async () => {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => { asked.push(url); return { ok: true, json: async () => hits } as unknown as Response; };
  const found = await searchPlaces('coles', fetchImpl, { lat: -31.95, lon: 115.86 });
  assert.deepEqual(found, [
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
