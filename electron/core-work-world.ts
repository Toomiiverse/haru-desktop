/** Fixed, authenticated Core transport. No classification, execution or retry policy. */
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { coreServiceOptions, type CoreServiceOptions } from './core-service-client';
import { coreAdapterOwner } from './core-policy-sync';
import { ELSEWHERE_FILES } from './elsewhere';

export class CoreWorkWorld {
  private note = '';
  private noteExpiresAt = 0;
  constructor(private options = coreServiceOptions(), private fetcher: typeof fetch = fetch) {}
  private async read(suffix: string, body?: unknown) {
    if (!this.options) throw Error('work_world_core_unavailable');
    const url = new URL(this.options.endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('work_world_loopback_required');
    if (statSync(this.options.tokenFile).mode & 0o077) throw Error('work_world_private_token_required');
    const token = readFileSync(this.options.tokenFile, 'utf8').trim();
    if (token.length < 32) throw Error('work_world_token_invalid');
    const response = await this.fetcher(url.origin + '/v1/world/work' + suffix, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'content-type':'application/json'}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(3000),
    });
    if (!response.ok) throw Error('work_world_core_unavailable');
    return response.json();
  }
  async get() {
    this.note = '';
    const result = await this.read('');
    if (result.version !== 1 || result.mode !== 'work') throw Error('work_world_protocol_error');
    this.note = typeof result.promptNote === 'string' ? result.promptNote : '';
    this.noteExpiresAt = Number.isSafeInteger(result.promptExpiresAt) ? result.promptExpiresAt : 0;
    return result;
  }
  detail(id: string, before?: number) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)
      || before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw Error('work_world_invalid_reference');
    return this.read('/items/' + encodeURIComponent(id) + (before === undefined ? '' : '?before=' + before));
  }
  async observe(facts: {speaking:boolean;asleep:boolean}) {
    await this.read('/observation', {owner:coreAdapterOwner(),...facts});
    await this.get();
  }
  prompt() { return Date.now() < this.noteExpiresAt ? this.note : ''; }
}

/** Presentation-only, fixed art inventory for the local desktop bridge. */
export function workWorldAssets(root: string, emotions: string) {
  const result: Record<string,string> = {};
  for (const [url,[relative,type]] of ELSEWHERE_FILES) {
    if (type !== 'image/png') continue;
    const file = path.join(process.env.HARU_WORLD_ASSET_ROOT || path.join(root, 'elsewhere'), relative);
    if (existsSync(file)) result[url] = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  }
  const neutral = path.join(emotions,'neutral.svg');
  if (existsSync(neutral)) result['/emotions/neutral.svg'] = 'data:image/svg+xml;base64,' + readFileSync(neutral).toString('base64');
  return result;
}
