// Voice activity, on the server this time.
//
// The same detector the phone page runs (webpage.ts, the VOICE block), ported
// so a call can be segmented where the audio arrives: energy against a floor
// that follows the room. Speech is a level well above the floor held for a
// beat; it ends after a stretch of quiet; the floor only learns while nobody
// is speaking, drops quickly and climbs slowly. The caller can raise the ratio
// while she is talking, so her own voice through the speaker is not taken for
// theirs. Kept in step with the page's copy — the tests mirror each other.

export type VadOptions = {
  /** How long a loud stretch must last before it counts as speech starting. */
  startAfterMs: number;
  /** How much quiet ends an utterance. Shorter is snappier and cuts pauses. */
  endAfterMs: number;
  /** Shorter than this is a bump, not words. */
  minMs: number;
  /** A monologue is cut here regardless. */
  maxMs: number;
  /** How far before the detected start the utterance is taken to begin. */
  prerollMs: number;
  ratio: number;
  floorMin: number;
  floorStart: number;
};

export const DEFAULT_VAD: VadOptions = { startAfterMs: 90, endAfterMs: 700, minMs: 350, maxMs: 15000, prerollMs: 300, ratio: 3.5, floorMin: 0.004, floorStart: 0.01 };

export type VadEvent =
  | { type: 'start'; t: number }
  | { type: 'end'; from: number; to: number; ms: number; speechEnd: number }
  | { type: 'drop' };

export type Vad = {
  /** One level reading (RMS, 0..1) at time t (ms). `ratio` overrides the option for this reading. */
  feed(level: number, t: number, ratio?: number): VadEvent | null;
  speaking(): boolean;
  possibleSpeech(): boolean;
  floor(): number;
  threshold(ratio?: number): number;
  /** Read-only tentative cut, identical to a later quiet endpoint if speech does not resume. */
  preview(t: number, quietMs: number): {from:number;to:number;speechEnd:number} | null;
  reset(): void;
};

export function makeVad(options: Partial<VadOptions> = {}): Vad {
  const o: VadOptions = { ...DEFAULT_VAD, ...options };
  let floor = o.floorStart;
  let state: 'quiet' | 'maybe' | 'speech' = 'quiet';
  let since = 0;
  let startedAt = 0;
  let lastLoud = 0;
  const threshold = (ratio?: number) => Math.max(o.floorMin, floor * (ratio || o.ratio));
  return {
    feed(level, t, ratio) {
      const loud = level > threshold(ratio);
      if (state === 'quiet') {
        floor = level < floor ? floor * 0.7 + level * 0.3 : floor + (level - floor) * 0.02;
        if (loud) { state = 'maybe'; since = t; }
        return null;
      }
      if (state === 'maybe') {
        if (!loud) { state = 'quiet'; return null; }
        if (t - since >= o.startAfterMs) { state = 'speech'; startedAt = since; lastLoud = t; return { type: 'start', t: Math.max(0, since - o.prerollMs) }; }
        return null;
      }
      if (loud) lastLoud = t;
      const over = t - startedAt >= o.maxMs;
      if ((!loud && t - lastLoud >= o.endAfterMs) || over) {
        state = 'quiet';
        const to = over ? t : lastLoud;
        if (to - startedAt < o.minMs) return { type: 'drop' };
        return { type: 'end', from: Math.max(0, startedAt - o.prerollMs), to: to + 100, ms: to - startedAt, speechEnd: to };
      }
      return null;
    },
    speaking: () => state === 'speech',
    possibleSpeech: () => state !== 'quiet',
    floor: () => floor,
    threshold,
    preview(t, quietMs) {
      return state === 'speech' && t - lastLoud >= Math.max(100, quietMs) && lastLoud - startedAt >= o.minMs
        ? {from:Math.max(0,startedAt-o.prerollMs),to:lastLoud+100,speechEnd:lastLoud} : null;
    },
    reset() { state = 'quiet'; },
  };
}

/** The RMS level of a frame of 16-bit PCM, 0..1 — the same scale the page reads off its float samples. */
export function pcm16Level(frame: Uint8Array): number {
  const samples = frame.byteLength >> 1;
  if (!samples) return 0;
  const view = new DataView(frame.buffer, frame.byteOffset, samples * 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) { const s = view.getInt16(i * 2, true) / 32768; sum += s * s; }
  return Math.sqrt(sum / samples);
}
