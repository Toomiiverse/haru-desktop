import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Core release data, loaded once. No API or conversation can replace it. */
export type CoreIdentity = {
  version: 1;
  character: { identity: string; style: string };
  voice: Record<string, unknown>;
  breezeActing: Record<string, string>;
};
let loadedPath: string | undefined;
let loaded: CoreIdentity | undefined;
export function coreIdentity(): CoreIdentity | undefined {
  const file = process.env.HARU_CORE_IDENTITY_FILE;
  if (!file) return undefined; // Preserved legacy rollback runtime.
  if (file !== loadedPath) {
    if (!path.isAbsolute(file)) throw Error('absolute_core_identity_required');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.version !== 1 || typeof value.character?.identity !== 'string' || !value.character.identity.trim()
        || typeof value.character?.style !== 'string' || !value.character.style.trim()
        || !value.voice || typeof value.voice !== 'object' || Array.isArray(value.voice)
        || !value.breezeActing || typeof value.breezeActing !== 'object'
        || !Object.values(value.breezeActing).every(v => typeof v === 'string')) throw Error('invalid_core_identity');
    loaded = value; loadedPath = file;
  }
  return structuredClone(loaded);
}
export function protectedIdentityKey(key: string): boolean {
  return ['character', 'voice'].includes(key.split('.')[0]);
}
export function assertIdentityWritable(keys: string[]): void {
  if (coreIdentity() && keys.some(protectedIdentityKey)) throw Error('core_identity_read_only');
}
export function coreIdentityValue(key: string): { value: unknown } | undefined {
  if (!protectedIdentityKey(key)) return undefined;
  const profile = coreIdentity();
  if (!profile) return undefined;
  let value: any = profile;
  for (const part of key.split('.')) {
    value = value && Object.hasOwn(value, part) ? value[part] : undefined;
  }
  return { value: structuredClone(value) };
}
