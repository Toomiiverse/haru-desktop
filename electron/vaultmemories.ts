import {runCoreVaultMemories} from './core-knowledge';
import {corePolicySync} from './core-policy-sync';
// Vault pages as standing memories.
//
// The user owns three pages at the vault root — People.md, Preferences.md,
// Us.md — and this file turns their bullets into memory records of the kinds
// the blocks were built for. The preferences and relationship blocks had
// always been empty: nothing in the app ever created a record of those kinds,
// so the two blocks sat in the prompt as empty headers no matter what the user
// told her. These pages are the input that was missing.
//
// The contract with the pages is one bullet, one record:
//
//   People.md       - **Name** — what she should know     -> relationship, subject = Name
//   Preferences.md  - what she should do or avoid          -> preference
//   Us.md           - **Topic** — what it is and why       -> fact, subject = Topic
//
// Lines starting with TODO are skipped, so a page half-filled in is safe. The
// vault sync runs hourly and on demand, so an edit lands in her standing
// context within the hour; records flow through the same admission gate as
// conversation memories (isWorthRemembering), so pruning, decay, supersession
// and the Memories.md page in the vault all treat them like anything else she
// was told. The id is a hash of the page and text, so the same bullet across
// syncs is the same record (repeat evidence), and an edited bullet is a new
// record that the old one supersedes or that decays naturally.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const VAULT_MEMORY_PAGES = {
  'People.md': { kind: 'relationship' as const, subjectFrom: 'bold' as const },
  'Preferences.md': { kind: 'preference' as const, subjectFrom: 'none' as const },
  'Us.md': { kind: 'fact' as const, subjectFrom: 'bold' as const },
} as const;

export type VaultMemoryPage = keyof typeof VAULT_MEMORY_PAGES;

export type VaultMemoryDraft = {
  text: string;
  kind: 'relationship' | 'preference' | 'fact';
  subject?: string;
  /** Stable across syncs: the same bullet is the same record. */
  id: string;
};

/** The first `---` block is frontmatter, not content. */
function stripFrontmatter(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith('---')) return text;
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return text;
  return trimmed.slice(end + 4);
}

/** The leading bold run, when the page's contract says a bullet has one. */
function boldLead(content: string): string | null {
  const match = content.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/);
  if (!match) return null;
  return match[1].trim();
}

/** `- **Name** — what to know` keeps the subject; the text reads with the
 *  marker stripped so a memory like "*Johnny* — Tommy's stepfather" does not
 *  carry asterisks into the prompt. */
function draftFrom(content: string, page: VaultMemoryPage, kind: 'relationship' | 'preference' | 'fact'): VaultMemoryDraft {
  const bold = boldLead(content);
  const subject = bold ? bold : page === 'Us.md' ? 'us' : undefined;
  const clean = content.replace(/\*\*/g, '').trim();
  return {
    text: clean,
    kind,
    subject,
    id: createHash('sha1').update(`${page}|${kind}|${clean}`).digest('hex').slice(0, 16),
  };
}

/**
 * The bullets of one page, as memory drafts. Only lines that are `- ` bullets
 * count; headings, blockquotes, TODO lines and the frontmatter are ignored, so
 * the page stays readable prose to a human and a data file to her.
 */
export function parseVaultMemoryPage(text: string, page: VaultMemoryPage): VaultMemoryDraft[] {
  return corePolicySync('knowledge-vault.memoryPage',[text,page]);
}

export type VaultMemoryResult = { created: boolean };

export type VaultMemoryAdmitter = (draft: VaultMemoryDraft) => VaultMemoryResult | null;

export type VaultMemoryReport = { page: VaultMemoryPage; bullets: number; admitted: number; repeated: number }[];

/** Reads the three pages (those that exist) and admits their bullets through
 *  the same gate conversation memories use. Returns a per-page tally for the
 *  log line; a page missing from the vault is simply absent from the report. */
export function admitVaultMemories(
  vault: string,
  admit: VaultMemoryAdmitter,
  read = (file: string) => readFileSync(file, 'utf8'),
  exists = (file: string) => existsSync(file),
): VaultMemoryReport {
 return runCoreVaultMemories(vault,admit,read,exists);
}