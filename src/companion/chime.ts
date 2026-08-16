// A sound for the microphone being open.
//
// Until now the only sign she was listening was a bar on a button, which is no
// use at all: the moment you most need to know is the moment you have turned
// away from the screen to say something. Every device that listens makes a noise
// when it starts, for exactly this reason.
//
// Synthesised rather than shipped as a file. Two short sine tones need no asset
// to load, resolve or package, and nothing to go missing from a build — and a
// chime that sometimes fails to play is worse than none, because you learn not
// to trust it.

/**
 * Rising for opening, falling for closing.
 *
 * The pair matters more than either note. A sound that only marks the start
 * leaves you talking into a window that shut a while ago; hearing it close is
 * what tells you to say her name again rather than repeat a whole sentence to
 * nobody.
 */
const OPEN = [660, 880];
const SHUT = [660, 440];

/** Short enough not to talk over, long enough to hear across a room. */
const NOTE_MS = 90;
/**
 * How loud, 0 to 1, set in Setup.
 *
 * Its own control rather than following her speaking volume, because the two
 * are wanted at different levels: her voice can sit low in the background while
 * the cue that the microphone is open still needs to carry across a room. On
 * this machine her voice is at 0.05, which would have made the chime inaudible
 * had it been scaled by it.
 */
let level = 0.06;

export function setChimeVolume(value: number) {
  level = Math.max(0, Math.min(1, value));
}

let context: AudioContext | null = null;

/**
 * One context, made on first use.
 *
 * Built lazily because the first chime always follows something the user did,
 * so by then the page has the activation an AudioContext needs — created at
 * import time it would start suspended and stay silent.
 */
function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    // Chromium suspends a context when nothing has used it for a while; resuming
    // is a no-op when it is already running.
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function play(notes: number[]) {
  // Silent means silent: no context, no nodes, no cost.
  if (level <= 0) return;
  const ctx = audio();
  if (!ctx) return;
  notes.forEach((frequency, index) => {
    const at = ctx.currentTime + index * (NOTE_MS / 1000);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    // Sine, because every other waveform has harmonics that read as an alert.
    // This is meant to be noticed and not reacted to.
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    // Ramped rather than switched: a square-edged gate on a tone clicks, and the
    // click is louder than the note.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_MS / 1000);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + NOTE_MS / 1000 + 0.02);
  });
}

/** She has started listening for what you are about to say. */
export function chimeListening() {
  play(OPEN);
}

/** The window has closed; anything said now is not going to her. */
export function chimeStoppedListening() {
  play(SHUT);
}
