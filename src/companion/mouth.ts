// Her voice, and the mouth that moves with it.
//
// The audio plays in this window rather than the chat window because the model
// is here. That is the whole reason the lip sync is honest: the jaw is driven by
// the amplitude actually leaving the speakers, read per frame, rather than by an
// envelope timed against the text and hoped to line up.
//
// Clips arrive one sentence at a time while the rest of the reply is still being
// synthesised, so this is a queue rather than a player — she starts talking on
// the first sentence and the others fall in behind it.

import type { SpeechClip } from '../types';

/**
 * What the parameter layer reads each frame. `bands` is the voice's balance right now, as fractions of the whole:
 * low (150-900 Hz, the jaw's open vowels), mid (900-2600 Hz, the second formant, high for ee/eh and low for
 * oo/oh) and high (3.5-9 kHz, s/sh/f/t hiss). Absent where there is no audio to measure.
 */
export type Bands = { low: number; mid: number; high: number };
export type MouthReading = { open: number; weight: number; bands?: Bands; pause?: Pause };
/** A pause she is holding at punctuation: a comma's breath or a full stop's. */
export type Pause = 'comma' | 'stop';

// Speech sits well below full scale, so the usable range is narrow. Below the
// floor is the gap between words and should read as a closed mouth; above the
// ceiling is a raised voice and should not open it any further.
const LEVEL_FLOOR = 0.015;
const LEVEL_CEILING = 0.18;
// Opens faster than it closes. Matched attack and release make her look like she
// is chewing; a slower release lets the jaw fall shut the way a real one does.
const ATTACK = 0.45;
const RELEASE = 0.15;
// How quickly the mouth hands control back to the pose layer when she stops.
const WEIGHT_FADE = 0.12;
const FFT_SIZE = 1024;
// How quickly the band balance follows the voice (per frame): enough to see a vowel change, not a single noisy frame.
const BANDS_FOLLOW = 0.4;
const BAND_HZ = { low: [150, 900], mid: [900, 2600], high: [3500, 9000] } as const;

// Pauses at punctuation, so her mouth stops where a person's would. The synthesiser runs the words of a sentence
// together and plays sentences back to back; a comma inside a clip is found by where it falls in the text, then
// the quietest stretch of audio near there (a natural dip, if there is one) is where the clip is split.
const PAUSE_MS: Record<Pause, number> = { comma: 200, stop: 380 };
const PAUSE_MARKS: [RegExp, Pause][] = [[/[.!?…]/, 'stop'], [/[,;:—–]/, 'comma']];
// Seconds either side of a comma's estimated time to look for the dip; the dip must be this quiet against the clip.
// 0.1 (-20dB) is real silence. At 0.35 (-9dB) cuts landed inside words ("Well," at -11dB) and the pause chopped them.
const CUT_SEARCH_S = 0.35, CUT_QUIET = 0.1, CUT_MIN_GAP_S = 0.3;

type Piece = { from: number; to: number; pause?: Pause };

/** Splits a clip at the punctuation in its text, where the audio dips, into pieces with the pause after each. */
export function piecesFor(samples: Float32Array, sampleRate: number, text: string): Piece[] {
  const duration = samples.length / sampleRate, hop = Math.round(sampleRate * 0.02);
  const rms: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / hop));
  }
  const level = Math.sqrt(rms.reduce((a, r) => a + r * r, 0) / Math.max(1, rms.length));
  const trimmed = text.trim(), letters = trimmed.length;
  const kindOf = (ch: string) => PAUSE_MARKS.find(([re]) => re.test(ch))?.[1];
  const pieces: Piece[] = [];
  let from = 0;
  for (let i = 0; i < letters - 1; i++) {
    const kind = kindOf(trimmed[i]);
    // A mark followed by another mark or not by a space ("2.5", "...") is not a pause of its own.
    if (!kind || !/\s/.test(trimmed[i + 1])) continue;
    const at = (i + 1) / letters * duration;
    const lo = Math.max(from + CUT_MIN_GAP_S, at - CUT_SEARCH_S), hi = Math.min(duration - CUT_MIN_GAP_S, at + CUT_SEARCH_S);
    let best = -1;
    for (let k = Math.ceil(lo / 0.02); k * 0.02 <= hi && k < rms.length - 1; k++) {
      const quiet = (rms[k - 1] + rms[k] + rms[k + 1]) / 3;
      if (best < 0 || quiet < (rms[best - 1] + rms[best] + rms[best + 1]) / 3) best = k;
    }
    if (best < 1 || (rms[best - 1] + rms[best] + rms[best + 1]) / 3 > CUT_QUIET * level) continue;
    pieces.push({ from, to: best * 0.02, pause: kind });
    from = best * 0.02;
  }
  pieces.push({ from, to: duration, pause: kindOf(trimmed[letters - 1] ?? '') });
  return pieces;
}

