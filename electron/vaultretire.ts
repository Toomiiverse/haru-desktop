import {corePolicySync} from './core-policy-sync';
// A page that no longer says it should stop saying it.
//
// admitVaultMemories only ever adds. He rewrote his preferences page on
// 2026-09-08 and three bullets he had deleted were still active records — one
// of them the exact prohibition the new bullet reversed, so "don't interrupt
// with unprompted lines while Tommy is working at the shop" sat in the same
// block as "she can interrupt whenever she likes, the shop included". Editing
// the page had never changed her mind. It had only ever added to it.
//
// The page is his standing statement of what he wants, so a bullet that leaves
// it should stop being a memory. Archived rather than deleted: the store treats
// archived as shelved and requires a deliberate unarchive, which is the right
// weight for "he took it off the page" — out of every block, and recoverable.
//
// Two guards, and the second one is the one that matters.
//
//   It only ever retires something the page itself once said. The bullets from
//   the previous sync are kept per page, and a record is retired only when its
//   text is in that list, is absent from the page now, and matches exactly.
//   Something she was told in conversation is never touched, however alike.
//
//   It refuses to act on a page that currently parses to nothing. A file
//   half-written, unreadable, or momentarily empty would otherwise retire every
//   preference he has, which is a far worse failure than keeping a stale one.

export type Admitted = Record<string, string[]>;

export function readAdmitted(saved: unknown): Admitted {
  return corePolicySync('knowledge-vault.admitted',[saved]);
}

/** What the page said last time and does not say now. */
export function goneFromPage(previous: readonly string[], current: readonly string[]): string[] {
  return corePolicySync('knowledge-vault.gone',[previous,current]);
}

export type RetirePlan = {
  /** The bullets to take out of her memory. Empty whenever it is not safe to act. */
  gone: string[];
  /** Why nothing is being retired, for the log. Absent when the plan is to act. */
  held?: 'first sync, nothing to compare' | 'the page parsed to nothing';
};

export function planRetirement(previous: readonly string[] | undefined, current: readonly string[]): RetirePlan {
  return corePolicySync('knowledge-vault.retirement',[previous,current]);
}

export type RetirableRecord = { text: string; kind: string; status?: string; source?: string; supersededBy?: string };

/**
 * The records a retirement actually touches.
 *
 * Restricted to `explicit`, which is what every page bullet is admitted as, and
 * to the kind the page produces, so a fact and a preference that happen to read
 * alike are not confused for one another. Already-archived and superseded
 * records are left alone: retiring one twice would be a second log line saying
 * something untrue.
 */
export function recordsToRetire<T extends RetirableRecord>(memories: readonly T[], gone: readonly string[], kind: string): T[] {
  return corePolicySync('knowledge-vault.retirable',[memories,gone,kind]);
}
