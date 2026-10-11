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
import { DEFAULT_VOICE, hasShout, isSilent, readVoiceConfig, referenceFor, shoutReference, speakableText, splitForSpeech, streamedSentences, spokenCase, type VoiceConfig, sovitsRequest, DEFAULT_SAMPLING, looksClipped, SPOKEN_CHARS_PER_SECOND, pickSigh, HUME_DESCRIPTIONS, HUME_TTS_URL, BREEZE_DESCRIPTIONS, pcmToWav, wrapPcmAsWav } from '../electron/voice';
import { EMOTIONS } from '../electron/emotion';

const config = (overrides: Partial<VoiceConfig> = {}): VoiceConfig => ({ ...DEFAULT_VOICE, ...overrides });

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

test('breeze carries a tempo cue in every mood, because it has no speed parameter', () => {
  // Breeze's API has no speed field — delivery pace rides in the instruction
  // (its own docs demonstrate "Speak slowly with a restrained, serious tone").
  // Every mood must ask for its own pace or the delivery defaults to one speed.
  const tempoByEmotion: Record<string, RegExp> = {
    sleepy: /slow|drowsy/i,
    bored: /drawn out|flat/i,
    worried: /soft|strained/i,
    determined: /deliberate|firm/i,
    embarrassed: /hesitant|sheepish/i,
    affectionate: /gentle|soft/i,
    happy: /quicker|bright/i,
    curious: /light|wondering/i,
    smug: /unhurried|teasing/i,
    surprised: /quick|sharp/i,
    annoyed: /sharp|clipped/i,
    neutral: /flat|dry/i,
    shy: /hesitant|quiet/i,
    seductive: /slow|low/i,
    teasing: /sing-song|playful/i,
    sexy: /breathy|sultry/i,
    direct: /clipped|firm/i,
    whispering: /whispering|soft/i,
    breathless: /quick|panting/i,
    challenging: /daring|confident/i,
    coy: /hesitant|playful/i,
    knowing: /low|amused/i,
    commanding: /brisk|bossy/i,
    possessive: /steady|low/i,
  };
  for (const emotion of EMOTIONS) {
    const direction = BREEZE_DESCRIPTIONS[emotion];
    assert.match(direction, tempoByEmotion[emotion], `no tempo cue for ${emotion}`);
  }
});

test('Breeze PCM is wrapped in a playable WAV', () => {
  const pcm = new Uint8Array(48000); // one second at 24 kHz mono s16le
  const wav = pcmToWav(pcm);
  const view = new DataView(wav.buffer);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint32(24, true), 24000, 'sample rate');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  // A wrapped clip is not silent once it carries signal.
  assert.equal(isSilent(pcmToWav(new Uint8Array(4800))), true);
});

test('Breeze PCM is streamed as a WAV the phone can play', async () => {
  // A wrapped clip is not silent once it carries signal.
  const pcm = new Uint8Array(48000);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcm.subarray(0, 24000));
      controller.enqueue(pcm.subarray(24000));
      controller.close();
    },
  });
  const chunks: Uint8Array[] = [];
  const stream = wrapPcmAsWav(body);
  for await (const chunk of stream) chunks.push(chunk);
  const all = Buffer.concat(chunks.map(c => Buffer.from(c)));
  assert.equal(all.length, 44 + pcm.length);
  assert.equal(String.fromCharCode(...all.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...all.subarray(8, 12)), 'WAVE');
  // Unknown length: the streaming marker that says "keep reading until the connection ends".
  assert.equal(new DataView(all.buffer).getUint32(40, true), 0xFFFFFFFF);
  assert.equal(new DataView(all.buffer).getUint32(24, true), 24000);
  // The header lands before any PCM, so the player gets its format first.
  assert.equal(String.fromCharCode(...all.subarray(36, 40)), 'data');
});