// Synthesised speech comes back quiet — measured at about -17dB peak against
// music and game audio that routinely runs close to full scale — so at matched
// volume settings she is simply inaudible over anything else playing. This lifts
// her into the same range. The limiter below is what makes it safe: gain this
// far above unity would otherwise clip on her louder syllables.
// Applied after the compressor below, which is what makes a number this large
// safe. Boosting raw speech this far would clip on every stressed syllable;
// boosting speech that has already had its dynamic range pulled in raises the
// whole line instead of just its peaks, which is what "louder" actually means
// to a listener.
const SPEECH_MAKEUP_GAIN = 7;

/**
 * A ceiling on how far the reminder escalation may push her, and on that alone.
 *
 * The two things stacked on her volume are not the same kind of thing, and
 * capping their product was a mistake. Escalation is meant to make her louder,
 * so it needs a limit. Duck compensation is meant to keep her exactly as loud as
 * she already was while everything else drops away — it is cancelled by the drop
 * it is compensating for, and capping it does not make her quieter, it makes the
 * cancellation incomplete.
 *
 * Which is audible. The system volume falls in one step; her gain, capped, could
 * only climb part of the way back. The shortfall was a dip at the moment she
 * started talking and a swell as the ramp finished — heard, reasonably enough,
 * as her raising her own volume.
 *
 * 1.9 is the shouting tier in ./reminders, so this binds nothing she does on
 * purpose and everything she does by accident.
 */
const MAX_INSISTENCE = 1.9;

/**
 * What every clip is levelled to before playback, as RMS.
 *
 * Loudness rather than peak: peak is set by whichever consonant happened to land
 * hardest and says little about how loud a line sounds, and matching peaks would
 * leave the quiet chunks quiet. -30dBFS is about where the synthesiser already
 * sits, so this mostly nudges outliers into line rather than moving everything.
 */
const TARGET_RMS = 0.0316;
// ponytail: fixed trim for streamed Breeze audio (measured -24.4dBFS RMS → TARGET_RMS). Per-line levelling needs the whole line; measure the first part if another engine streams.
const STREAM_TRIM = 0.52;
/**
 * How far a single clip may be moved. A chunk that is nearly silent — a breath,
 * a trailing "…mm" — has a tiny RMS and would otherwise be hauled up to full
 * conversational level, which is a far worse artefact than the one being fixed.
 */
const MAX_TRIM = 2.5;
const MIN_TRIM = 0.4;

/** RMS of the first channel, which is all the synthesiser produces. */
function levellingFor(buffer: AudioBuffer) {
  const samples = buffer.getChannelData(0);
  if (!samples.length) return 1;
  let sum = 0;
  // Every fourth sample: loudness does not need every one of them, and this runs
  // on the main thread between clips.
  for (let i = 0; i < samples.length; i += 4) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.ceil(samples.length / 4));
  if (!Number.isFinite(rms) || rms < 1e-5) return 1;
  return Math.min(MAX_TRIM, Math.max(MIN_TRIM, TARGET_RMS / rms));
}

/**
 * How far the duck compensation may go. Holding her steady while the rest of the
 * output drops is the point of ducking, but past roughly a third the thing she
 * is being held steady against is already close to inaudible, and dividing
 * further only shouts into a quiet room.
 */
const MIN_DUCK_FACTOR = 0.35;

/** The parts of the settings that playback cares about. */
export type PlaybackSettings = { volume: number; speed: number; systemVoice: string };

