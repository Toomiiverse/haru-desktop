import {activeTask} from './task-controller';
import {corePolicySync} from './core-policy-sync';
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
 return corePolicySync('final-downloads.config',[anime??null,homedir()]);
}

/** Whether she can be asked at all: the block is on and the password file is there. */
export function downloadsReady(config: DownloadsConfig | null, exists: (file: string) => boolean = existsSync): boolean {
  return config !== null && exists(config.passwordFile);
}

type Torrent = { hash: string; name: string; state: string; progress: number; dlspeed: number; upspeed: number; eta: number; size: number; category?: string };

export type Standing = 'downloading' | 'paused' | 'stalled' | 'queued' | 'checking' | 'seeding' | 'done' | 'error';

/** qBittorrent's dozen states, as the four or five words she needs. */
export function standing(state: string): Standing {
 return corePolicySync('final-downloads.standing',[state]);
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);

/** A release name without its tag soup: "[Group] Naruto (001-220) [BD]…" → "Naruto (001-220)". */
export function plainName(name: string): string {
 return corePolicySync('final-downloads.plainName',[name]);
}

/** Whether every word of the show he named is in the torrent's name. */
export function namesShow(torrentName: string, title: string): boolean {
 return corePolicySync('final-downloads.namesShow',[torrentName,title]);
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

  private async core(action:'status'|'pause'|'resume',title?:string):Promise<Record<string,unknown>>{
    const task=activeTask.getStore();if(!task)throw Error('downloads_task_required');await task.check();
    let packet=corePolicySync<any>('final-downloads.start',[action,title??null,this.sid!==null,this.host.known?.()??[]]);
    for(let n=0;n<24;n++){
      if(Object.hasOwn(packet,'result'))return packet.result;
      if(packet.error)throw Error(packet.error);
      await task.check();const c=packet.command;let observation:any;
      if(c.kind==='login'){
        if(c.clear)this.sid=null;const password=this.password();if(!password)throw Error(`no qBittorrent password in ${this.config.passwordFile}`);
        const r=await this.host.fetch(`${this.config.url}/api/v2/auth/login`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:this.config.url},body:new URLSearchParams({username:this.config.username,password}).toString()});
        const body=await r.text();observation={kind:'login',ok:r.ok,status:r.status,body};
        // Cookie bytes are opaque transport state. Core decides authentication/retry.
        const pair=(r.headers.get('set-cookie')??'').split(';')[0].trim();this.sid=/^[\w-]+=.+/.test(pair)?pair:'';
      }else if(c.kind==='request'){
        // Protocol confinement prevents Core payloads bypassing the adapter surface.
        if(!['torrents/info','torrents/start','torrents/stop','torrents/pause','torrents/resume'].includes(c.endpoint))throw Error('downloads_endpoint_protocol');
        try{const r=await this.host.fetch(`${this.config.url}/api/v2/${c.endpoint}`,{method:c.form?'POST':'GET',headers:{...(this.sid?{Cookie:this.sid}:{}),Referer:this.config.url,...(c.form?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(c.form?{body:new URLSearchParams(c.form).toString()}:{})});observation={kind:'request',ok:r.ok,status:r.status,body:await r.text()};}
        catch(error){observation={okTransport:false,error:error instanceof Error?error.message:String(error)}}
      }else throw Error('downloads_command_protocol');
      await task.check();packet=corePolicySync('final-downloads.observed',[packet.state,observation]);
    }
    throw Error('downloads_program_bound');
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
    return this.core('status');
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
    return this.core(action,title);
  }
}
