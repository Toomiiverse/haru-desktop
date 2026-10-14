// 3840: the attachment record is local bookkeeping; a photo's saved path must not read as a card number and keep the turn local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOutboundSafe } from '../electron/outbound';
import { toOpenAIBody } from '../electron/provider';

const photo = { id: 'a', kind: 'image', name: 'photo-1791986267.jpg', saved: '/home/toomii/Pictures/Haru/2026-10-14-135754-photo-1791986267.jpg', url: '', bytes: 388441 };

test("a photo whose saved path looks like a card number no longer blocks the turn", () => {
  assert.doesNotThrow(() => assertOutboundSafe([{ role: 'user', content: 'what is this?', attachments: [photo], picturesRead: 1 } as any]));
});

test('the content is still scanned: a real card number in the text still blocks', () => {
  assert.throws(() => assertOutboundSafe([{ role: 'user', content: 'my card is 4111 1111 1111 1111', attachments: [photo] } as any]), /outbound_privacy_blocked/);
});

test('no provider body carries the attachment record', () => {
  const body = JSON.stringify(toOpenAIBody({ model: 'm', conversation: [{ role: 'user', content: 'hi', attachments: [photo] } as any] } as any));
  assert.ok(!body.includes('Pictures/Haru') && !body.includes('attachments'));
});