export type VoicePlayer = {
  /** Queues a clip. Clips from an abandoned turn are ignored. */
  play(clip: SpeechClip): void;
  stop(): void;
  configure(settings: PlaybackSettings): void;
  /** Per-frame mouth position. Cheap enough to call from the render loop. */
  read(): MouthReading;
  /** Whether she is mid-line. Unlike read(), this advances nothing, so it is
   *  safe to ask from somewhere that is not driving the mouth. */
  speaking(): boolean;
  /** How far the system output has been ducked beneath her, so she can be lifted
   *  by the same amount and stay put while the rest of the machine drops. */
  setDuck(factor: number): void;
  /** Raises her above her normal level while she is being ignored about
   *  something she was asked to chase. 1 is normal, 2 the ceiling. */
  setInsistence(factor: number): void;
  dispose(): void;
};

export function createVoicePlayer(): VoicePlayer {
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let gain: GainNode | null = null;
  let compressor: DynamicsCompressorNode | null = null;
  let limiter: DynamicsCompressorNode | null = null;
  // Explicitly over an ArrayBuffer: getByteTimeDomainData will not take a view
  // that might sit on a SharedArrayBuffer.
  let samples: Uint8Array<ArrayBuffer> | null = null;
  let spectrum: Float32Array<ArrayBuffer> | null = null;
  const bands: Bands = { low: 0.7, mid: 0.2, high: 0.03 };

  let volume = 0.9;
  // How far the system output has been pulled down beneath her. She shares that
  // output, so a duck alone lowers her by exactly as much as everything else and
  // changes nothing about whether she can be heard over it. Dividing her gain by
  // the same factor holds her steady in absolute terms while the rest drops away,
  // which is the entire point of ducking.
  let duckFactor = 1;
  // Raised while she is chasing an unanswered reminder. Separate from volume so
  // it decays back on its own without disturbing the user's setting, and capped
  // in setInsistence so repeated escalation cannot run away.
  let insistence = 1;
  // Only meaningful for the Windows voices — the audio engines have already
  // baked speed and voice into the samples by the time they reach here.
  let speed = 1;
  let systemVoice = '';
  let queue: SpeechClip[] = [];
  let current: AudioBufferSourceNode | null = null;
  // The pause being held between two pieces of a clip, or after one, and its timer.
  let pause: Pause | undefined;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  // The turn of the most recent clip accepted. Anything older is a leftover from
  // a reply she has already been interrupted out of.
  let turn = -1;
  // Bumped by every stop. Decoding is asynchronous, so without this a clip that
  // was mid-decode when she was cut off would still reach the speakers — the
  // turn alone cannot catch it, since being silenced does not start a new turn.
  let generation = 0;
  // True while a Windows voice is talking — that path has no audio to measure,
  // so the mouth has to be driven differently.
  let synthesising = false;
  // A streamed line (playPart): its parts already queued on the audio clock,
  // when the last of them ends, and whether more of the line is still coming.
  const scheduled = new Set<AudioBufferSourceNode>();
  let streamEnd = 0;
  let streaming = false;

  let level = 0;
  let weight = 0;

  /**
   * The boost applied on top of whatever the user set, capped as a multiplier
   * rather than as a final level so their volume stays a real master control —
   * clamping the finished value instead would quietly ignore a low setting the
   * moment anything else pushed the stack up.
   */
  function speechBoost() {
    // Bounded: how loud she is allowed to get.
    const loudness = SPEECH_MAKEUP_GAIN * Math.min(insistence, MAX_INSISTENCE);
    // Unbounded by design, and safe because it is exactly the reciprocal of a
    // drop that has already happened — the floor is what keeps it finite. Left
    // capped, she audibly climbs after every duck instead of staying put.
    const holdSteady = 1 / Math.max(MIN_DUCK_FACTOR, duckFactor);
    return loudness * holdSteady;
  }

  /**
   * Ramped, and deliberately not symmetrically.
   *
   * This is the surge. Ducking sets two things going at once: the system volume
   * is pulled down through the helper, and this window is told to divide her
   * gain by the same factor to hold her steady against it. The second arrives
   * over IPC in about a millisecond. The first has to reach a PowerShell process
   * over stdin and then Core Audio, and does not. So her gain doubled — a clean
   * +6dB — while the output it was compensating for was still at full level, and
   * she was audibly loud until the duck landed underneath her and put her back.
   *
   * Going up is therefore taken slowly enough for the system change to arrive
   * first; coming down stays quick, because that direction only ever errs
   * quiet and nobody has ever complained about that.
   */
  // Short in both directions now. The slow rise was there to hide a gain change
  // that arrived before the system volume moved; it now arrives on the
  // acknowledgement that the system volume *has* moved, so the two are meant to
  // coincide. Ramping either one is what pulls them apart again.
  const GAIN_UP = 0.02;
  const GAIN_DOWN = 0.02;

  function applyGain() {
    if (!gain || !context) return;
    const target = volume * speechBoost();
    const constant = target > gain.gain.value ? GAIN_UP : GAIN_DOWN;
    gain.gain.setTargetAtTime(target, context.currentTime, constant);
  }

  function audio() {
    if (context) return context;
    context = new AudioContext();
    gain = context.createGain();
    // Through the same path as every later change, so the first clip after a
    // duck or an escalation is not briefly louder than the rest.
    gain.gain.value = volume * speechBoost();
    // Catches the peaks the makeup gain would otherwise push past full scale.
    // Fast attack because a clipped consonant is audible immediately; slow
    // release so it does not pump between syllables.
    limiter = context.createDynamicsCompressor();
    // Evens her out before anything is added. Speech swings enormously between a
    // stressed syllable and a trailing word, and it is that gap — not the peaks —
    // that makes her hard to hear: the peaks were always audible, the rest of the
    // sentence was not. Pulling the range in first is what lets the gain lift the
    // quiet parts with it.
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 8;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    // Measured against her own synthesised speech before touching this: at 5:1
    // over a -26dB threshold the applied gain travels about 4.4dB across a line
    // whatever the release is, and lengthening it to 0.38 moved that by under
    // half a decibel — in the wrong direction. The surge is not this node
    // breathing; it is the duck compensation in applyGain arriving early.
    compressor.release.value = 0.16;
    // The last line of defence, right at the ceiling. By this point the signal is
    // already even, so it only ever catches the occasional stray transient.
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    // Some smoothing in the node itself, the rest in read(): this one steadies
    // the raw reading, the attack/release below shapes how a jaw moves.
    analyser.smoothingTimeConstant = 0.35;
    // The time-domain read wants one byte per sample in the window, not per bin.
    samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    spectrum = new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * 4));
    // Order matters: even her out, then lift, then catch what is left. Lifting
    // before compressing would just push the peaks into the compressor and
    // squash them back down, which is loud in the meter and no louder in the room.
    // The analyser sits last so the mouth follows what is actually heard.
    compressor.connect(gain);
    gain.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(context.destination);
    return context;
  }

  function playNext() {
    const clip = queue.shift();
    if (!clip) { busy = false; return; }
    busy = true;
    if (clip.pcm?.byteLength) void playPart(clip);
    else if (clip.audio?.byteLength) void playAudio(clip);
    else speakWithSystemVoice(clip.text);
  }

  /**
   * One part of a line streamed from the server, scheduled to start exactly
   * where the part before it ends — so she is talking while the rest of the
   * line is still being made. No pieces and no per-clip levelling: both need
   * the whole line, which is the wait this exists to skip.
   */
  async function playPart(clip: SpeechClip) {
    const era = generation;
    const ctx = audio();
    if (ctx.state === 'suspended') await ctx.resume();
    if (era !== generation) return;
    if (clip.turn !== turn) { playNext(); return; }
    const pcm = clip.pcm!;
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const buffer = ctx.createBuffer(1, pcm.byteLength >> 1, clip.sampleRate ?? 24000);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true) / 32768;
    const trim = ctx.createGain();
    trim.gain.value = STREAM_TRIM;
    trim.connect(compressor!);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(trim);
    // A little headroom before the first part, so network jitter does not open gaps between the rest.
    const at = Math.max(ctx.currentTime + 0.06, streamEnd);
    streamEnd = at + buffer.duration;
    streaming = Boolean(clip.more);
    scheduled.add(source);
    current = source;
    source.onended = () => {
      scheduled.delete(source);
      if (source !== current) return;
      current = null;
      if (!clip.more) playNext();
    };
    source.start(at);
    // More of this line is on its way: free the queue so it is scheduled the moment it lands.
    if (clip.more) playNext();
  }

  async function playAudio(clip: SpeechClip) {
    const bytes = clip.audio;
    if (!bytes) { playNext(); return; }
    const era = generation;
    try {
      const ctx = audio();
      // Autoplay is permitted by a switch in main, but a context can still come
      // up suspended if the window was not visible when it was created.
      if (ctx.state === 'suspended') await ctx.resume();
      // Copied out of the transferred view: decodeAudioData detaches the buffer,
      // and the view may be a window onto a larger one.
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const buffer = await ctx.decodeAudioData(copy);
      // Silenced, or superseded by a newer reply, while this was decoding.
      if (era !== generation) return;
      if (clip.turn !== turn) { playNext(); return; }
      const pieces = piecesFor(buffer.getChannelData(0), buffer.sampleRate, clip.text);
      // Every clip trimmed to the same loudness before anything else sees it.
      //
      // A reply is spoken as several chunks and each one is a separate run of
      // the synthesiser, which does not return a consistent level: measured
      // across five chunks of one reply, peaks spanned 5dB and loudness 1.6dB.
      // Played as they arrive, a quiet chunk followed by a loud one is heard as
      // her getting louder part-way through a sentence — which is precisely what
      // it is, only it happens between two halves of the same thought.
      const trim = ctx.createGain();
      trim.gain.value = levellingFor(buffer);
      // Into the head of the chain, not the gain: the compressor has to see the
      // signal at a consistent level to even it out correctly.
      trim.connect(compressor!);
      // The pieces in turn, each followed by its pause: silence the mouth closes on.
      const playPiece = (k: number) => {
        const piece = pieces[k];
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(trim);
        source.onended = () => {
          if (source !== current) return;
          current = null;
          const next = () => { pause = undefined; if (era !== generation) return; if (k + 1 < pieces.length) playPiece(k + 1); else playNext(); };
          if (!piece.pause) { next(); return; }
          pause = piece.pause;
          pauseTimer = setTimeout(next, PAUSE_MS[piece.pause]);
        };
        current = source;
        source.start(0, piece.from, piece.to - piece.from);
      };
      playPiece(0);
    } catch (error) {
      console.warn('[voice] could not play a clip:', error);
      if (era === generation) playNext();
    }
  }

  // The built-in Windows voices are reachable only as speech, never as samples,
  // so there is no amplitude to follow. The mouth is animated at a plausible
  // syllable rate instead — a flap, not lip sync, and it looks like one next to
  // the real thing. It exists so the feature works before a TTS server is set up.
  function speakWithSystemVoice(text: string) {
    if (!('speechSynthesis' in window)) { playNext(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = volume;
    utterance.rate = speed;
    // Resolved at speak time, not when the setting was saved: getVoices() is
    // empty until the engine has enumerated them, which is usually after the
    // window has finished loading. Left unset, the utterance takes the system
    // default — which is how she ended up male.
    if (systemVoice) {
      const match = window.speechSynthesis.getVoices().find(entry => entry.voiceURI === systemVoice);
      if (match) utterance.voice = match;
    }
    const era = generation;
    // Cancelling still ends the utterance, and that end arrives after the next
    // turn has started. Without the guard it would advance the new queue too,
    // leaving two lines talking over each other.
    const finish = () => {
      if (era !== generation) return;
      synthesising = false;
      playNext();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    synthesising = true;
    window.speechSynthesis.speak(utterance);
  }

  function measure(): number {
    if (synthesising) {
      // Two detuned oscillations so the rhythm does not read as a machine: one
      // near syllable rate, one slower shaping it into words.
      const t = performance.now() / 1000;
      const syllable = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 5.5);
      const phrase = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2.3 + 1.1);
      return 0.2 + 0.6 * syllable * phrase;
    }
    if (!analyser || !samples || !current) return 0;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const deviation = (samples[i] - 128) / 128;
      sum += deviation * deviation;
    }
    const rms = Math.sqrt(sum / samples.length);
    if (spectrum) {
      analyser.getFloatFrequencyData(spectrum);
      const hz = analyser.context.sampleRate / analyser.fftSize;
      const mean = ([lo, hi]: readonly [number, number]) => {
        let total = 0, n = 0;
        for (let i = Math.ceil(lo / hz); i < Math.min(spectrum!.length, hi / hz); i++, n++) total += 10 ** (spectrum![i] / 20);
        return n ? total / n : 0;
      };
      const low = mean(BAND_HZ.low), mid = mean(BAND_HZ.mid), high = mean(BAND_HZ.high), all = low + mid + high;
      if (all > 0) {
        bands.low += (low / all - bands.low) * BANDS_FOLLOW;
        bands.mid += (mid / all - bands.mid) * BANDS_FOLLOW;
        bands.high += (high / all - bands.high) * BANDS_FOLLOW;
      }
    }
    const scaled = (rms - LEVEL_FLOOR) / (LEVEL_CEILING - LEVEL_FLOOR);
    if (scaled <= 0) return 0;
    // Curved so ordinary speech uses most of the travel — linear, the mouth
    // barely moves except on the loudest syllables.
    return Math.min(1, scaled) ** 0.7;
  }

  function stopAll() {
    generation++;
    queue = [];
    busy = false;
    synthesising = false;
    clearTimeout(pauseTimer);
    pause = undefined;
    if (current) {
      // The handler would otherwise start the next clip of a turn being abandoned.
      current.onended = null;
      try { current.stop(); } catch { /* already finished */ }
      current = null;
    }
    // Parts of a streamed line already waiting on the audio clock.
    for (const source of scheduled) { source.onended = null; try { source.stop(); } catch { /* already finished */ } }
    scheduled.clear();
    streamEnd = 0;
    streaming = false;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  return {
    play(clip) {
      // A clip from a newer turn supersedes anything queued from an older one.
      if (clip.turn > turn) { queue = []; turn = clip.turn; }
      else if (clip.turn < turn) return;
      queue.push(clip);
      if (!busy) playNext();
    },
    stop: stopAll,
    speaking: () => Boolean(current) || synthesising || queue.length > 0 || Boolean(pause) || streaming,
    setDuck(factor) {
      duckFactor = Number.isFinite(factor) && factor > 0 ? Math.min(1, factor) : 1;
      applyGain();
    },
    setInsistence(factor) {
      // Capped at 2: past that the limiter is doing all the work and she stops
      // sounding louder, only more distorted.
      insistence = Number.isFinite(factor) ? Math.max(1, Math.min(2, factor)) : 1;
      applyGain();
    },
    configure(settings) {
      volume = Math.max(0, Math.min(1, settings.volume));
      speed = settings.speed;
      systemVoice = settings.systemVoice;
      applyGain();
    },
    read() {
      const target = measure();
      const speaking = target > 0 || !!current || synthesising || !!pause;
      level += (target - level) * (target > level ? ATTACK : RELEASE);
      // Weight is separate from level so that a closed mouth mid-sentence still
      // belongs to speech, and the pose layer does not get it back until she has
      // actually finished talking.
      weight += ((speaking ? 1 : 0) - weight) * WEIGHT_FADE;
      if (weight < 0.001) weight = 0;
      return { open: level, weight, bands: current ? { ...bands } : undefined, pause };
    },
    dispose() {
      stopAll();
      void context?.close();
      context = null;
    },
  };
}

