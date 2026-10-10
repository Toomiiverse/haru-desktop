import {corePolicySync} from './core-policy-sync';
import type {SpeakerSession} from './core-speaker';
import { addressedText, callInputCommand, callMicCheckReply, type CallInputMode } from './call-admission';
// A call handled at home: her own ears, her own brain, her own voice.
//
// The phone's microphone arrives as frames; the detector in vad.ts decides
// where what they said begins and ends; the utterance goes to her ears
// (whisper, with the corrections she has been taught); the words go to the
// same brain a typed message reaches; and each sentence of the reply is voiced
// the moment it is complete, streamed down to the phone while the next one is
// still being written. She starts talking at her first sentence, not her last
// — which is the difference from the Hume engine, where nothing is said until
// the whole reply is in. While a tool runs she says one of the fillers in
// call.ts, because a search is seconds of silence otherwise.
//
// Talking over her: speech that starts while her voice is going out is an
// interruption — her queue is dropped, the phone is told to hush, and the
// next turn is told she was cut off, exactly as the phone's own talk mode
// does. Nothing here touches the transcript: the brain's own path writes the
// exchange into the day, the way it does for every message.
//
// Time inside the detector is sample time, counted from the frames, so a test
// can feed a call without a clock; the phone's clock only decides how long a
// call ran.

import { makeVad, pcm16Level, type VadOptions } from './vad';
import { pcmToWav } from './voice';
import { looksUnfinished } from './call';
import { completeNaturalUtterance } from './natural-conversation';
import {randomUUID} from 'node:crypto';
import type {CallEngagement, ReactionCommand, ReactionClip} from './call-engagement';

/** The phone's rate; what its ear already makes. */
export const CALL_RATE = 16_000;
/** Her voice's rate off the local engine, when the engine does not say. */
export const VOICE_RATE = 24_000;
/** How much of the microphone is kept, so an utterance can be cut out whole. */
const RING_SECONDS = 20;
/** After her voice stops, how long the detector stays wary of an echo of it. */
const HER_ECHO_MS = 500;
/** While she is audible, how much louder than the room they must be to count. */
const OVER_HER_RATIO = 7;
/** Over her voice, this much of an utterance is heard before she is cut off. */
const PROBE_MS = 1200;
/** Her lines kept for the echo check: what the phone may still be playing. */
const HER_LINES_KEPT = 3;
/** Words too common to tell his speech from hers coming back. */
const SMALL_WORDS = new Set(['the', 'and', 'you', 'your', 'that', 'this', 'for', 'with', 'are', 'was', 'but', 'not', 'have', 'its', "it's", "i'm", 'just', 'like', 'what', 'yeah', 'okay']);
/** How long a sentence that reads as unfinished waits for its other half. */
export const UNFINISHED_HOLD_MS = 700;
/**
 * After the first sentence, which goes out at once for the sake of the wait,
 * the rest of a reply is voiced in stretches of about this many characters,
 * or a paragraph, or the rest of the reply — whichever comes first. A take
 * per sentence sounded assembled; the reply is usually finished before the
 * first sentence has been said anyway.
 */
export const STRETCH_CHARS = 240;

export type CallEvent = Record<string, unknown>;

export type PreparedHearing = (() => string) & {text?:string};

export type LocalCallDeps = {
  inputMode?: CallInputMode;
  speaker?: SpeakerSession;
  engagement?: CallEngagement;
  /** Words for one utterance, as WAV bytes — the phone's ear: transcription, the taught corrections, the hallucination filter. '' when nothing worth sending. */
  hear(wav: Uint8Array, signal?:AbortSignal): Promise<string>;
  /** Tentative recognition cannot update hearing, memory, mood, tools or history.
   * Its returned commit runs only for the exact final audio range. */
  prepareHear?(wav: Uint8Array, signal?:AbortSignal): Promise<PreparedHearing>;
  prepareAfterMs?: number;
  unfinishedQuietMs?: number;
  /**
   * Her reply. Sentences arrive as they complete, with the mood read from the
   * line so far; a tool round announces itself as it starts. Resolves with the
   * reply that settled, which the brain has already written into the day.
   */
  answer(text: string, options: { phoneTimeZone?:string; interrupted: boolean; signal?:AbortSignal; callTrace?:{id:string;turn:number}; onSentence(sentence: string, emotion: string): void; onToolCall(name: string): void }): Promise<{ reply: string; ignored?: boolean }>;
  /**
   * Her voice for a line: a stream of mono PCM16 with no header, and its
   * rate. Null when she has no voice to give. Every line of one reply comes
   * with the same seed, reused after an interruption so the voice stays
   * continuous while the words and their requested delivery can change.
   */
  speak(text: string, emotion: string | null, seed: number, signal?: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array>; sampleRate: number } | null>;
  /** Her resting mood, only when no sentence delivery has been supplied. */
  moodNow?(): string | null;
  /** A line to say while a tool runs. */
  filler(): string;
  /**
   * Told, once a turn is over, when what she got out differs from the reply
   * her brain wrote — she was talked over, or they spoke before she could.
   * `said` is the part that reached the phone; '' when none of it did. The
   * day should hold what was said, not what was drafted.
   */
  said?(reply: string, said: string): void;
  vad?: Partial<VadOptions>;
  /** Wall clock, for the call's length. */
  now?(): number;
  log?(line: string): void;
};

