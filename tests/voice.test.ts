// Getting a written reply ready to be said out loud.
//
// The file separates this half from the engine on purpose, and it is the half
// worth testing: what she says aloud differs from what is on screen whoever
// synthesises it, and every difference here is one somebody heard go wrong.
// "STOP" spelled out letter by letter. A url read aloud in full. Her stopping
// dead at every comma. A reply that came back as thirty seconds of silence.
//
// The engine adapters underneath are two fetches and a switch, and testing them
// would mostly be testing that a fetch was called with what it was called with.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOICE, hasShout, isSilent, readVoiceConfig, referenceFor, shoutReference,
  speakableText, splitForSpeech, spokenCase, type VoiceConfig,
} from '../electron/voice';

const config = (overrides: Partial<VoiceConfig> = {}): VoiceConfig => ({ ...DEFAULT_VOICE, ...overrides });

// -- capitals: a shout, or an abbreviation? -------------------------------------

test('a word she is shouting is handed over as a word', () => {
  // Given "STOP" the engine says S-T-O-P, which is unintelligible. There is no
  // SSML here to mark stress with, so it goes down as a word and the delivery
  // carries from the punctuation around it.
  assert.equal(spokenCase('STOP that'), 'stop that');
  // Only the listed words go all the way down to lower case. "NOT" is not on the
  // list, so it takes the general path and comes out title-cased — which still
  // gets it spoken as a word, which is the whole point.
  assert.equal(spokenCase('NO. Absolutely NOT.'), 'no. Absolutely Not.');
});

test('an initialism is left to be spelled out, because that is how it is said', () => {
  // CPU appears 36 times in her history and PC 31 — getting this wrong in the
  // other direction would be far more damaging than the bug it fixes.
  for (const said of ['CPU', 'GPU', 'PC', 'RAM', 'SSD', 'API', 'TV']) {
    assert.equal(spokenCase(`the ${said} is fine`), `the ${said} is fine`, `${said} was mangled`);
  }
});

test('two letters stay as they are, where a shout and an abbreviation are least distinguishable', () => {
  assert.equal(spokenCase('OK then'), 'OK then');
  assert.equal(spokenCase('MY word'), 'MY word');
});

test('a run of capitals with no vowel can only be an abbreviation', () => {
  assert.equal(spokenCase('the GTX card'), 'the GTX card');
  assert.equal(spokenCase('send an RSVP'), 'send an RSVP');
});

test('a long shouted word is given back its lower case', () => {
  assert.equal(spokenCase('this is BRILLIANT'), 'this is Brilliant');
  assert.equal(spokenCase("I said DON'T"), "I said Don't");
});

test('ordinary text is left completely alone', () => {
  const said = 'Fine. The bins go out on Thursday, as you well know.';
  assert.equal(spokenCase(said), said);
});

// -- whether it was a shout at all ----------------------------------------------

test('a shout is noticed before the capitals are taken away', () => {
  // Run before spokenCase, which removes the evidence — and the capitals survive
  // into the subtitle, where seeing STOP is the point.
  assert.equal(hasShout('STOP that'), true);
  assert.equal(hasShout('this is BRILLIANT'), true);
});

test('talking about her hardware is not shouting', () => {
  assert.equal(hasShout('the CPU is at 90 degrees'), false);
  assert.equal(hasShout('check the GPU and the SSD'), false);
  assert.equal(hasShout('nothing here is loud at all'), false);
});

test('punctuation is the other way she raises her voice', () => {
  // Two marks in a row, of any mixture: "?!" counts as much as "??" does.
  assert.equal(hasShout('what?!'), true);
  assert.equal(hasShout('what??'), true);
  assert.equal(hasShout('what? Really.'), false, 'one mark, then a word, is ordinary');
  assert.equal(hasShout('honestly!!!'), true);
  assert.equal(hasShout('honestly!'), false);
});

// -- what is worth saying out loud ------------------------------------------------

test('a code block is dropped rather than narrated character by character', () => {
  const said = speakableText('Try this:\n\n```js\nconst x = 1;\n```\n\nThat should do it.');
  assert.ok(!said.includes('const'));
  assert.ok(said.includes('Try this'));
  assert.ok(said.includes('That should do it'));
});

test('inline code is spoken without its backticks', () => {
  assert.equal(speakableText('run `npm test` first'), 'run npm test first');
});

test('a link is read as its words, never as its address', () => {
  assert.equal(speakableText('see [the docs](https://example.com/a/b?c=d) for it'), 'see the docs for it');
});

test('a stage direction left inside a sentence is not something she said', () => {
  assert.equal(speakableText('so anyway [she sighs] fine.'), 'so anyway fine.');
});

test('markdown emphasis, headings, quotes and bullets are stripped', () => {
  assert.equal(speakableText('**really** and *truly*'), 'really and truly');
  assert.equal(speakableText('## Today\nthe bins'), 'Today the bins');
  assert.equal(speakableText('> quoted thing'), 'quoted thing');
  assert.equal(speakableText('- first\n- second'), 'first second');
});