// The chart's talking mouths, by index into whichever set draws them: her screen's traced sprites, her figure's
// drawn visemes. Closed is the rest mouth of the mood, whatever that is.
export const MOUTH = { closed: 0, slit: 1, mid: 2, wide: 3, round: 4, roundSmall: 5 } as const;
// Her synthesised voice is compressed, so its level sits near the top most of a line: the shape goes by the level
// relative to how loud she has been over the last LOUD_S seconds (rising at once, never below LOUD_FLOOR). The
// thresholds were tuned on her own voice clips (60 frames a second) to close between syllables about a tenth of
// the time: hiss over HISS of the whole is a sibilant; a second formant under ROUNDED of the low band is a rounded
// vowel, over FRONT a front one (ee/eh).
export const LOUD_S = 1.5, LOUD_FLOOR = 0.3;
export const SHUT = 0.06, CLOSED = 0.7;
const MID = 0.85, WIDE = 0.95, ROUND_OPEN = 0.88;
const HISS = 0.12, ROUNDED = 0.15, FRONT = 0.9;
/** The chart's mouth for this voice level (`rel`, relative to her recent loudness) and band balance. */
export function mouthFor(level: number, rel: number, bands?: Bands): number {
  if (level < SHUT || rel < CLOSED) return MOUTH.closed;
  const f2 = bands ? bands.mid / Math.max(bands.low, 1e-4) : 0.4;
  if (bands && bands.high > HISS) return MOUTH.slit;
  if (f2 < ROUNDED) return rel > ROUND_OPEN ? MOUTH.round : MOUTH.roundSmall;
  if (f2 > FRONT) return rel > WIDE ? MOUTH.mid : MOUTH.slit;
  return rel > WIDE ? MOUTH.wide : rel > MID ? MOUTH.mid : MOUTH.slit;
}
