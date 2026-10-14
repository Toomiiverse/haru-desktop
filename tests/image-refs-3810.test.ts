// 3810: picture bytes never cross the Core's preparation calls; a reference does, and the provider boundary puts the bytes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessMedia, turnImages, withImageBytes } from '../electron/core-harness-media';

test('a screenshot crosses as a short reference and is restored byte for byte', () => {
  const shot = 'iVBOR' + 'x'.repeat(400_000);
  const sent = turnImages.toCore([{ role: 'system', content: 's' }, { role: 'user', content: 'look', images: [shot] }] as any);
  assert.ok(JSON.stringify(sent).length < 500 && !JSON.stringify(sent).includes('xxxx'));
  // the preparation steps return new message objects (fold, gap markers): the reference string is all that has to survive
  const back = withImageBytes(JSON.parse(JSON.stringify([{ role: 'system', content: 'gap' }, ...sent])));
  assert.equal((back.at(-1) as any).images[0], shot);
});

test('bytes from elsewhere pass untouched; an unknown reference fails closed instead of reaching a model', () => {
  const plain = [{ role: 'user', content: 'x', images: ['iVBORplain'] }];
  assert.equal(withImageBytes(plain), plain);
  assert.throws(() => withImageBytes([{ role: 'user', content: 'x', images: ['haru-session-image:nope'] }]), /core_harness_media_unbound/);
  // the harness's own references wrap ours; unwrapping them gives ours, which then resolve
  const harness = new HarnessMedia(), shot = 'iVBOR' + 'y'.repeat(1000);
  const ours = turnImages.toCore([{ role: 'user', content: '', images: [shot] }] as any);
  const theirs = harness.toCore(ours);
  assert.equal((withImageBytes(harness.fromCore(theirs))[0] as any).images[0], shot);
});

test('main.ts sends references to the Core and restores bytes at the provider boundary', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  assert.ok(src.includes('const withFiles = turnImages.toCore(attached as any) as unknown as typeof attached;'));
  assert.ok(/async function sendToProviderUnchecked\([^\n]*\n  conversation = withImageBytes\(conversation\);/.test(src));
  const harness = readFileSync(require.resolve('../../electron/core-harness.ts'), 'utf8');
  assert.ok(harness.includes("result={images:withImageBytes(media.fromCore([{role:'user',images:payload.references}]))[0].images};"));
});
