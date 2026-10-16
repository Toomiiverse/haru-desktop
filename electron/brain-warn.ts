// 4050: the journal line for a brain warning: its [tag] and the last snake_case error code in it, never the text.
// One line per tag+code a minute, so a warning in a loop cannot flood the journal.
export function warnLine(args: unknown[], now: number, seen: Map<string, number>): string | null {
  const tag = /^\[([a-z][a-z-]{0,30})\]/.exec(typeof args[0] === 'string' ? args[0] : '')?.[1];
  if (!tag) return null;
  const text = args.map(a => a instanceof Error ? a.message : typeof a === 'string' ? a : '').join(' ');
  const codes: string[] = text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
  const policy = codes.indexOf('core_policy_unavailable');   // 4060: the refused operation rides after the code
  const code = (policy >= 0 && codes[policy + 1] ? 'core_policy_unavailable ' + codes[policy + 1] : codes.at(-1) ?? 'uncoded').slice(0, 96);
  const key = tag + ' ' + code;
  if ((seen.get(key) ?? -Infinity) > now - 60_000) return null;
  if (seen.size > 500) seen.clear();
  seen.set(key, now);
  return '[brain-warn] ' + JSON.stringify({ tag, code });
}