export type LocalCallHandlers = {
  onEvent(event: CallEvent): void;
  /** A stretch of her voice: 24 kHz mono PCM16, after an audio_start and before its audio_end. */
  onAudio(pcm: Uint8Array): void;
  onClose(reason: string, seconds: number): void;
};

export type LocalCall = {
  /** A frame of the phone's microphone: 16 kHz mono PCM16. */
  feed(frame: Uint8Array): void;
  start(facts?:{reactionActivityTracked?:boolean;phoneTimeZone?:string}):void;
  interrupt(requestId?:string):void;
  /** The phone says whether she is audible through its speaker right now. */
  herSpeaking(on: boolean): void;
  close(reason?: string): void;
  manualInput(enabled:boolean):void;
  inputHeld(active:boolean):void;
};

type Line = { text: string; emotion: string | null; seed: number; filler: boolean };

/**
 * What one reply's lines came to once played: the ones that went out whole, and
 * the first that was cut with how long it had played. Each line carries its
 * turn's take, so a reply whose brain finishes after the next turn has begun
 * still finds what it got out.
 */
type HeardTiming = { speechEndAt: number; speechEndSample: number; detectedAt: number; heardAt: number; listenMs: number; segments: number; preparedRecognition?:boolean; manual?:boolean; inputEpoch?:number };
type TurnTiming = HeardTiming & { turn: number; answerAt: number; queuedAt: number | null; speakAt: number | null; pcmAt: number | null };
type Take = { voiced: string[]; cut: { text: string; seconds: number } | null; reported: boolean; timing: TurnTiming };
type Queued = Line & { take: Take; reaction?:{command:ReactionCommand;clip:ReactionClip} };

/** About how much text a second of her voice carries, for cutting a line where the voice was cut. */
const CHARS_PER_SECOND = 15;

/** The first `seconds` worth of a line, ended at a word, marked as cut. Nothing under half a second. */
export function saidOf(text: string, seconds: number): string {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.saidOf',[text,seconds]);
  if (seconds < 0.5) return '';
  const chars = Math.round(seconds * CHARS_PER_SECOND);
  if (chars >= text.length) return text;
  const head = text.slice(0, chars);
  const atWord = head.lastIndexOf(' ');
  const kept = (atWord > 0 ? head.slice(0, atWord) : head).replace(/[,;:]$/, '');
  return kept ? `${kept}—` : '';
}

/** The sample rate a WAV header declares, or 0 when the bytes are not a WAV. */
export function wavSampleRate(bytes: Uint8Array): number {
  if (bytes.byteLength < 44 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'RIFF') return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(24, true);
}

/** A WAV stream with its 44-byte header taken off: the PCM the phone plays. */
export function withoutWavHeader(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let skipped = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (skipped >= 44) { controller.enqueue(chunk); return; }
      const take = Math.min(44 - skipped, chunk.byteLength);
      skipped += take;
      if (chunk.byteLength > take) controller.enqueue(chunk.subarray(take));
    },
  }));
}

/** One buffer as a stream, for a voice that only renders whole. */
export function oneChunk(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { if (bytes.byteLength) controller.enqueue(bytes); controller.close(); } });
}

