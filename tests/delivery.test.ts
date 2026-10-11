import test from 'node:test';
import assert from 'node:assert/strict';
import { cleaningChunks, deliveryReminder, deliveryRule, hasDeliveryLabel, splitDelivery, stripDelivery } from '../electron/delivery';
import { CORE_EMOTIONS, EMOTIONS, EMOTION_SCHEMA, STYLES, parseEmotion } from '../electron/emotion';
import { MOOD_TO_EMOTION, isHaruEmotion } from '../electron/emotions';
import { BREEZE_DESCRIPTIONS, HUME_DESCRIPTIONS } from '../electron/voice';

test('the reminder names every mood and shows the shape', () => {
  const said = deliveryReminder();
  for (const mood of EMOTIONS) assert.ok(said.includes(mood), `missing ${mood}`);
  assert.match(said, /like this: \[annoyed\] Knock it off\. \[curious\] What actually broke\?/);
  assert.ok(!said.startsWith('[') && !said.endsWith(']'), 'main.ts wraps it with the voice note, as tested');
});

// Verbatim from the live conversation route, before any of this was wired up.
const REAL = '[annoyed] Oh, perfect. You want me to care about your motherboard now. [neutral] C5 is usually memory initialization—reseat your RAM, one stick at a time.';

test('a real reply splits into what to say and how to say it', () => {
  const said = splitDelivery(REAL);
  assert.deepEqual(said.map(s => s.mood), ['annoyed', 'neutral']);
  assert.match(said[0].text, /^Oh, perfect\./);
  assert.match(said[1].text, /^C5 is usually/);
  // The mood changes mid-reply, which is the thing neither current path can see.
  assert.notEqual(said[0].mood, said[1].mood);
});

test('words before the first label are hers and are kept', () => {
  const said = splitDelivery('Right. [annoyed] Do not touch that.');
  assert.equal(said.length, 2);
  assert.equal(said[0].mood, null);
  assert.equal(said[0].text, 'Right.');
  assert.equal(said[1].mood, 'annoyed');
});

test('the rule names every mood she has, so an invented one is detectable', () => {
  const rule = deliveryRule();
  for (const mood of EMOTIONS) assert.ok(rule.includes(mood), `${mood} missing from the rule`);
  assert.match(rule, /stripped before he sees them/);
});

test('every style has an avatar face and a voice direction', () => {
  for (const style of STYLES) {
    assert.ok(isHaruEmotion(MOOD_TO_EMOTION[style]), `${style} has no avatar face`);
    assert.ok(BREEZE_DESCRIPTIONS[style].length > 10 && HUME_DESCRIPTIONS[style].length > 10, `${style} has no voice direction`);
  }
});

test('a sound split across stream chunks never reaches the page half written', () => {
  const full = "[sleepy] (sigh) It's late. [smug] (laugh) Ha.";
  for (let cut = 1; cut < full.length; cut++) {
    const seen: string[] = [];
    const sink = cleaningChunks(text => seen.push(text));
    sink(full.slice(0, cut));
    sink(full.slice(cut));
    const shown = seen.join('');
    assert.equal(shown, "It's late. Ha.", `cut ${cut}`);
  }
});

test('the rule allows exactly two spoken sounds, (sigh) and (laugh), and nothing else in brackets', () => {
  const rule = deliveryRule();
  assert.match(rule, /\(sigh\) or \(laugh\)/);
  assert.match(rule, /no other sound in brackets is allowed/);
  assert.doesNotMatch(rule, /\((yawn|gasp|cough|clears throat)\)/);
});

// ---- the stream, which is what he actually watches ----

test('a label never reaches the screen, even split across chunks', () => {
  const shown: string[] = [];
  const feed = cleaningChunks(t => shown.push(t));
  // The chunk boundary falls inside the label, which is the whole risk.
  for (const chunk of ['[ann', 'oyed] Do not ', 'touch that. [cur', 'ious] Why?']) feed(chunk);
  const seen = shown.join('');
  assert.equal(hasDeliveryLabel(seen), false);
  assert.doesNotMatch(seen, /\[ann|\[cur/, 'half a label is still a label');
  assert.equal(seen, 'Do not touch that. Why?');
});

test('the stream only ever moves forwards', () => {
  const shown: string[] = [];
  const feed = cleaningChunks(t => shown.push(t));
  for (const chunk of ['Fine', '. [smug]', ' I told you.']) feed(chunk);
  assert.equal(shown.join(''), 'Fine. I told you.');
  assert.ok(shown.every(piece => piece.length > 0), 'no empty emissions');
});

test('an unlabelled stream is passed through unchanged', () => {
  const shown: string[] = [];
  const feed = cleaningChunks(t => shown.push(t));
  for (const chunk of ['The array is [1, ', '2, 3] and you ', 'broke index two.']) feed(chunk);
  assert.equal(shown.join(''), 'The array is [1, 2, 3] and you broke index two.');
});
