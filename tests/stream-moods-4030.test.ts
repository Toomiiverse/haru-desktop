// 4030: the phone streams its replies, so the streaming and retry paths keep her own mood tag for /api/expression;
// before, only the non-streaming path did and every phone reply's face went to the classifier (one extra model call each).
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDelivery } from '../electron/delivery';
test('both streamed paths remember the delivery, keyed on the stripped reply the phone sends back', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(require.resolve('../../electron/main.ts'), 'utf8');
  const stream = main.slice(main.indexOf('    async sayStream('), main.indexOf('    async retryStream('));
  const retry = main.slice(main.indexOf('    async retryStream('), main.indexOf('    async retryStream(') + 6000);
  for (const body of [stream, retry]) {
    const strip = body.indexOf("const reply = stripDelivery(answer.content ?? '');");
    assert.ok(strip > 0);
    assert.ok(body.slice(strip, strip + 200).includes("rememberDelivery(answer.content ?? '', reply);"));
  }
  assert.ok(main.includes("const said = deliveredMoods.get((text ?? '').trim());"));   // the lookup the face request uses
});
test('a tagged reply yields the mood she opened on', () => {
  assert.equal(splitDelivery('[smug] Heard you the first time. [teasing] Twice now.')[0]?.mood, 'smug');
});
