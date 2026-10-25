/**
 * Her singing along on her own screen, to what Spin plays (ported from spin-desktop src/haru.ts singAlong). Spin sends
 * each song's mouth track once (makeLyrics.ts Mouth: the vocals' level and band balance every `hop` seconds, 0-100,
 * plus the beat grid) with its lyric lines, and its playhead about once a second; this extrapolates the playhead
 * between reports and reads the track there each frame, in the shape her voice player's reading has, so the rig's
 * mouth reads it the same way. She sings only while a line of the lyrics is being sung, a line's last note is still
 * held, or the vocals are strong and steady where the lyrics have no line (the separated vocals keep some synths).
 */
export type Mouth = { hop: number; open: number[]; low: number[]; mid: number[]; high: number[]; tempo: number; beats: number[]; held?: number[][]; others?: number[][] };
export type Line = { at: number | null; text: string };
export type SongReading = { open: number; weight: number; bands: { low: number; mid: number; high: number }; sung: boolean };

// She starts on a line just before its stamp, as the lyrics' stamps run a touch late.
const LEAD_S = 0.15;
// A line goes on while the voice still sounds, until quiet for HELD_GAP_S, HELD_MAX_S at most.
const HELD_VOICE = 0.08, HELD_GAP_S = 0.5, HELD_MAX_S = 6;
// Strong singing the lyrics missed: open STRONG_MEAN on average over STRONG_S, over 30% for STRONG_SHARE of it.
const STRONG_S = 2, STRONG_MEAN = 60, STRONG_SHARE = 0.85;
// Her head nods NOD_LEAD_S ahead of each beat (a nod takes about that long to reach its lowest point).
const NOD_LEAD_S = 0.1;

// How long a line takes to sing, as the lyrics only say when it starts: about half a second a word plus a breath,
// at least LINE_MIN_S, at most LINE_MAX_S, never past the next line's start (as Spin's src/lyrics.ts).
const LINE_MIN_S = 2.5, LINE_MAX_S = 8, WORD_S = 0.5, BREATH_S = 1.2;
/** Whether a line is being sung at `seconds`, counting from `lead` seconds before each line starts. Blank lines (an
 *  instrumental's "♪") and untimed lyrics never are. */
export function sungAt(lines: Line[], seconds: number, lead = 0): boolean {
  for (let i = 0; i < lines.length; i++) {
    const { at, text } = lines[i];
    if (at === null || !text.replace(/[♪\s]/g, '')) continue;
    if (at - lead > seconds) return false;
    const next = lines[i + 1]?.at ?? Infinity;
    const long = Math.min(LINE_MAX_S, Math.max(LINE_MIN_S, text.split(/\s+/).length * WORD_S + BREATH_S));
    if (seconds < Math.min(next, at + long)) return true;
  }
  return false;
}
const inSpans = (spans: number[][] | undefined, t: number) => !!spans?.some(([a, b]) => t >= a && t < b);

export function createSingAlong() {
  let track: Mouth | null = null, lines: Line[] = [], strong = new Uint8Array(0);
  let playing = false, position = 0, at = 0, songId = '';
  let weight = 0, lastVoice = -Infinity, lastLined = -Infinity, carrying = false, nextBeat = 0, lastT = -Infinity;
  const playhead = () => position + (playing ? (Date.now() - at) / 1000 : 0);
  return {
    /** A song's track (null while Spin has none yet: she listens with her mouth at rest). */
    setTrack(id: string, mouth: Mouth | null, words: Line[]) {
      songId = id; track = mouth; lines = words ?? [];
      lastVoice = lastLined = -Infinity; carrying = false; nextBeat = 0; lastT = -Infinity;
      if (!mouth) { strong = new Uint8Array(0); return; }
      const n = mouth.open.length, half = Math.round(STRONG_S / 2 / mouth.hop);
      const total = new Float64Array(n + 1), loud = new Uint32Array(n + 1);
      strong = new Uint8Array(n);
      for (let i = 0; i < n; i++) { total[i + 1] = total[i] + mouth.open[i]; loud[i + 1] = loud[i] + (mouth.open[i] > 30 ? 1 : 0); }
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - half), b = Math.min(n, i + half), len = b - a;
        strong[i] = total[b] - total[a] >= STRONG_MEAN * len && loud[b] - loud[a] >= STRONG_SHARE * len ? 1 : 0;
      }
    },
    /** Spin's playhead report. A different song than the track's means the track is stale until the next one. */
    setState(state: { playing: boolean; position: number; at: number; id?: string }) {
      if (state.id && state.id !== songId) track = null;
      playing = state.playing; position = state.position; at = state.at;
    },
    stop() { playing = false; },
    get playing() { return playing; },
    /** Her singing now, or null when there is nothing to sing (no song playing, or not yet known). */
    read(): SongReading | null {
      weight += ((playing && track ? 1 : 0) - weight) * 0.12;
      if (!track || weight < 0.01) return null;
      const t = playhead(), f = t / track.hop, i = Math.floor(f), k = f - i;
      const read = (a: number[]) => ((a[i] ?? 0) * (1 - k) + (a[i + 1] ?? a[i] ?? 0) * k) / 100;
      const lined = sungAt(lines, t, LEAD_S);
      if (t < lastVoice - 1) lastVoice = -Infinity;
      if (read(track.open) > HELD_VOICE) lastVoice = t;
      if (t < lastLined - 1) lastLined = -Infinity;
      if (lined) { carrying = true; lastLined = t; }
      const held = !lined && carrying && (inSpans(track.held, t) || t - lastVoice < HELD_GAP_S) && t - lastLined < HELD_MAX_S;
      if (!lined && !held) carrying = false;
      const sung = playing && !inSpans(track.others, t) && (lined || held || strong[i] === 1);
      return { open: sung ? read(track.open) : 0, weight, bands: { low: read(track.low), mid: read(track.mid), high: read(track.high) }, sung };
    },
    /** Whether a beat of the song's grid has just passed (once per beat); false without a grid or while paused. */
    beat(): boolean {
      if (!track?.beats?.length || !playing) return false;
      const t = playhead() + NOD_LEAD_S;
      if (t < lastT || t - lastT > 1) { nextBeat = track.beats.findIndex(b => b > t); if (nextBeat < 0) nextBeat = track.beats.length; lastT = t; return false; }
      let beat = false;
      while (nextBeat < track.beats.length && track.beats[nextBeat] <= t) { beat = true; nextBeat++; }
      lastT = t;
      return beat;
    },
    /** The lyric line being sung now ('' between lines). */
    line(): string {
      const t = playhead();
      let found = '';
      for (const line of lines) { if (line.at !== null && line.at - LEAD_S <= t) found = line.text; else if (line.at !== null) break; }
      return sungAt(lines, t, LEAD_S) ? found : '';
    },
    progress(duration: number) { return duration > 0 ? Math.min(1, playhead() / duration) : 0; },
    position: playhead,
  };
}
export type SingAlong = ReturnType<typeof createSingAlong>;
