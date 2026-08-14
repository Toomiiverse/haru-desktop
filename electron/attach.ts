// Showing her a file, whatever kind it is.
//
// The picture button already worked; this is the same act for everything else.
// The awkward part is that "upload it and it understands" is a property of the
// ChatGPT *product*, not of any API — no model takes a video file, and none
// takes an mp3. What the product does is pull the file apart first and send the
// models what they can actually read. So that is what happens here.
//
//   image   → straight to a vision model
//   audio   → transcribed
//   video   → a handful of frames, plus the sound transcribed
//   text    → read directly, no model needed to know what it says
//
// ffmpeg does the pulling apart. It is already on this machine, and it is the
// only way to get frames out of an mp4 or a waveform out of an m4a without
// shipping a codec.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export type FileKind = 'image' | 'audio' | 'video' | 'text' | 'unreadable';

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|ico|heic)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|opus|flac|wma|aiff?)$/i;
const VIDEO = /\.(mp4|mkv|mov|avi|webm|wmv|flv|m4v|mpe?g|ts)$/i;
/** Anything whose bytes are already words. */
const TEXT = /\.(txt|md|markdown|csv|tsv|json|jsonc|ya?ml|toml|ini|cfg|conf|log|xml|html?|css|scss|js|jsx|ts|tsx|py|rb|go|rs|java|c|h|cpp|hpp|cs|sh|ps1|sql|srt|vtt|ass)$/i;

export function classify(file: string): FileKind {
  const name = file ?? '';
  if (IMAGE.test(name)) return 'image';
  if (AUDIO.test(name)) return 'audio';
  if (VIDEO.test(name)) return 'video';
  if (TEXT.test(name)) return 'text';
  return 'unreadable';
}

/** Every extension the picker should offer, in the order the dialog lists them. */
export const OPENABLE = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'ico', 'heic'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wma', 'aiff'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg'],
  text: ['txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'yml', 'log', 'xml', 'html', 'srt', 'vtt', 'js', 'ts', 'py', 'cs', 'sql'],
};

// --- ffmpeg -----------------------------------------------------------------

/**
 * Found rather than assumed.
 *
 * winget installs it under a versioned path that is on PATH for a login shell
 * and not always for a packaged app, so PATH is tried first and the known
 * install roots after. Returning null rather than throwing lets the caller say
 * which kinds of file are unavailable instead of failing at the moment of use.
 */
export function findFfmpeg(exists = fs.existsSync, env = process.env): { ffmpeg: string; ffprobe: string } | null {
  const roots = [
    '', // on PATH
    `${env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0-full_build\\bin\\`,
    `${env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Links\\`,
    'C:\\ffmpeg\\bin\\',
    `${env.PROGRAMFILES ?? ''}\\ffmpeg\\bin\\`,
  ];
  for (const root of roots) {
    const ffmpeg = `${root}ffmpeg.exe`;
    if (root === '' || exists(ffmpeg)) return { ffmpeg, ffprobe: `${root}ffprobe.exe` };
  }
  return null;
}

function run(file: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('ffmpeg took too long')); }, timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      // ffmpeg writes everything to stderr, including success. Only the exit
      // code says whether it worked.
      if (code === 0) resolve(out || err);
      else reject(new Error(err.trim().split('\n').slice(-2).join(' ').slice(0, 200) || `ffmpeg exited ${code}`));
    });
  });
}

export function scratchDir(): string {
  const dir = path.join(os.tmpdir(), 'haru-attach');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Seconds, or 0 when the file does not say. */
export async function duration(file: string, tools: { ffprobe: string }): Promise<number> {
  try {
    const text = await run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 20_000);
    const seconds = Number(String(text).trim());
    return Number.isFinite(seconds) ? seconds : 0;
  } catch { return 0; }
}

/**
 * The sound, as the speech server wants it.
 *
 * 16kHz mono wav for the same reason the microphone records that way: it is what
 * Whisper resamples to anyway, and sending three times the bytes to have them
 * thrown away is only latency.
 */
