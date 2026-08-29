// Haru's persistence layer — the only module that reads or writes the on-disk
// store files: config.json for application/configuration state, knowledge.json
// for structured memory, archive.json for the day-by-day transcripts.
//
// Three files rather than two since v4, and the split is not filing tidiness.
// electron-store rewrites the whole of config.json on every set, and the life
// loop sets one key every twenty seconds — so the transcripts, which change
// twice a day, were being written to disk four thousand times a day along with
// everything else. See archive.ts.
//
// What that buys is real and worth keeping. No other module imports
// electron-store or knows where the files live, and this is the one place that
// owns the safety net: atomic saves, backups before migration, corruption
// recovery, schema versioning and file permissions. Move a file, change how it
// is written, add a migration — only this file changes.
//
// What it does not buy is a different database, and this header used to say
// otherwise: that the files could be swapped for SQLite, Postgres or a graph
// database without changing any caller. They cannot. get and set below are
// electron-store's own surface re-exported, and 282 call sites across four
// modules reach through them for 65 dotted string keys — 'chat.messages',
// 'ai.config', 'journal.config' — and cast whatever comes back. That is a
// key-value store's shape and it is load-bearing in every one of those callers.
//
// The typed accessors below — getMemories, setBlocks, appendForgettingLog — are
// what an actual boundary looks like, and the distance to one is those 65 keys.
// Said plainly here because a sentence promising portability is worse than no
// sentence: it is the kind of thing somebody plans a weekend around.

import Store from 'electron-store';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyKnowledge, loadKnowledge, saveKnowledge, type KnowledgeStore } from './knowledge';
import { loadArchive, normalizeArchive, saveArchive, type Archive } from './archive';
import { mergeBlockDefaults, type MemoryBlock } from './blocks';
import { migrateMemories, type ForgettingEntry, type MemoryRecord, type SessionSummary } from './memory';

/** The current schema version of the store. Bumped by each schema migration. */
export const SCHEMA_VERSION = 4;

export type MigrationStep = {
  /** The schema version this step produces. Steps run in ascending order. */
  version: number;
  label: string;
  run: (haruStore: HaruStore) => void;
};

export type MigrationReport = {
  from: number;
  to: number;
  steps: string[];
};

/**
 * Schema migrations, applied in ascending version order by migrate(). Each
 * step is responsible for the shape of the data it produces; steps never
 * touch data written by later steps.
 */
export const MIGRATIONS: MigrationStep[] = [
  {
    version: 2,
    label: 'memories gain confidence, importance, source, status, memoryType, evidence and triples',
    run: (haruStore) => {
      // migrateMemories derives the v2 fields on read; this step makes that
      // derivation permanent so the file carries the new schema, not just the
      // in-memory view.
      haruStore.setMemories(migrateMemories(haruStore.getMemories(), new Date().toISOString()));
    },
  },
  {
    version: 3,
    label: 'memory blocks arrive — label, description, limit, read_only; persona is read-only and mirrors the character config',
    run: (haruStore) => {
      // Defaults are merged rather than forced: any custom blocks the user
      // already configured keep their shape, and the standard set fills in.
      haruStore.setBlocks(mergeBlockDefaults(haruStore.get('memory.blocks')));
    },
  },
  {
    version: 4,
    label: 'the day-by-day transcript archive moves out of config.json into archive.json',
    run: (haruStore) => {
      const saved = haruStore.get('chat.archive');
      // Written before the key is dropped, and dropped only once the write has
      // returned: the archive is the one thing here with no other copy.
      if (saved && typeof saved === 'object' && Object.keys(saved).length) {
        haruStore.setArchive({ ...haruStore.getArchive(), ...normalizeArchive(saved) });
        console.log(`[store] moved ${Object.keys(saved).length} archived day(s) out of config.json`);
      }
      haruStore.delete('chat.archive');
    },
  },
];

export type HaruStoreOptions = {
  /** Where knowledge.json lives. */
  knowledgeFile: string;
  /** Where archive.json lives. Defaults to sitting beside config.json, which
   *  is where it belongs — it is the same user's data, just the part that does
   *  not need rewriting every twenty seconds. */
  archiveFile?: string;
  /** Only used in tests — overrides where the config file lives. */
  cwd?: string;
  configName?: string;
  /** How many backups to keep per reason before the oldest are removed. */
  maxBackups?: number;
};

// The counter is what makes two backups in the same millisecond two files.
// Found by the server: its disk is fast enough that back-to-back backups landed
// on identical stamps, and the second copy silently overwrote the first — a
// backup eating the previous backup, which is the one failure a backup must not
// have. Appended after the milliseconds so names still sort by age.
let backupSequence = 0;

