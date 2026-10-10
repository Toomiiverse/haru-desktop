import test from 'node:test';
import assert from 'node:assert/strict';
import { readWhatsAppConfig, readHeard, isForHer, asTurn, asOverheard, chatLabel, splitForWhatsApp, gapBefore, DEFAULT_WHATSAPP } from '../electron/whatsapp';

const HIM = '61400000000@s.whatsapp.net';
const SAM = '61411111111@s.whatsapp.net';
const post = (extra: Record<string, unknown>) => ({ id: 'M1', chat: HIM, chatName: '', from: 'him', text: 'hi', kind: null, mine: true, at: '2026-09-19T10:00:00.000Z', selfChat: true, ...extra });

test('the door is shut unless the config says otherwise', () => {
  // Unlike her other workers, a missing key must not mean "on": turning this on
  // puts a companion device on his real number.
  assert.equal(readWhatsAppConfig(undefined).enabled, false);
  assert.equal(readWhatsAppConfig({}).enabled, false);
  assert.equal(readWhatsAppConfig({ enabled: 'yes' }).enabled, false, 'only a real true');
  assert.equal(readWhatsAppConfig({ enabled: true }).enabled, true);
  assert.equal(readWhatsAppConfig({}).url, DEFAULT_WHATSAPP.url);
  assert.equal(readWhatsAppConfig({ url: 'http://127.0.0.1:8793/' }).url, 'http://127.0.0.1:8793', 'no trailing slash, or every path doubles one');
  assert.equal(readWhatsAppConfig({ token: '  t  ' }).token, 't');
});

test('a post is only read when it is actually a message', () => {
  assert.equal(readHeard(post({}))?.text, 'hi');
  assert.equal(readHeard(null), null);
  assert.equal(readHeard(post({ id: '' })), null, 'no id');
  assert.equal(readHeard(post({ chat: '' })), null, 'no chat');
  assert.equal(readHeard(post({ text: '   ', kind: null })), null, 'nothing in it');
  assert.equal(readHeard(post({ text: '', kind: 'a photo' }))?.kind, 'a photo');
  // The worker is trusted to be the worker, not to be careful. Anything shaped
  // wrong becomes its default rather than reaching her prompt as an object.
  assert.equal(readHeard(post({ from: 42 }))?.from, 'someone');
  assert.equal(readHeard(post({ mine: 'true' }))?.mine, false);
  assert.equal(readHeard(post({ selfChat: 1 }))?.selfChat, false);
  assert.equal(readHeard(post({ text: 'x'.repeat(9000) }))?.text.length, 4000, 'a pasted wall cannot become her whole prompt');
});

test('she answers his own chat and nothing else', () => {
  assert.equal(isForHer(readHeard(post({}))!), true);
  // The whole safety story of Tier 1 in one assertion: an allowed chat is
  // something she comes to know, never something she replies into. She is not
  // in Sam's conversation.
  assert.equal(isForHer(readHeard(post({ chat: SAM, selfChat: false, from: 'Sam' }))!), false);
  assert.equal(isForHer(readHeard(post({ text: '', kind: 'a voice note' }))!), true);
});

test('a message with no words still reaches her as the thing it was', () => {
  // A turn where he sent something and she was told nothing reads, from inside
  // her prompt, as him having said nothing -- and she answers it as silence.
  assert.equal(asTurn(readHeard(post({ text: '', kind: 'a photo' }))!), '(he sent a photo on WhatsApp, with nothing written)');
  assert.match(asTurn(readHeard(post({ text: 'look at this', kind: 'a photo' }))!), /^look at this\n\n\(he sent a photo with that, on WhatsApp\)$/);
  assert.equal(asTurn(readHeard(post({ text: 'just words' }))!), 'just words');
});

test('a chat is named, never shown to the model as a JID', () => {
  // A model told it is reading "Sam" does better than one shown 6141…@s.whatsapp.net,
  // and a bare JID in the prompt is a thing it might try to extract.
  assert.equal(chatLabel(readHeard(post({ chatName: 'Sam' }))!), 'Sam');
  assert.equal(chatLabel(readHeard(post({ chat: '12036-1699@g.us', chatName: '' }))!), 'a group chat');
  assert.equal(chatLabel(readHeard(post({ chat: SAM, chatName: '' }))!), 'an unnamed chat');
  assert.equal(readHeard(post({ chatName: 'x'.repeat(200) }))!.chatName.length, 80);
});

test('an overheard line names who said it', () => {
  assert.equal(asOverheard(readHeard(post({ chat: SAM, selfChat: false, mine: false, from: 'Sam', text: 'running late' }))!), 'Sam: running late');
  assert.equal(asOverheard(readHeard(post({ chat: SAM, selfChat: false, mine: true, from: 'him', text: 'no worries' }))!), 'he: no worries');
  assert.equal(asOverheard(readHeard(post({ chat: SAM, selfChat: false, mine: false, from: 'Sam', text: '', kind: 'a photo' }))!), 'Sam: sent a photo');
});

test('her reply arrives as the bubbles she wrote it in', () => {
  // Paragraphs and nothing cleverer: she already writes for the phone painting
  // paragraphs as bubbles, and WhatsApp has no length ceiling to split on.
  assert.deepEqual(splitForWhatsApp('one'), ['one']);
  assert.deepEqual(splitForWhatsApp('one\n\ntwo'), ['one', 'two']);
  assert.deepEqual(splitForWhatsApp('one\nstill one'), ['one\nstill one'], 'a single newline is not a bubble');
  assert.deepEqual(splitForWhatsApp('   '), []);
  // Four is a person with more to say; eight in a row is a bot.
  const many = splitForWhatsApp('a\n\nb\n\nc\n\nd\n\ne\n\nf');
  assert.equal(many.length, 4);
  assert.equal(many[3], 'd\n\ne\n\nf', 'the overflow joins the last rather than being dropped');
  assert.ok(splitForWhatsApp('a\n\nb\n\nc\n\nd\n\ne').join(' ').includes('e'), 'nothing she said is lost');
});

test('the gap between bubbles is a pause, never a wait', () => {
  assert.ok(gapBefore('ok') >= 600);
  assert.ok(gapBefore('x'.repeat(1000)) <= 4_000, 'capped');
  assert.ok(gapBefore('a longer sentence than the last one') > gapBefore('ok'));
});
