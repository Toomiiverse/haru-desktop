import core_speaker_1 = require("./core-speaker");
import speaker_setup_1 = require("./speaker-setup");
import { readAffectSettings, saveAffectSettings, admitAffect, affectOutcome } from './core-affect';
import { affectPage } from './affect-page';
import { coreAdapterOwner } from './core-policy-sync';
import { bridgeIOS } from './core-ios';
import { coreGmail } from './core-gmail';
import { gmailPage } from './gmail-page';
import { CoreServiceClient, coreServiceOptions } from './core-service-client';
import { timingFor } from './turn-timing';
import {callTelemetry} from './call-telemetry';
// The door itself: an HTTP server that lets one phone reach one Haru.
//
// It runs inside the desktop app rather than beside it. Her memory, her journal
// and the conversation all live in one electron-store file, and a second process
// writing that file is the bug that has already eaten work twice in this project
// — the app rewrites what it holds in memory and the other writer's changes
// vanish. One process, one writer, no sync, and no second copy of a journal on
// some other machine.
//
// It listens on the loopback address and nowhere else. Reaching it from a phone
// is somebody else's job — a tunnel, which also terminates TLS — and doing it
// this way means there is no configuration mistake that quietly exposes her to
// the local coffee shop wifi in plain text.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { ChatReceipts, type ChatReceipt } from './chat-receipts';
import { ChatIntake, intakeFromEnvironment, IntakeFailure, type IntakeTransport, type ChatInput } from './chat-intake';
import { readThread, withChatThread } from './chat-thread';
import type { Duplex } from 'node:stream';
import filePath from 'node:path';
import { WebSocketServer, type WebSocket as CallSocket } from 'ws';
import { clmTurnFrom, spokenReply, sseChunk, sseStop, SSE_DONE } from './evi';
import { pcmToWav } from './voice';
import type { Correction } from './hearing';
import type { Standing } from './standing';
import type { Her } from './her';
import {
  type WebAccess, passwordMatches, newToken, deviceFor, rememberDevice, touchDevice,
  noteFailure, lockedFor, clearFailures, type Attempts, DEVICE_DAYS,
} from './web';
import { loginPage, appPage, serviceWorker } from './webpage';
import { callCheckPage, callCheckWorklet, callCheckResults, readCallCheck, saveCallCheck } from './call-check';
import { readPushPrefs, type PushPrefs } from './push';
import { isDeviceToken } from './apns';
import { emotionFile } from './emotions';
import type { CheckIn } from './checkins';
import { MAX_SHOT_BYTES, type HeldShots } from './shotstore';
import { readActivityReport, type ActivityReport } from './activity-observation';
import { validNudgePreference } from './nudge-learning';
import type { Aside, NudgePreference } from './asides';
import type { CodeModeLink } from './codemode';
import type { ScreenPanel } from './tools';

export type WebDeps = {
  /** 4570: the desk's New chat; its conversation joins today's archive and starts again. */
  newDeskChat?: () => { cleared: number };
  /** 4560: one remark the desk composed the prompt for (a poke, a fullscreen title, a notice); no tools, no conversation. */
  compose?: (messages: { role: 'system' | 'user'; content: string }[], options: { temperature: number; maxTokens?: number }) => Promise<string>;
  /** Core-authored status text; the web transport makes no credit or route decisions. */
  funding?(): { mode: string; notice: string; balanceUsd: number | null; fallbackBelowUsd: number };
  durableChat?: IntakeTransport;
  elsewhereKey?(): string | undefined;
  /** Diagnostic input only; must not reset chat silence or trigger a nudge. */
  attentionInput?(source: string, report: ActivityReport): void;
  readAccess(): WebAccess;
  saveAccess(access: WebAccess): void;
  /** Her real answer, through the same pipeline the desktop uses — minus hands.
   *  `attachments` are staged records handed back by attach.stage below; the
   *  other side re-reads and re-vets them, so this is a courier, not a judge. */
  say(text: string, attachments?: unknown[], options?:{phoneTimeZone?:string}): Promise<{ reply: string; ignored?: boolean; expression?: string | null; emotion?: string | null }>;
  /**
   * The same answer, with the words while they are still being written.
   *
   * `onChunk` is called with each new stretch of the final reply, in order.
   * Whatever was shown so far is exactly what survives: the chat loop only
   * streams the round that ends the turn, so there is no text here that gets
   * taken back. One exception: a round that is thrown away at the last moment
   * (a tool call was coming, a retry was pressed) signals itself by handing a
   * single U+FFFD — the reader clears what it has and waits for the next chunk.
   *
   * `onSentence` is called as each complete sentence of the reply arrives,
   * with the mood read from the line so far (no model call). The phone speaks
   * these while the rest is still being written, so her voice follows the
   * words instead of waiting for them; the last sentence is always delivered
   * before the stream ends. The same U+FFFD that clears the text clears the
   * voice: nothing of a thrown-away round may be spoken.
   */
  sayStream(text: string, onChunk: (chunk: string) => void, attachments?: unknown[], options?: { signal?:AbortSignal; onActed?: () => void; repeated?: string; interrupted?: boolean; call?: boolean; callTrace?:{id:string;turn:number}; replyTo?: string; quoted?: string; phoneTimeZone?: string; onToolCall?: (name: string) => void }, onSentence?: (sentence: string, emotion: string) => void): Promise<{ reply: string; ignored?: boolean }>;
  /**
   * Her last reply, done again. The message that prompted it is asked once
   * more with that reply left out of the history, and the new one takes its
   * place — on the phone and on the desktop, which owns the conversation.
   * Same stream contract as sayStream, sentences included.
   * Null when she has nothing to redo.
   */
  retryStream(onChunk: (chunk: string) => void, onSentence?: (sentence: string, emotion: string) => void): Promise<{ reply: string; ignored?: boolean } | null>;
  /** Files that ride the next message, staged the way a desktop paste is. */
  attach: {
    /** Copies the bytes into her keeping; returns the staged record the page
     *  sends back with the message. Throws when the kind cannot be opened. */
    stage(name: string, bytes: Buffer): unknown;
    discard(attachment: unknown): void;
  };
  /**
   * What her face should do about a line she has just said.
   *
   * Asked for separately, for the same reason her voice is: it costs a whole
   * round trip to a model, and a reply that waits for one before it appears is
   * a reply that arrives late for no benefit the reader can see.
   */
  expression(text: string): Promise<{ emotion: string | null; expression: string | null }>;
  /** The day so far, with ids so a reply can be rated, and any rating it already has. */
  /** The day as heard; `poll` marks a page refreshing itself, which is not the page being opened. */
  history(poll?: boolean): { id?: string; role: string; content: string; at?: string; reaction?: string; note?: string; aside?: string; nudge?: boolean; nudgeFeedback?: NudgePreference }[];
  nudgeFeedback?(id: string, choice: NudgePreference | null): Aside | null | Promise<Aside | null>;
  /**
   * What they thought of a reply of hers. A thumb lands on the message the
   * same way the desktop's does — into her prompt, onto her mood — and she
   * answers back in kind; `line` is that comeback, or null when she has none
   * (a note alone, or the same thumb again). Null altogether when the id is
   * not a reply of hers.
   */
  rate(id: string, reaction: 'up' | 'down' | null, note?: string): Promise<{ line: string | null } | null>;
  /**
   * What was wrong with a reply of hers, written down for whoever is tuning
   * her. Nothing of this reaches her — not her prompt, not her mood, no
   * comeback — so it is deliberately not `rate`. False when the id is not a
   * reply of hers, or when there was nothing in the note.
   */
  tune(id: string, wrong?: string, rather?: string): boolean;
  /** date is a bare YYYY-MM-DD; daysAway is its offset from today so the page can bucket into daily/weekly/monthly without redoing timezone-aware date math client-side. */
  agenda(): { id: string; title: string; date: string; time: string | null; kind: string; done?: boolean; daysAway: number }[];
  /** Panels she put up on her screen with an id after `since`. Asking marks the screen as present. */
  screen(since: number): ScreenPanel[];
  tickOff(id: string): Promise<void> | void;
  /** A task the phone wrote down — a reminder added to the Haru list in Apple Reminders. Null when the time does not read as one. */
  addAgenda(title: string, date: string, time?: string): { id: string; title: string; date: string; time?: string } | null;
  memories(): string[];
  /** Where they stand with her, for the status tab. See standing.ts. */
  standing(): Standing;
  /** Her diary, newest first, for the diary tab. See diary.ts. */
  diary(): { day: string; title: string; text: string }[];
  /** Her own things, nights, likes and wants, for the Her tab. See her.ts. */
  her(): Her;
  /** The whole records, for the other Haru of hers to merge against. The page
   *  never asks for these — it shows the text and nothing else. */
  memoryRecords(): unknown[];
  memoryDeletions?(): unknown[];
  /** The last reset, if there was one — carried out to the bodies (blankslate.ts). */
  slate(): { at: string } | null;
  /** Fold that machine's memories into this one's. Vetted on the way in, so
   *  whatever arrives here is treated as a claim rather than a record. */
  mergeMemories(theirs: unknown): { added: number; updated: number };
  /** The day at the desk, day-keyed. Raw window titles, so this is behind the
   *  same login as everything else and reached only over the tailnet. */
  activityLog(): unknown;
  /** Fold the desk's log into this machine's. Returns how many days it touched. */
  mergeActivity(theirs: unknown): { days: number; entries: number };
  /** The screenshots themselves. The desk asks what is already here and sends
   *  only the difference, so nothing is uploaded twice. */
  shots: {
    held(): HeldShots;
    /** Throws when the day or the name is refused — that is a 400, not a 500. */
    keep(day: unknown, name: unknown, bytes: Buffer): void;
  };
  /** Today's little notes, oldest first. */
  checkIns(): CheckIn[];
  /** Jot one down. Returns today's, including the new one. */
  addCheckIn(note: string, anxiety: number | undefined): CheckIn[];
  /** Anything she would say first, unprompted, or nothing. */
  nudge(): Promise<{ line: string; about: string; eventId?: string } | null>;
  /** Being told about her when nothing of hers is open. The keys stored are the
   *  phone's own; the one secret — the signing key — never appears here. */
  push: {
    /** The native app's device token, from Apple. `sandbox` for a build run from Xcode; TestFlight and the store are production. */
    subscribeApns(token: string, name: string, sandbox: boolean, deviceId?: string): void;
    unsubscribeApns(token: string): void;
    /** Whether the Apple sender has a key to sign with. */
    apnsReady(): boolean;
    /** The public half of the VAPID pair, for the page to subscribe with. */
    key(): string;
    subscribe(device: { endpoint: string; p256dh: string; auth: string }, name: string, deviceId?: string): void;
    unsubscribe(endpoint: string): void;
    prefs(): PushPrefs;
    savePrefs(prefs: PushPrefs): void;
    /** One real push, now, preferences ignored. True if a push service took it. */
    test(): Promise<boolean>;
  };
  /** Coding mode (codemode.ts): his own OpenCode session beside the chat, kept out of her history; leaving notes one deed for her. Null without OpenCode. */
  code?: (Omit<CodeModeLink, 'leave'> & { leave(): { noted: boolean } }) | null;
  /** Google Calendar and Tasks: where the connection stands, and a consent page to reconnect from another machine. */
  google: {
    status(): unknown;
    /** Starts a sign-in and hands back the consent page and the loopback port the answer must reach. */
    connect(): Promise<{ url: string; port: number }>;
  };
  /** The background re-voicing pass (revoice.ts): run one now, or see where it stands. */
  revoice: {
    run(): Promise<unknown>;
    status(): unknown;
  };
  /** Where their phone says they are — kept here, named by them, told to her in words. */
  where: {
    get(): { enabled: boolean; at: string | null; fresh: boolean; net: string | null; places: string[] };
    enable(on: boolean): void;
    /** The phone's latest fix. Refused (false) while sharing is off. */
    report(spot: unknown): boolean;
    /** Calls wherever the phone last was by this name. False with no fix to stand on. */
    name(name: string): boolean;
    forget(name: string): void;
    /** What the last fix's surroundings are called, asked once of the map service. Throws when there is nothing to ask about or no answer. */
    lookUp(): Promise<string>;
  };
  /** How they slept and how far they walked, from the phone's Health app — see body.ts. */
  body: {
    get(): { enabled: boolean; at: string | null; fresh: boolean; day: string | null; sleepMinutes: number | null; steps: number | null };
    enable(on: boolean): void;
    /** The phone's latest figures. Refused (false) while the switch is off or the report is not one. */
    report(report: unknown): boolean;
  };
  /** Her picture, or nothing if this build has none. */
  portrait(): Buffer | null;
  /** Keep a picture on her server, or forget it (main.ts). */
  keepPicture?(id: string, keep: boolean): boolean;
  /** A picture she made, if the signature on the link is hers (venice-image.ts). */
  picture?(id: string, signature: string): { body: Buffer; type: string } | null;
  /** The Live2D model to stand on the stage: the folder it lives in and its entry file. */
  model(): { root: string; entry: string } | null;
  /** How she has been set up on the desktop — her pose, and what she is wearing. */
  pose?(): Record<string, number>;
  /** Where the vendored pixi and Live2D plugin are kept. */
  libFolder(): string | null;
  /** Where her faces are kept — the supplied Haru emotion SVGs, one per emotion. */
  emotionsFolder(): string | null;
  /** Her voice for a line — in the mood it was said in, when told — or nothing if she has none set up. */
  speak(text: string, emotion?: string | null): Promise<{ audio: Uint8Array; mime: string } | null>;
  /** The same line as a stream the page can play as it arrives — the Hume path,
   *  which generates audio progressively. Null when the engine does not stream. */
  speakStream?(text: string, emotion?: string | null, options?: { seed?: number; rawPCM?: boolean; signal?: AbortSignal }): Promise<{ mime: string; body: ReadableStream<Uint8Array>; sampleRate?: number } | null>;
  /** Whether she has agreed to go quiet on the phone (mute.ts). Calls are not
   *  asked: they reach speak() without coming through these routes. */
  quiet?(): boolean;
  /** A picture or file she was sent, back out of her keeping for the chat to show. */
  attachedFile?(saved: string): { bytes: Uint8Array; mime: string } | null;
  /** Her selfies, newest first; the pictures themselves come from /api/attach/file. */
  album?(): { id: string; saved: string; private: boolean; at: string }[];
  /** One of her recorded sighs, for the gap between paragraphs; null when she has none. */
  sigh(emotion?: string | null): Promise<{ audio: Uint8Array; mime: string } | null>;
  /** Her word when they only said her name. */
  wake(): { line: string; emotion: string };
  /** What they just said, through the same ears and the same corrections as the desktop. */
  hear(audio: Uint8Array, mime: string): Promise<string>;
  /** A take of his voice saying her name, from the phone's enrolment: kept for the wake-word model of his voice. Returns the file name. */
  keepVoiceTake?(wav: Uint8Array): Promise<string>;
  /** What she has been taught she mishears — see hearing.ts. */
  corrections(): Correction[];
  /** Teaching her ears from the phone: what came back against what was said. The pair she kept, if there was one. */
  teach(heard: string, meant: string): { learned: { heard: string; meant: string } | null; count: number };
  forgetCorrection(heard: string): Correction[];
  /**
   * The WhatsApp worker, knocking. Absent when this build has none, and absent
   * when he has not turned it on — which is the usual state, because turning it
   * on puts a companion device on his real number.
   */
  whatsapp?: {
    /** The bearer the worker must present. '' when none is set, which refuses everything. */
    secret(): string;
    /** One message the worker heard. Answering happens on her side, not in the response. */
    heard(body: unknown): void;
  };
  /**
   * Speech to speech through Hume's EVI — see evi.ts. A call: the phone streams
   * its microphone up one socket and her voice comes back down it, while her
   * words are asked of the brain hook below. Absent when this build has none.
   */
  evi?: {
    status(): { enabled: boolean; engine: string; minutesToday: number; cap: number; reason?: string; asleep?: boolean; wakesAt?: string | null };
    /** The bearer Hume must present at the brain hook; '' when none is set. */
    secret(): string;
    /**
     * Opens a call for this device, on whichever engine is configured (call.ts).
     * Throws with a reason worth showing when refused. `onAudio` carries her
     * voice as raw PCM between an audio_start and its audio_end (the local
     * engine); the Hume engine sends whole sentences as audio_output events.
     */
    open(deviceId: string, handlers: { onEvent(event: Record<string, unknown>): void; onAudio(pcm: Uint8Array): void; onClose(reason: string): void }): Promise<{ sendAudio(pcm: Uint8Array): void; close(reason?: string): void; herSpeaking?(on: boolean): void; start?(facts?:{reactionActivityTracked?:boolean;phoneTimeZone?:string}):void; interrupt?(requestId?:string):void; manualInput?(enabled:boolean):void; inputHeld?(active:boolean):void }>;
    /**
     * One turn of a call: what Hume heard and how it sounded, answered in her
     * words, streamed. Null when the session is not a call of ours.
     */
    turn(sessionId: string, text: string, prosody: Record<string, number> | null, onChunk: (chunk: string) => void): Promise<{ reply: string; ignored?: boolean } | null>;
  };
  knowledge: {
    search(query: string, category?: string): Promise<{ results: { content: string; source: string; category: string; heading: string | null; version: number; confidence: number; updatedAt: string; score: number }[] }>;
    stats(): Record<string, unknown>;
    ingest(file: string, category?: string): Promise<{ queued: boolean; source: string; sourceType: string; category: string; action: string; chunks: number }>;
    deleteDocument(source: string): Promise<{ deleted: boolean; removedChunks: number }>;
    reindex(source?: string): Promise<{ reindexed: number }>;
    vault(path: string): Promise<{ added: number; updated: number; unchanged: number; removed: number; files: number; ms: number }>;
  };
};

