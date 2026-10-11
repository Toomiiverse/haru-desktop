import {walkCoreVault,runCoreVaultSync} from './core-knowledge';
import {corePolicySync} from './core-policy-sync';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeStore } from './knowledge';

export type VaultFile = { file: string; relative: string };

export type VaultSyncReport = {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  files: number;
  ms: number;
};

/** Her own folder in the vault (vault.ts) — written by the app, and not read back as knowledge about his world. */
export const HARU_FOLDER = 'Haru';
/**
 * The one page of her folder she may read: how she is put together
 * (Configuration.md, kept by scripts/update-haru-config.sh). The rest of the
 * folder is regenerated from her own store and would only feed her back to
 * herself; this one is about her and written by nobody else.
 */
export const HER_OWN_READABLE = ['Configuration.md'];

/** Folders that are Obsidian housekeeping or should never be read as knowledge. */
export const DEFAULT_VAULT_SKIP = ['.obsidian', '.trash', '.git', 'templates', '_templates', 'attachments', '_attachments', 'node_modules', HARU_FOLDER];

export function walkVault(root: string, skip: string[] = DEFAULT_VAULT_SKIP): VaultFile[] {
 return walkCoreVault(root,skip).files;
}

export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  return corePolicySync('knowledge-vault.split',[text]);
}

function scalar(value: string): unknown {
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^["']|["']$/g, '');
  if (/^\[.*\]$/.test(trimmed)) {
    const inner = trimmed.slice(1, -1);
    if (!inner.trim()) return [];
    return inner.split(',').map(part => part.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (unquoted !== '' && unquoted === String(Number(unquoted)) && Number.isFinite(Number(unquoted))) return Number(unquoted);
  return unquoted;
}

export function parseFrontmatter(frontmatter: string): Record<string, unknown> {
  return corePolicySync('knowledge-vault.parse',[frontmatter]);
}

export function cleanWikilinks(text: string): string {
  return corePolicySync('knowledge-vault.wikilinks',[text]);
}

export const FOLDER_CATEGORIES: Record<string, KnowledgeCategory> = {
  projects: 'projects',
  project: 'projects',
  personal: 'personal',
  business: 'business',
  work: 'business',
  journal: 'conversation',
  daily: 'conversation',
  'daily notes': 'conversation',
  docs: 'documentation',
  documentation: 'documentation',
  notes: 'documentation',
};

function isCategory(value: string): value is KnowledgeCategory {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

export function categoryForFolder(relative: string, map: Record<string, KnowledgeCategory> = FOLDER_CATEGORIES): KnowledgeCategory {
  return corePolicySync('knowledge-vault.folder',[relative,map]);
}

export function categoryForNote(relative: string, frontmatter: Record<string, unknown>, map: Record<string, KnowledgeCategory> = FOLDER_CATEGORIES): KnowledgeCategory {
  return corePolicySync('knowledge-vault.note',[relative,frontmatter,map]);
}

export function removedNotes(store: KnowledgeStore, relativePaths: string[], vault: string): string[] {
  return corePolicySync('knowledge-vault.removed',[store,relativePaths,vault]);
}

export type VaultSyncDeps = {
  store: KnowledgeStore;
  ingest(note: { file: string; relative: string; text: string; metadata: Record<string, unknown>; category: KnowledgeCategory }): Promise<'created' | 'updated' | 'unchanged'>;
  remove(source: string): void;
};

export async function syncVaultFiles(vault: string, deps: VaultSyncDeps): Promise<VaultSyncReport> {
 return runCoreVaultSync(vault,deps);
}
