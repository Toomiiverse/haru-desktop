/**
 * A picture from the web, fetched once and kept beside the ones she draws, so a
 * poster or a cover she found can ride in the chat as an attachment. The address
 * never reaches a model: the outbound scanner reads image hosts' paths as keys
 * (2026-10-12), and a link in her reply would have kept every later turn local.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const WEB_PICTURE_MAX_BYTES = 8_000_000;
// Image hosts refuse a bare fetch (Fandom answered 403 on 2026-10-12): the page the picture belongs to is the referer, and a browser's name is sent.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

export type WebPicture = { id: string; file: string; bytes: number; mime: string; source: string; url: string };

export async function fetchWebPicture(url: string, source: string, folder: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<WebPicture> {
  if (!/^https:\/\//.test(url)) throw Error('web_picture_https_required');
  const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'User-Agent': UA, Referer: source } });
  if (!response.ok) throw Error(`web_picture_${response.status}`);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[mime];
  if (!ext) throw Error('web_picture_not_an_image');
  if (Number(response.headers.get('content-length') ?? 0) > WEB_PICTURE_MAX_BYTES) throw Error('web_picture_too_large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw Error('web_picture_empty');
  if (bytes.length > WEB_PICTURE_MAX_BYTES) throw Error('web_picture_too_large');
  mkdirSync(folder, { recursive: true });
  const id = randomUUID(), file = path.join(folder, `${id}.${ext}`);
  writeFileSync(file, bytes, { flag: 'wx' });
  return { id, file, bytes: bytes.length, mime, source, url };
}