test('a list marker goes, but a year does not', () => {
  assert.equal(speakableText('1. do the thing'), 'do the thing');
  assert.equal(speakableText('it was 1990. A good year.'), 'it was 1990. A good year.');
});

test('emoji are removed, because most engines emit a gap where one was', () => {
  assert.equal(speakableText('fine 🙄 whatever'), 'fine whatever');
});

// -- cutting it into pieces she can start speaking sooner ---------------------------

test('short sentences travel together up to the limit', () => {
  const chunks = splitForSpeech('One. Two. Three.', 40);
  assert.deepEqual(chunks, ['One. Two. Three.']);
});

test('it breaks at a sentence end rather than mid-thought', () => {
  const chunks = splitForSpeech('AAAA BBBB CCCC. DDDD EEEE FFFF.', 20);
  assert.deepEqual(chunks, ['AAAA BBBB CCCC.', 'DDDD EEEE FFFF.']);
});

test('a sentence longer than the limit is left whole', () => {
  // A clause broken in half sounds worse than one long chunk takes to arrive.
  const long = 'This one sentence is considerably longer than the limit it is being given here.';
  assert.deepEqual(splitForSpeech(long, 20), [long]);
});

test('nothing but punctuation is not worth a request', () => {
  assert.deepEqual(splitForSpeech('... ! ?'), []);
  assert.deepEqual(splitForSpeech(''), []);
});

// -- which clip she is cloned from --------------------------------------------------

test('an emotion with a clip of its own is used', () => {
  const voice = config({ voice: 'default.wav', referenceText: 'the usual', emotionVoices: { annoyed: { clip: 'cross.wav', text: 'for goodness sake' } } });
  assert.deepEqual(referenceFor(voice, 'annoyed'), { clip: 'cross.wav', text: 'for goodness sake' });
});

test('a half-filled row falls back rather than sending an empty path', () => {
  // The server rejects an empty ref_audio_path, and the reply comes back silent.
  const voice = config({ voice: 'default.wav', referenceText: 'the usual', emotionVoices: { annoyed: { clip: '', text: 'orphaned transcript' } } });
  assert.deepEqual(referenceFor(voice, 'annoyed'), { clip: 'default.wav', text: 'the usual' });
  assert.deepEqual(referenceFor(voice, null), { clip: 'default.wav', text: 'the usual' });
  assert.deepEqual(referenceFor(voice), { clip: 'default.wav', text: 'the usual' });
});

test('a shout uses its own clip, then the cross one, then whatever was going to be used', () => {
  const fallback = { clip: 'default.wav', text: 'the usual' };
  const dedicated = config({ shoutVoice: { clip: 'shout.wav', text: 'OI' }, emotionVoices: { annoyed: { clip: 'cross.wav', text: 'ugh' } } });
  assert.equal(shoutReference(dedicated, fallback).clip, 'shout.wav');

  // No dedicated clip: her angry one is the right one and is usually already
  // mapped, so shouting needs no new setup to work.
  const crossOnly = config({ emotionVoices: { annoyed: { clip: 'cross.wav', text: 'ugh' } } });
  assert.equal(shoutReference(crossOnly, fallback).clip, 'cross.wav');

  assert.deepEqual(shoutReference(config(), fallback), fallback);
});

// -- reading a stored config forward --------------------------------------------------

test('nothing saved is the default configuration', () => {
  assert.deepEqual(readVoiceConfig(undefined), DEFAULT_VOICE);
  assert.deepEqual(readVoiceConfig('not an object'), DEFAULT_VOICE);
  assert.deepEqual(readVoiceConfig(null), DEFAULT_VOICE);
});

test('an engine nobody has heard of falls back rather than being sent anywhere', () => {
  assert.equal(readVoiceConfig({ engine: 'elevenlabs' }).engine, DEFAULT_VOICE.engine);
  assert.equal(readVoiceConfig({ engine: 'gpt-sovits' }).engine, 'gpt-sovits');
});

test('speed and volume are held inside what the engine will accept', () => {
  assert.equal(readVoiceConfig({ speed: 99 }).speed, 2);
  assert.equal(readVoiceConfig({ speed: 0 }).speed, DEFAULT_VOICE.speed, 'a speed of nothing is not a speed');
  assert.equal(readVoiceConfig({ speed: -1 }).speed, DEFAULT_VOICE.speed);
  assert.equal(readVoiceConfig({ volume: 5 }).volume, 1);
  assert.equal(readVoiceConfig({ volume: -5 }).volume, 0);
});

test('the web door speaks unless it was told not to', () => {
  assert.equal(readVoiceConfig({}).webEnabled, true);
  assert.equal(readVoiceConfig({ webEnabled: false }).webEnabled, false);
  assert.equal(readVoiceConfig({ webEnabled: 'nonsense' }).webEnabled, true, 'only a real false switches it off');
});

