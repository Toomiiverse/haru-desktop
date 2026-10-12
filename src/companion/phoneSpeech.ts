import type { MouthReading } from './mouth';

/** Measure the existing speech element; initialize only after audio is unlocked. */
export function createPhoneSpeech(player: HTMLAudioElement | null) {
  let context: AudioContext | null = null, source: MediaElementAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null, samples: Float32Array<ArrayBuffer> | null = null;
  let disposed = false, pending = false, failed = false;
  async function unlock() {
    if (!player || disposed || pending || failed) return;
    pending = true;
    try {
      const Audio = window.AudioContext || (window as any).webkitAudioContext;
      if (!Audio) return;
      context ??= new Audio();
      await context!.resume();
      if (disposed || context!.state !== 'running' || source) return;
      analyser = context!.createAnalyser(); analyser.fftSize = 512;
      samples = new Float32Array(analyser.fftSize);
      analyser.connect(context!.destination);
      source = context!.createMediaElementSource(player); source.connect(analyser);
    } catch {
      failed = true;
      if (source && context) { source.disconnect(); source.connect(context.destination); }
      else { void context?.close(); context = null; }
      console.warn('[Haru avatar] Speech metering unavailable; voice playback is retained.');
    } finally { pending = false; }
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  player?.addEventListener('playing', unlock);
  return {
    read(): MouthReading {
      if (disposed || !player || player.paused || player.ended || player.muted || !player.volume || player.readyState < 3 || context?.state !== 'running' || !analyser || !samples) return { open: 0, weight: 0 };
      analyser.getFloatTimeDomainData(samples);
      let sum = 0; for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      return { open: Math.pow(Math.max(0, Math.min(1, (rms - .015) / .165)), .7), weight: 1 };
    },
    dispose() {
      disposed = true;
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      player?.removeEventListener('playing', unlock);
      // Keep the element's audio route alive after removing the visual meter.
      if (source && context) { source.disconnect(); source.connect(context.destination); analyser?.disconnect(); }
      else void context?.close();
    },
  };
}
