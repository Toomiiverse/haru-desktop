import {corePolicySync} from './core-policy-sync';
// What was actually said in a video.
//
// She cannot watch anything. There is no audio path from a page to a model
// here and there never was, and sampling frames off a twenty-minute video is
// not watching it — it is guessing at it, which is the failure this codebase
// keeps having to undo. But nearly every video worth talking about carries a
// caption track, and a caption track is the words. Reading those is a real
// thing she can do and be asked about afterwards.
//
// Getting the words is the hard part, and it is not done here. In 2026 YouTube
// closed the caption endpoint and the player API to anything that is not a
// signed-in browser — a plain fetch gets an empty 200, the player API says
// UNPLAYABLE, and even a real Electron window under Xvfb is told the video is
// unavailable. youtube-transcript-api is the maintained library that tracks
// exactly that churn, so a small Python bridge (transcript-bridge.py, in its
// own venv) runs it and hands back JSON. What is here is everything around
// that: reading a link, shaping the words, and what she is told with them.
//
// So: the transcript, fetched, and said to be a transcript. "I went through
// what they said in it" is true. "I watched it" is not, and she is told so.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type Caption = { atSeconds: number; text: string };

/** Long enough to be worth the tokens, short enough not to crowd the prompt. */
export const TRANSCRIPT_CHARS = 6000;

const HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;

/**
 * The video id in a link, or nothing.
 *
 * Every shape people actually paste: a watch link, a share link, a short, an
 * embed, and a live link. Anything else is not refused with a guess — an id
 * invented from a URL fetches somebody else's video, which is worse than
 * saying it cannot be read.
 */
