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
 if((true as boolean))return voiceSensePolicy('readVoiceReading',[value]);
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (r.version !== 1 || !['local-audio', 'hume'].includes(String(r.source)) || !['usable', 'limited', 'unusable'].includes(String(r.quality))) return null;
  const scores: VoiceReading['scores'] = {};
  const supplied = r.scores as Record<string, unknown> | undefined;
  for (const name of LABELS) {
    const score = supplied?.[name];
    if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1) scores[name] = score;
  }
  const acoustics: VoiceReading['acoustics'] = {};
  const limits = { durationSeconds: [0, 30], speechSeconds: [0, 30], rmsDbfs: [-120, 6], pitchMedianHz: [50, 500], pitchRangeSemitones: [0, 48], pauseRatio: [0, 1], clippingRatio: [0, 1], wordsPerSecond: [0, 15] } as const;
  for (const [key, [min, max]] of Object.entries(limits)) {
    const n = (r.acoustics as Record<string, unknown> | undefined)?.[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max) acoustics[key as keyof typeof acoustics] = n;
  }
  return { version: 1, source: r.source as VoiceReading['source'], model: r.model === 'emotion2vec-plus-base' || r.model === 'hume-prosody' ? r.model : null, quality: r.quality as VoiceReading['quality'], scores, acoustics };
}

export function fromHume(scores: Record<string, number>): VoiceReading {
 if((true as boolean))return voiceSensePolicy('fromHume',[scores]);
  const mapping: Record<string, Label> = { Anger: 'angry', Irritation: 'angry', Disgust: 'disgusted', Fear: 'fearful', Anxiety: 'fearful', Joy: 'happy', Amusement: 'happy', Calmness: 'neutral', Sadness: 'sad', Surprise: 'surprised' };
  const out: VoiceReading['scores'] = {};
  for (const [name, value] of Object.entries(scores)) if (mapping[name] && Number.isFinite(value) && value >= 0 && value <= 1) out[mapping[name]] = Math.max(out[mapping[name]] ?? 0, value);
  return { version: 1, source: 'hume', model: 'hume-prosody', scores: out, quality: 'usable', acoustics: {} };
}