/**
 * The only extensions a model is allowed to be made of.
 *
 * A route that serves files out of a folder is a route that will be asked for
 * other files, and the answer has to be no by default rather than no by
 * accident. Together with the containment check below, this is what keeps
 * "serve her model" from meaning "serve anything on this disk".
 */
const MODEL_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.moc3': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mtn': 'application/octet-stream',
  '.motion3': 'application/json',
  '.wav': 'audio/wav',
};

/**
 * A file inside the folder, or nothing.
 *
 * Resolved and then checked to still be under the root, which is the check that
 * matters: "../" survives being decoded, being encoded twice, and being written
 * with backslashes, and none of those look suspicious until the file comes back.
 */
function fileWithin(root: string, requested: string): string | null {
  let relative: string;
  try { relative = decodeURIComponent(requested); } catch { return null; }
  if (relative.includes('\0')) return null;
  const resolved = filePath.resolve(root, '.' + filePath.posix.normalize('/' + relative.replace(/\\/g, '/')));
  const base = filePath.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + filePath.sep)) return null;
  if (!MODEL_TYPES[filePath.extname(resolved).toLowerCase()]) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  return resolved;
}

/**
 * The three files the stage is made of, all served from us.
 *
 * The Cubism runtime is here rather than fetched from Live2D because it is the
 * one thing on the page that used to come from somewhere else, and a shield, a
 * blocker or a phone with no signal all stopped it without saying so. Its own
 * header names it "Redistributable Code" under Live2D's licence, which is the
 * licence anticipating exactly this.
 */
const LIB_FILES: Record<string, string> = {
  '/lib/haru-avatar.js': 'haru-avatar.js',
  '/lib/pixi.js': 'pixi.min.js',
  '/lib/noeval.js': 'pixi-unsafe-eval.min.js',
  '/lib/live2d.js': 'live2d.cubism4.min.js',
  '/lib/cubismcore.js': 'live2dcubismcore.min.js',
};

/**
 * The manifest, with the expression files the folder actually contains.
 *
 * Only when it declares none itself — a model that lists its own expressions
 * knows better than we do. Read fresh each time rather than cached: the file is
 * a kilobyte, and a reimported model should not need a restart to be noticed.
 */
function withExpressions(entry: string, root: string): unknown {
  const manifest = JSON.parse(readFileSync(entry, 'utf8')) as { FileReferences?: { Expressions?: unknown[] } };
  const refs = manifest.FileReferences ?? (manifest.FileReferences = {});
  if (Array.isArray(refs.Expressions) && refs.Expressions.length) return manifest;
  let names: string[] = [];
  try { names = readdirSync(root).filter(name => /\.exp3\.json$/i.test(name)); } catch { return manifest; }
  if (!names.length) return manifest;
  refs.Expressions = names.map(file => ({ Name: file.replace(/\.exp3\.json$/i, ''), File: file }));
  return manifest;
}

const SESSION_COOKIE = 'haru_session';
const DEVICE_COOKIE = 'haru_device';
/** Big enough for a long message, small enough that nobody posts a film. */
const MAX_BODY = 256 * 1024;
/**
 * The two routes another machine of hers syncs through — every memory it
 * holds, and its day at the desk — carry the whole thing each time, and a
 * laptop that has pulled the server's records posts them all back. At the
 * message-sized cap that was refused as "too much" forty-six times a day
 * (2026-09-06), and the laptop's memories and activity never arrived.
 */
const MAX_SYNC_BODY = 8 * 1024 * 1024;
/** A recording is not a message. Roughly a minute of opus, and a hard stop. */
const MAX_AUDIO = 8 * 1024 * 1024;
/** A file attached to a message. Videos are the biggest honest case. */
const MAX_UPLOAD = 50 * 1024 * 1024;
/** A message can carry several files, not a folder. Matches the desktop's habit. */
const MAX_FILES = 6;

/** Logins that were not asked to be remembered. Gone when the app closes, deliberately. */
const sessions = new Map<string, number>();
const elsewhereRequests = new WeakMap<WebDeps,{busy:boolean;recent:number[]}>();
const SESSION_MS = 12 * 60 * 60_000;

/** Wrong guesses, kept per address. In memory: a restart is not a reward worth farming. */
const attemptsBy = new Map<string, Attempts>();

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (name) out[name] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

/**
 * Secure and HttpOnly always, SameSite=Strict always.
 *
 * Strict rather than Lax because nothing here is ever meant to be reached by
 * following a link from somewhere else — every request comes from her own page —
 * and it is the cheapest defence against another site posting on her behalf.
 * Secure is safe on loopback too: browsers treat localhost as a secure origin.
 */
function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds: number) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict'];
  bits.push(maxAgeSeconds > 0 ? `Max-Age=${maxAgeSeconds}` : 'Max-Age=0');
  const existing = res.getHeader('Set-Cookie');
  const all = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [...all, bits.join('; ')]);
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json') {
  // No third-party anything, ever: the page is entirely self-contained, so the
  // policy that says so costs nothing and takes a whole class of injected script
  // off the table.
  res.writeHead(status, {
    'Content-Type': type === 'application/json' ? 'application/json; charset=utf-8' : type,
    // Nothing outside this server, again.
    //
    // The Live2D stage briefly needed one named origin for Cubism's runtime.
    // That file is now served from here like everything else, so the policy is
    // back to naming no host at all — which is the version worth having: there
    // is no third party to block it, no signal needed beyond the tunnel, and a
    // hostile string that reaches this page has nowhere to send what it finds.
    'Content-Security-Policy': [
      "default-src 'none'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      // 'self' for the service worker that shows notifications; blob: predates it.
      "worker-src 'self' blob:",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, JSON.stringify(value));

/** A named file directly inside a folder, never below it. */
function fileAt(folder: string, name: string): string | null {
  const full = filePath.join(folder, name);
  return existsSync(full) && statSync(full).isFile() ? full : null;
}

/**
 * Streamed rather than read: the model is 28MB across nearly forty files, and
 * holding each one in memory to hand it over would be the same bytes twice for
 * no reason. Cached hard — a .moc3 does not change without being reimported.
 */
function sendFile(res: ServerResponse, file: string, type: string) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': statSync(file).size,
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=604800, immutable',
  });
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

async function readBody(req: IncomingMessage, cap = MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > cap) throw new Error('too much');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('not json'); }
}

/** A raw body — a recording, an attached file — up to the cap its route allows. */
async function readRaw(req: IncomingMessage, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > cap) throw new Error('too much');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Who is asking, if anyone. Returns the device when one is remembered, so it can be touched. */
function whoIsThis(req: IncomingMessage, access: WebAccess, now: Date) {
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies[SESSION_COOKIE];
  if (session) {
    const until = sessions.get(session);
    if (until && until > now.getTime()) return { allowed: true as const, device: null, source: session };
    if (until) sessions.delete(session);
  }
  const device = deviceFor(access, cookies[DEVICE_COOKIE] ?? '', now);
  return device ? { allowed: true as const, device, source: device.id } : { allowed: false as const, device: null, source: '' };
}

