// The downloads on the server: qBittorrent, where the anime fetches land.
//
// "How are the downloads going", "pause the downloads, I'm on a call", "start
// them again" — from the desk or the phone. The Web API is asked directly:
// a login for a session cookie, the torrent list, and stop/start on all of
// them or on the ones whose name carries the show he named. qBittorrent 5
// renamed pause/resume to stop/start; the older names are tried when the new
// ones are not there. The password is read from a file of his (never held in
// her config), the way the Servarr keys are read from theirs (anime.ts).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Fetcher } from './anime';

export type DownloadsConfig = { url: string; username: string; passwordFile: string };

export const DEFAULT_DOWNLOADS: DownloadsConfig = {
  url: 'http://127.0.0.1:8080',
  username: 'admin',
  passwordFile: path.join(homedir(), '.config', 'haru', 'qbittorrent-password'),
};

/** The `anime.qbittorrent` block, read forward; null when the anime stack is off. */
export function readDownloadsConfig(anime: unknown): DownloadsConfig | null {
  if (!anime || typeof anime !== 'object' || (anime as Record<string, unknown>).enabled !== true) return null;
  const raw = ((anime as Record<string, unknown>).qbittorrent ?? {}) as Record<string, unknown>;
  const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
  return {
    url: text(raw.url, DEFAULT_DOWNLOADS.url).replace(/\/+$/, ''),
    username: text(raw.username, DEFAULT_DOWNLOADS.username),
    passwordFile: text(raw.passwordFile, DEFAULT_DOWNLOADS.passwordFile),
  };
}

/** Whether she can be asked at all: the block is on and the password file is there. */
export function downloadsReady(config: DownloadsConfig | null, exists: (file: string) => boolean = existsSync): boolean {
  return config !== null && exists(config.passwordFile);
}

type Torrent = { hash: string; name: string; state: string; progress: number; dlspeed: number; upspeed: number; eta: number; size: number; category?: string };

export type Standing = 'downloading' | 'paused' | 'stalled' | 'queued' | 'checking' | 'seeding' | 'done' | 'error';

/** qBittorrent's dozen states, as the four or five words she needs. */
export function standing(state: string): Standing {
  if (/^(pausedDL|stoppedDL)$/.test(state)) return 'paused';
  if (/^(pausedUP|stoppedUP)$/.test(state)) return 'done';
  if (/^(uploading|stalledUP|forcedUP|queuedUP)$/.test(state)) return 'seeding';
  if (/^(downloading|forcedDL|metaDL)$/.test(state)) return 'downloading';
  if (state === 'stalledDL') return 'stalled';
  if (state === 'queuedDL') return 'queued';
  if (/^checking/.test(state) || state === 'moving') return 'checking';
  return 'error';
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);

/** A release name without its tag soup: "[Group] Naruto (001-220) [BD]…" → "Naruto (001-220)". */
export function plainName(name: string): string {
  return name.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim() || name;
}

/** Whether every word of the show he named is in the torrent's name. */
export function namesShow(torrentName: string, title: string): boolean {
  const have = new Set(words(torrentName));
  const want = words(title);
  return want.length > 0 && want.every(word => have.has(word));
}

export type Known = { title: string; infoHash?: string };

export type DownloadsHost = {
  fetch: Fetcher;
  readFile?: (file: string) => string;
  /** The fetches she made herself (anime.fetches), so a release is called by its show. */
  known?: () => Known[];
};

export class Downloads {
  private sid: string | null = null;
  private readonly readFile: (file: string) => string;

  constructor(private readonly config: DownloadsConfig, private readonly host: DownloadsHost) {
    this.readFile = host.readFile ?? (file => readFileSync(file, 'utf8'));
  }

  private password(): string {
    try { return this.readFile(this.config.passwordFile).trim(); } catch { return ''; }
  }