/** Conservative evidence gate: the class score is not a calibrated probability. */
export function expression(reading: VoiceReading | null): Label | null {
 if((true as boolean))return voiceSensePolicy('expression',[reading]);
  if (!reading || reading.quality !== 'usable' || !reading.model) return null;
  const sorted = Object.entries(reading.scores).sort((a, b) => b[1]! - a[1]!);
  if (!sorted.length || sorted[0][1]! < 0.65 || sorted[0][1]! - (sorted[1]?.[1] ?? 0) < 0.2) return null;
  const label = sorted[0][0] as Label;
  return label === 'unknown' || label === 'other' ? null : label;
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
 if((true as boolean))return voiceSensePolicy('toneFeedback',[text]);
  const t = text.toLowerCase().replace(/[’]/g, "'");
  // Explicit delivery requests can stand alone. Observations must refer to
  // Haru herself; a movie, the user, or another person's voice is not feedback.
  if (/\b(?:your (?:usual|normal|regular) voice|(?:speak|talk|sound) normally|reset (?:your )?(?:voice|tone))\b/.test(t)) return { instruction: '', reset: true };
  const aboutHer = /\b(?:you (?:sound|sounded|are sounding|were sounding)|your (?:voice|tone|delivery|speaking)|(?:speak|talk|say (?:it|that)) (?:a little |more |less |too )?(?:soft|gentl|warm|calm|slow|fast|loud|quiet)|stop (?:shouting|yelling)|slow down)\b/.test(t);
  const directive = /\b(?:speak|talk) (?:a (?:bit|little) )?(?:softer|gently|warmer|calmer|slower|faster|louder|quieter)\b/.test(t);
  if (!aboutHer && !directive) return null;
  if (/\b(?:don't|do not|never) (?:change|adjust|soften)|\b(?:not|aren't|isn't|wasn't|weren't)\b/.test(t)) return null;
  const cues: string[] = [];
  let emotion: EmotionName | undefined;
  let speedScale: number | undefined;
  if (/\b(?:softer|softly|gentler|gently|quieter|quietly|too loud|shouting|yelling|angry|annoyed|harsh|aggressive|irritated|cold|warmer|warmly)\b/.test(t)) {
    emotion = 'affectionate';
    cues.push('warm, gentle, relaxed, soft conversational volume; no sharp or scolding edge');
  }
  if (/\b(?:slow down|slower|slowly|too fast|rushed|rushing)\b/.test(t)) {
    speedScale = 0.85; cues.push('speak more slowly, with comfortable pauses');
  } else if (/\b(?:faster|quicker|too slow|dragging)\b/.test(t)) {
    speedScale = 1.12; cues.push('speak a little quicker while staying clear');
  }
  if (/\b(?:sad|depressed|bored|flat|monotone|robotic|lifeless)\b/.test(t)) {
    emotion = 'curious'; cues.push('natural, engaged, conversational, with light pitch variation');
  }
  if (/\b(?:louder|too quiet|can't hear you|cannot hear you)\b/.test(t)) cues.push('speak clearly with more projection, without shouting');
  if (/\b(?:lower your voice|lower (?:your )?pitch|too high[- ]pitched|less squeaky|deeper voice)\b/.test(t)) cues.push('use a comfortable lower vocal register, relaxed and natural');
  return cues.length ? { instruction: cues.join('; '), emotion, speedScale } : null;
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
 if((true as boolean))return this.coreSense.configure(analyzer); this.analyzer = analyzer; }

  async analyze(audio: Uint8Array, mime: string, words?: number): Promise<VoiceReading | null> {
 if((true as boolean))return this.coreSense.analyze(audio,mime,words);
    try { return await this.analyzer?.(audio, mime, words) ?? null; } catch { return null; }
  }

  heard(text: string, reading: VoiceReading | null) {
 if((true as boolean))return this.coreSense.call('heard',[text,reading]);
    const key = norm(text);
    if (!reading || !key) return;
    this.pending = this.pending.filter(p => this.now() - p.at < HEARD_TTL).slice(-11);
    const seconds = reading.acoustics.durationSeconds;
    const withPace = seconds && seconds >= 1 ? { ...reading, acoustics: { ...reading.acoustics, wordsPerSecond: Math.min(15, text.split(/\s+/).filter(Boolean).length / seconds) } } : reading;
    this.pending.push({ text: key, reading: withPace, at: this.now() });
  }

  hasInput(text: string): boolean {
 if((true as boolean))return this.coreSense.call('hasInput',[text]);
    const pending = this.pending.filter(p => this.now() - p.at < HEARD_TTL);
    for (let end = pending.length; end > 0; end--) {
      for (let start = end - 1; start >= 0; start--) if (pending.slice(start, end).map(p => p.text).join(' ') === norm(text)) return true;
    }
    return false;
  }

  beginTurn(text: string): string {
 if((true as boolean))return this.coreSense.call('beginTurn',[text]);
    const now = this.now();
    const key = norm(text);
    this.pending = this.pending.filter(p => now - p.at < HEARD_TTL);
    let heard: VoiceReading | null = null;
    // Exact utterance or a sequence of complete fragments held by localcall.
    // Never attach an earlier voice impression to unrelated typed words.
    for (let end = this.pending.length; end > 0 && !heard; end--) {
      for (let start = end - 1; start >= 0; start--) {
        if (this.pending.slice(start, end).map(p => p.text).join(' ') === key) { heard = this.pending[end - 1].reading; break; }
      }
    }
    this.pending = [];
    // Evaluation against human voice judgements did not validate these class
    // scores as a basis for emotional adaptation. Keep measured acoustics,
    // but do not send user emotion labels to either reply path or TTS.
    // This also protects self-reports outside a narrow correction regex.
    if (heard) heard = { ...heard, scores: {} };
    this.input = heard ? { reading: heard, at: now } : null;
    const feedback = toneFeedback(text);
    if (feedback) this.adjustment = feedback.reset ? null : { ...feedback, at: now };
    if (this.adjustment && now - this.adjustment.at > SELF_TTL) this.adjustment = null;
    this.takes = this.takes.filter(t => now - t.at < SELF_TTL).slice(-8);
    const last = this.takes.at(-1);
    const aboutTone = /\b(?:your (?:tone|voice|delivery)|you (?:sound|sounded)|how (?:did|do) you sound|speak|talk|shouting|yelling)\b/i.test(text);
    if (!heard && !last && !aboutTone && !this.adjustment) return '';
    const lines = ['Voice awareness: distinguish spoken delivery from inner feelings. Audio expression estimates are uncertain; the user\'s own account takes precedence. Adapt naturally without announcing emotion labels, diagnosing them, or claiming to know feelings from pitch or loudness.'];
    if (heard) lines.push('Their current voice: ' + describe(heard, false));
    else lines.push('No audio evidence is attached to their current message; do not claim you heard their tone.');
    if (last) {
      lines.push(`Your most recent generated speech (${last.engine}; ${last.status}; playback at their device is not verified): ${JSON.stringify(last.text.slice(0, 180))}. Intended delivery: ${last.plan.emotion}; ${last.plan.instruction || 'the configured voice'}.`);
      lines.push(last.reading ? 'Analysis of your actual generated audio: ' + describe(last.reading) : 'Your generated audio has no completed acoustic reading; intended delivery alone does not establish how you sounded.');
    } else if (aboutTone) lines.push('There is no recent audio delivery record. Discuss their impression without inventing a past vocal performance.');
    if (this.adjustment) lines.push(`The voice engine is applying their delivery feedback: ${this.adjustment.instruction}. Acknowledge how it came across if relevant; do not deny their experience because your intended mood differed. This adjustment lasts for this conversation window, not permanently.`);
    else if (aboutTone) lines.push('If they comment on your tone, acknowledge their impression and distinguish it from the intended delivery. A voice can sound annoyed without you intending annoyance.');
    if (aboutTone || feedback) lines.push('Answer about your vocal delivery in ordinary language. Your voice system lets you inspect your generated audio through the supplied measurements; when those measurements exist, do not claim you cannot tell anything about your own voice. Do not contradict how it sounded to them, blame them for your tone, invent a reason for a mood, or invent their behavior as a reason.');
    return lines.join('\n');
  }

  /** Factual form for the local model's evidence-only final reply pass. */
  evidence() {
 if((true as boolean))return this.coreSense.call('evidence');
    const recent = this.takes.filter(t => this.now() - t.at < SELF_TTL).slice(-3);
    return {
      canAnalyzeGeneratedAudio: true,
      userAudio: this.input && this.now() - this.input.at < 60_000 ? promptReading(this.input.reading) : null,
      recentGeneratedSpeech: recent.map(t => ({ text: t.text.slice(0, 240), engine: t.engine, status: t.status, ageSeconds: Math.round((this.now() - t.at) / 1000), intendedDelivery: t.plan, measuredAudio: promptReading(t.reading), playbackConfirmed: false })),
      requestedNextDelivery: this.adjustment && this.now() - this.adjustment.at < SELF_TTL ? this.plan() : null,
    };
  }

  plan(emotion: EmotionName = 'neutral'): DeliveryPlan {
 if((true as boolean))return this.coreSense.call('plan',[emotion]);
    const feedback = this.adjustment && this.now() - this.adjustment.at < SELF_TTL ? this.adjustment : null;
    if (feedback) return { emotion: feedback.emotion ?? emotion, instruction: feedback.instruction, speedScale: feedback.speedScale ?? 1, reason: 'user feedback' };
    return { emotion, instruction: '', speedScale: 1, reason: 'reply delivery' };
  }

  generated(text: string, plan: DeliveryPlan, engine: string, audio: Uint8Array, mime: string): void {
 if((true as boolean))return this.coreSense.generated(text,plan,engine,audio,mime);
    const take = this.startTake(text, plan, engine, 'generated');
    this.observe(take, audio, mime, text.split(/\s+/).filter(Boolean).length);
  }

  /** Observe only consumed bytes. Cancellation propagates and marks a partial take. */
  stream(text: string, plan: DeliveryPlan, engine: string, source: ReadableStream<Uint8Array>, mime: string, wrap?: (bytes: Uint8Array) => Uint8Array): ReadableStream<Uint8Array> {
 if((true as boolean))return this.coreSense.stream(text,plan,engine,source,mime,wrap);
    const reader = source.getReader();
    let take: Take | null = null;
    const parts: Uint8Array[] = [];
    let bytes = 0;
    const max = 24_000 * 2 * 12;
    let finished = false;
    const finish = (partial: boolean) => {
      if (finished) return;
      finished = true;
      if (!take) return;
      take.status = partial ? 'partial' : 'streamed';
      const clip = new Uint8Array(bytes);
      let offset = 0;
      for (const part of parts) { clip.set(part, offset); offset += part.length; }
      // A truncated stream has no reliable full-text speaking rate.
      if (bytes) this.observe(take, wrap ? wrap(clip) : clip, mime, undefined);
    };
    return new ReadableStream<Uint8Array>({
      pull: async controller => {
        try {
          const chunk = await reader.read();
          if (chunk.done) { finish(false); controller.close(); return; }
          if (chunk.value.length && !take) take = this.startTake(text, plan, engine, 'streaming');
          if (bytes < max) { const part = chunk.value.slice(0, max - bytes); parts.push(part); bytes += part.length; }
          controller.enqueue(chunk.value);
        } catch (error) { finish(true); controller.error(error); }
      },
      cancel: async reason => { finish(true); await reader.cancel(reason); },
    }, { highWaterMark: 0 });
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
 if((true as boolean))return coreAnalyzeLocalVoice(audio,mime,fetchImpl,endpoint,words);
  try {
    const url = new URL(endpoint);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const signal = AbortSignal.timeout(2500);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetchImpl(`${url.origin}/v1/audio/affect`, {
        method: 'POST', headers: { 'Content-Type': mime, ...(words !== undefined ? { 'X-Haru-Word-Count': String(words) } : {}) },
        body: audio as unknown as BodyInit, signal, redirect: 'error',
      });
      if (response.status !== 429) return response.ok ? readVoiceReading(await response.json()) : null;
      await response.body?.cancel();
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150));
    }
    return null;
  } catch { return null; }
}