export function startWebServer(port: number, deps: WebDeps): Promise<{ port: number; stop(): Promise<void> }> {
  const transport = deps.durableChat ?? intakeFromEnvironment();
  const intake = transport ? new ChatIntake(transport, {
    scope: () => deps.slate()?.at ?? 'none',
    enabled: () => { const access = deps.readAccess(); return Boolean(access.enabled && access.hash); },
    say: (text, files, options) => deps.say(text, files, options),
    sayStream: (text, chunk, files, options, sentence) => deps.sayStream(text, chunk, files, options, sentence),
  }) : undefined;
  if (intake) durableIntakes.set(deps, intake);
  const server: Server = createServer((req, res) => { void handle(req, res, deps).catch(error => {
    // Named by route, size and caller: "too much" forty-six times in a day
    // said nothing about who was sending what (2026-09-06).
    const from = String(req.headers['x-forwarded-for'] ?? req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
    const declared = req.headers['content-length'] ? ` (${req.headers['content-length']} bytes declared)` : '';
    console.error(`[web] ${error instanceof Error ? error.message : String(error)} — ${req.method ?? '?'} ${(req.url ?? '/').split('?')[0]} from ${from}${declared}`);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong.' });
  }); });

  // The one socket: a call. Everything else on this server is a request and an
  // answer; a call is the phone's microphone going up and her voice coming
  // down for as long as the mic is on, and that is a different shape of
  // connection. It is gated the same way as every route past the sign-in.
  const calls = new WebSocketServer({ noServer: true, maxPayload: MAX_CALL_FRAME });
  server.on('upgrade', (req, socket, head) => {
    void answerUpgrade(req, socket as Duplex, head, deps, calls).catch(error => {
      console.error('[web] ' + (error instanceof Error ? error.message : String(error)));
      socket.destroy();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only. This is the line that keeps her off the network.
    server.listen(port, '127.0.0.1', async () => {
      const actual = (server.address() as { port: number }).port;
      try { await intake?.start(); }
      catch (error) { durableIntakes.delete(deps); calls.close(); server.close(); reject(error); return; }
      console.log(`[web] listening on 127.0.0.1:${actual} — reachable only through a tunnel`);
      resolve({
        port: actual,
        stop: async () => {
          for (const client of calls.clients) client.terminate();
          calls.close();
          try { await intake?.stop(); }
          finally {
            durableIntakes.delete(deps);
            await new Promise<void>(done => server.close(() => { sessions.clear(); done(); }));
          }
        },
      });
    });
  });
}

/** A frame of the phone's audio. 40 ms of 16 kHz PCM16 is 1.3 KB; a megabyte is somebody else. */
const MAX_CALL_FRAME = 1024 * 1024;
/** What Hume posts to the brain hook: the whole call as it holds it, prosody and all. */
const MAX_HOOK_BODY = 4 * 1024 * 1024;

function refuseUpgrade(socket: Duplex, status: number, reason: string) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * The call's door. Same checks as `handle`, in the same order — the door is
 * closed, the caller is a stranger, the feature is not built — and only then
 * the socket is taken over. Anything but the one path is refused outright: a
 * WebSocket handshake that lands anywhere else is not the phone.
 */
async function answerUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, deps: WebDeps, calls: WebSocketServer) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/api/ios/session') {
    if (req.headers.origin) {
      let source: URL;
      try { source = new URL(req.headers.origin); } catch { return refuseUpgrade(socket, 403, 'Forbidden'); }
      if (source.host !== req.headers.host) return refuseUpgrade(socket, 403, 'Forbidden');
    }
    const access = deps.readAccess();
    const me = whoIsThis(req, access, new Date());
    if (!access.enabled || !access.hash || !me.allowed || !me.device?.id) return refuseUpgrade(socket, 401, 'Unauthorized');
    calls.handleUpgrade(req, socket, head, ws => bridgeIOS(ws, me.device!.id, () => whoIsThis(req, deps.readAccess(), new Date()).allowed));
    return;
  }
  if (url.pathname !== '/api/call/session' && url.pathname !== '/api/evi/session') return refuseUpgrade(socket, 404, 'Not Found');
  const access = deps.readAccess();
  if (!access.enabled || !access.hash) return refuseUpgrade(socket, 503, 'Service Unavailable');
  const me = whoIsThis(req, access, new Date());
  if (!me.allowed) return refuseUpgrade(socket, 401, 'Unauthorized');
  if (!deps.evi) return refuseUpgrade(socket, 404, 'Not Found');
  const evi = deps.evi;
  const deviceId = me.device?.id ?? 'session';
  calls.handleUpgrade(req, socket, head, ws => { void runCall(ws, deviceId, evi); });
}

/**
 * The call itself. Binary frames up are the microphone and go to the engine;
 * text frames up are requests: `stop`, `hello` (what the phone can play), and
 * `her` (whether she is audible through its speaker, so the engine knows an
 * echo from an interruption). Down, one JSON event per text frame — what was
 * heard, what she said, a filler while a tool runs, she was talked over, she
 * has finished — and her voice either as base64 WAV `audio_output` events
 * (the Hume engine, and any phone that did not say it plays PCM) or as raw
 * PCM binary frames between `audio_start` and `audio_end` (the local engine,
 * to a phone that said `{type:'hello', pcm:true}`). `ready` first, `ended`
 * last, `refused` instead of either when the call could not be placed.
 */
async function runCall(ws: CallSocket, deviceId: string, evi: NonNullable<WebDeps['evi']>) {
  let callId:string=randomUUID();
  const telemetry=callTelemetry(value=>console.log('[phone-playback-timing] '+JSON.stringify({callId,...value})));
  const tell = (event: Record<string, unknown>) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)); };
  let call: Awaited<ReturnType<typeof evi.open>> | null = null;
  let ended = false;
  // A phone that plays PCM gets her voice as it is made; one that does not
  // gets each line whole, as a WAV, once it has all arrived.
  let pcmPhone = false;
  let sampleRate = 24000;
  let held: Uint8Array[] = [];
  const asWholeWav = (event: Record<string, unknown>): boolean => {
    if (pcmPhone) return false;
    if (event.type === 'audio_start') { held = []; sampleRate = typeof event.sampleRate === 'number' ? event.sampleRate : 24000; return true; }
    if (event.type === 'audio_end') {
      const pcm = Buffer.concat(held.map(part => Buffer.from(part.buffer, part.byteOffset, part.byteLength)));
      held = [];
      if (pcm.byteLength) tell({ type: 'audio_output', data: Buffer.from(pcmToWav(pcm, sampleRate)).toString('base64'), id: String(event.id ?? ''), index: 0 });
      return true;
    }
    return false;
  };
  try {
    call = await evi.open(deviceId, {
      onEvent: event => { if(typeof event.callId==='string' && /^[a-f0-9-]{36}$/.test(event.callId))callId=event.callId; telemetry.event(event); if (!asWholeWav(event)) tell(event); },
      onAudio: pcm => {
        if (pcmPhone) { if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true }); }
        else held.push(pcm);
      },
      onClose: reason => {
        if (ended) return;
        ended = true;
        tell({ type: 'ended', reason });
        if (ws.readyState === ws.OPEN) ws.close(1000, reason.slice(0, 120));
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`[evi] refused a call: ${reason}`);
    tell({ type: 'refused', reason });
    ws.close(1008, reason.slice(0, 120));
    return;
  }
  const placed = call;
  tell({ type: 'ready', pushToTalk:!!placed.manualInput && !!placed.inputHeld,...(placed.interrupt?{tapToInterrupt:true}:{}) });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      placed.sendAudio(frame);
      return;
    }
    let request: Record<string,unknown> = {};
    try { request = JSON.parse(String(data)) as typeof request; } catch { return; }
    if (request.type === 'stop') placed.close('the phone hung up');
    else if (request.type === 'hello') {pcmPhone = request.pcm === true;placed.start?.({reactionActivityTracked:request.reactionActivityTracked===true,...(typeof request.timeZone==='string'&&request.timeZone.length<=80?{phoneTimeZone:request.timeZone}:{})});}
    else if (request.type === 'input_mode' && typeof request.manual==='boolean') placed.manualInput?.(request.manual);
    else if (request.type === 'input_gate' && typeof request.active==='boolean') placed.inputHeld?.(request.active);
    else if (request.type === 'interrupt' && typeof request.requestId==='string' && /^[a-f0-9-]{36}$/i.test(request.requestId)) placed.interrupt?.(request.requestId);
    else if (request.type === 'her') placed.herSpeaking?.(request.speaking === true);
    else if (request.type === 'playback_timing') telemetry.receive(request);
  });
  ws.on('close', () => { ended = true; placed.close('the phone went away'); });
  ws.on('error', () => { ended = true; placed.close('the phone\'s socket failed'); });
}

/**
 * The brain hook: where Hume asks what she says.
 *
 * This is the one route that has to be reachable from the internet — Hume's
 * servers call it, not the phone — so it stands before the sign-in gate and
 * has a gate of its own: a bearer only Hume was handed, compared in constant
 * time, with the sign-in's own lockout behind it. A right bearer with a
 * session that is not a live call of ours is refused too; the secret opens
 * the door to the calls, not to her.
 */
