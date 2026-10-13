import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureAffect, admitAffect } from '../electron/core-affect';

test('the affect admission lets a write-behind commit land before the Core reads the store for its plan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'affect-fence-'));
  writeFileSync(join(dir, 'token'), 'x'.repeat(48), { mode: 0o600 });
  process.env.HARU_SERVICE_AFFECT_V2 = 'on';
  process.env.HARU_CORE_SERVICE_ENDPOINT = 'http://127.0.0.1:1/';
  process.env.HARU_CORE_SERVICE_TOKEN_FILE = join(dir, 'token');
  const order: string[] = [];
  configureAffect(() => ({ fence() { order.push('fence'); } }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    order.push('admit');
    const sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ version: 1, eventId: sent.eventId, disposition: 'accepted', status: 'ok' }), { status: 200 });
  }) as typeof fetch;
  try {
    const packet = await admitAffect([{ role: 'user', content: 'hi', id: 'e1' }], {});
    assert.equal(packet.eventId, 'e1');
    assert.deepEqual(order, ['fence', 'admit']);
  } finally { globalThis.fetch = realFetch; }
});