test('a clip mapped to nothing, or to an emotion she has not got, is dropped', () => {
  const read = readVoiceConfig({
    emotionVoices: {
      annoyed: { clip: 'cross.wav', text: 'ugh' },
      happy: { clip: '   ', text: 'orphaned' },
      smug: 'not even an object',
      neverheardofit: { clip: 'nonsense.wav', text: 'x' },
    },
    shoutVoice: { text: 'a transcript with no clip' },
  });
  assert.deepEqual(read.emotionVoices.annoyed, { clip: 'cross.wav', text: 'ugh' });
  assert.equal(read.emotionVoices.happy, undefined, 'a blank clip is not a mapping');
  assert.ok(!('neverheardofit' in read.emotionVoices));
  assert.equal(read.shoutVoice, undefined, 'a transcript alone is not a reference');
});

test('a clip with no transcript is still a clip', () => {
  // It will clone worse — the transcript has to match or the timbre drifts — but
  // that is a worse voice, not a broken one.
  const read = readVoiceConfig({ emotionVoices: { annoyed: { clip: 'cross.wav' } } });
  assert.deepEqual(read.emotionVoices.annoyed, { clip: 'cross.wav', text: '' });
});

// -- the reply that came back as silence -------------------------------------------

/** A 16-bit mono PCM WAV, optionally with a LIST chunk in front of the samples. */
function wav(samples: number[], { withListChunk = false, magic = 'RIFF' } = {}): Uint8Array {
  const list = withListChunk ? 12 : 0;
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + list + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i); };
  ascii(0, magic);
  view.setUint32(4, out.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  let at = 36;
  if (withListChunk) {
    ascii(at, 'LIST');
    view.setUint32(at + 4, 4, true);
    ascii(at + 8, 'INFO');
    at += 12;
  }
  ascii(at, 'data');
  view.setUint32(at + 4, dataBytes, true);
  samples.forEach((value, index) => view.setInt16(at + 8 + index * 2, value, true));
  return out;
}

const SILENCE = new Array(4000).fill(0);
const SPEECH = Array.from({ length: 4000 }, (_, i) => Math.round(8000 * Math.sin(i / 8)));

test('a reply that came back as silence is caught', () => {
  // It happens for real: inference fails part-way and the server hands back a
  // well-formed wav with nothing in it, so she opens her mouth and says nothing.
  assert.equal(isSilent(wav(SILENCE)), true);
  assert.equal(isSilent(wav(SPEECH)), false);
});

test('the samples are found even when something else is in front of them', () => {
  // A wav written with a LIST or fact chunk does not keep its samples at byte 44,
  // and reading a fixed header would find metadata and call it speech.
  assert.equal(isSilent(wav(SILENCE, { withListChunk: true })), true);
  assert.equal(isSilent(wav(SPEECH, { withListChunk: true })), false);
});

test('a nearly-silent clip is still silence, and a quiet one is not', () => {
  assert.equal(isSilent(wav(new Array(4000).fill(8))), true, 'dither is not speech');
  assert.equal(isSilent(wav(new Array(4000).fill(2000))), false);
});

test('nothing at all is silence', () => {
  assert.equal(isSilent(new Uint8Array(0)), true);
  assert.equal(isSilent(new Uint8Array(16)), true);
});

test('a format it cannot read is not judged', () => {
  // The check exists to catch one failure, not to sit in judgement on formats it
  // does not understand — an mp3 or an opus clip must pass straight through.
  const mp3 = new Uint8Array(200);
  mp3[0] = 0xff; mp3[1] = 0xfb;
  assert.equal(isSilent(mp3), false);
});

test('something merely shaped like a wav is not judged either', () => {
  // RF64 is the real case: a wav extension for files over four gigabytes, laid
  // out exactly like one but announcing itself differently. Every chunk here
  // would parse, and the samples really are silent — so without the check on the
  // first four bytes this would be reported as a failed synthesis. It is not
  // ours to read, so it passes.
  assert.equal(isSilent(wav(SILENCE, { magic: 'RF64' })), false);
  assert.equal(isSilent(wav(SILENCE, { magic: 'RIFF' })), true, 'the same bytes, correctly announced');
});

test('a wav that arrived inside a pooled buffer is read from the right place', () => {
  // Node hands back Buffers that are views into a shared pool, so byteOffset is
  // very often not zero. Reading from the underlying buffer instead of the view
  // would parse whatever another allocation left there.
  const bytes = wav(SILENCE);
  const pooled = Buffer.concat([Buffer.from([1, 2, 3, 4, 5]), Buffer.from(bytes)]).subarray(5);
  assert.ok(pooled.byteOffset > 0, 'the fixture needs a non-zero offset to mean anything');
  assert.equal(isSilent(pooled), true);
  assert.equal(isSilent(Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from(wav(SPEECH))]).subarray(3)), false);
});
