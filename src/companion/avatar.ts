/** Animation packs are local siblings of the imported VRM. No absolute paths or remote URLs. */
export function avatarClipEntries(value: unknown): [string, string][] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid avatar animation pack.');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 64) throw Error('The avatar pack must contain 1–64 clips.');
  for (const [name, file] of entries) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || typeof file !== 'string' || !/^clips\/[a-z][a-z0-9-]*\.vrma$/.test(file)) {
      throw Error('Invalid local avatar clip: ' + name);
    }
  }
  return entries as [string, string][];
}