function backupStamp(): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const now = new Date();
  backupSequence = (backupSequence + 1) % 1000;
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}-${String(backupSequence).padStart(3, '0')}`;
}

export class HaruStore {
  private readonly electron: Store<Record<string, unknown>>;
  private readonly knowledgeFile: string;
  private readonly archiveFile: string;
  private readonly maxBackups: number;
  /** Read once, then kept. This process is the only writer, so the copy in
   *  memory cannot go stale, and the alternative is parsing half a megabyte of
   *  transcript several times per reply. */
  private archiveCache: Archive | null = null;

  constructor(options: HaruStoreOptions) {
    this.knowledgeFile = options.knowledgeFile;
    this.maxBackups = options.maxBackups ?? 10;
    const storeOptions: Record<string, unknown> = {};
    if (options.cwd) storeOptions.cwd = options.cwd;
    if (options.configName) storeOptions.name = options.configName;
    this.electron = new Store<Record<string, unknown>>(storeOptions);
    this.archiveFile = options.archiveFile ?? path.join(path.dirname(this.electron.path), 'archive.json');
  }

  // -- generic access. Same surface as electron-store so existing callers and
  //    google.ts's StoreLike keep working; the file itself is private to this
  //    class.

  /** Same shape as electron-store's get: a default value and unknown results,
   *  so call sites that check `get(key, fallback) === x` or cast the result
   *  keep compiling unchanged. */
  get(key: string, defaultValue?: unknown): unknown {
    return defaultValue === undefined
      ? this.electron.get(key)
      : this.electron.get(key, defaultValue);
  }

  set(key: string, value: unknown): void;
  set(object: Record<string, unknown>): void;
  set(keyOrObject: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrObject === 'string') {
      this.electron.set(keyOrObject, value);
    } else {
      this.electron.set(keyOrObject);
    }
  }

  delete(key: string): void {
    this.electron.delete(key);
  }

  has(key: string): boolean {
    return this.electron.has(key);
  }

  // -- typed accessors for the memory subsystem. Later phases extend these as
  //    the record schema grows; no subsystem ever touches the raw keys.

  getMemories(): MemoryRecord[] {
    return (this.get('memories') as MemoryRecord[] | undefined) ?? [];
  }

  setMemories(items: MemoryRecord[]): void {
    this.set('memories', items);
  }

  getSessions(): SessionSummary[] {
    return (this.get('memory.sessions') as SessionSummary[] | undefined) ?? [];
  }

  setSessions(items: SessionSummary[]): void {
    this.set('memory.sessions', items);
  }

  /** The trail of what she forgot and why — bounded so the log itself cannot
   *  grow forever. */
  getForgettingLog(): ForgettingEntry[] {
    const saved = (this.get('memory.forgettingLog') as ForgettingEntry[] | undefined) ?? [];
    return saved.filter(entry => entry && typeof entry.id === 'string' && typeof entry.at === 'string');
  }

  setForgettingLog(entries: ForgettingEntry[]): void {
    this.set('memory.forgettingLog', entries.slice(-200));
  }

  appendForgettingLog(entries: ForgettingEntry[]): ForgettingEntry[] {
    if (!entries.length) return this.getForgettingLog();
    const combined = [...this.getForgettingLog(), ...entries];
    this.setForgettingLog(combined);
    return combined;
  }

  /** The memory-block configuration. Values are derived at render time; only
   *  governed edits persist an explicit value. */
  getBlocks(): MemoryBlock[] {
    return mergeBlockDefaults(this.get('memory.blocks'));
  }

  setBlocks(blocks: MemoryBlock[]): void {
    this.set('memory.blocks', blocks);
  }

  // -- knowledge. The file is read and written only here; main.ts holds its own
  //    in-memory copy and hands it over through these two methods.

  /** Always a well-formed store: a missing file, an unparseable one, or one
   *  full of the wrong shapes all come back empty rather than throwing.
   *  loadKnowledge normalises what it reads, so this does not do it again. */
  getKnowledge(): KnowledgeStore {
    return loadKnowledge(this.knowledgeFile);
  }

  setKnowledge(value: KnowledgeStore): void {
    saveKnowledge(this.knowledgeFile, value);
  }

  // -- the archive. Its own file since v4: see archive.ts for why.

  /** Every day of transcript she still has. Always an object, never undefined —
   *  callers used to write `?? {}` after every read of the old key. */
  getArchive(): Archive {
    if (!this.archiveCache) this.archiveCache = loadArchive(this.archiveFile);
    // A copy of the top level, so a caller that deletes a day it was only
    // reading cannot quietly delete it for everyone else too. The transcripts
    // themselves are shared; nothing appends to one in place.
    return { ...this.archiveCache };
  }

  setArchive(archive: Archive): void {
    this.archiveCache = archive;
    saveArchive(this.archiveFile, archive);
  }

  // -- lifecycle safety.

  /**
   * Run several mutations as one unit: if the function throws, the store is
   * rolled back to the state it had when the transaction began. Writes during
   * the function still happen (electron-store saves on every set); the rollback
   * restores the previous state afterwards.
   */
  transaction<T>(fn: () => T): T {
    const snapshot = JSON.parse(JSON.stringify(this.electron.store)) as Record<string, unknown>;
    try {
      return fn();
    } catch (error) {
      this.electron.store = snapshot;
      throw error;
    }
  }

  /**
   * Copy both store files to timestamped backups, then drop the oldest so at
   * most `maxBackups` survive per reason. Returns the backup paths created.
   */
  backup(reason: string): string[] {
    const made: string[] = [];
    for (const file of [this.electron.path, this.knowledgeFile, this.archiveFile]) {
      if (!existsSync(file)) continue;
      const target = `${file}.before-${reason}-${backupStamp()}`;
      try {
        copyFileSync(file, target);
        made.push(target);
      } catch (error) {
        console.warn(`[store] could not back up ${file}:`, error instanceof Error ? error.message : error);
      }
    }
    this.rotateBackups(reason);
    return made;
  }

  /**
   * Apply every registered migration that has not run yet, backing up first so
   * a bad step can never destroy the only copy of the data. Idempotent.
   */
  migrate(): MigrationReport {
    const saved = this.get('schema.version') as number | undefined;
    // Absent means the file predates versioning — treat it as 0 so the first
    // run stamps the current version even when no migration steps apply.
    const from = typeof saved === 'number' && Number.isFinite(saved) ? saved : 0;
    if (from >= SCHEMA_VERSION) return { from, to: from, steps: [] };
    this.backup(`schema-v${SCHEMA_VERSION}`);
    const steps: string[] = [];
    for (const step of MIGRATIONS
      .filter(candidate => candidate.version > from && candidate.version <= SCHEMA_VERSION)
      .sort((a, b) => a.version - b.version)) {
      step.run(this);
      steps.push(step.label);
    }
    this.set('schema.version', SCHEMA_VERSION);
    return { from, to: SCHEMA_VERSION, steps };
  }

  /** Whether both store files parse as JSON right now. */
  verify(): boolean {
    const ok = (file: string) => {
      if (!existsSync(file)) return true;
      try {
        JSON.parse(readFileSync(file, 'utf8'));
        return true;
      } catch {
        return false;
      }
    };
    return ok(this.electron.path) && ok(this.knowledgeFile) && ok(this.archiveFile);
  }

  /**
   * Restore the newest backup of each store file over the live file. Used when
   * the store fails to open — the electron-store constructor itself parses the
   * file, so this must run before constructing the facade, hence static.
   */
  static recoverBackups(options: HaruStoreOptions): boolean {
    let restored = false;
    for (const file of [path.join(options.cwd ?? '', options.configName ? `${options.configName}.json` : 'config.json'), options.knowledgeFile, options.archiveFile ?? path.join(options.cwd ?? '', 'archive.json')]) {
      if (!existsSync(file)) continue;
      const newest = this.newestBackup(file);
      if (!newest) continue;
      try {
        copyFileSync(newest, file);
        console.warn(`[store] recovered ${file} from ${newest}`);
        restored = true;
      } catch (error) {
        console.warn(`[store] could not recover ${file}:`, error instanceof Error ? error.message : error);
      }
    }
    return restored;
  }

  /**
   * Restrict the store files to the current user (Windows). Headless Linux
   * relies on the same user-only permissions the rest of the app expects.
   * Best effort — a failure to tighten is logged, not fatal.
   */
  hardenPermissions(): void {
    if (process.platform !== 'win32') return;
    const targets = [this.electron.path, this.knowledgeFile].filter(existsSync);
    if (!targets.length) return;
    const user = os.userInfo().username;
    const args = (file: string) => [file, '/inheritance:r', '/grant:r', `${user}:(F)`, 'SYSTEM:(F)', 'Administrators:(F)'];
    for (const file of targets) {
      execFile('icacls', args(file), (error) => {
        if (error) console.warn(`[store] could not tighten permissions on ${file}:`, error.message);
      });
    }
  }

  // -- internal.

  private rotateBackups(reason: string): void {
    const dir = path.dirname(this.electron.path);
    const prefix = `${path.basename(this.electron.path)}.before-${reason}-`;
    const files = readdirSync(dir)
      .filter(name => name.startsWith(prefix))
      .map(name => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of files.slice(this.maxBackups)) {
      try {
        rmSync(path.join(dir, entry.name));
      } catch {
        // a backup that will not delete is not worth stopping the app for
      }
    }
  }

  private static newestBackup(file: string): string | null {
    const dir = path.dirname(file);
    const base = path.basename(file);
    const matches = readdirSync(dir)
      .filter(name => name.startsWith(`${base}.before-`))
      .map(name => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return matches.length ? path.join(dir, matches[0].name) : null;
  }
}