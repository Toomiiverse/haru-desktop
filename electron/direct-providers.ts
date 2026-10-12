import { routePolicy } from './core-route-admission';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProviderConfig } from './model-registry';

const DIRECT_HOSTS: Record<string, string> = {
  'api.deepseek.com': 'DEEPSEEK_API_KEY',
  'api.moonshot.ai': 'MOONSHOT_API_KEY',
  'api.openai.com': 'OPENAI_API_KEY',
  'api.anthropic.com': 'ANTHROPIC_API_KEY',
  'api.xiaomimimo.com': 'MIMO_API_KEY',
  // NanoGPT: OpenAI-compatible aggregator, uncensored GLM-5.3 routes.
  'nano-gpt.com': 'NANOGPT_API_KEY',
  'api.abliteration.ai': 'ABLITERATION_API_KEY',
};

/** No suffix matching: a provider's key must never reach a look-alike host. */
export function directCredentialName(endpoint: string): string | undefined {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443')) return undefined;
    return DIRECT_HOSTS[u.hostname];
  } catch { return undefined; }
}

export function isDirectProvider(config: ProviderConfig): boolean {
  return Boolean(directCredentialName(config.endpoint)) && (config.provider === 'openai' || config.provider === 'anthropic');
}

/** Read the existing private credential file as data, never execute/source it. */
export function parseProviderEnv(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    out[match[1]] = value;
  }
  return out;
}

export function directProviderKey(endpoint: string): string {
  const name = directCredentialName(endpoint);
  if (!name) return '';
  if (process.env[name]?.trim()) return process.env[name]!.trim();
  try {
    const file = process.env.HARU_PROVIDER_ENV || path.join(os.homedir(), 'litellm/.env');
    return parseProviderEnv(readFileSync(file, 'utf8'))[name]?.trim() ?? '';
  } catch { return ''; }
}

/** The explicitly configured Sonnet 5.5 route uses the existing Venice account. */
export function isAllowedTaskProvider(config: ProviderConfig): boolean {
  if (process.env.HARU_CORE_ROUTE_ADMISSION === 'on') return routePolicy<boolean>('allowed', [config]);
  return isDirectProvider(config) || (config.provider === 'venice'
    && config.model === 'claude-sonnet-5-5'
    && config.endpoint === 'https://api.venice.ai/api/v1');
}