export async function extractAudio(file: string, tools: { ffmpeg: string }, seconds = 0): Promise<string> {
  const out = path.join(scratchDir(), `sound-${Date.now()}.wav`);
  const limit = seconds > 0 ? ['-t', String(seconds)] : [];
  await run(tools.ffmpeg, ['-y', '-i', file, ...limit, '-vn', '-ar', '16000', '-ac', '1', out]);
  return out;
}

/** How many stills to take from a video. */
export const FRAMES = 4;

/**
 * Frames spread across the whole thing rather than the first few seconds.
 *
 * A video's opening is a title card or a black frame often enough that taking
 * the first N tells you nothing about it. Sampling at even intervals costs the
 * same and describes the video instead of its intro.
 */
export async function extractFrames(file: string, tools: { ffmpeg: string; ffprobe: string }, count = FRAMES): Promise<string[]> {
  const length = await duration(file, tools);
  const dir = scratchDir();
  const stamp = Date.now();
  const shots: string[] = [];
  for (let i = 0; i < count; i++) {
    // Offset into each slice rather than at its edge, so a hard cut on the
    // boundary does not give a half-rendered frame.
    const at = length > 0 ? (length * (i + 0.5)) / count : i;
    const out = path.join(dir, `frame-${stamp}-${i}.jpg`);
    try {
      // -ss before -i seeks by keyframe, which is approximate and enormously
      // faster than decoding to the timestamp.
      await run(tools.ffmpeg, ['-y', '-ss', at.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=896:-2', '-q:v', '4', out], 60_000);
      if (fs.existsSync(out) && fs.statSync(out).size > 0) shots.push(out);
    } catch { /* a frame that will not decode is not worth failing the file for */ }
  }
  return shots;
}

// --- text -------------------------------------------------------------------

/** Enough to know what a file is and what it says; far short of a whole book. */
export const MAX_TEXT = 12_000;

export function readText(file: string): string {
  const raw = fs.readFileSync(file);
  // A file claiming to be text that is full of zero bytes is not text, whatever
  // its extension says.
  if (raw.subarray(0, 1024).includes(0)) throw new Error('that looks like a binary file rather than text');
  const text = raw.toString('utf8');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(${text.length - MAX_TEXT} more characters not shown)` : text;
}

/** Tidies up the frames and wavs afterwards. Best effort; the OS clears tmp anyway. */
export function discard(files: string[]) {
  for (const file of files) { try { fs.unlinkSync(file); } catch { /* already gone */ } }
}

/**
 * What she is told about a file, given whatever could be got out of it.
 *
 * The kind is stated plainly because it changes what a sensible remark is: a
 * transcript of a voice note is not the same thing as a text file that happens
 * to contain speech, and she should not talk about "the document" when someone
 * has played her a recording of their own voice.
 */
export function attachmentPrompt(
  kind: FileKind,
  name: string,
  parts: { description?: string; transcript?: string; text?: string; seconds?: number },
  asked: string,
): string {
  const length = parts.seconds ? ` It is ${Math.round(parts.seconds)} seconds long.` : '';
  const head: Record<FileKind, string> = {
    image: `They have shown you a picture called "${name}".`,
    audio: `They have played you a sound file called "${name}".${length}`,
    video: `They have shown you a video called "${name}".${length} You have seen a few frames from across it and heard the sound.`,
    text: `They have given you a file called "${name}" to read.`,
    unreadable: `They have given you a file called "${name}".`,
  };
  const body = [
    parts.description ? `What is in it: ${parts.description}` : '',
    parts.transcript ? `What is said in it: "${parts.transcript}"` : '',
    parts.text ? `Its contents:\n${parts.text}` : '',
  ].filter(Boolean).join('\n');
  return [
    head[kind],
    body,
    asked ? `They asked: "${asked}" — answer that.` : 'React to it the way you would if they had turned the screen round to show you. Do not summarise it back at them.',
    'Never mention frames, transcripts, descriptions or file formats — as far as you are concerned you looked at it or listened to it.',
  ].filter(Boolean).join('\n\n');
}