export function videoIdFrom(link: string): string | null {
  let url: URL;
  try { url = new URL(String(link ?? '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const id = (value: string | null) => (value && /^[\w-]{11}$/.test(value) ? value : null);
  if (/^(?:www\.)?youtu\.be$/i.test(url.hostname)) return id(url.pathname.slice(1).split('/')[0]);
  if (!HOSTS.test(url.hostname)) return null;
  if (url.pathname === '/watch') return id(url.searchParams.get('v'));
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0].toLowerCase())) return id(parts[1]);
  return null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/**
 * The transcript as she will read it.
 *
 * Stamped every half minute rather than every line: the timestamps are what
 * let her say "about ten minutes in", and one per caption is four hundred of
 * them and no more information. A long video keeps its beginning and its end
 * and says where the cut is, because the middle of an hour is the least of it
 * and a silent truncation reads as the video simply stopping.
 */
export function formatTranscript(captions: Caption[], limit = TRANSCRIPT_CHARS): string {
  if((true as boolean))return corePolicySync('local-reply-defaults.transcript',[captions,arguments[1]===undefined?{supplied:false}:{supplied:true,value:arguments[1]}]);
  if((true as boolean))return corePolicySync('final-tool-values.formatTranscript',[captions,limit]);
  if (!captions.length) return '';
  const lines: string[] = [];
  let stampedAt = -Infinity;
  for (const caption of captions) {
    if (caption.atSeconds - stampedAt >= 30) { lines.push(`[${clock(caption.atSeconds)}] ${caption.text}`); stampedAt = caption.atSeconds; }
    else lines.push(caption.text);
  }
  const whole = lines.join('\n');
  if (whole.length <= limit) return whole;
  const half = Math.floor(limit / 2);
  const head = whole.slice(0, half);
  const tail = whole.slice(-half);
  return `${head}\n\n[… the middle is left out, ${Math.round((whole.length - limit) / 1000)}k characters of it …]\n\n${tail}`;
}

/** What she is handed with it, and the one thing she must not say. */
export function transcriptInstruction(title: string, generated: boolean, transcript: string): string {
  if((true as boolean))return corePolicySync('final-tool-values.transcriptInstruction',[title,generated,transcript]);
  return [
    `This is the transcript of "${title}" — the words spoken in it, nothing else.`,
    generated ? 'It was written by speech recognition, so names and unusual words in it may be wrong; treat an odd-looking one as a mishearing rather than a fact.' : '',
    transcript,
    'You read this. You did not watch the video: you have not seen a frame of it and you do not know what anything in it looks like. Say what was said in it, and if they ask about something visual, say you only went through the transcript.',
  ].filter(Boolean).join('\n');
}

const UNESCAPE: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/**
 * The title a watch page declares, for naming what she read.
 *
 * The page itself still comes back to a plain fetch — it is the captions that
 * do not — so this is the one thing still read off it.
 */
export function titleFrom(html: string): string {
  const meta = /<meta\s+name="title"\s+content="([^"]*)"/i.exec(html ?? '')
    ?? /<title>([^<]*)<\/title>/i.exec(html ?? '');
  const raw = meta?.[1] ?? '';
  return raw.replace(/&(amp|lt|gt|quot|#39|apos);/g, entity => UNESCAPE[entity] ?? entity).replace(/\s*-\s*YouTube\s*$/i, '').trim();
}

/** Where the bridge lives, and the interpreter that has the library. */
export const TRANSCRIPT_VENV = path.join(process.env.HOME ?? '', '.local', 'share', 'haru-transcripts', 'bin', 'python');
const BRIDGE_TIMEOUT_MS = 45_000;

/**
 * The bridge is a .py beside this file's *source*, and the compiled copy of
 * this file lives in dist-electron (or dist-test/electron), where no build
 * step puts it. So it is found from the project root — the nearest package.json
 * above wherever this is running from — which is the same place from every
 * one of those directories.
 */
function projectRoot(): string {
  let dir = __dirname;
  for (let up = 0; up < 6; up++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return __dirname;
}
const BRIDGE = path.join(projectRoot(), 'electron', 'transcript-bridge.py');

export type Transcript = { language: string; generated: boolean; captions: Caption[] };

/** Whether she can read transcripts on this machine at all. */
export function transcriptsAvailable(): boolean {
  return existsSync(TRANSCRIPT_VENV) && existsSync(BRIDGE);
}

/**
 * The words in a video, or a reason there are none.
 *
 * Throws rather than returning empty: an empty transcript would be handed to
 * her as "the video says nothing", and the true answer is that it could not be
 * read. The reason is kept because she is told it — "no captions on that one"
 * is worth saying, "unavailable" is worth saying differently.
 */
export function fetchTranscript(videoId: string, run: typeof execFile = execFile): Promise<Transcript> {
  if (!/^[\w-]{11}$/.test(videoId)) return Promise.reject(new Error('That is not a video id.'));
  // A runner handed in is a test's stand-in for the bridge; only the real one
  // needs the real bridge to exist.
  if (run === execFile && !transcriptsAvailable()) return Promise.reject(new Error('Transcripts are not set up on this machine.'));
  return new Promise((resolve, reject) => {
    run(TRANSCRIPT_VENV, [BRIDGE, videoId], { timeout: BRIDGE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      let parsed: { error?: string; language?: string; generated?: boolean; captions?: Caption[] } | null = null;
      try { parsed = JSON.parse(String(stdout ?? '').trim()); } catch { parsed = null; }
      if (parsed?.error) return reject(new Error(plainReason(parsed.error)));
      if (error && !parsed) return reject(new Error(error.message.includes('TIMEOUT') || (error as { killed?: boolean }).killed ? 'It took too long.' : 'The transcript reader failed.'));
      if (!parsed || !Array.isArray(parsed.captions)) return reject(new Error('The transcript reader answered with nothing usable.'));
      const captions = parsed.captions.filter(c => c && typeof c.text === 'string' && c.text.trim()).map(c => ({ atSeconds: Number(c.atSeconds) || 0, text: c.text.replace(/\s+/g, ' ').trim() }));
      if (!captions.length) return reject(new Error('There are no captions on it.'));
      resolve({ language: String(parsed.language ?? ''), generated: Boolean(parsed.generated), captions });
    });
  });
}

/** The library's exception names, said the way she would say them. */
export function plainReason(raw: string): string {
  const name = raw.split(':')[0].trim();
  const said: Record<string, string> = {
    NoTranscriptFound: 'There are no captions on it.',
    TranscriptsDisabled: 'Captions are turned off on that one.',
    VideoUnavailable: 'That video is not available.',
    VideoUnplayable: 'That video cannot be opened.',
    InvalidVideoId: 'That is not a video id.',
    IpBlocked: 'YouTube is refusing this machine right now.',
    RequestBlocked: 'YouTube is refusing this machine right now.',
    AgeRestricted: 'It is age-restricted, and she is not signed in.',
    TooManyRequests: 'YouTube wants a break — too many in a row.',
  };
  return said[name] ?? 'The transcript could not be read.';
}
