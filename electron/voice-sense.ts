import {CoreVoiceSense,voiceSensePolicy,coreAnalyzeLocalVoice} from './core-voice-sense';
// Evidence about a voice belongs to one utterance, never to a permanent user trait.
// No audio, inferred feelings, or delivery feedback is persisted by this module.
import type { EmotionName } from './emotion';

const LABELS = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'other', 'sad', 'surprised', 'unknown'] as const;
type Label = typeof LABELS[number];
export type VoiceReading = {
  version: 1;
  source: 'local-audio' | 'hume';
  model: string | null;
  scores: Partial<Record<Label, number>>;
  quality: 'usable' | 'limited' | 'unusable';
  acoustics: Partial<Record<'durationSeconds' | 'speechSeconds' | 'rmsDbfs' | 'pitchMedianHz' | 'pitchRangeSemitones' | 'pauseRatio' | 'clippingRatio' | 'wordsPerSecond', number>>;
};
export type DeliveryPlan = { emotion: EmotionName; instruction: string; speedScale: number; reason: string };
type Take = { id: number; text: string; plan: DeliveryPlan; at: number; engine: string; status: 'generated' | 'streaming' | 'streamed' | 'partial'; reading: VoiceReading | null };
type Analyzer = (audio: Uint8Array, mime: string, words?: number) => Promise<VoiceReading | null>;
const HEARD_TTL = 45_000;
const SELF_TTL = 10 * 60_000;
const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:(?:hey|hi|okay|ok) )?haru\b\s*/, '');

export function readVoiceReading(value: unknown): VoiceReading | null {
 return voiceSensePolicy('readVoiceReading',[value]);
}

export function fromHume(scores: Record<string, number>): VoiceReading {
 return voiceSensePolicy('fromHume',[scores]);
}

/** Conservative evidence gate: the class score is not a calibrated probability. */
export function expression(reading: VoiceReading | null): Label | null {
 return voiceSensePolicy('expression',[reading]);
}

function describe(reading: VoiceReading, includeExpression = true): string {
  if (reading.quality === 'unusable') return 'The recording has too little clear speech to judge its tone.';
  const label = includeExpression ? expression(reading) : null;
  const f = reading.acoustics;
  const cues = [label ? `The audio model suggests a ${label} vocal expression (uncertain, not a fact about feelings).` : 'These acoustic measurements do not establish their feelings.'];
  if (f.pitchMedianHz) cues.push(`Measured pitch about ${Math.round(f.pitchMedianHz)} Hz${f.pitchRangeSemitones !== undefined ? `, range ${f.pitchRangeSemitones.toFixed(1)} semitones` : ''}.`);
  if (f.wordsPerSecond && f.wordsPerSecond > 3.4) cues.push('The measured speaking pace was quick.');
  else if (f.wordsPerSecond && f.wordsPerSecond < 1.7) cues.push('The measured speaking pace was unhurried.');
  if (f.pauseRatio !== undefined && f.pauseRatio > 0.4) cues.push('There were substantial pauses in the recording.');
  if (reading.quality === 'limited') cues.push('The recording quality or length limits this reading.');
  return cues.join(' ');
}

/** Measured features need modest precision in a language prompt. Long binary
 * decimal tails can accidentally pass the outbound card-number detector.
 * Keep the detector strict, and retain full precision for local decisions. */
function promptReading(reading: VoiceReading | null): VoiceReading | null {
  if (!reading) return null;
  const rounded = (values: Record<string, number | undefined>) => Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === undefined ? value : Number(value.toFixed(4))]),
  );
  return { ...reading, scores: rounded(reading.scores), acoustics: rounded(reading.acoustics) };
}

type Adjustment = { instruction: string; emotion?: EmotionName; speedScale?: number; reset?: boolean };
export function toneFeedback(text: string): Adjustment | null {
 return voiceSensePolicy('toneFeedback',[text]);
}

export class VoiceSense {
 private readonly coreSense=new CoreVoiceSense(()=>this.now());
  private pending: { text: string; reading: VoiceReading; at: number }[] = [];
  private takes: Take[] = [];
  private nextTake = 0;
  private input: { reading: VoiceReading; at: number } | null = null;
  private adjustment: (Adjustment & { at: number }) | null = null;
  private analyzer: Analyzer | null = null;
  private analyzingOutput = false;
  constructor(private now: () => number = Date.now) {}

  configure(analyzer: Analyzer) {
 return this.coreSense.configure(analyzer); }

  async analyze(audio: Uint8Array, mime: string, words?: number): Promise<VoiceReading | null> {
 return this.coreSense.analyze(audio,mime,words);
  }

  heard(text: string, reading: VoiceReading | null) {
 return this.coreSense.call('heard',[text,reading]);
  }

  hasInput(text: string): boolean {
 return this.coreSense.call('hasInput',[text]);
  }

  beginTurn(text: string): string {
 return this.coreSense.call('beginTurn',[text]);
  }

  /** Factual form for the local model's evidence-only final reply pass. */
  evidence() {
 return this.coreSense.call('evidence');
  }

  plan(emotion: EmotionName = 'neutral'): DeliveryPlan {
 return this.coreSense.call('plan',[emotion]);
  }

  generated(text: string, plan: DeliveryPlan, engine: string, audio: Uint8Array, mime: string): void {
 return this.coreSense.generated(text,plan,engine,audio,mime);
  }

  /** Observe only consumed bytes. Cancellation propagates and marks a partial take. */
  stream(text: string, plan: DeliveryPlan, engine: string, source: ReadableStream<Uint8Array>, mime: string, wrap?: (bytes: Uint8Array) => Uint8Array): ReadableStream<Uint8Array> {
 return this.coreSense.stream(text,plan,engine,source,mime,wrap);
  }

  private startTake(text: string, plan: DeliveryPlan, engine: string, status: Take['status']): Take {
    const take: Take = { id: ++this.nextTake, text, plan: { ...plan }, at: this.now(), engine, status, reading: null };
    this.takes.push(take); this.takes = this.takes.slice(-8);
    return take;
  }
  private observe(take: Take, audio: Uint8Array, mime: string, words?: number) {
    if (this.analyzingOutput || !this.analyzer || !audio.length) return;
    this.analyzingOutput = true;
    void this.analyze(audio, mime, words).then(reading => { take.reading = reading; }).finally(() => { this.analyzingOutput = false; });
  }
}

export const voiceSense = new VoiceSense();

/** Loopback is deliberate: this feature must not silently upload microphone audio. */
export async function analyzeLocalVoice(audio: Uint8Array, mime: string, fetchImpl: typeof fetch, endpoint = 'http://127.0.0.1:9882', words?: number): Promise<VoiceReading | null> {
 return coreAnalyzeLocalVoice(audio,mime,fetchImpl,endpoint,words);
}
