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
import { createReadStream, existsSync, statSync } from 'node:fs';
import filePath from 'node:path';
import {
  type WebAccess, passwordMatches, newToken, deviceFor, rememberDevice, touchDevice,
  noteFailure, lockedFor, clearFailures, type Attempts, DEVICE_DAYS,
} from './web';
import { loginPage, appPage } from './webpage';

export type WebDeps = {
  readAccess(): WebAccess;
  saveAccess(access: WebAccess): void;
  /** Her real answer, through the same pipeline the desktop uses — minus hands. */
  say(text: string): Promise<{ reply: string; ignored?: boolean }>;
  history(): { role: string; content: string; at?: string }[];
  agenda(): { id: string; title: string; date: string; kind: string; done?: boolean }[];
  tickOff(id: string): Promise<void> | void;
  memories(): string[];
  journal(): { date: string; text: string; mood?: number; anxiety?: number }[];
  writeJournal(entry: { text: string; mood?: number; anxiety?: number }): Promise<void> | void;
  /** Her picture, or nothing if this build has none. */
  portrait(): Buffer | null;
  /** The Live2D model to stand on the stage: the folder it lives in and its entry file. */
  model(): { root: string; entry: string } | null;
  /** Where the vendored pixi and Live2D plugin are kept. */
  libFolder(): string | null;
  /** Her voice for a line, or nothing if she has none set up. */
  speak(text: string): Promise<{ audio: Uint8Array; mime: string } | null>;
  /** What they just said, through the same ears and the same corrections as the desktop. */
  hear(audio: Uint8Array, mime: string): Promise<string>;
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
  '/lib/pixi.js': 'pixi.min.js',
  '/lib/noeval.js': 'pixi-unsafe-eval.min.js',
  '/lib/live2d.js': 'live2d.cubism4.min.js',
  '/lib/cubismcore.js': 'live2dcubismcore.min.js',
};

const SESSION_COOKIE = 'haru_session';
const DEVICE_COOKIE = 'haru_device';
/** Big enough for a long message, small enough that nobody posts a film. */
const MAX_BODY = 256 * 1024;
/** A recording is not a message. Roughly a minute of opus, and a hard stop. */
const MAX_AUDIO = 8 * 1024 * 1024;

/** Logins that were not asked to be remembered. Gone when the app closes, deliberately. */
const sessions = new Map<string, number>();
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
      "style-src 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "worker-src blob:",
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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('too much');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('not json'); }
}

async function readAudio(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_AUDIO) throw new Error('too much');
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
    if (until && until > now.getTime()) return { allowed: true as const, device: null };
    if (until) sessions.delete(session);
  }
  const device = deviceFor(access, cookies[DEVICE_COOKIE] ?? '', now);
  return device ? { allowed: true as const, device } : { allowed: false as const, device: null };
}

export function startWebServer(port: number, deps: WebDeps): Promise<{ port: number; stop(): Promise<void> }> {
  const server: Server = createServer((req, res) => { void handle(req, res, deps).catch(error => {
    console.error('[web] ' + (error instanceof Error ? error.message : String(error)));
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong.' });
  }); });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only. This is the line that keeps her off the network.
    server.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as { port: number }).port;
      console.log(`[web] listening on 127.0.0.1:${actual} — reachable only through a tunnel`);
      resolve({
        port: actual,
        stop: () => new Promise<void>(done => server.close(() => { sessions.clear(); done(); })),
      });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: WebDeps) {
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

  if (req.method === 'POST' && path === '/api/login') return login(req, res, deps, access, now);

  if (!me.allowed) {
    // Her model is not served to strangers. It is 28MB of somebody's paid asset
    // and there is no reason for the sign-in page to need it.
    if (path === '/' ) return send(res, 200, loginPage(), 'text/html; charset=utf-8');
    return json(res, 401, { error: 'Sign in first.' });
  }

  // Seen today, so a phone in daily use never gets logged out.
  if (me.device) deps.saveAccess(touchDevice(access, me.device.id, now));

  if (req.method === 'GET' && path === '/') return send(res, 200, appPage(), 'text/html; charset=utf-8');

  // The stage's moving parts, all behind the login.
  if (req.method === 'GET' && path === '/api/model') {
    const model = deps.model();
    return json(res, 200, { entry: model ? filePath.basename(model.entry) : null });
  }

  if (req.method === 'GET' && LIB_FILES[path]) {
    const folder = deps.libFolder();
    const file = folder && fileAt(folder, LIB_FILES[path]);
    if (!file) return json(res, 404, { error: 'The Live2D runtime is not in this build.' });
    return sendFile(res, file, 'text/javascript; charset=utf-8');
  }

  if (req.method === 'GET' && path.startsWith('/model/')) {
    const model = deps.model();
    if (!model) return json(res, 404, { error: 'No model.' });
    const file = fileWithin(model.root, path.slice('/model/'.length));
    if (!file) return json(res, 404, { error: 'Not part of the model.' });
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
  // A recording is the one thing posted here that is not JSON, and it checks its
  // own content type below rather than being waved through.
  if (req.method === 'POST' && path !== '/api/listen' && !/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return json(res, 415, { error: 'Send JSON.' });
  }

  if (req.method === 'GET' && path === '/api/chat') {
    return json(res, 200, { messages: deps.history().slice(-60) });
  }

  if (req.method === 'POST' && path === '/api/chat') {
    const body = await readBody(req) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json(res, 400, { error: 'Say something.' });
    const answer = await deps.say(text);
    return json(res, 200, answer);
  }

  // Her voice. Asked for separately rather than returned with the reply,
  // because the words should be on screen while the audio is still being made —
  // a sentence that waits for its own recording arrives late and reads as lag.
  if (req.method === 'POST' && path === '/api/speak') {
    const body = await readBody(req) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json(res, 400, { error: 'Nothing to say.' });
    const clip = await deps.speak(text.slice(0, 2000));
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

  // Her ears. The body is a recording rather than JSON, so it is read raw and
  // capped far higher — the JSON limit is sized for a message, not for a minute
  // of audio.
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
    try { audio = await readAudio(req); } catch {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'That recording is too long.' });
    }
    if (!audio.length) return json(res, 400, { error: 'The recording was empty.' });
    const text = await deps.hear(audio, mime);
    console.log(`[web] heard ${(audio.length / 1024).toFixed(0)}KB -> ${text ? `"${text.slice(0, 60)}"` : 'nothing worth sending'}`);
    return json(res, 200, { text });
  }

  if (req.method === 'GET' && path === '/api/agenda') return json(res, 200, { items: deps.agenda() });

  if (req.method === 'POST' && path === '/api/agenda/done') {
    const body = await readBody(req) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) return json(res, 400, { error: 'Which one?' });
    await deps.tickOff(body.id);
    return json(res, 200, { items: deps.agenda() });
  }

  if (req.method === 'GET' && path === '/api/memory') return json(res, 200, { memories: deps.memories() });

  if (req.method === 'GET' && path === '/api/journal') return json(res, 200, { entries: deps.journal().slice(-30) });

  if (req.method === 'POST' && path === '/api/journal') {
    const body = await readBody(req) as { text?: unknown; mood?: unknown; anxiety?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json(res, 400, { error: 'Write something.' });
    const rating = (value: unknown) => (typeof value === 'number' && value >= 1 && value <= 10 ? Math.round(value) : undefined);
    await deps.writeJournal({ text, mood: rating(body.mood), anxiety: rating(body.anxiety) });
    return json(res, 200, { entries: deps.journal().slice(-30) });
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
    console.log('[web] signed in for this session only');
  }
  return json(res, 200, { ok: true });
}
