import { readdirSync, readFileSync } from 'node:fs';
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

/** Folders that are Obsidian housekeeping or should never be read as knowledge. */
export const DEFAULT_VAULT_SKIP = ['.obsidian', '.trash', '.git', 'templates', '_templates', 'attachments', '_attachments', 'node_modules', HARU_FOLDER];

export function walkVault(root: string, skip: string[] = DEFAULT_VAULT_SKIP): VaultFile[] {
  const out: VaultFile[] = [];
  const visit = (dir: string, relative: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (skip.includes(entry.name)) continue;
        visit(full, rel);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        out.push({ file: full, relative: rel });
      }
    }
  };
  visit(root, '');
  return out.sort((a, b) => a.relative.localeCompare(b.relative));
}

export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { frontmatter: '', body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
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
  const out: Record<string, unknown> = {};
  const lines = frontmatter.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(lines[index]);
    if (!match) { index++; continue; }
    const key = match[1];
    const rest = match[2].trim();
    if (!rest) {
      const values: string[] = [];
      index++;
      while (index < lines.length) {
        const item = /^\s*[-*]\s+(.*)$/.exec(lines[index]);
        if (item) { values.push(item[1].trim().replace(/^["']|["']$/g, '')); index++; }
        else break;
      }
      out[key] = values.length ? values : '';
      continue;
    }
    out[key] = scalar(rest);
    index++;
  }
  return out;
}

export function cleanWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g, (whole, name, alias) => {
    const shown = alias && alias.trim() ? alias.trim() : name.trim();
    return shown;
  });
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
  const top = relative.split(/[\\/]/)[0].toLowerCase();
  return map[top] ?? 'general';
}

export function categoryForNote(relative: string, frontmatter: Record<string, unknown>, map: Record<string, KnowledgeCategory> = FOLDER_CATEGORIES): KnowledgeCategory {
  for (const key of ['category', 'type', 'folder']) {
    const value = frontmatter[key];
    if (typeof value === 'string' && isCategory(value.toLowerCase())) return value.toLowerCase() as KnowledgeCategory;
  }
  return categoryForFolder(relative, map);
}

export function removedNotes(store: KnowledgeStore, relativePaths: string[], vault: string): string[] {
  const seen = new Set(relativePaths);
  return store.documents
    .filter(document => document.metadata.vault === vault && document.status === 'active' && !seen.has(document.source))
    .map(document => document.source);
}

export type VaultSyncDeps = {
  store: KnowledgeStore;
  ingest(note: { file: string; relative: string; text: string; metadata: Record<string, unknown>; category: KnowledgeCategory }): Promise<'created' | 'updated' | 'unchanged'>;
  remove(source: string): void;
};

export async function syncVaultFiles(vault: string, deps: VaultSyncDeps): Promise<VaultSyncReport> {
  const started = Date.now();
  const files = walkVault(vault);
  const report: VaultSyncReport = { added: 0, updated: 0, unchanged: 0, removed: 0, files: files.length, ms: 0 };
  for (const item of files) {
    let raw: string;
    try { raw = readFileSync(item.file, 'utf8'); } catch { continue; }
    const { frontmatter, body } = splitFrontmatter(raw);
    const parsed = parseFrontmatter(frontmatter);
    const metadata = { vault, frontmatter: parsed };
    const category = categoryForNote(item.relative, parsed);
    try {
      const action = await deps.ingest({
        file: item.file,
        relative: item.relative,
        text: cleanWikilinks(body),
        metadata,
        category,
      });
      if (action === 'created') report.added++;
      else if (action === 'updated') report.updated++;
      else report.unchanged++;
    } catch (error) {
      console.warn(`[knowledge] vault skip ${item.relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const removed = removedNotes(deps.store, files.map(file => file.relative), vault);
  for (const source of removed) deps.remove(source);
  report.removed = removed.length;
  report.ms = Date.now() - started;
  return report;
}
