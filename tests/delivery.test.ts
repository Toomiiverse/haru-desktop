import test from 'node:test';
import assert from 'node:assert/strict';
import { cleaningChunks, deliveryReminder, deliveryRule, hasDeliveryLabel, splitDelivery, stripDelivery } from '../electron/delivery';
import { CORE_EMOTIONS, EMOTIONS, EMOTION_SCHEMA, STYLES, parseEmotion } from '../electron/emotion';
import { MOOD_TO_EMOTION, isHaruEmotion } from '../electron/emotions';
import { BREEZE_DESCRIPTIONS, HUME_DESCRIPTIONS } from '../electron/voice';

test('a mood off the list is read as the one it means, and never reaches him', () => {
  // Kimi K3, 2026-09-14: "[concerned] Stop." — the stripper left it in.
  const said = splitDelivery('[concerned] Stop. [angry] You are not useless. [playful] Fine.');
  assert.deepEqual(said.map(s => s.mood), ['worried', 'annoyed', 'smug']);
  assert.equal(stripDelivery('[concerned] Stop.\n\n[concerned] You are not useless.'), 'Stop.\n\nYou are not useless.');
  assert.equal(hasDeliveryLabel('[Concerned] Stop.'), true);
  assert.equal(stripDelivery('[whatever] is not one of your moods.'), '[whatever] is not one of your moods.', 'a word that names no feeling is still hers');
});

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

// The whole risk of this feature. Her tool calls came out as words once and
// were read aloud; a label must never reach him.
test('nothing that looks like a label survives into what he reads', () => {
  const clean = stripDelivery(REAL);
  assert.equal(hasDeliveryLabel(clean), false);
  assert.match(clean, /^Oh, perfect\./);
  assert.match(clean, /C5 is usually memory initialization/);
});

test('a label the sentence splitter never saw is still stripped', () => {
  // Mid-sentence, doubled, and on its own line: shapes the split would miss.
  for (const said of [
    'Fine. [smug] I told you so.',
    '[annoyed][annoyed] Twice, apparently.',
    '[curious]\nWhat did you do to it?',
    'Look at it. [bored]',
  ]) assert.equal(hasDeliveryLabel(stripDelivery(said)), false, `leaked: ${said}`);
});

test('brackets that are hers are left alone', () => {
  // A banned word is a suggested word; a bracket is not a label unless it names
  // a mood she was given.
  for (const said of [
    'I redacted it [redacted] and moved on.',
    'See [the manual](https://example.com) before you touch it.',
    'The array is [1, 2, 3] and you broke index two.',
    '[whatever] is not one of your moods.',
  ]) assert.equal(stripDelivery(said), said, `wrongly stripped: ${said}`);
});

test('words before the first label are hers and are kept', () => {
  const said = splitDelivery('Right. [annoyed] Do not touch that.');
  assert.equal(said.length, 2);
  assert.equal(said[0].mood, null);
  assert.equal(said[0].text, 'Right.');
  assert.equal(said[1].mood, 'annoyed');
});

test('an unlabelled reply comes back whole, with no mood', () => {
  const said = splitDelivery('No labels here at all.');
  assert.deepEqual(said, [{ mood: null, text: 'No labels here at all.' }]);
  assert.equal(stripDelivery('No labels here at all.'), 'No labels here at all.');
});

test('nothing in, nothing out', () => {
  assert.deepEqual(splitDelivery(''), []);
  assert.deepEqual(splitDelivery('   '), []);
  assert.equal(stripDelivery(''), '');
  assert.equal(splitDelivery('[annoyed]   ').length, 0, 'a label with no sentence is not a sentence');
});

test('the rule names every mood she has, so an invented one is detectable', () => {
  const rule = deliveryRule();
  for (const mood of EMOTIONS) assert.ok(rule.includes(mood), `${mood} missing from the rule`);
  assert.match(rule, /stripped before he sees them/);
});

test('the five voice styles are labels she can use, on top of the twelve', () => {
  assert.deepEqual([...STYLES], ['shy', 'teasing', 'direct', 'whispering', 'breathless', 'challenging', 'coy', 'knowing', 'commanding', 'possessive']);
  assert.deepEqual([...EMOTIONS], [...CORE_EMOTIONS, ...STYLES]);
  const said = splitDelivery('[shy] I was not looking. [coy] Maybe. [teasing] Cute. [knowing] Obviously. [direct] Do it now. [commanding] Sit. [possessive] Mine. [love] Fine.');
  assert.deepEqual(said.map(part => part.mood), ['shy', 'coy', 'teasing', 'knowing', 'direct', 'commanding', 'possessive', 'affectionate']);
  assert.equal(stripDelivery('[shy] I was not looking. [direct] Do it now.'), 'I was not looking. Do it now.');
  assert.match(deliveryRule(), /shy, teasing, direct, whispering, breathless, challenging, coy, knowing, commanding, possessive/);
});

test('seductive and sexy are not styles, and a stray label is stripped and read as affectionate', () => {
  assert.ok(!(STYLES as readonly string[]).includes('seductive') && !(STYLES as readonly string[]).includes('sexy'));
  assert.ok(!(EMOTIONS as readonly string[]).includes('seductive') && !(EMOTIONS as readonly string[]).includes('sexy'));
  assert.doesNotMatch(deliveryRule(), /seductive|sexy/);
  assert.deepEqual(splitDelivery('[sexy] Hello. [seductive] There.').map(part => part.mood), ['affectionate', 'affectionate']);
  assert.equal(stripDelivery('[sexy] Hello. [seductive] There.'), 'Hello. There.');
});

test('the face classifier still only knows the twelve core emotions', () => {
  assert.deepEqual((EMOTION_SCHEMA.properties.emotion as { enum: string[] }).enum, [...CORE_EMOTIONS]);
  assert.equal(parseEmotion({ emotion: 'shy', confidence: 1, energy: 1, intent: 'listen', focus: 'user' }), null);
  assert.equal(parseEmotion({ emotion: 'smug', confidence: 1, energy: 1, intent: 'listen', focus: 'user' })?.emotion, 'smug');
});

test('every style has an avatar face and a voice direction', () => {
  for (const style of STYLES) {
    assert.ok(isHaruEmotion(MOOD_TO_EMOTION[style]), `${style} has no avatar face`);
    assert.ok(BREEZE_DESCRIPTIONS[style].length > 10 && HUME_DESCRIPTIONS[style].length > 10, `${style} has no voice direction`);
  }
});

test('the voice keeps a spoken sound that the page never shows', () => {
  const reply = "[sleepy] (sigh) It's late. [annoyed] (laugh) Fine. Go to bed.";
  assert.deepEqual(splitDelivery(reply).map(part => part.text), ["(sigh) It's late.", '(laugh) Fine. Go to bed.']);
  assert.equal(stripDelivery(reply), "It's late. Fine. Go to bed.");
  assert.equal(stripDelivery('(Sigh) No label at all.'), 'No label at all.');
});

test('other bracketed words are still hers', () => {
  assert.equal(stripDelivery('[neutral] The file is (sighted) twice (laughter) here.'), 'The file is (sighted) twice (laughter) here.');
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
