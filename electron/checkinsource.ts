// Reading her check-ins off another machine.
//
// Discord moved to the server, so a note jotted on the phone now lands in the
// server's config while the end-of-day review happens at the desk and reads the
// desktop's. Two halves of one day, in two places, neither aware of the other —
// which quietly breaks the whole point of taking the notes.
//
// The desk pulls rather than the server pushing. The desk is where the review
// happens and where the answer is needed, so it is the machine that should go
// and ask; a push would also mean the server holding a credential for here,
// which is a second secret in the place with no keyring to protect it.

import { type CheckIn, type CheckInStore } from './checkins';

export type CheckInSource = { url: string; username: string };

/**
 * Only over the tailnet. Ever.
 *
 * These notes are the most private thing she holds — an anxiety rating and what
 * caused it, written in the moment. A misconfigured or mistyped host would send
 * a password and receive all of that over the open internet, so the address is
 * checked rather than trusted, and anything that is not plainly a tailnet
 * address is refused before a request is made.
 *
 * Tailscale addresses come in two shapes: a MagicDNS name under .ts.net, and the
 * 100.64.0.0/10 range that carrier-grade NAT reserves and Tailscale uses for its
 * own. Both are accepted; nothing else is.
 */
export function isTailnetAddress(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith('.ts.net')) return true;
  const octets = host.split('.');
  if (octets.length !== 4 || octets.some(part => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = octets.map(Number);
  // 100.64.0.0/10 — the second octet runs 64 to 127.
  return a === 100 && b >= 64 && b <= 127;
}

export function readCheckInSource(saved: unknown): CheckInSource | null {
  if (!saved || typeof saved !== 'object') return null;
  const raw = saved as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim().replace(/\/+$/, '') : '';
  const username = typeof raw.username === 'string' ? raw.username.trim() : '';
  if (!url || !username || !isTailnetAddress(url)) return null;
  return { url, username };
}

/**
 * Both machines' notes as one day.
 *
 * Ids are made where the note is written and never travel, so the same id from
 * two machines is the same note arriving twice — that is the whole dedupe. What
 * is kept is whichever copy has more in it: a note edited at the desk after
 * being jotted on a phone should not be replaced by the shorter original just
 * because the pull ran afterwards.
 */
export function mergeCheckIns(mine: CheckInStore, theirs: CheckIn[]): CheckInStore {
  const byId = new Map<string, CheckIn>();
  for (const entry of mine.entries) byId.set(entry.id, entry);
  for (const entry of theirs) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.note !== 'string') continue;
    const held = byId.get(entry.id);
    if (!held || (entry.note.length > held.note.length)) byId.set(entry.id, held ? { ...held, ...entry } : entry);
  }
  const entries = [...byId.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  return { entries };
}

/** Whether a pull actually brought anything back, for a log worth reading. */
export function describePull(before: CheckInStore, after: CheckInStore): string {
  const added = after.entries.length - before.entries.length;
  if (added > 0) return `${added} new check-in${added === 1 ? '' : 's'} from the server`;
  const changed = after.entries.some((entry, index) => entry !== before.entries[index]);
  return changed ? 'check-ins updated from the server' : '';
}