  private async login(): Promise<void> {
    const password = this.password();
    if (!password) throw new Error(`no qBittorrent password in ${this.config.passwordFile}`);
    const response = await this.host.fetch(`${this.config.url}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: this.config.url },
      body: new URLSearchParams({ username: this.config.username, password }).toString(),
    });
    const body = (await response.text()).trim();
    // The session cookie, whatever it is called: SID in qBittorrent 4,
    // QBT_SID_<port> in 5.2.
    const pair = (response.headers.get('set-cookie') ?? '').split(';')[0].trim();
    // 4.x said "Ok." with 200; 5.2 says nothing with 204. A wrong password is 401.
    if (!response.ok || /^fails/i.test(body)) throw new Error(`qBittorrent refused the login (${response.status}${body ? `: ${body}` : ''})`);
    // No cookie header to read (Electron's net keeps it in its own jar): the
    // session carries it, and no Cookie header of ours gets in the way.
    this.sid = /^[\w-]+=.+/.test(pair) ? pair : '';
  }

  /** One call, logged in first and once more if the session had lapsed. */
  private async call(endpoint: string, form?: Record<string, string>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (this.sid === null) await this.login();
      const response = await this.host.fetch(`${this.config.url}/api/v2/${endpoint}`, {
        method: form ? 'POST' : 'GET',
        headers: { ...(this.sid ? { Cookie: this.sid } : {}), Referer: this.config.url, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(form ? { body: new URLSearchParams(form).toString() } : {}),
      });
      if (response.status === 403 && attempt === 0) { this.sid = null; continue; }
      return response;
    }
  }

  private async torrents(): Promise<Torrent[]> {
    const response = await this.call('torrents/info');
    if (!response.ok) throw new Error(`qBittorrent answered ${response.status} to the torrent list`);
    const list = JSON.parse(await response.text()) as Torrent[];
    return Array.isArray(list) ? list : [];
  }

  private showOf(torrent: Torrent): string {
    const known = (this.host.known?.() ?? []).find(item => item.infoHash && item.infoHash.toLowerCase() === torrent.hash.toLowerCase());
    return known?.title ?? plainName(torrent.name);
  }

  private describe(torrent: Torrent) {
    const state = standing(torrent.state);
    return {
      show: this.showOf(torrent),
      release: torrent.name,
      state,
      percent: Math.round(torrent.progress * 1000) / 10,
      gb: Math.round(torrent.size / 1e8) / 10,
      downloadingKbps: Math.round(torrent.dlspeed / 1000),
      etaMinutes: state === 'downloading' && torrent.eta > 0 && torrent.eta < 8_640_000 ? Math.round(torrent.eta / 60) : null,
    };
  }

  /** What is on the server, by show, and how it is going. */
  async status(): Promise<Record<string, unknown>> {
    const list = await this.torrents();
    const torrents = list.map(torrent => this.describe(torrent));
    const count = (state: Standing) => torrents.filter(t => t.state === state).length;
    return {
      torrents,
      downloading: count('downloading') + count('stalled') + count('queued'),
      paused: count('paused'),
      finished: count('done') + count('seeding'),
      downloadingKbps: torrents.reduce((sum, t) => sum + t.downloadingKbps, 0),
      note: torrents.length ? 'Say how it is going in your own words — the show, roughly how far, and how long is left when there is a figure.' : 'There is nothing downloading and nothing queued.',
    };
  }

  /** Stop the downloads: all of them, or the show he named. */
  async pause(title?: string): Promise<Record<string, unknown>> {
    return this.flip('pause', title);
  }

  /** Start them again: all, or the show he named. */
  async resume(title?: string): Promise<Record<string, unknown>> {
    return this.flip('resume', title);
  }

  private async flip(action: 'pause' | 'resume', title?: string): Promise<Record<string, unknown>> {
    const list = await this.torrents();
    const wanted = title ? list.filter(torrent => namesShow(torrent.name, title) || namesShow(this.showOf(torrent), title)) : list;
    if (!list.length) return { [action === 'pause' ? 'paused' : 'resumed']: [], note: 'There is nothing on the server to ' + action + '.' };
    if (title && !wanted.length) return { error: `Nothing downloading is called "${title}". On the server: ${[...new Set(list.map(t => this.showOf(t)))].join(', ')}.` };
    // Only the ones that would change: resuming a finished download is nothing, and says so.
    const applicable = wanted.filter(torrent => (action === 'pause' ? !/^(paused|done)$/.test(standing(torrent.state)) : standing(torrent.state) === 'paused'));
    if (!applicable.length) {
      return { [action === 'pause' ? 'paused' : 'resumed']: [], note: action === 'pause' ? 'They are already paused (or finished).' : 'Nothing was paused — they are already going, or finished.' };
    }
    const hashes = title ? applicable.map(t => t.hash).join('|') : 'all';
    // qBittorrent 5 says stop/start; 4 said pause/resume.
    const names = action === 'pause' ? ['torrents/stop', 'torrents/pause'] : ['torrents/start', 'torrents/resume'];
    let response: Response | null = null;
    for (const endpoint of names) {
      response = await this.call(endpoint, { hashes });
      if (response.status !== 404) break;
    }
    if (!response || !response.ok) throw new Error(`qBittorrent answered ${response?.status ?? 'nothing'} to ${action}`);
    const shows = [...new Set(applicable.map(t => this.showOf(t)))];
    return {
      [action === 'pause' ? 'paused' : 'resumed']: shows,
      all: !title,
      note: action === 'pause' ? 'Done: they are paused until they ask you to start them again.' : 'Done: they are downloading again.',
    };
  }
}