async function brainHook(req: IncomingMessage, res: ServerResponse, deps: WebDeps, url: URL, now: Date) {
  if (!deps.evi) return json(res, 404, { error: 'Nothing here.' });
  // The bearer is checked before the lockout, not after: through the tunnel
  // every caller shares one address, so a stranger guessing at the door must
  // slow only strangers down. A right bearer cannot be guessed, and Hume's
  // calls go through however many wrong ones came before.
  const given = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
  if (!sameSecret(given, deps.evi.secret())) {
    const from = String(req.headers['x-forwarded-for'] ?? req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
    const attempts = attemptsBy.get(from) ?? clearFailures();
    const wait = lockedFor(attempts, now.getTime());
    if (wait > 0) return json(res, 429, { error: `Too many tries. Wait ${Math.ceil(wait / 1000)}s.` });
    attemptsBy.set(from, noteFailure(attempts, now.getTime()));
    console.warn(`[evi] refused a brain-hook call from ${from}`);
    return json(res, 401, { error: 'That is not right.' });
  }
  const sessionId = (url.searchParams.get('custom_session_id') ?? '').trim();
  if (!sessionId) return json(res, 400, { error: 'No session.' });
  let body: unknown;
  try { body = await readBody(req, MAX_HOOK_BODY); } catch { return json(res, 400, { error: 'Bad request.' }); }
  const turn = clmTurnFrom(body);
  if (!turn) return json(res, 400, { error: 'Nothing was said.' });

  // The reply goes out whole, once it is the reply that counts. Measured on
  // the wire (2026-09-05): EVI says nothing until the stream has ended,
  // whatever arrives first, so streaming her words as they come bought
  // nothing and cost two things — a round thrown away at the last moment had
  // already been spoken, and the reply the filters settled on differed from
  // the one she said. Waiting for the end fixes both, and lets the text be
  // made speakable as one piece: no markdown, no emoji, no shouting.
  const id = `haru-${now.getTime().toString(36)}`;
  const created = Math.floor(now.getTime() / 1000);
  let answer: { reply: string; ignored?: boolean } | null;
  try {
    answer = await deps.evi.turn(sessionId, turn.text, turn.prosody, () => {});
  } catch (error) {
    console.error('[evi] the brain hook failed: ' + (error instanceof Error ? error.message : String(error)));
    return json(res, 500, { error: 'Something went wrong.' });
  }
  if (!answer) return json(res, 403, { error: 'Not a call of ours.' });
  const said = answer.ignored ? '' : spokenReply(answer.reply);
  if (answer.ignored) console.log(`[evi] ${sessionId} — she is not answering that`);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
  if (said) res.write(sseChunk(said, id, created));
  res.write(sseStop(id, created));
  res.write(SSE_DONE);
  return res.end();
}

/**
 * Whether this request came from this machine rather than through the tunnel.
 *
 * Both loopback forms, and nothing else. A forwarded-for header is deliberately
 * not consulted: it is set by whatever is in front, and for a route that must
 * only ever be reached by a process on this box, the socket's own address is
 * the only thing worth trusting.
 */
function fromThisMachine(req: IncomingMessage): boolean {
  const from = req.socket.remoteAddress ?? '';
  return from === '127.0.0.1' || from === '::1' || from === '::ffff:127.0.0.1';
}

/** Equal, in time that does not depend on where they differ. */
function sameSecret(given: string, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const chatReceipts = new WeakMap<WebDeps, ChatReceipts>();
const durableIntakes = new WeakMap<WebDeps, ChatIntake>();
function receiptsFor(deps: WebDeps): ChatReceipts {
  let receipts = chatReceipts.get(deps);
  if (!receipts) { receipts = new ChatReceipts(); chatReceipts.set(deps, receipts); }
  return receipts;
}
const publicReceipt = (entry: ChatReceipt) => ({ state: entry.state, reply: entry.reply, ignored: entry.ignored, error: entry.error });

async function durableChat(req: IncomingMessage, res: ServerResponse, deps: WebDeps, input: ChatInput, requestedId: unknown) {
  input = {...input,originDeviceId:whoIsThis(req,deps.readAccess(),new Date()).device?.id};
  const id = typeof requestedId === 'string' ? requestedId : randomUUID();
  if (requestedId !== undefined && (typeof requestedId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id))) return json(res,400,{error:'Invalid request ID.'});
  const mark = timingFor(id);
  mark('received',{mode:input.mode});
  // finish means bytes handed to the server transport, not phone receipt/playback.
  res.once('finish',() => mark('response_finish',{connected:!res.destroyed}));
  res.once('close',() => mark('response_close',{connected:res.writableFinished}));
  const intake = durableIntakes.get(deps)!;
  const scope = deps.slate()?.at ?? 'none';
  let admitted;
  try { admitted = await intake.admit(id,scope,input); mark('admitted',{fresh:admitted.fresh,status:admitted.receipt.state === 'pending' ? 'pending' : admitted.receipt.state === 'done' ? 'ok' : 'error'}); }
  catch (error) { mark('admission_failed',{status:'error'}); return json(res,error instanceof IntakeFailure ? error.status : 503,{error:'That request could not be confirmed. Keep its request ID when checking delivery.',requestId:id}); }
  if (input.mode === 'plain') {
    const receipt = admitted.receipt.state !== 'pending' ? admitted.receipt
      : admitted.fresh && !admitted.paused ? await intake.wait(id,scope) : null;
    return json(res,receipt?.state === 'done' ? 200 : receipt?.state === 'error' ? 409 : 202,
      receipt?.state === 'done' ? {reply:receipt.reply,ignored:receipt.ignored,expression:receipt.expression,emotion:receipt.emotion,requestId:id,...(receipt.disposition ? {disposition:receipt.disposition,ran:receipt.ran} : {})}
      : receipt?.state === 'error' ? {error:receipt.error,requestId:id} : {accepted:true,pending:true,requestId:id});
  }
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive'});
  let firstText = false;
  const emit = (value: unknown) => { if (!res.destroyed) {
    res.write(`data: ${JSON.stringify(value)}\n\n`);
    if (!firstText && value && typeof value === 'object' && 'text' in value && value.text) { firstText = true; mark('first_text_write',{connected:true}); }
  } };
  emit({accepted:true,requestId:id}); res.flushHeaders();
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': waiting\n\n'); },10000); heartbeat.unref();
  res.once('close',() => clearInterval(heartbeat));
  try {
    const receipt = admitted.receipt.state !== 'pending' ? admitted.receipt
      : admitted.fresh && !admitted.paused ? await intake.wait(id,scope,emit) : null;
    if (receipt?.state === 'done') emit({done:true,reply:receipt.reply,ignored:receipt.ignored,...(receipt.disposition ? {disposition:receipt.disposition,ran:receipt.ran} : {})});
    else if (receipt?.state === 'error') emit({error:receipt.error});
    else emit({pending:true});
  } finally { clearInterval(heartbeat); res.end(); }
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: WebDeps) {
  const receivedAt = Date.now();
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const now = new Date();
  const access = deps.readAccess();

  if (!access.enabled || !access.hash) {
    return send(res, 503, '<!doctype html><meta charset=utf-8><p style="font:16px system-ui;padding:2rem">Haru is not set up for the web yet. Turn it on in her settings, on the desktop.</p>', 'text/html; charset=utf-8');
  }

  const me = whoIsThis(req, access, now);

  // Her face, on the sign-in page as well as the stage, so it is served before
  // anyone has signed in. It is the app's own icon and gives nothing away.
  if (req.method === 'GET' && path === '/portrait') {
    const picture = deps.portrait();
    if (!picture) return json(res, 404, { error: 'No portrait.' });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    });
    return res.end(picture);
  }

  // A picture she made, fetched by the phone's notification extension, which
  // has no cookie to offer. The link carries its own signature instead, and the
  // signature is checked before anything is read off the disk.
  if (req.method === 'POST' && /^\/api\/picture\/[0-9a-f-]{36}\/keep$/.test(path)) {
    const id = path.split('/')[3];
    let body: unknown;
    try { body = await readBody(req, 512); } catch { return json(res, 400, { error: 'Bad request.' }); }
    const keep = (body as { keep?: unknown }).keep !== false;
    if (!deps.keepPicture?.(id, keep)) return json(res, 404, { error: 'No such picture.' });
    return json(res, 200, { ok: true, kept: keep });
  }

  if (req.method === 'GET' && path.startsWith('/api/picture/')) {
    const id = path.slice('/api/picture/'.length);
    const found = deps.picture?.(id, url.searchParams.get('k') ?? '');
    if (!found) return json(res, 404, { error: 'No such picture.' });
    res.writeHead(200, {
      'Content-Type': found.type,
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    });
    return res.end(found.body);
  }

  // What makes her installable rather than a browser tab: her own window, her
  // own icon in the taskbar and on a home screen, no address bar. Served before
  // the login because a browser reads it to decide whether it can be installed
  // at all, and it says nothing a stranger could not guess from the front page.
  if (req.method === 'GET' && path === '/manifest.webmanifest') {
    return send(res, 200, JSON.stringify({
      name: 'Haru',
      short_name: 'Haru',
      description: 'Haru, wherever you are.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#171029',
      theme_color: '#171029',
      icons: [
        { src: '/portrait', sizes: '1254x1254', type: 'image/png', purpose: 'any' },
        { src: '/portrait', sizes: '1254x1254', type: 'image/png', purpose: 'maskable' },
      ],
    }), 'application/manifest+json; charset=utf-8');
  }

  // The worker that shows her notifications when the page is closed. Public
  // for the manifest's reason — a browser fetches it on its own schedule, from
  // the browser process, where the login cookie does not reliably travel — and
  // safe for the manifest's reason too: it is generic code that says nothing a
  // stranger could not guess. Everything it is ever handed arrives by push,
  // sealed to the phone's own keys.
  if (req.method === 'GET' && path === '/sw.js') {
    return send(res, 200, serviceWorker(), 'text/javascript; charset=utf-8');
  }

  // Whether the process behind the door is answering at all. Public, before the
  // sign-in gate, and loopback-only like everything here: the watchdog on this
  // machine asks it every half minute, and the fastest way to know she is gone
  // is for a question she has always answered to stop being answered. It says
  // nothing a stranger could use — only that something is still home.
  if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, at: new Date().toISOString() });

  if (req.method === 'POST' && path === '/api/login') return login(req, res, deps, access, now);

  // Hume's servers, asking what she says. Its own gate, above — the phone's
  // cookie never travels this way.
  if (req.method === 'POST' && path === '/api/evi/chat/completions') return brainHook(req, res, deps, url, now);

  // The WhatsApp worker, handing over a message it heard. Stands before the
  // sign-in gate for the brain hook's reason — it is not a browser and carries
  // no cookie — but its gate is stricter, because this door is not Hume's.
  //
  // The brain hook has to be reachable from the internet, so it can only ask
  // for a secret. This one never should be: the worker is a process on this
  // machine. Funnel puts port 443 of this server on the public internet, so
  // "only the worker calls this" is a thing that has to be checked rather than
  // assumed. Loopback first, then the bearer, and a build without the worker
  // configured has no route here at all.
  if (req.method === 'POST' && path === '/api/whatsapp/inbound') {
    if (!deps.whatsapp) return json(res, 404, { error: 'Nothing here.' });
    if (!fromThisMachine(req)) {
      console.warn('[whatsapp] refused an inbound from off this machine');
      return json(res, 404, { error: 'Nothing here.' });
    }
    const given = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!sameSecret(given, deps.whatsapp.secret())) {
      console.warn('[whatsapp] refused an inbound with the wrong bearer');
      return json(res, 401, { error: 'That is not right.' });
    }
    let body: unknown;
    try { body = await readBody(req, 64 * 1024); } catch { return json(res, 400, { error: 'Bad request.' }); }
    // Answered before she has answered. The worker is not waiting for her reply
    // -- it goes back out through its own door when she has written it -- and
    // holding this request open for a whole turn would have the worker time out
    // and give up on a message she did in fact hear.
    deps.whatsapp.heard(body);
    return json(res, 200, { heard: true });
  }

  if (!me.allowed) {
    // Her model is not served to strangers. It is 28MB of somebody's paid asset
    // and there is no reason for the sign-in page to need it.
    if (req.method === 'GET' && (path === '/' || path === '/elsewhere' || path === '/call-check' || path === '/emotion-settings' || path === '/gmail' || path === '/voice-identity')) return send(res, 200, loginPage(), 'text/html; charset=utf-8');
    return json(res, 401, { error: 'Sign in first.' });
  }

  // Seen today, so a phone in daily use never gets logged out.
  if (me.device) {
    const touched = touchDevice(access, me.device.id, now);
    if (touched !== access) deps.saveAccess(touched);
  }

  if (req.method === 'GET' && path === '/') return send(res, 200, appPage(), 'text/html; charset=utf-8');

  if (req.method === 'GET' && path === '/emotion-settings') return send(res, 200, affectPage(), 'text/html; charset=utf-8');
  if (req.method === 'GET' && path === '/api/affect/settings') {
    res.setHeader('Cache-Control', 'no-store');
    try { return json(res, 200, await readAffectSettings()); }
    catch { return json(res, 503, { error: 'affect_settings_unavailable' }); }
  }
  if (req.method === 'POST' && path === '/api/affect/settings') {
    if (req.headers['x-haru-affect-ui'] !== '1' || !String(req.headers['content-type'] ?? '').startsWith('application/json') || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'affect_same_origin_required' });
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'affect_same_origin_required' }); }
      catch { return json(res, 403, { error: 'affect_same_origin_required' }); }
    }
    res.setHeader('Cache-Control', 'no-store');
    try { return json(res, 200, await saveAffectSettings(await readBody(req, 4096))); }
    catch { return json(res, 409, { error: 'affect_settings_unconfirmed' }); }
  }
  if (req.method === 'GET' && path === '/mail') {
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, require('node:fs').readFileSync(require('node:path').join(__dirname, 'mail.html'), 'utf8'), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && path.startsWith('/api/openmail/')) {
    if (req.headers['x-haru-mail-ui'] !== '1' || !String(req.headers['content-type'] ?? '').startsWith('application/json') || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'openmail_same_origin_required' });
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'openmail_same_origin_required' }); }
      catch { return json(res, 403, { error: 'openmail_same_origin_required' }); }
    }
    res.setHeader('Cache-Control', 'no-store');
    try { return json(res, 200, await require('./core-openmail').coreOpenMail(path.slice('/api/openmail/'.length), await readBody(req))); }
    catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : 'openmail_request_failed' }); }
  }
  if (req.method === 'GET' && path === '/gmail') return send(res, 200, gmailPage(), 'text/html; charset=utf-8');
  if (req.method === 'GET' && path === '/api/gmail') {
    res.setHeader('Cache-Control', 'no-store');
    try { return json(res, 200, await coreGmail('status', {}, '', true)); }
    catch (error) { return json(res, 503, { error: error instanceof Error ? error.message : 'gmail_unavailable' }); }
  }
  if (req.method === 'POST' && path.startsWith('/api/gmail/')) {
    if (req.headers['x-haru-gmail-ui'] !== '1' || !String(req.headers['content-type'] ?? '').startsWith('application/json') || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'gmail_same_origin_required' });
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'gmail_same_origin_required' }); }
      catch { return json(res, 403, { error: 'gmail_same_origin_required' }); }
    }
    res.setHeader('Cache-Control', 'no-store');
    try { return json(res, 200, await coreGmail(path.slice('/api/gmail/'.length), await readBody(req) as Record<string, unknown>, '', true)); }
    catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : 'gmail_request_unconfirmed' }); }
  }
  if(req.method==='GET'&&path==='/voice-identity')return send(res,200,speaker_setup_1.speakerSetupPage(),'text/html; charset=utf-8');
  if(req.method==='GET'&&path==='/api/speaker/status'){
    if(!core_speaker_1.speakerEnabled())return json(res,200,{enabled:false,deferVoiceStart:false,enrolled:false,validated:false,message:'Voice recognition is not installed in this runtime.'});
    try{return json(res,200,await core_speaker_1.speakerRequest('status'));}catch{return json(res,503,{error:'Voice recognition is unavailable.'});}
  }
  if (req.method === 'GET' && path === '/call-check') return send(res, 200, callCheckPage(), 'text/html; charset=utf-8');
  if (req.method === 'GET' && path === '/call-check-worklet.js') return send(res, 200, callCheckWorklet(), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && path === '/api/funding') {
    if (!deps.funding) return json(res, 503, { error: 'Credit status is unavailable.' });
    return json(res, 200, deps.funding());
  }
  if (req.method === 'GET' && path === '/api/call-check/results') return json(res, 200, callCheckResults());
  if (req.method === 'POST' && path === '/api/chat/observe') {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res,415,{error:'JSON required.'});
    try { if (new URL(req.headers.origin ?? '').host !== req.headers.host) return json(res,403,{error:'Same origin required.'}); }
    catch { return json(res,403,{error:'Same origin required.'}); }
    const intake=durableIntakes.get(deps);
    if (!intake) return json(res,503,{error:'Measurement unavailable.'});
    try {
      const body=await readBody(req,8192);
      if (!body || typeof body!=='object' || !('requestId' in body) || typeof body.requestId!=='string' || !('observation' in body)) return json(res,400,{error:'Invalid measurement.'});
      const result=await intake.observe(body.requestId,deps.slate()?.at ?? 'none',body.observation);
      return json(res,200,result);
    } catch (error) { return json(res,error instanceof IntakeFailure ? error.status : 400,{error:'Measurement unavailable.'}); }
  }
  if (req.method === 'POST' && path === '/api/call-check/results') {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON required.' });
    // A browser submission must originate at this authenticated site.
    try { if (new URL(req.headers.origin ?? '').host !== req.headers.host) return json(res, 403, { error: 'Same origin required.' }); }
    catch { return json(res, 403, { error: 'Same origin required.' }); }
    let body: unknown;
    try { body = await readBody(req, 8192); } catch { return json(res, 400, { error: 'Invalid result.' }); }
    const checked = readCallCheck(body);
    if (!checked) return json(res, 400, { error: 'Invalid result.' });
    return json(res, 200, { ok: true, at: saveCallCheck(checked).at });
  }

  if ((req.method === 'POST' && ['/api/world/control', '/api/elsewhere/dialogue'].includes(path)) || (req.method === 'GET' && (path === '/api/world' || path.startsWith('/api/world/work')))) return json(res, 410, { error: 'The fictional simulation is archived. Open the work world.' });

  // The stage's moving parts, all behind the login.
  if (req.method === 'GET' && path === '/api/model') {
    const model = deps.model();
    // Her pose is decoration; the model is the point. Looked up separately so a
    // wardrobe that cannot be read leaves her standing in the default position
    // rather than leaving the stage empty.
    let pose: Record<string, number> = {};
    try { pose = deps.pose?.() ?? {}; } catch { /* she stands as she comes */ }
    return json(res, 200, { entry: model ? filePath.basename(model.entry) : null, pose });
  }

  if (req.method === 'GET' && LIB_FILES[path]) {
    const folder = deps.libFolder();
    const file = folder && fileAt(folder, LIB_FILES[path]);
    if (!file) return json(res, 404, { error: 'The Live2D runtime is not in this build.' });
    return sendFile(res, file, 'text/javascript; charset=utf-8');
  }

  // Her face, one SVG per emotion, served as it is. By name off an allowlist —
  // the folder holds nothing else, but the route must not rely on that — and
  // behind the login like the model: it is her artwork.
  if (req.method === 'GET' && path.startsWith('/emotions/')) {
    const name = decodeURIComponent(path.slice('/emotions/'.length)).replace(/\.svg$/, '');
    const wanted = emotionFile(name);
    const folder = deps.emotionsFolder();
    const file = wanted && folder ? fileAt(folder, wanted) : null;
    if (!file) return json(res, 404, { error: 'No such face.' });
    return sendFile(res, file, 'image/svg+xml; charset=utf-8');
  }

  if (req.method === 'GET' && path.startsWith('/model/')) {
    const model = deps.model();
    if (!model) return json(res, 404, { error: 'No model.' });
    const file = fileWithin(model.root, path.slice('/model/'.length));
    if (!file) return json(res, 404, { error: 'Not part of the model.' });
    // The manifest is handed over with its expressions filled in, when it has
    // none of its own. Anya ships twenty-two .exp3.json files and declares not
    // one of them, so every runtime that reads the manifest — this one included
    // — believes she has no face at all. Done here rather than by editing the
    // file, because the model is somebody's paid asset and rewriting it to make
    // our feature work is not ours to do.
    if (file === filePath.resolve(model.entry)) {
      return send(res, 200, JSON.stringify(withExpressions(file, model.root)), 'application/json; charset=utf-8');
    }
    return sendFile(res, file, MODEL_TYPES[filePath.extname(file).toLowerCase()] ?? 'application/octet-stream');
  }

  if (req.method === 'POST' && path === '/api/logout') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[SESSION_COOKIE]) sessions.delete(cookies[SESSION_COOKIE]);
    if (me.device) deps.saveAccess({ ...deps.readAccess(), devices: deps.readAccess().devices.filter(d => d.id !== me.device!.id) });
    setCookie(res, SESSION_COOKIE, '', 0);
    setCookie(res, DEVICE_COOKIE, '', 0);
    return json(res, 200, { ok: true });
  }

  // Everything past here changes or reveals something, so it must be a real
  // request from her own page rather than a form somebody else submitted.
  // A recording and an attached file are the two things posted here that are
  // not JSON; each checks its own body below rather than being waved through.
  if (req.method === 'POST' && path !== '/api/listen' && path !== '/api/attach' && path !== '/api/activity/shots' && path !== '/api/voice/enrol' && path !== '/api/speaker/enroll' && path !== '/api/speaker/validate' && !/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return json(res, 415, { error: 'Send JSON.' });
  }

  if (req.method === 'GET' && path === '/api/chat') {
    const messages = await withChatThread(readThread(url.searchParams.get('thread')), () => deps.history(url.searchParams.get('poll') === '1'));
    return json(res, 200, { messages: messages.slice(-60) });
  }

  // Whether a call can be placed, on which engine, and how much of today's allowance is left.
  if (req.method === 'GET' && (path === '/api/call/status' || path === '/api/evi/status')) {
    return json(res, 200, deps.evi ? deps.evi.status() : { enabled: false, engine: 'none', minutesToday: 0, cap: 0, reason: 'not built' });
  }

  if (req.method === 'POST' && path === '/api/attention/input') {
    const report = readActivityReport(await readBody(req));
    if (!report) {
      return json(res, 400, { error: 'Expected an input signal.' });
    }
    // The source stays in memory inside the observation registry, never in
    // diagnostic output. Scope client sequence numbers to authenticated callers.
    deps.attentionInput?.(me.source, report);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && path === '/api/chat/receipt') {
    const intake = durableIntakes.get(deps);
    if (intake) {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) return json(res,400,{error:'Invalid request ID.'});
      try {
        const receipt = await intake.get(id,deps.slate()?.at ?? 'none');
        // 4460: retries are not in the durable intake; their receipts are the in-memory ones below.
        const retried = receipt ? undefined : receiptsFor(deps).get(id, deps.slate()?.at ?? 'none');
        if (retried) return json(res, 200, publicReceipt(retried));
        return json(res,receipt ? 200 : 404,receipt ?? {state:'unknown'});
      } catch { return json(res,503,{error:'Delivery status is temporarily unavailable.'}); }
    }
    const entry = receiptsFor(deps).get(url.searchParams.get('id') ?? '', deps.slate()?.at ?? 'none');
    return json(res, entry ? 200 : 404, entry ? publicReceipt(entry) : { state: 'unknown' });
  }
  if (req.method === 'POST' && path === '/api/local/profile') {
    const options = coreServiceOptions();
    if (!options || !me.device) return json(res, 503, { error: 'Local profile unavailable.' });
    try {
      const response = await new CoreServiceClient(options).phoneProfile({ deviceId: me.device.id, owner: coreAdapterOwner(), nowMs: Date.now() });
      return json(res, response.status, await response.json());
    } catch { return json(res, 503, { error: 'Local profile unavailable.' }); }
  }
  // Coding mode: his own conversation with the coder, on routes of its own so it never waits in, or writes to, her chat.
  if (path.startsWith('/api/code/')) {
    const code = deps.code;
    if (!code) return json(res, 404, { error: 'Coding mode is not set up on this server.' });
    if (req.method === 'POST' && req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'same_origin_required' });
    if (req.method === 'POST' && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'same_origin_required' }); }
      catch { return json(res, 403, { error: 'same_origin_required' }); }
    }
    res.setHeader('Cache-Control', 'no-store');
    const route = `${req.method} ${path.slice('/api/code/'.length)}`;
    if (route === 'GET events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
      res.flushHeaders();
      const emit = (value: unknown) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': waiting\n\n'); }, 10000); heartbeat.unref();
      let stop: (() => void) | null = null;
      res.once('close', () => { clearInterval(heartbeat); stop?.(); });
      try { stop = await code.subscribe(emit); if (!stop || res.destroyed) { stop?.(); clearInterval(heartbeat); res.end(); } }
      catch (error) { emit({ kind: 'error', id: 'stream', text: error instanceof Error ? error.message : 'The coder is not answering.' }); clearInterval(heartbeat); res.end(); }
      return;
    }
    let body: any = {};
    if (req.method === 'POST') { try { body = await readBody(req, 64 * 1024) ?? {}; } catch { return json(res, 400, { error: 'Bad request.' }); } }
    const text = (key: string) => typeof body[key] === 'string' ? body[key] : '';
    try {
      switch (route) {
        case 'GET state': return json(res, 200, await code.state());
        case 'GET diff': return json(res, 200, code.diff());
        case 'POST session': return json(res, 200, await code.start(text('folder'), text('model') || undefined));
        case 'POST prompt': return json(res, 200, await code.prompt(text('text')));
        case 'POST model': return json(res, 200, await code.model(text('model')));
        case 'POST permission': return json(res, 200, await code.permission(text('id'), text('decision')));
        case 'POST shell': return json(res, 200, await code.shell(text('command')));
        case 'POST stop': return json(res, 200, await code.stop());
        case 'POST leave': return json(res, 200, code.leave());
        case 'GET sessions': return json(res, 200, await code.sessions());
        case 'POST resume': return json(res, 200, await code.resume(text('id')));
        case 'POST archive': return json(res, 200, code.archive(text('id'), body.archived !== false));
        case 'POST delete': return json(res, 200, await code.remove(text('id')));
      }
    } catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : 'The coder is not answering.' }); }
    return json(res, 404, { error: 'Nothing here.' });
  }

  // Fixed authenticated transport; the body cannot supply owner or device identity.
  if (req.method === 'POST' && path === '/api/local/task') {
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'same_origin_required' });
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'same_origin_required' }); }
      catch { return json(res, 403, { error: 'same_origin_required' }); }
    }
    const body: any = await readBody(req, 24000);
    const options = coreServiceOptions();
    if (!options || !me.device) return json(res, 503, { error: 'Phone task service unavailable.' });
    const controller = new AbortController();
    const close = () => controller.abort();
    res.once('close', close);
    try {
      const affect = await admitAffect([{ role: 'user', content: body.text }], { eventId: body.requestId, signal: controller.signal });
      if (affect?.reply) {
        await affectOutcome(affect, affect.status);
        return json(res, 200, { version: 1, requestId: body.requestId, status: affect.status, answer: affect.reply.replace(/^\[[^\]]+\]\s*/, ''), ran: [], sources: [] });
      }
      const response = await new CoreServiceClient(options).phoneTask({ version: 1, affectEventId: affect?.eventId, text: body.text, requestId: body.requestId,
        deviceId: me.device.id, owner: coreAdapterOwner(), nowMs: Date.now() }, controller.signal);
      const result = await response.json();
      return json(res, response.status, result);
    } catch { if (!res.destroyed) return json(res, 503, { error: 'Task result unavailable. This request was not replayed.' }); }
    finally { res.removeListener('close', close); }
    return;
  }

  if (req.method === 'POST' && path === '/api/chat') {
    const body = await readBody(req) as { text?: unknown; attachments?: unknown; requestId?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const zoneHeader=req.headers['x-haru-timezone'];
    const phoneTimeZone=typeof zoneHeader==='string'&&zoneHeader.length<=80?zoneHeader:undefined;
    const files = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_FILES) : [];
    if (!text && !files.length) return json(res, 400, { error: 'Say something.' });
    const thread = readThread(url.searchParams.get('thread'));
    if (durableIntakes.has(deps)) return durableChat(req,res,deps,{text,files,mode:'plain',...(phoneTimeZone?{phoneTimeZone}:{}),...(thread==='desk'?{thread}:{})},body.requestId);
    const answer = await withChatThread(thread, () => deps.say(text, files, phoneTimeZone?{phoneTimeZone}:undefined));
    return json(res, 200, answer);
  }

  // The same chat, as a stream. A phone that waits for the whole reply waits in
  // silence; a phone that watches the words arrive reads "she is thinking" as
  // "she is answering". Kept as a separate route so the plain /api/chat above
  // stays for the terminal client, which has nothing to gain from a stream.
  if (req.method === 'POST' && path === '/api/chat/stream') {
    const body = await readBody(req) as { text?: unknown; attachments?: unknown; interrupted?: unknown; replyTo?: unknown; quoted?: unknown; requestId?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const zoneHeader=req.headers['x-haru-timezone'];
    const phoneTimeZone=typeof zoneHeader==='string'&&zoneHeader.length<=80?zoneHeader:undefined;
    // Said over her, while she was still speaking: she is told so.
    const interrupted = body.interrupted === true;
    // Which line of hers this answers, when the phone says. Only a claim: it is
    // checked against what she actually said before anything is made of it
    // (replyto.ts), and bounded here so a page cannot send her an essay as a quote.
    const replyTo = typeof body.replyTo === 'string' ? body.replyTo.slice(0, 80) : undefined;
    const quoted = typeof body.quoted === 'string' ? body.quoted.slice(0, 400) : undefined;
    // A file with nothing typed is still a message — the desktop lets a picture
    // be the whole of what is said, and she reacts to it.
    const files = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_FILES) : [];
    if (!text && !files.length) return json(res, 400, { error: 'Say something.' });
    const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;
    if (body.requestId !== undefined && (!requestId || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId))) return json(res, 400, { error: 'Invalid request ID.' });
    const thread = readThread(url.searchParams.get('thread'));
    if (durableIntakes.has(deps)) return durableChat(req,res,deps,{text,files,mode:'stream',interrupted,...(phoneTimeZone?{phoneTimeZone}:{}),...(replyTo ? {replyTo} : {}),...(quoted ? {quoted} : {}),...(thread==='desk'?{thread}:{})},body.requestId);
    const timingId = requestId ?? `web-${receivedAt}`;
    console.log(`[web-reply-timing] ${JSON.stringify({ request: timingId, stage: 'received', at: receivedAt })}`);
    let receipt: ChatReceipt | undefined;
    let fresh = true;
    if (requestId) {
      try {
        const input = createHash('sha256').update(JSON.stringify({ text, files, interrupted, replyTo, quoted, ...(phoneTimeZone?{phoneTimeZone}:{}) })).digest('hex');
        const started = receiptsFor(deps).begin(requestId, input, deps.slate()?.at ?? 'none');
        receipt = started.entry; fresh = started.fresh;
      } catch (error) {
        return json(res, (error as Error).message === 'receipt_conflict' ? 409 : 429, { error: 'That request cannot be accepted.' });
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    const emit = (value: unknown) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
    if (requestId) emit({ accepted: true, requestId });
    res.flushHeaders();
    if (!fresh && receipt) {
      if (receipt.state === 'done') emit({ done: true, reply: receipt.reply, ignored: receipt.ignored });
      else if (receipt.state === 'error') emit({ error: receipt.error });
      else emit({ pending: true });
      return res.end();
    }
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': waiting\n\n'); }, 10_000);
    heartbeat.unref();
    res.once('close', () => clearInterval(heartbeat));
    if (requestId) console.log(`[web-chat] accepted ${requestId}`);
    try {
      let visible = false;
      const answer = await withChatThread(thread, () => deps.sayStream(text, chunk => {
        emit({ text: chunk });
        if (!visible && chunk && chunk !== '\uFFFD') {
          visible = true;
          console.log(`[web-reply-timing] ${JSON.stringify({ request: timingId, stage: 'text_event', elapsedMs: Date.now() - receivedAt, connected: !res.destroyed })}`);
        }
      }, files, { interrupted, ...(phoneTimeZone?{phoneTimeZone}:{}), ...(replyTo ? { replyTo } : {}), ...(quoted ? { quoted } : {}) }, (sentence, emotion) => emit({ sentence, emotion })));
      if (receipt) Object.assign(receipt, { state: 'done', reply: answer.reply, ignored: Boolean(answer.ignored) });
      if (requestId) console.log(`[web-chat] completed ${requestId} connected=${!res.destroyed}`);
      emit({ done: true, reply: answer.reply, ignored: Boolean(answer.ignored) });
      console.log(`[web-reply-timing] ${JSON.stringify({ request: timingId, stage: 'complete', elapsedMs: Date.now() - receivedAt })}`);
    } catch (error) {
      console.error('[web] ' + (error instanceof Error ? error.message : String(error)));
      if (receipt) Object.assign(receipt, { state: 'error', error: 'Her reply failed. Check the conversation before sending again.' });
      emit({ error: error instanceof Error ? error.message : String(error) });
    } finally { clearInterval(heartbeat); }
    return res.end();
  }

  if (req.method === 'POST' && path === '/api/chat/nudge-feedback') {
    const body = await readBody(req) as { id?: unknown; choice?: unknown } | null;
    if (!body || typeof body.id !== 'string' || !body.id.trim() || body.id.length > 80 || !validNudgePreference(body.choice)) {
      return json(res, 400, { error: 'Choose a nudge and valid feedback.' });
    }
    let aside: Aside | null | undefined;
    try { aside = await deps.nudgeFeedback?.(body.id, body.choice); }
    catch (error) { return json(res, error instanceof Error && error.message === 'core_nudge_state_changed' ? 409 : 503, { error: 'Feedback was not saved. Try again.' }); }
    if (!aside) return json(res, 404, { error: 'That nudge is no longer available.' });
    return json(res, 200, { ok: true, id: aside.id, choice: aside.nudgeFeedback ?? null });
  }

  // What they thought of a reply. A thumb, a note, or both; the reply is named
  // by the id the history handed out, so nothing here trusts the page's text.
  // 4570: only the desk's conversation can be started again from here; the
  // phone's is the day's, and the 5am roll is what ends it.
  if (req.method === 'POST' && path === '/api/chat/new') {
    if (readThread(url.searchParams.get('thread')) !== 'desk' || !deps.newDeskChat) return json(res, 400, { error: 'Only the desk starts a new chat.' });
    return json(res, 200, deps.newDeskChat());
  }

  if (req.method === 'POST' && path === '/api/chat/rate') {
    const body = await readBody(req) as { id?: unknown; reaction?: unknown; note?: unknown };
    const id = typeof body.id === 'string' ? body.id.trim().slice(0, 80) : '';
    const reaction = body.reaction === 'up' || body.reaction === 'down' ? body.reaction : null;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : undefined;
    if (!id) return json(res, 400, { error: 'Which reply?' });
    if (!reaction && note === undefined) return json(res, 400, { error: 'A thumb or a note.' });
    let rated;
    try { rated = await withChatThread(readThread(url.searchParams.get('thread')), () => deps.rate(id, reaction, note)); }
    catch { return json(res, 503, { error: 'Feedback could not be confirmed. Refresh the conversation before rating again.' }); }
    if (!rated) return json(res, 404, { error: 'No such reply of hers.' });
    return json(res, 200, { ok: true, line: rated.line });
  }

  // What was wrong with a reply, and what he would rather have had. A thumb is
  // for her; this is for him. It is written to the tuning log and nowhere else,
  // which is why it gets a door of its own rather than another field on rate:
  // the two must not be able to leak into one another.
  if (req.method === 'POST' && path === '/api/chat/tune') {
    const body = await readBody(req) as { id?: unknown; wrong?: unknown; rather?: unknown };
    const id = typeof body.id === 'string' ? body.id.trim().slice(0, 80) : '';
    const wrong = typeof body.wrong === 'string' ? body.wrong : undefined;
    const rather = typeof body.rather === 'string' ? body.rather : undefined;
    if (!id) return json(res, 400, { error: 'Which reply?' });
    if (wrong === undefined && rather === undefined) return json(res, 400, { error: 'What was wrong, or what you would rather.' });
    let saved;
    try { saved = deps.tune(id, wrong, rather); }
    catch { return json(res, 503, { error: 'Tuning note could not be confirmed. Check the saved notes before sending it again.' }); }
    if (!saved) return json(res, 404, { error: 'No such reply of hers, or nothing said about it.' });
    return json(res, 200, { ok: true });
  }

  // Her last reply, done again. Same stream as above; the page swaps the bubble
  // rather than adding one. A reply she never gave cannot be given again.
  if (req.method === 'POST' && path === '/api/chat/retry') {
    // 4460: a retry carries a request ID like a send, so a phone whose stream drops can ask /api/chat/receipt how it ended.
    // Kept in memory only (retry never went through the durable intake); a restart forgets it and the phone falls back.
    const body = await readBody(req).catch(() => null) as { requestId?: unknown } | null;
    const requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;
    if (body?.requestId !== undefined && (!requestId || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId))) return json(res, 400, { error: 'Invalid request ID.' });
    let receipt: ChatReceipt | undefined;
    let fresh = true;
    if (requestId) {
      try {
        const started = receiptsFor(deps).begin(requestId, 'retry', deps.slate()?.at ?? 'none');
        receipt = started.entry; fresh = started.fresh;
      } catch (error) {
        return json(res, (error as Error).message === 'receipt_conflict' ? 409 : 429, { error: 'That request cannot be accepted.' });
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    const emit = (value: unknown) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
    if (!fresh && receipt) {
      if (receipt.state === 'done') emit({ done: true, reply: receipt.reply, ignored: receipt.ignored });
      else if (receipt.state === 'error') emit({ error: receipt.error });
      else emit({ pending: true });
      return res.end();
    }
    try {
      const answer = await deps.retryStream(chunk => emit({ text: chunk }), (sentence, emotion) => emit({ sentence, emotion }));
      if (!answer) {
        if (receipt) Object.assign(receipt, { state: 'error', error: 'There is nothing of hers to do again.' });
        emit({ error: 'There is nothing of hers to do again.' });
      } else {
        if (receipt) Object.assign(receipt, { state: 'done', reply: answer.reply, ignored: Boolean(answer.ignored) });
        emit({ done: true, reply: answer.reply, ignored: Boolean(answer.ignored) });
      }
    } catch (error) {
      console.error('[web] ' + (error instanceof Error ? error.message : String(error)));
      if (receipt) Object.assign(receipt, { state: 'error', error: 'Her reply failed. Check the conversation before sending again.' });
      emit({ error: error instanceof Error ? error.message : String(error) });
    }
    return res.end();
  }

  // Her face, on the same terms as her voice below and for the same reason.
  // Reading an expression means asking a model what a line sounds like, which is
  // a second round trip; done inside /api/chat it was time the reader spent
  // looking at a waiting bubble, paid entirely so her eyebrows would be right at
  // the exact moment the text landed. Out here it costs them nothing.
  if (req.method === 'POST' && path === '/api/expression') {
    const body = await readBody(req) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json(res, 400, { error: 'Nothing to read.' });
    return json(res, 200, await deps.expression(text.slice(0, 2000)));
  }

  // Her voice. Asked for separately rather than returned with the reply,
  // because the words should be on screen while the audio is still being made —
  // a sentence that waits for its own recording arrives late and reads as lag.
  // Her name, and nothing else: a word back, in a mood, for the phone to say.
  if (req.method === 'POST' && path === '/api/wake') {
    return json(res, 200, deps.wake());
  }

  // A recorded sigh or grunt of hers, in a mood, for the gap between two
  // paragraphs — the desktop breathes there and the phone can too. Bytes, so
  // the phone plays it like a line.
  // She has gone quiet for him: no voice leaves by any of the three routes.
  // 204 rather than an error — nothing is wrong, she is simply not speaking.
  if ((path === '/api/sigh' || path === '/api/speak') && deps.quiet?.()) {
    res.writeHead(204, { 'Cache-Control': 'no-store', 'X-Haru-Quiet': '1' });
    return res.end();
  }

  // What he sent her, for the chat to show again. The name is one stage() gave
  // out; the deps side refuses anything outside her pictures folder.
  if (req.method === 'GET' && path === '/api/album') {
    res.setHeader('Cache-Control', 'no-store');
    return json(res, 200, { pictures: deps.album?.() ?? [] });
  }
  if (req.method === 'GET' && path === '/api/attach/file') {
    const file = deps.attachedFile?.(url.searchParams.get('saved') ?? '');
    if (!file) return json(res, 404, { error: 'She does not have that.' });
    res.writeHead(200, {
      'Content-Type': file.mime,
      'Content-Length': file.bytes.length,
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    });
    return res.end(Buffer.from(file.bytes));
  }

  if (req.method === 'GET' && path === '/api/sigh') {
    const emotion = (url.searchParams.get('emotion') ?? '').slice(0, 30) || null;
    const clip = await deps.sigh(emotion);
    if (!clip) return json(res, 404, { error: 'No sigh for that.' });
    res.writeHead(200, {
      'Content-Type': clip.mime || 'audio/wav',
      'Content-Length': clip.audio.length,
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return res.end(Buffer.from(clip.audio));
  }

  if (req.method === 'POST' && path === '/api/speak') {
    const body = await readBody(req) as { text?: unknown; emotion?: unknown; sigh?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    // The mood is a word off the wire; the voice side only honours one it has a clip for.
    const emotion = typeof body.emotion === 'string' ? body.emotion.slice(0, 30) : null;
    // A sigh is asked for by name, not synthesised: the page wants one of her
    // recorded breaths for the gap between two paragraphs.
    if (body.sigh === true) {
      const breath = await deps.sigh(emotion);
      if (!breath) return json(res, 404, { error: 'She has no sighs recorded.' });
      res.writeHead(200, { 'Content-Type': breath.mime || 'audio/wav', 'Content-Length': breath.audio.length, 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      return res.end(Buffer.from(breath.audio));
    }
    if (!text) return json(res, 400, { error: 'Nothing to say.' });
    const clip = await deps.speak(text.slice(0, 2000), emotion);
    if (!clip) return json(res, 503, { error: 'Her voice is not set up.' });
    res.writeHead(200, {
      'Content-Type': clip.mime || 'audio/wav',
      'Content-Length': clip.audio.length,
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return res.end(Buffer.from(clip.audio));
  }

  // The streaming half of the same door. A GET the page's <audio> element can
  // play directly, so the first sound is the first bytes instead of the whole
  // clip. Hume streams MP3 as it generates; any other engine falls back to the
  // buffered clip and sends it whole — identical sound, just not progressive.
  if (req.method === 'GET' && path === '/api/speak') {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const text = (url.searchParams.get('text') ?? '').trim().slice(0, 2000);
    const emotion = (url.searchParams.get('emotion') ?? '').slice(0, 30) || null;
    if (!text) return json(res, 400, { error: 'Nothing to say.' });
    // The client binds all chunks of one utterance to the same synthesis seed.
    // Validate only the wire value; Core still owns the voice and delivery.
    const rawSeed = url.searchParams.get('seed');
    if (rawSeed !== null && (url.searchParams.getAll('seed').length !== 1 || !/^(0|[1-9]\d{0,9})$/.test(rawSeed) || Number(rawSeed) > 2147483647)) {
      return json(res, 400, { error: 'Invalid speech seed.' });
    }
    const streamed = deps.speakStream ? await deps.speakStream(text, emotion, {
      rawPCM: url.searchParams.get('format') === 'pcm',
      ...(rawSeed !== null ? { seed: Number(rawSeed) } : {}),
    }) : null;
    if (streamed?.body) {
      if (res.destroyed) { await streamed.body.cancel(); return; }
      res.writeHead(200, {
        'Content-Type': streamed.mime || 'audio/mpeg',
        ...(streamed.mime === 'audio/pcm' && streamed.sampleRate ? { 'X-Haru-Sample-Rate': String(streamed.sampleRate) } : {}),
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      const reader = streamed.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      res.once('close', cancel);
      try {
        while (!res.destroyed) {
          const { value, done } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } catch { /* a stalled stream ends the reply, not the connection */ }
      finally { res.off('close', cancel); reader.releaseLock(); }
      return res.end();
    }
    const clip = await deps.speak(text, emotion);
    if (!clip) return json(res, 503, { error: 'Her voice is not set up.' });
    res.writeHead(200, {
      'Content-Type': clip.mime || 'audio/wav',
      'Content-Length': clip.audio.length,
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return res.end(Buffer.from(clip.audio));
  }

  // Her ears, taught. The phone had no way to tell her she keeps getting a
  // name wrong; this is it — what came back, against what was actually said.
  // The pair is narrowed to the word that differs (hearing.ts) and rewrites
  // every take after this one, calls included.
  if (req.method === 'GET' && path === '/api/hearing') {
    return json(res, 200, { corrections: deps.corrections() });
  }
  if (req.method === 'POST' && path === '/api/hearing') {
    const body = await readBody(req) as { heard?: unknown; meant?: unknown };
    const heard = typeof body.heard === 'string' ? body.heard.trim().slice(0, 500) : '';
    const meant = typeof body.meant === 'string' ? body.meant.trim().slice(0, 500) : '';
    if (!heard || !meant) return json(res, 400, { error: 'Both what she heard and what you said.' });
    return json(res, 200, deps.teach(heard, meant));
  }
  if (req.method === 'POST' && path === '/api/hearing/forget') {
    const body = await readBody(req) as { heard?: unknown };
    const heard = typeof body.heard === 'string' ? body.heard.trim() : '';
    if (!heard) return json(res, 400, { error: 'Which one.' });
    return json(res, 200, { corrections: deps.forgetCorrection(heard) });
  }

  // Her ears. The body is a recording rather than JSON, so it is read raw and
  // capped far higher — the JSON limit is sized for a message, not for a minute
  // of audio.
  // The phone teaching her his voice (VoiceGate.swift): each "Hey Haru" he
  // says lands here as a WAV, the seeds of a wake-word model of his own voice.
  if(req.method==='POST'&&['/api/speaker/enroll','/api/speaker/validate','/api/speaker/enable','/api/speaker/disable','/api/speaker/forget'].includes(path)){
    if(!core_speaker_1.speakerEnabled())return json(res,503,{error:'Voice recognition is not installed in this runtime.'});
    const action=path.slice('/api/speaker/'.length);
    try{
      if(action==='enroll'||action==='validate'){
        const audio=await readRaw(req,970000);
        return json(res,200,await core_speaker_1.speakerRequest(action,{audio:audio.toString('base64')}));
      }
      return json(res,200,await core_speaker_1.speakerRequest(action==='forget'?'forget':'mode',action==='forget'?{}:{enabled:action==='enable'}));
    }catch(error){return json(res,422,{error:error instanceof Error?error.message:'Voice setup failed.'});}
  }
  if (req.method === 'POST' && path === '/api/voice/enrol') {
    const mime = String(req.headers['content-type'] ?? '').split(';')[0];
    if (!/^audio\//.test(mime)) return json(res, 415, { error: 'Send audio.' });
    let wav: Buffer;
    try { wav = await readRaw(req, MAX_AUDIO); } catch {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That take is too long.' });
    }
    if (wav.length < 1000) return json(res, 400, { error: 'The take was empty.' });
    if (!deps.keepVoiceTake) return json(res, 501, { error: 'This server keeps no voice takes.' });
    return json(res, 200, { kept: await deps.keepVoiceTake(wav) });
  }

  if (req.method === 'POST' && path === '/api/listen') {
    const mime = String(req.headers['content-type'] ?? 'audio/webm').split(';')[0];
    if (!/^audio\//.test(mime)) return json(res, 415, { error: 'Send audio.' });
    // Answered from the declared length before a byte is read, because refusing
    // part-way through a body that is still being sent breaks the connection
    // underneath the answer: the caller gets a reset instead of the 413 that was
    // genuinely sent. A browser posting a Blob always declares its length, so
    // this is the path that matters. The streaming cap below still stands for
    // anything chunked, which is a caller we did not write.
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_AUDIO) {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That recording is too long.' });
    }
    let audio: Buffer;
    try { audio = await readRaw(req, MAX_AUDIO); } catch {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That recording is too long.' });
    }
    if (!audio.length) return json(res, 400, { error: 'The recording was empty.' });
    if(core_speaker_1.speakerEnabled()){
      try{
        const verdict=await core_speaker_1.speakerRequest('dictation',{deviceId:me.device?.id??'session',audio:audio.toString('base64'),busy:req.headers['x-haru-speaking']==='true'});
        if(!verdict.allow)return json(res,200,{text:'',speaker:verdict.speaker,reason:verdict.reason,notice:verdict.notice});
      }catch{return json(res,503,{error:'Voice recognition is unavailable. Your recording was not sent to the conversation.'});}
    }
    const text = await deps.hear(audio, mime);
    console.log(`[web] heard ${(audio.length / 1024).toFixed(0)}KB -> ${text ? `"${text.slice(0, 60)}"` : 'nothing worth sending'}`);
    return json(res, 200, { text });
  }

  // A file for the next message. The bytes land here once and are staged the
  // way a desktop paste is — copied into her keeping, no model called — and the
  // staged record goes back to the page to ride the send. The name travels in
  // the query because the body is the file itself.
  if (req.method === 'POST' && path === '/api/attach') {
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 200);
    if (!name) return json(res, 400, { error: 'Name the file.' });
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD) {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That file is too big.' });
    }
    let bytes: Buffer;
    try { bytes = await readRaw(req, MAX_UPLOAD); } catch {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That file is too big.' });
    }
    if (!bytes.length) return json(res, 400, { error: 'The file was empty.' });
    try {
      return json(res, 200, { attachment: deps.attach.stage(name, bytes) });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : 'That could not be attached.' });
    }
  }

  // Removing a chip before sending takes the copy with it, same as the desktop.
  if (req.method === 'POST' && path === '/api/attach/discard') {
    const body = await readBody(req) as { attachment?: unknown };
    deps.attach.discard(body.attachment);
    return json(res, 200, { ok: true });
  }

  // Asked for when the page opens and while it stays open. This is how she
  // speaks first while she has their attention; the push routes below are how
  // she speaks first when she does not.
  // 4560: the desk has no brain of its own when it is pointed here. A remark it
  // wants (a poke, a fullscreen title, a notice) is composed by this one. One
  // system prompt and at most one line of theirs: never tools, never the chat.
  if (req.method === 'POST' && path === '/api/compose') {
    if (!deps.compose) return json(res, 404, { error: 'Not here.' });
    let body: { messages?: unknown; temperature?: unknown; maxTokens?: unknown };
    try { body = await readBody(req, 32768) as typeof body; } catch { return json(res, 400, { error: 'Bad request.' }); }
    const rows = Array.isArray(body.messages) ? body.messages as { role?: unknown; content?: unknown }[] : [];
    if (!rows.length || rows.length > 2 || rows[0]?.role !== 'system' || rows.some(row => !row || (row.role !== 'system' && row.role !== 'user') || typeof row.content !== 'string' || !row.content.trim() || row.content.length > 12000)) return json(res, 400, { error: 'Bad request.' });
    const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? Math.min(Math.max(body.temperature, 0), 1.5) : 0.9;
    const maxTokens = Number.isInteger(body.maxTokens) ? Math.min(Math.max(body.maxTokens as number, 16), 600) : undefined;
    try { return json(res, 200, { content: await deps.compose(rows.map(row => ({ role: row.role as 'system' | 'user', content: row.content as string })), { temperature, ...(maxTokens ? { maxTokens } : {}) }) }); }
    catch { return json(res, 503, { error: 'She could not compose that just now.' }); }
  }

  if (req.method === 'GET' && path === '/api/nudge') {
    const said = await deps.nudge();
    return json(res, 200, said ?? { line: null });
  }

  // Being told about her when nothing of hers is open. What is stored is the
  // phone's own endpoint and public keys — revealing nothing — and what goes
  // out later is sealed to that phone, so the push service ferries it unread.
  // Where they are. The page holds the coordinates; this side holds names and
  // a yes or no. Nothing is taken while sharing is off, so a phone that kept
  // watching after the switch was thrown here changes nothing.
  // Their body, from the phone: last night's sleep and today's steps, while
  // the switch says so. Two numbers a day, for one background sentence.
  if (req.method === 'GET' && path === '/api/body') return json(res, 200, deps.body.get());

  if (req.method === 'POST' && path === '/api/body/prefs') {
    const body = await readBody(req) as { enabled?: unknown };
    deps.body.enable(body.enabled === true);
    return json(res, 200, deps.body.get());
  }

  if (req.method === 'POST' && path === '/api/body') {
    if (!deps.body.get().enabled) return json(res, 409, { error: 'That is switched off.' });
    if (!deps.body.report(await readBody(req))) return json(res, 400, { error: 'That is not a report.' });
    return json(res, 200, deps.body.get());
  }

  if (req.method === 'GET' && path === '/api/where') {
    return json(res, 200, deps.where.get());
  }

  if (req.method === 'POST' && path === '/api/where/prefs') {
    const body = await readBody(req) as { enabled?: unknown };
    deps.where.enable(body.enabled === true);
    return json(res, 200, deps.where.get());
  }

  if (req.method === 'POST' && path === '/api/where') {
    if (!deps.where.get().enabled) return json(res, 409, { error: 'Sharing is off.' });
    if (!deps.where.report(await readBody(req))) return json(res, 400, { error: 'That is not a place on Earth.' });
    return json(res, 200, deps.where.get());
  }

  if (req.method === 'POST' && path === '/api/where/name') {
    const body = await readBody(req) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
    if (!name) return json(res, 400, { error: 'Call it something.' });
    if (!deps.where.name(name)) return json(res, 409, { error: 'The phone has not said where it is yet.' });
    return json(res, 200, deps.where.get());
  }

  if (req.method === 'GET' && path === '/api/google') return json(res, 200, deps.google.status());
  if (req.method === 'POST' && path === '/api/google/connect') {
    try { return json(res, 200, await deps.google.connect()); }
    catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : 'Could not start the sign-in.' }); }
  }
  if (req.method === 'GET' && path === '/api/revoice') return json(res, 200, deps.revoice.status());
  if (req.method === 'POST' && path === '/api/revoice') return json(res, 200, await deps.revoice.run());

  if (req.method === 'POST' && path === '/api/where/forget') {
    const body = await readBody(req) as { name?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim()) return json(res, 400, { error: 'Which place?' });
    deps.where.forget(body.name);
    return json(res, 200, deps.where.get());
  }

  if (req.method === 'POST' && path === '/api/where/lookup') {
    try { return json(res, 200, { name: await deps.where.lookUp() }); }
    catch (error) { return json(res, 502, { error: (error as Error).message }); }
  }

  if (req.method === 'GET' && path === '/api/push') {
    return json(res, 200, { key: deps.push.key(), prefs: deps.push.prefs() });
  }

  if (req.method === 'POST' && path === '/api/push/subscribe') {
    const body = await readBody(req) as { endpoint?: unknown; p256dh?: unknown; auth?: unknown };
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body.p256dh === 'string' ? body.p256dh : '';
    const auth = typeof body.auth === 'string' ? body.auth : '';
    // The endpoint is a URL this server will later POST to, so it is held to
    // the exact shape a push service hands out: https, and keys that decode to
    // a P-256 point and a 16-byte secret. Anything else is not a subscription.
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 2048) return json(res, 400, { error: 'That is not a push endpoint.' });
    if (Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(auth, 'base64url').length !== 16) {
      return json(res, 400, { error: 'Those are not subscription keys.' });
    }
    deps.push.subscribe({ endpoint, p256dh, auth }, me.device?.name ?? 'a phone', me.device?.id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && path === '/api/push/apns') {
    const body = await readBody(req) as { token?: unknown; sandbox?: unknown };
    if (!isDeviceToken(body.token)) return json(res, 400, { error: 'That is not a device token.' });
    deps.push.subscribeApns(body.token.toLowerCase(), me.device?.name ?? 'an iPhone', body.sandbox === true, me.device?.id);
    return json(res, 200, { ok: true, ready: deps.push.apnsReady() });
  }

  if (req.method === 'POST' && path === '/api/push/apns/unsubscribe') {
    const body = await readBody(req) as { token?: unknown };
    if (!isDeviceToken(body.token)) return json(res, 400, { error: 'Which one?' });
    deps.push.unsubscribeApns(body.token.toLowerCase());
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && path === '/api/push/unsubscribe') {
    const body = await readBody(req) as { endpoint?: unknown };
    if (typeof body.endpoint !== 'string' || !body.endpoint) return json(res, 400, { error: 'Which one?' });
    deps.push.unsubscribe(body.endpoint);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && path === '/api/push/prefs') {
    // The reader, not the body, decides what a preference is allowed to be;
    // a body that names only some of them leaves the rest as they were, so
    // the Focus filter's one flag does not reset the sheet's switches.
    const current = deps.push.prefs() as unknown as Record<string, unknown>;
    const wanted = await readBody(req) as Record<string, unknown>;
    deps.push.savePrefs(readPushPrefs({ ...current, ...wanted }));
    return json(res, 200, { prefs: deps.push.prefs() });
  }

  if (req.method === 'POST' && path === '/api/push/test') {
    return json(res, 200, { delivered: await deps.push.test() });
  }

  // Her screen, the desk's portrait monitor: what she has put up since the
  // desk last asked. The desk asks every so often and after each reply.
  if (req.method === 'GET' && path === '/api/screen') {
    const since = Number(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('since')) || 0;
    return json(res, 200, { panels: deps.screen(since), now: Date.now() });
  }

  if (req.method === 'GET' && path === '/api/agenda') return json(res, 200, { items: deps.agenda() });

  // The phone's own list writes back: a reminder added to the Haru list in
  // Apple Reminders arrives here and becomes a task of hers, so the two lists
  // stay one list (Reminders.swift in haru-ios). A title and a bare date; a
  // clock is optional and read as either "9:00 AM" or "09:00".
  if (req.method === 'POST' && path === '/api/agenda') {
    const body = await readBody(req) as { title?: unknown; date?: unknown; time?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '';
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '';
    const time = typeof body.time === 'string' && body.time.trim() ? body.time.trim() : undefined;
    if (!title || !date) return json(res, 400, { error: 'A title and a date, please.' });
    const item = deps.addAgenda(title, date, time);
    if (!item) return json(res, 400, { error: 'That time does not read as one.' });
    return json(res, 200, { item, items: deps.agenda() });
  }

  if (req.method === 'POST' && path === '/api/agenda/done') {
    const body = await readBody(req) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) return json(res, 400, { error: 'Which one?' });
    await deps.tickOff(body.id);
    return json(res, 200, { items: deps.agenda() });
  }

  if (req.method === 'GET' && path === '/api/status') return json(res, 200, deps.standing());
  if (req.method === 'GET' && path === '/api/diary') return json(res, 200, { entries: deps.diary() });
  if (req.method === 'GET' && path === '/api/her') return json(res, 200, deps.her());

  if (req.method === 'GET' && path === '/api/memory') return json(res, 200, { memories: deps.memories() });

  // The other half of her, kept level. Both machines write memories — one from
  // the phone, one from the desk — and these two routes are how each finds out
  // what the other learned. Behind the same login as everything else, and only
  // ever reached over the tailnet: the desk refuses to dial anything that is
  // not one (checkinsource.ts), and these notes are no less hers than that.
  if (req.method === 'GET' && path === '/api/memory/records') {
    // The slate travels with the records. A body that sees one newer than its
    // own clears itself to match, which is the only way forgetting crosses a
    // merge that only ever adds and updates — see blankslate.ts.
    return json(res, 200, { memories: deps.memoryRecords(), deletions: deps.memoryDeletions?.() ?? [], slate: deps.slate() });
  }

  // What they were doing, as opposed to what they said about it. Pushed by the
  // desk, which is the only machine with a foreground window; the server keeps
  // it so the day pass there has the same material the desk's does.
  if (req.method === 'GET' && path === '/api/activity') {
    return json(res, 200, { activity: deps.activityLog() });
  }

  // What she was looking at, not only what it was called. The desk asks first
  // and sends the difference, so a reconnect after a week off does not re-send
  // the week.
  if (req.method === 'GET' && path === '/api/activity/shots') {
    return json(res, 200, { shots: deps.shots.held() });
  }

  if (req.method === 'POST' && path === '/api/activity/shots') {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_SHOT_BYTES) {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That screenshot is too big.' });
    }
    let bytes: Buffer;
    try { bytes = await readRaw(req, MAX_SHOT_BYTES); } catch {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That screenshot is too big.' });
    }
    try {
      // The day and the name are the sender's claim, and shotstore treats them
      // as one — a name it will not accept is refused, never repaired.
      deps.shots.keep(url.searchParams.get('day'), url.searchParams.get('name'), bytes);
      return json(res, 200, { kept: true });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : 'That could not be kept.' });
    }
  }

  if (req.method === 'POST' && path === '/api/activity') {
    const body = await readBody(req, MAX_SYNC_BODY) as { activity?: unknown };
    if (!body.activity || typeof body.activity !== 'object' || Array.isArray(body.activity)) {
      return json(res, 400, { error: 'Send a log keyed by day.' });
    }
    return json(res, 200, deps.mergeActivity(body.activity));
  }

  if (req.method === 'POST' && path === '/api/memory/records') {
    const body = await readBody(req, MAX_SYNC_BODY) as { memories?: unknown; deletions?: unknown };
    if (!Array.isArray(body.memories)) return json(res, 400, { error: 'Send a list of memories.' });
    const merged = deps.mergeMemories(body.deletions === undefined ? body.memories : body);
    return json(res, 200, { ...merged, memories: deps.memoryRecords(), deletions: deps.memoryDeletions?.() ?? [] });
  }

  // Little notes taken while the day happens. Separate from the journal on
  // purpose: one is written about a day, the other during it.
  if (req.method === 'GET' && path === '/api/checkins') return json(res, 200, { entries: deps.checkIns() });

  if (req.method === 'POST' && path === '/api/checkins') {
    const body = await readBody(req) as { note?: unknown; anxiety?: unknown };
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) return json(res, 400, { error: 'Write something.' });
    const anxiety = typeof body.anxiety === 'number' && body.anxiety >= 1 && body.anxiety <= 10 ? Math.round(body.anxiety) : undefined;
    return json(res, 200, { entries: deps.addCheckIn(note.slice(0, 1000), anxiety) });
  }


  // Her own knowledge store: what she has been given to read, searched or
  // inspected from the terminal. Same auth as everything else here.
  if (req.method === 'POST' && path === '/api/knowledge/search') {
    const body = await readBody(req) as { query?: unknown; category?: unknown };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return json(res, 400, { error: 'query is required.' });
    return json(res, 200, await deps.knowledge.search(query, typeof body.category === 'string' ? body.category : undefined));
  }

  if (req.method === 'GET' && path === '/api/knowledge/stats') {
    return json(res, 200, deps.knowledge.stats());
  }

  if (req.method === 'POST' && path === '/api/knowledge/ingest') {
    const body = await readBody(req) as { path?: unknown; category?: unknown };
    const file = typeof body.path === 'string' ? body.path.trim() : '';
    if (!file) return json(res, 400, { error: 'path is required.' });
    return json(res, 200, await deps.knowledge.ingest(file, typeof body.category === 'string' ? body.category : undefined));
  }

  if (req.method === 'POST' && path === '/api/knowledge/delete') {
    const body = await readBody(req) as { source?: unknown };
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    if (!source) return json(res, 400, { error: 'source is required.' });
    return json(res, 200, await deps.knowledge.deleteDocument(source));
  }

  if (req.method === 'POST' && path === '/api/knowledge/reindex') {
    const body = await readBody(req) as { source?: unknown };
    return json(res, 200, await deps.knowledge.reindex(typeof body.source === 'string' ? body.source.trim() : undefined));
  }

  // An Obsidian vault: walked, ingested, and remembered so it can re-sync.
  if (req.method === 'POST' && path === '/api/knowledge/vault') {
    const body = await readBody(req) as { path?: unknown };
    const vault = typeof body.path === 'string' ? body.path.trim() : '';
    if (!vault) return json(res, 400, { error: 'path is required.' });
    return json(res, 200, await deps.knowledge.vault(vault));
  }

  return json(res, 404, { error: 'Nothing here.' });
}

async function login(req: IncomingMessage, res: ServerResponse, deps: WebDeps, access: WebAccess, now: Date) {
  // Keyed by the address the tunnel reports, falling back to one shared bucket.
  // A shared bucket is the safe direction to be wrong in: it slows everybody
  // down under attack rather than letting each new source start fresh.
  const from = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? 'unknown');
  const attempts = attemptsBy.get(from) ?? clearFailures();
  const wait = lockedFor(attempts, now.getTime());
  if (wait > 0) return json(res, 429, { error: `Too many tries. Wait ${Math.ceil(wait / 1000)}s.` });

  let body: { username?: unknown; password?: unknown; remember?: unknown; device?: unknown };
  try { body = await readBody(req) as typeof body; } catch { return json(res, 400, { error: 'Bad request.' }); }
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // The username is compared too, but a wrong one is not said to be wrong —
  // "no such user" tells a stranger which half to keep working on.
  const right = username.toLowerCase() === access.username.toLowerCase() && passwordMatches(password, access);
  if (!right) {
    attemptsBy.set(from, noteFailure(attempts, now.getTime()));
    console.warn(`[web] refused a sign-in from ${from}`);
    return json(res, 401, { error: 'That is not right.' });
  }

  attemptsBy.set(from, clearFailures());
  const token = newToken();
  if (body.remember) {
    const name = typeof body.device === 'string' ? body.device : '';
    deps.saveAccess(rememberDevice(deps.readAccess(), token, name, now));
    setCookie(res, DEVICE_COOKIE, token, DEVICE_DAYS * 86_400);
    console.log(`[web] signed in and remembered "${name || 'a device'}"`);
  } else {
    sessions.set(token, now.getTime() + SESSION_MS);
    setCookie(res, SESSION_COOKIE, token, Math.floor(SESSION_MS / 1000));
    console.log(`[web] signed in for this session only — from ${from}, ${String(req.headers['user-agent'] ?? 'no user agent').slice(0, 60)}`);
  }
  return json(res, 200, { ok: true });
}