export function openLocalCall(handlers: LocalCallHandlers, deps: LocalCallDeps): LocalCall {
  const callId=randomUUID();
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const startedAt = now();
  const vad = makeVad(deps.vad);
  const ring: { at: number; frame: Uint8Array }[] = [];
  let ringSamples = 0;
  let samples = 0;                // sample time, in samples since the call began
  let closed = false;
  const listening = new AbortController();
  let phoneHearsHer = false;
  let sending = false;            // her voice is going down the socket
  let herEchoUntil = 0;           // wall clock; after her voice, the detector stays wary
  let interrupted = false;        // she was cut off; the next turn is told
  let manual=false,held=false,inputEpoch=0,manualFrom=0,manualEnd:number|null=null;
  let inputMode:CallInputMode = deps.inputMode ?? 'open';
  let activeAnswer:AbortController | null = null;
  let thinking = false;           // the brain is on a turn
  let generation = 0;             // bumps on every interruption: stale audio is dropped
  let queue: Queued[] = [];
  let pumping = false;
  let activeSpeech: AbortController | null = null;
  let spokeThisTurn = false;
  let fillerThisTurn = false;
  let turnDone: (() => void) | null = null;
  let lineId = 0;
  let turns = 0;
  // What reached the phone this turn: whole lines, and the cut one by how much of it played.
  let lastEmotion: string | null = null;  // the mood of her last line, for the phone's face
  // Only real reply audio can establish continuity; a queued sentence or a
  // tool filler may never have been heard. This state lasts for this call only.
  let lastDelivery: { emotion: string | null; seed: number } | null = null;
  // Words heard but not yet answered: a breath in the middle of a sentence
  // reads to the detector as its end. What was said before the breath waits
  // here for what comes after it, and the two go to her brain as one.
  let pending = '';
  let pendingTiming: HeardTiming | null = null;
  let holdUntil = 0;              // sample time; a held fragment is answered alone once this passes in quiet
  let transcribing = 0;           // utterances at her ears right now; a held fragment waits for them
  let preparation: {from:number;to:number;result:Promise<PreparedHearing|null>;settled:boolean} | null = null;
  let ears:Promise<unknown> = Promise.resolve();
  function atEars<T>(read:() => Promise<T>):Promise<T> {
    const job=ears.then(()=>{if(closed)throw Error('call_closed');return read();});
    ears=job.catch(()=>{});return job;
  }
  // Words over her voice are not an interruption until they are known not to
  // be hers. On 2026-09-18 she said "Your psychologist appointment…", the
  // phone's speaker fed "Psychologist." back into its microphone past the
  // echo cancelling, the detector took it for him, and the rest of the reply
  // was dropped. So a start over her is a suspicion: a probe after PROBE_MS
  // and the whole utterance at its end go to her ears first, and only words
  // that are not in her recent lines cut her off.
  let overHer: 'no' | 'suspect' | 'his' = 'no';
  let overHerAt = 0;              // sample time the suspect utterance began
  let probing = false;
  const herLines: string[] = [];  // the last few lines sent to the phone

  const emit = (event: CallEvent) => { if (!closed) handlers.onEvent({...event,callId}); };
  let engagementState:unknown=null, engagementStarted=false, engagementFailed=false;
  let reactionActivityTracked=false;
  let phoneTimeZone:string|undefined;
  let reactionTimer:ReturnType<typeof setTimeout>|null=null;
  let activeReaction=false, reactionAudible=false, reactionEchoUntil=0, playbackUntil=0;
  const hers = () => (!reactionAudible && phoneHearsHer) || (!activeReaction && sending) || now() < herEchoUntil;
  function react(event:string) {
    if(!deps.engagement || engagementFailed || closed || !engagementStarted && event!=='ready')return;
    if(reactionTimer){clearTimeout(reactionTimer);reactionTimer=null;}
    try {
      const plan=deps.engagement.plan(engagementState,event,{nowMs:now(),closed,
        available:deps.engagement.available(),inputMode,manualHeld:manual&&held,reactionActivityTracked,
        phoneSpeaking:phoneHearsHer&&!reactionAudible,
        replyBusy:queue.some(line=>!line.filler)||!!activeSpeech&&!activeReaction,
        playbackUntilMs:playbackUntil});
      engagementState=plan.state;
      if(plan.inputMode)inputMode=plan.inputMode;
      if(plan.command) {
        const clip=deps.engagement.clip(plan.command);
        if(clip && now()<=plan.command.expiresAtMs && deps.engagement.available()) {
          const at=now();
          queue.push({text:plan.command.text,emotion:plan.command.emotion,seed:0,filler:true,
            reaction:{command:plan.command,clip},take:{voiced:[],cut:null,reported:false,
              timing:{speechEndAt:at,speechEndSample:samples,detectedAt:at,heardAt:at,listenMs:0,segments:0,turn:0,answerAt:at,queuedAt:at,speakAt:null,pcmAt:null}}});
          void pump();
        }
      }
      if(plan.afterMs!==null) {
        if(!Number.isFinite(plan.afterMs)||plan.afterMs<=0)throw Error('reaction_timer');
        reactionTimer=setTimeout(()=>{reactionTimer=null;react('tick');},plan.afterMs);
        reactionTimer.unref?.();
      }
    } catch {
      engagementFailed=true;log('[call-engagement] decision unavailable; reactions stopped for this call');
    }
  }
  function stopReaction() {
    queue=queue.filter(line=>!line.reaction);
    if(activeReaction || reactionAudible && phoneHearsHer) {
      activeSpeech?.abort();sending=false;phoneHearsHer=false;
      playbackUntil=now();reactionAudible=false;reactionEchoUntil=now()+HER_ECHO_MS;
      emit({type:'user_interruption',reactionOnly:true});
    }
  }
  function interrupt(requestId?:string) {
    if(closed)return;
    interrupted=true;
    dropHerVoice();finishTurn();
    phoneHearsHer=false;reactionAudible=false;playbackUntil=now();
    reactionEchoUntil=now()+HER_ECHO_MS;
    react('interrupt');
    emit({type:'user_interruption',...(requestId?{requestId}:{})});
  }
  function start(facts?:{reactionActivityTracked?:boolean;phoneTimeZone?:string}) {
    if(facts){reactionActivityTracked=facts.reactionActivityTracked===true;phoneTimeZone=facts.phoneTimeZone;}
    if(closed || engagementStarted)return;
    engagementStarted=true;react('ready');
  }

  // -- the microphone ----------------------------------------------------------------

  function feed(frame: Uint8Array) {
    if (closed || !frame.byteLength) return;
    start();
    const at = samples;
    samples += frame.byteLength >> 1;
    if(manual && !held)return;
    ring.push({ at, frame });
    ringSamples += frame.byteLength >> 1;
    while (ringSamples > CALL_RATE * RING_SECONDS && ring.length) ringSamples -= ring.shift()!.frame.byteLength >> 1;
    const t = (samples * 1000) / CALL_RATE;
    if(manual) {
      if(pcm16Level(frame)>0.001)manualEnd=samples;
      if(samples-manualFrom>=CALL_RATE*15)releaseInput();
      return;
    }
    const event = vad.feed(pcm16Level(frame), t, hers() ? OVER_HER_RATIO : undefined);
    const preview = !event && !hers() && !transcribing && !deps.speaker?.enabled && deps.prepareHear && deps.prepareAfterMs
      ? vad.preview(t, deps.prepareAfterMs) : null;
    if (preview && (!preparation || preparation.settled && (preparation.from !== preview.from || preparation.to !== preview.to))) {
      const item = {from:preview.from,to:preview.to,settled:false,result:Promise.resolve(null) as Promise<PreparedHearing|null>};
      const wav=cut(preview.from,preview.to);
      item.result = atEars(()=>deps.prepareHear!(wav,listening.signal)).catch(() => null).finally(() => {item.settled=true;});
      preparation = item;
    }
    if (pending && holdUntil && !transcribing && !vad.possibleSpeech() && t >= holdUntil && !event) {
      // Nothing more came: the half they said is the whole of it.
      const text = pending;
      const timing = pendingTiming;
      pending = '';
      pendingTiming = null;
      holdUntil = 0;
      if (timing) commit(text, timing);
    }
    if (overHer === 'suspect' && !probing && !event && vad.speaking() && t - overHerAt >= PROBE_MS) {
      probing = true;
      void probe(cut(Math.max(0, overHerAt - 300), t));
    }
    if (!event) return;
    if (event.type === 'start') {
      if (hers()) { overHer = 'suspect'; overHerAt = t; probing = false;if(!deps.speaker?.enabled)react('speechStart'); }       else {
        const echo=phoneHearsHer&&reactionAudible || now()<reactionEchoUntil;
        overHer = echo?'suspect':'no';
        if(inputMode==='open'&&!echo&&!deps.speaker?.enabled)spokeOver();
        if(!deps.speaker?.enabled)react('speechStart');
      }
      return;
    }
    if (event.type === 'drop') { overHer = 'no';react('hearingRejected'); return; }
    if(!deps.speaker?.enabled)react('speechEnd');
    const suspect = overHer === 'suspect';
    overHer = 'no';
    const detectedAt = now();
    // Estimated from received sample time: microphone/network buffering is
    // outside this interval. The WAV tail is not the end of voiced speech.
    const speechEndAt = detectedAt - Math.max(0, t - event.speechEnd);
    const prepared = preparation;
    preparation = null;
    void heard(cut(event.from, event.to), suspect, { speechEndAt, speechEndSample:Math.round(event.speechEnd*CALL_RATE/1000), detectedAt, heardAt: detectedAt, listenMs: 0, segments: 1,inputEpoch },
      prepared ? {result:prepared.result,exact:prepared.from===event.from&&prepared.to===event.to} : undefined);
  }

  /** Words heard over her: hers, coming back through the phone, or his? */
  function echoOfHers(text: string): boolean {
  if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on')return corePolicySync<any>('speech-boundary.echoOfHers',[text,herLines]);
    const words = (line: string) => line.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
    const heardWords = words(text);
    if (!heardWords.length) return true;
    const hers = new Set(herLines.flatMap(words));
    const content = heardWords.filter(w => w.length >= 3 && !SMALL_WORDS.has(w));
    const judged = content.length ? content : heardWords;
    const found = judged.filter(w => hers.has(w)).length;
    return found / judged.length >= 0.6;
  }

  /** The first stretch of an utterance over her, heard early so his words stop her soon. */
  async function probe(wav: Uint8Array) {
    let text = '';
    try {
      if(deps.speaker){const verdict=await atEars(()=>deps.speaker!.check(wav,false,true,listening.signal));if(closed||!verdict.allow)return;}
      if (deps.prepareHear) {
        const candidate=await atEars(()=>deps.prepareHear!(wav,listening.signal));
        text=typeof candidate.text==='string' ? candidate.text : inputMode==='open' ? await atEars(()=>deps.hear(wav,listening.signal)) : '';
      } else if(inputMode==='open')text=await atEars(()=>deps.hear(wav,listening.signal));
    } catch { return; }
    if(inputMode==='addressed' && !addressedText(text))return;
    if (closed || manual || overHer !== 'suspect') return;
    if (echoOfHers(text)) { log(`[call] heard herself over her line: "${text.slice(0, 40)}"`); return; }
    overHer = 'his';
    log(`[call] words over her: "${text.slice(0, 40)}"`);
    spokeOver();
  }

  /** The frames between two sample-times, as one WAV for her ears. */
  function cut(fromMs: number, toMs: number): Uint8Array {
    const from = Math.floor((fromMs * CALL_RATE) / 1000);
    const to = Math.ceil((toMs * CALL_RATE) / 1000);
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const { at, frame } of ring) {
      const end = at + (frame.byteLength >> 1);
      if (end <= from || at >= to) continue;
      const head = Math.max(0, from - at) * 2;
      const tail = Math.min(frame.byteLength, (to - at) * 2);
      const piece = frame.subarray(head, tail);
      parts.push(piece);
      total += piece.byteLength;
    }
    const pcm = new Uint8Array(total);
    let offset = 0;
    for (const piece of parts) { pcm.set(piece, offset); offset += piece.byteLength; }
    return pcmToWav(pcm, CALL_RATE);
  }

  /** They started talking. Over her, that is an interruption; over her thinking, the reply will not be voiced. */
  function spokeOver() {
    if (phoneHearsHer || sending || activeSpeech || queue.length || (thinking && spokeThisTurn)) {
      interrupted = true;
      dropHerVoice();
      emit({ type: 'user_interruption' });
      finishTurn();
      log('[call] talked over her');
    } else if (thinking) {
      // Nothing of hers has gone out yet: the reply on its way is not spoken,
      // and what they are saying now is the turn that counts.
      generation++;
      activeAnswer?.abort();
      queue = [];
      log('[call] they spoke before she could');
    }
  }

  function dropHerVoice() {
    generation++;
    activeAnswer?.abort();
    queue = [];
    activeSpeech?.abort();
    sending = false;
    herEchoUntil = now() + HER_ECHO_MS;
  }

  function speakerNotice(text?:string|null) {
    if(!text||closed)return;
    const at=now();
    emit({type:'speaker_notice',text});
    queue.push({text,emotion:'neutral',seed:0,filler:true,take:{voiced:[],cut:null,reported:true,
      timing:{speechEndAt:at,speechEndSample:samples,detectedAt:at,heardAt:at,listenMs:0,segments:0,turn:0,answerAt:at,queuedAt:at,speakAt:null,pcmAt:null}}});
    void pump();
  }
  function pollSpeakerNotice(){
    if(!deps.speaker||closed)return;
    void atEars(()=>deps.speaker!.notice(phoneHearsHer||sending||thinking||queue.length>0)).then(value=>{if(!closed)speakerNotice(value.notice);}).catch(()=>{});
  }

  // -- a turn --------------------------------------------------------------------------

  async function heard(wav: Uint8Array, suspect: boolean, timing: HeardTiming, prepared?: {result:Promise<PreparedHearing|null>;exact:boolean}) {
    let text = '';
    const listenAt = now();
    const stale=()=>closed || timing.inputEpoch!==undefined && timing.inputEpoch!==inputEpoch;
    transcribing++;
    try {
      if(deps.speaker){
        const verdict=await atEars(()=>deps.speaker!.check(wav,true,phoneHearsHer||sending||thinking||queue.length>0,listening.signal));
        if(stale())return;
        emit({type:'speaker_identity',speaker:verdict.speaker,reason:verdict.reason});
        if(!verdict.allow){speakerNotice(verdict.notice);react('hearingRejected');return;}
        if(deps.speaker.enabled){react('speechStart');react('speechEnd');}
      }
      const commit = prepared ? await prepared.result : null;
      if(stale())return;
      timing.preparedRecognition=!!commit && !!prepared?.exact;
      let candidate=commit && prepared?.exact ? commit : null;
      if(!candidate && (deps.speaker||inputMode==='addressed'||timing.manual) && deps.prepareHear)candidate=await atEars(()=>deps.prepareHear!(wav,listening.signal));
      if(stale())return;
      if(!timing.manual && inputMode==='addressed' && (typeof candidate?.text!=='string' || !addressedText(candidate.text))) {
        log('[call-admission] '+JSON.stringify({callId,reason:'not_addressed',mode:inputMode}));
        react('hearingRejected');return;
      }
      if(deps.speaker){await atEars(()=>deps.speaker!.confirm(listening.signal));if(stale())return;}
      text=candidate ? candidate() : await atEars(()=>deps.hear(wav,listening.signal));
    } catch (error) { log(`[call] her ears failed: ${error instanceof Error ? error.message : String(error)}`);if(deps.speaker)emit({type:'error',message:'Voice recognition could not verify this turn. Please reconnect.'});react('hearingRejected'); return; } finally { transcribing--; }
    if (stale()) return;
    const command=timing.manual ? null : callInputCommand(text);
    if(!timing.manual && inputMode==='addressed') { const admitted=addressedText(text);if(!admitted){react('hearingRejected');return;}text=admitted; }
    if (suspect) {
      if (echoOfHers(text)) { log(`[call] heard herself: "${text.slice(0, 40)}" — not an interruption`);react('hearingRejected'); return; }
      log(`[call] words over her: "${text.slice(0, 40)}"`);
      spokeOver();
    }
    if (!text) { log('[call] heard nothing worth answering');react('hearingRejected'); return; }
    timing.heardAt = now();
    timing.listenMs = timing.heardAt - listenAt;
    if(timing.manual){commit(text,timing);return;}
    if(command) {
      inputMode=command;pending='';pendingTiming=null;holdUntil=0;react('mode');
      log('[call-admission] '+JSON.stringify({callId,reason:'mode_changed',mode:inputMode}));
      commit(text,timing,process.env.HARU_CORE_SPEECH_BOUNDARY==='on'?corePolicySync<string>('speech-boundary.commandReply',[command]):command==='addressed' ? 'Noisy room mode is on. Start each request with Haru.' : 'Hands free mode is on for this call.');
      return;
    }
    if(inputMode==='addressed'||deps.speaker?.enabled)spokeOver();
    timing.segments += pendingTiming?.segments ?? 0;
    text = pending ? `${pending} ${text}` : text;
    pending = '';
    pendingTiming = null;
    holdUntil = 0;
    // They went on talking while this was being written down: what they are
    // saying now belongs with it, and she answers the whole once it has ended.
    if (vad.possibleSpeech()) { pending = text; pendingTiming = timing; holdUntil=(samples*1000)/CALL_RATE+UNFINISHED_HOLD_MS; log(`[call] holding "${text.slice(0, 40)}" — they are still talking`); return; }
    // A sentence they stopped in the middle of waits a moment for its end.
    if (process.env.HARU_CORE_SPEECH_BOUNDARY==='on'?corePolicySync<boolean>('speech-boundary.unfinished',[text]):looksUnfinished(text) && !completeNaturalUtterance(text) && !callMicCheckReply(text)) {
      pending = text;
      pendingTiming = timing;
      const hold = process.env.HARU_CORE_SPEECH_BOUNDARY==='on'?corePolicySync<number>('speech-boundary.unfinishedHold',[deps.unfinishedQuietMs??null,now()-timing.speechEndAt]):deps.unfinishedQuietMs ? Math.max(0, deps.unfinishedQuietMs - (now() - timing.speechEndAt)) : UNFINISHED_HOLD_MS;
      if (!hold) {pending='';pendingTiming=null;commit(text,timing);return;}
      holdUntil = (samples * 1000) / CALL_RATE + hold;
      log(`[call] holding "${text.slice(0, 40)}" — it sounds unfinished`);
      return;
    }
    commit(text, timing);
  }

  function commit(text: string, timing: HeardTiming, localReply?:string) {
    if (!localReply) {
      localReply = callMicCheckReply(text) ?? undefined;
      if (localReply) log('[call-response] '+JSON.stringify({callId,turn:turns+1,route:'local_mic_check',model:null,at:Date.now()}));
    }
    stopReaction();react('thinking');
    activeAnswer?.abort();
    emit({ type: 'user_message', text, interim: false, turn:turns+1,speechEndSample:timing.speechEndSample });
    if (thinking) {
      // Two things said before she could answer the first: the second is the
      // one she answers. The first turn finishes on its own, unvoiced.
      generation++;
      queue = [];
      activeSpeech?.abort();
    }
    void turn(text, timing, localReply);
  }

  async function turn(text: string, heardTiming: HeardTiming, localReply?:string) {
    const answering=new AbortController();
    activeAnswer=answering;
    const mine = ++turns;
    const wasInterrupted = interrupted;
    interrupted = false;
    thinking = true;
    spokeThisTurn = false;
    fillerThisTurn = false;
    const take: Take = { voiced: [], cut: null, reported: false,
      timing: { ...heardTiming, turn: mine, answerAt: now(), queuedAt: null, speakAt: null, pcmAt: null } };
    const myGeneration = generation;
    const started = now();
    let firstQueuedAt: number | null = null;
    let reply = '';
    // The day holds what she said. A reply she was cut off in is written
    // down as what came out — not as what was drafted. A reply she never got
    // a word of stays as written: taken out, his question sat in the
    // transcript with nothing under it (the shirt question, 2026-09-06), and
    // the draft is what she would have said, there for him to read.
    const settleTake = (whole: boolean) => {
      if (take.reported || !reply || !deps.said) return;
      take.reported = true;
      if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on'){const p=corePolicySync<any>('speech-boundary.settleTake',[reply,take.voiced,take.cut,whole]);if(p.report)deps.said(reply,p.said);return;}
      const said = [...take.voiced, take.cut ? saidOf(take.cut.text, take.cut.seconds) : ''].filter(Boolean).join(' ').trim();
      // A play-time estimate can run past the text ("89 of 22 chars"): that is all of it.
      if (whole || said === reply || said.length >= reply.length) return;
      if (!said) { log(`[call] she got none of ${reply.length} chars out — the day keeps the reply as written`); return; }
      log(`[call] she got ${said.length} of ${reply.length} chars out — the day keeps what she said`);
      deps.said(reply, said);
    };
    // One take preserves the voice identity. A labelled change of delivery
    // must still reach the speech engine, including a return to neutral.
    const continued = process.env.HARU_CORE_SPEECH_BOUNDARY==='on'?corePolicySync<typeof lastDelivery>('speech-boundary.continued',[wasInterrupted,lastDelivery]):wasInterrupted ? lastDelivery : null;
    let mood = continued ? continued.emotion : deps.moodNow?.() ?? null;
    const seed = continued ? continued.seed : Math.floor(Math.random() * 2 ** 31);
    lastEmotion = mood;
    let sentences = 0;
    let stretch = '';
    const flush = () => {
      const text = stretch.trim();
      stretch = '';
      if (text) say({ text, emotion: mood, seed, filler: false });
    };
    try {
      const answer = localReply ? {reply:localReply,ignored:false} : await deps.answer(text, {
        signal:answering.signal,
        callTrace:{id:callId,turn:mine},
        interrupted: wasInterrupted,
        ...(phoneTimeZone?{phoneTimeZone}:{}),
        onSentence: (sentence, emotion) => {
          if (generation !== myGeneration || turns !== mine) return;
          stopReaction();react('replyStart');
          if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on'){const p=corePolicySync<any>('speech-boundary.sentencePlan',[{mood,stretch,sentences},sentence,emotion]);mood=p.mood;stretch=p.stretch;sentences=p.sentences;if(p.moodChanged)lastEmotion=mood;for(const command of p.commands)say({...command,seed,filler:false});return;}
          sentences++;
          if (emotion && emotion !== mood) {
            flush();
            mood = emotion;
            lastEmotion = mood;
          }
          if (sentences === 1) {
            say({ text: sentence.trim(), emotion: mood, seed, filler: false });
            return;
          }
          // A paragraph is a breath: what came before it is said before it.
          if (/^\s*\n\s*\n/.test(sentence)) flush();
          stretch += (stretch && !/\s$/.test(stretch) && !/^\s/.test(sentence) ? ' ' : '') + sentence;
          if (/\n\s*\n\s*$/.test(stretch) || stretch.length >= STRETCH_CHARS) flush();
        },
        onToolCall: name => {
          if (generation !== myGeneration || turns !== mine) return;
          if(deps.engagement){react('tool');return;}
          if(process.env.HARU_CORE_SPEECH_BOUNDARY==='on'?!corePolicySync<boolean>('speech-boundary.fillerAllowed',[fillerThisTurn,spokeThisTurn]):fillerThisTurn||spokeThisTurn)return;
          fillerThisTurn = true;
          log(`[call] a tool is running (${name}) — she says something meanwhile`);
          say({ text: deps.filler(), emotion: mood, seed, filler: true });
        },
      });
      reply = answer.reply ?? '';
      if(answering.signal.aborted || closed || generation!==myGeneration){settleTake(false);return;}
      // The next turn began while her brain was still going: whatever of this
      // one was voiced is already cut, so it is settled here, not after a drain.
      if (turns !== mine) { settleTake(false); return; }
      if (generation === myGeneration) flush();
      // A reply that streamed no sentence — a round held back from her voice
      // and answered again, a line that came whole — is still said.
      if (generation === myGeneration && sentences === 0 && reply && !answer.ignored) {
        log('[call] nothing of the reply was streamed — saying it whole');
        say({ text: reply, emotion: mood, seed, filler: false });
      }
      if (answer.ignored) log('[call] she is not answering that');
    } catch (error) {
      if(!answering.signal.aborted && !closed && turns===mine) {
        log(`[call] her brain failed: ${error instanceof Error ? error.message : String(error)}`);
        emit({ type: 'error', message: 'She lost her train of thought.' });
      } else log('[call-cancelled] '+JSON.stringify({callId,turn:mine}));
    } finally {
      if(activeAnswer===answering)activeAnswer=null;
      if (turns === mine) {
        thinking = false;
        // The turn is over once every queued line has been voiced.
        await new Promise<void>(resolve => { if (!queue.length && !pumping) resolve(); else turnDone = resolve; });
        if (turns === mine && !closed && generation === myGeneration) {
          // The face goes with the end of the turn, read off her last line, so
          // the phone need not ask a model — that one shares the card with her voice.
          emit({ type: 'assistant_end', ...(lastEmotion ? { emotion: lastEmotion } : {}) });
          react('replyEnd');
          log(`[call] turn ${mine}: ${firstQueuedAt !== null ? `reply queued at ${firstQueuedAt - started}ms, ` : 'nothing queued, '}${take.timing.pcmAt !== null ? `first PCM at ${take.timing.pcmAt - started}ms, ` : 'no reply audio, '}said as ${mood ?? 'her plain self'}, done in ${now() - started}ms`);
          logTiming(take.timing, 'done');
        }
        settleTake(generation === myGeneration && !take.cut && take.voiced.length > 0 && !queue.length);
      }
    }
    function say(line: Line) {
      if(!line.filler){stopReaction();react('replyStart');}
      if (!line.filler && firstQueuedAt === null) {
        firstQueuedAt = now();
        take.timing.queuedAt = firstQueuedAt;
      }
      queue.push({ ...line, take });
      void pump();
    }
  }

  function logTiming(timing: TurnTiming, stage: 'first-audio' | 'done') {
    const { speechEndAt, detectedAt, heardAt, listenMs, answerAt, queuedAt, speakAt, pcmAt } = timing;
    log(`[call-latency] ${JSON.stringify({ callId, turn: timing.turn, stage, segments: timing.segments,
      endpointMs: detectedAt - speechEndAt, listenMs, holdMs: answerAt - heardAt,
      recognitionWaitMs:listenMs,preparedRecognition:timing.preparedRecognition??false,
      answerMs: queuedAt === null ? null : queuedAt - answerAt,
      voiceQueueMs: speakAt === null || queuedAt === null ? null : speakAt - queuedAt,
      ttsFirstPcmMs: pcmAt === null || speakAt === null ? null : pcmAt - speakAt,
      transcriptToFirstPcmMs: pcmAt === null ? null : pcmAt - answerAt,
      receivedSpeechEndToFirstPcmMs: pcmAt === null ? null : pcmAt - speechEndAt,
      playbackMeasured: false, inputMode:timing.manual?'push-to-talk':'voice-activity',
    })}`);
  }

  function finishTurn() {
    const done = turnDone;
    turnDone = null;
    done?.();
  }

  // -- her voice --------------------------------------------------------------------

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length && !closed) {
        const line = queue.shift()!;
        if(line.reaction && (!deps.engagement?.available() || now()>line.reaction.command.expiresAtMs))continue;
        activeReaction=!!line.reaction;
        const myGeneration = generation;
        const id=String(++lineId);
        emit(line.filler ? { type: 'filler', text: line.text, ...(line.reaction?{reaction:line.reaction.command.clip}:{} ) } : { type: 'assistant_message', text: line.text, id });
        if (!line.filler) spokeThisTurn = true;
        let voice: { stream: ReadableStream<Uint8Array>; sampleRate: number } | null = null;
        const speech = new AbortController();
        activeSpeech = speech;
        if (!line.filler && line.take.timing.speakAt === null) line.take.timing.speakAt = now();
        try { voice = line.reaction ? {stream:oneChunk(line.reaction.clip.pcm),sampleRate:line.reaction.clip.sampleRate} : await deps.speak(line.text, line.emotion, line.seed, speech.signal); } catch (error) {
          if (!speech.signal.aborted) log(`[call] her voice failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!voice || generation !== myGeneration || closed) { if (voice) void voice.stream.cancel().catch(() => {}); continue; }
        reactionAudible=!!line.reaction;
        const rate = voice.sampleRate || VOICE_RATE;
        herLines.push(line.text);
        if (herLines.length > HER_LINES_KEPT) herLines.shift();
        emit({ type: 'audio_start', id, sampleRate: rate,turn:line.take.timing.turn,filler:line.filler,inputMode:line.take.timing.manual?'push-to-talk':'voice-activity' });
        const playingSince = now();
        sending = true;
        const reader = voice.stream.getReader();
        const cancel = () => { void reader.cancel().catch(() => {}); };
        speech.signal.addEventListener('abort', cancel, { once: true });
        let bytes = 0;
        let whole = false;
        // Whole samples per frame: an odd-length chunk put every later sample
        // on the phone half a sample out — static — until the next odd one.
        let carry: Uint8Array | null = null;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) { whole = true; break; }
            if (generation !== myGeneration || closed) { await reader.cancel().catch(() => {}); break; }
            if (!value?.byteLength) continue;
            bytes += value.byteLength;
            let frame = value;
            if (carry) { const joined = new Uint8Array(carry.byteLength + value.byteLength); joined.set(carry); joined.set(value, carry.byteLength); frame = joined; carry = null; }
            if (frame.byteLength & 1) { carry = frame.subarray(frame.byteLength - 1); frame = frame.subarray(0, frame.byteLength - 1); }
            if (frame.byteLength) {
              if (!line.filler) lastDelivery = { emotion: line.emotion, seed: line.seed };
              if (!line.filler && line.take.timing.pcmAt === null) {
                line.take.timing.pcmAt = now();
                logTiming(line.take.timing, 'first-audio');
              }
              if(line.reaction && !deps.engagement?.available()){await reader.cancel().catch(()=>{});break;}
              playbackUntil=Math.max(now(),playbackUntil)+frame.byteLength/(rate*2)*1000;
              if(line.reaction) {reactionEchoUntil=playbackUntil+HER_ECHO_MS;log('[call-engagement] '+JSON.stringify({callId,clip:line.reaction.command.clip,trigger:line.reaction.command.trigger,issuedToPcmMs:now()-line.reaction.command.issuedAtMs,scope:'server_received_event_to_pcm_send; not physical playback'}));}
              handlers.onAudio(frame);
            }
          }
        } catch (error) {
          if (!speech.signal.aborted) log(`[call] her voice broke off: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          speech.signal.removeEventListener('abort', cancel);
          if (activeSpeech === speech) activeSpeech = null;
        }
        if (!line.filler) {
          if (whole && generation === myGeneration) line.take.voiced.push(line.text);
          // Her voice arrives faster than it plays, so the bytes sent overstate
          // what was heard; the clock since the first of them caps it.
          else if (!line.take.cut) line.take.cut = { text: line.text, seconds: Math.min(bytes / (rate * 2), (now() - playingSince) / 1000) };
        }
        if (generation === myGeneration) { sending = false; if(!line.reaction)herEchoUntil = now() + HER_ECHO_MS; emit({ type: 'audio_end', id }); }
      }
    } finally {
      activeSpeech = null;activeReaction=false;
      pumping = false;
      if (!queue.length) finishTurn();
    }
  }

  function releaseInput() {
    if(!manual||!held)return;
    held=false;
    emit({type:'input_gate',active:false});
    const end=manualEnd===null ? null : samples,from=manualFrom,at=now();
    if(end===null || samples-from<CALL_RATE*.15)return;
    const audio=cut(from*1000/CALL_RATE,samples*1000/CALL_RATE);
    void heard(audio,false,{speechEndAt:at-(samples-end)*1000/CALL_RATE,speechEndSample:end,detectedAt:at,heardAt:at,listenMs:0,segments:1,manual:true,inputEpoch});
  }
  return {
    feed,start,interrupt,
    manualInput(enabled) {
      if(closed)return;
      inputEpoch++;manual=enabled;held=false;manualEnd=null;
      preparation=null;pending='';pendingTiming=null;holdUntil=0;overHer='no';vad.reset();ring.length=0;ringSamples=0;
      dropHerVoice();finishTurn();
      emit({type:'input_mode',manual});react('mode');
    },
    inputHeld(active) {
      if(closed||!manual||active===held)return;
      if(!active){releaseInput();return;}
      inputEpoch++;held=true;manualFrom=samples;manualEnd=null;
      ring.length=0;ringSamples=0;preparation=null;pending='';pendingTiming=null;holdUntil=0;
      dropHerVoice();finishTurn();emit({type:'user_interruption'});emit({type:'input_gate',active:true});react('speechStart');
    },
    herSpeaking(on) {
      phoneHearsHer = on;
      if (!on) {playbackUntil=now();if(!reactionAudible)herEchoUntil = now() + HER_ECHO_MS;react('playback');pollSpeakerNotice();}
    },
    close(reason = 'hung up') {
      if (closed) return;
      closed = true;
      deps.speaker?.close();
      if(reactionTimer){clearTimeout(reactionTimer);reactionTimer=null;}
      queue=queue.filter(line=>!line.reaction);
      listening.abort();
      dropHerVoice();
      finishTurn();
      handlers.onClose(reason, Math.round((now() - startedAt) / 1000));
    },
  };
}
