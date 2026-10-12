import {corePolicySync} from './core-policy-sync';
import { CoreStore, coreStoreOptions, type CoreStoreOptions } from './core-store';
import { assertIdentityWritable, coreIdentityValue } from './core-identity';
import { memorySourceRevision } from './memory-revision';
import { mergeDeletions, type MemoryDeletion } from './memorysync';
// The persistence boundary for Haru's memory and application state.
// HARU_CORE_STORAGE=on selects the Core SQLite authority: typed documents and
// dotted config keys are committed through CoreStore, with no JSON fallback.
// The file backend remains available for explicit rollback and isolated tests.
// Callers retain the synchronous API; Core commits documents and derived belief
// state atomically before a write returns. See core-store.ts for the transport.

import Store from 'electron-store';
import { execFile } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyKnowledge, loadKnowledge, saveKnowledge, type KnowledgeStore } from './knowledge';
import { loadArchive, normalizeArchive, saveArchive, type Archive } from './archive';
import { normalizeActivityLog, type ActivityLog } from './activitylog';
import { normalizeGraph, type FactGraph } from './factgraph';
import { normalizeSchedule, type ScheduleFile } from './scheduler';
import { normalizeThoughtState, type ThoughtState } from './thoughts';
import { mergeBlockDefaults, type MemoryBlock } from './blocks';
import { migrateMemories, type ForgettingEntry, type MemoryRecord, type MonthNote, type SessionSummary } from './memory';

/** The current schema version of the store. Bumped by each schema migration. */
export const SCHEMA_VERSION = 5;

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
      // Only reaches anything for a store already past v5; before that the
      // records are still in config.json and getMemories reads the file that
      // v5 has not written yet. The v5 step below runs the same derivation on
      // what it moves, which is what covers a store coming up from v0 or v1 —
      // and migrateMemories is idempotent, so both running costs nothing.
      const held = haruStore.getMemories();
      if (held.length) haruStore.setMemories(migrateMemories(held, new Date().toISOString()));
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
  {
    version: 5,
    label: 'the memories, sessions and forgetting log move out of config.json into memories.json',
    run: (haruStore) => {
      // Written before the keys are dropped, and dropped only once the write
      // has returned — the same order archive.ts moved in, for the same reason.
      const memories = haruStore.get('memories');
      const sessions = haruStore.get('memory.sessions');
      const forgettingLog = haruStore.get('memory.forgettingLog');
      const moved = {
        // Enriched on the way across rather than moved raw: see the v2 step.
        memories: migrateMemories(memories, new Date().toISOString()),
        sessions: Array.isArray(sessions) ? sessions as SessionSummary[] : [],
        forgettingLog: Array.isArray(forgettingLog) ? forgettingLog as ForgettingEntry[] : [],
      };
      if (moved.memories.length || moved.sessions.length || moved.forgettingLog.length) {
        const held = haruStore.readMemoryFile();
        haruStore.writeMemoryFile({
          ...held,
          memories: moved.memories.length ? moved.memories : held.memories,
          sessions: moved.sessions.length ? moved.sessions : held.sessions,
          // monthNotes never lived in config.json — carried across untouched.
          monthNotes: held.monthNotes,
          forgettingLog: moved.forgettingLog.length ? moved.forgettingLog : held.forgettingLog,
        });
        console.log(`[store] moved ${moved.memories.length} memor(ies) out of config.json`);
      }
      haruStore.delete('memories');
      haruStore.delete('memory.sessions');
      haruStore.delete('memory.forgettingLog');
    },
  },
];

/** What memories.json holds. The blocks stay in config.json: they are the
 *  layout of the prompt rather than anything she remembers, and they are
 *  written when somebody edits one, not when she learns something. */
export type MemoryFile = {
  memories: MemoryRecord[];
  sessions: SessionSummary[];
  monthNotes: MonthNote[];
  forgettingLog: ForgettingEntry[];
  deletions?: MemoryDeletion[];
};

const EMPTY_MEMORY_FILE: MemoryFile = { memories: [], sessions: [], monthNotes: [], forgettingLog: [] };

/** Arrays where arrays belong and nothing else. A file somebody has edited by
 *  hand, or half-written by a machine that lost power, comes back usable rather
 *  than throwing at startup — the same bargain loadArchive makes. */
export function normalizeMemoryFile(value: unknown): MemoryFile {
  return corePolicySync('memory-tools.normalizeFile',[value]);
}

export type HaruStoreOptions = {
  core?: CoreStoreOptions | false;
  /** Where knowledge.json lives. */
  knowledgeFile: string;
  /** Where archive.json lives. Defaults to sitting beside config.json, which
   *  is where it belongs — it is the same user's data, just the part that does
   *  not need rewriting every twenty seconds. */
  archiveFile?: string;
  /** Where memories.json lives. Beside config.json by the same reasoning. */
  memoriesFile?: string;
  /** Where activity.json lives. Beside config.json, same as the rest. */
  activityFile?: string;
  /** Where graph.json lives — who is who in his life (factgraph.ts). Beside config.json too. */
  graphFile?: string;
  /** Where schedule.json lives — jobs for later and their runs (scheduler.ts). Beside config.json too. */
  scheduleFile?: string;
  /** Where thoughts.json lives — her thoughts between messages (thoughts.ts). Beside config.json too. */
  thoughtsFile?: string;
  /** The user-data directory. Required so opening and recovery use the same
   *  paths even when Electron starts from a different working directory. */
  cwd: string;
  configName?: string;
  /** How many backups to keep per reason before the oldest are removed. */
  maxBackups?: number;
};

/** Resolve once by the same rules, including before electron-store can open. */
function storePaths(options: HaruStoreOptions) {
  const cwd = path.resolve(options.cwd);
  const config = path.resolve(cwd, `${options.configName || 'config'}.json`);
  const besideConfig = path.dirname(config);
  return {
    config,
    knowledge: path.resolve(options.knowledgeFile),
    archive: path.resolve(options.archiveFile ?? path.join(besideConfig, 'archive.json')),
    memories: path.resolve(options.memoriesFile ?? path.join(besideConfig, 'memories.json')),
    activity: path.resolve(options.activityFile ?? path.join(besideConfig, 'activity.json')),
    graph: path.resolve(options.graphFile ?? path.join(besideConfig, 'graph.json')),
    schedule: path.resolve(options.scheduleFile ?? path.join(besideConfig, 'schedule.json')),
    thoughts: path.resolve(options.thoughtsFile ?? path.join(besideConfig, 'thoughts.json')),
  };
}

/** All eight stores have an object at the root. Valid JSON alone would also
 *  accept null or an array, which cannot serve as the configuration store. */
function validStoreJson(contents: string): boolean {
  try {
    const value: unknown = JSON.parse(contents);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

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
  private readonly core?: CoreStore;
  private readonly electron: Store<Record<string, unknown>>;
  private readonly knowledgeFile: string;
  private readonly archiveFile: string;
  private readonly memoriesFile: string;
  private readonly activityFile: string;
  private readonly graphFile: string;
  private readonly scheduleFile: string;
  private readonly thoughtsFile: string;
  private readonly maxBackups: number;
  /** Read once, then kept. This process is the only writer, so the copy in
   *  memory cannot go stale, and the alternative is parsing half a megabyte of
   *  transcript several times per reply. */
  private archiveCache: Archive | null = null;
  /** Read once, then kept, for archiveCache's reasons — and one more: retrieval
   *  reads the memories several times per reply. */
  private memoryCache: MemoryFile | null = null;
  /** Read once, then kept. Appended to on every window change, so parsing it
   *  each time would be the most-repeated read in the app. */
  private activityCache: ActivityLog | null = null;
  /** Read once, then kept: every reply matches the message against its names. */
  private graphCache: FactGraph | null = null;
  /** Read once, then kept: the dispatcher looks at it every minute. */
  private scheduleCache: ScheduleFile | null = null;
  /** Read once, then kept: every reply reads the freshest of them. */
  private thoughtsCache: ThoughtState | null = null;

  constructor(options: HaruStoreOptions) {
    const files = storePaths(options);
    this.knowledgeFile = files.knowledge;
    this.maxBackups = options.maxBackups ?? 10;
    const storeOptions: Record<string, unknown> = { cwd: path.resolve(options.cwd) };
    if (options.configName) storeOptions.name = options.configName;
    const coreOptions = options.core === false ? undefined : options.core ?? coreStoreOptions();
    this.core = coreOptions ? new CoreStore(coreOptions, path.resolve(options.cwd)) : undefined;
    this.electron = this.core ? undefined as unknown as Store<Record<string, unknown>> : new Store<Record<string, unknown>>(storeOptions);
    this.archiveFile = files.archive;
    this.memoriesFile = files.memories;
    this.activityFile = files.activity;
    this.graphFile = files.graph;
    this.scheduleFile = files.schedule;
    this.thoughtsFile = files.thoughts;
  }

  // -- generic access. Same surface as electron-store so existing callers and
  //    google.ts's StoreLike keep working; the file itself is private to this
  //    class.

  /** Same shape as electron-store's get: a default value and unknown results,
   *  so call sites that check `get(key, fallback) === x` or cast the result
   *  keep compiling unchanged. */
  get(key: string, defaultValue?: unknown): unknown {
    const owned = coreIdentityValue(key);
    if (owned) return owned.value ?? defaultValue;
    if (this.core) {
      return this.core.getPath('config', key.split('.'), defaultValue);
    }
    return defaultValue === undefined
      ? this.electron.get(key)
      : this.electron.get(key, defaultValue);
  }

  set(key: string, value: unknown): void;
  set(object: Record<string, unknown>): void;
  set(keyOrObject: string | Record<string, unknown>, value?: unknown): void {
    assertIdentityWritable(typeof keyOrObject === 'string' ? [keyOrObject] : Object.keys(keyOrObject));
    if (this.core) {
      const config = this.core.get('config');
      for (const [key, entry] of Object.entries(typeof keyOrObject === 'string' ? { [keyOrObject]: value } : keyOrObject)) {
        const parts = key.split('.'); if (parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) throw new Error('invalid_config_path');
        let target = config; for (const part of parts.slice(0, -1)) { if (!target[part] || typeof target[part] !== 'object') target[part] = {}; target = target[part]; }
        target[parts.at(-1)!] = entry;
      }
      this.core.set('config', config); return;
    }
    if (typeof keyOrObject === 'string') {
      this.electron.set(keyOrObject, value);
    } else {
      this.electron.set(keyOrObject);
    }
  }

  delete(key: string): void {
    assertIdentityWritable([key]);
    if (this.core) {
      const config = this.core.get('config'), parts = key.split('.');
      if (parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) throw new Error('invalid_config_path');
      let target = config; for (const part of parts.slice(0, -1)) { if (!target?.[part] || typeof target[part] !== 'object') return; target = target[part]; }
      delete target[parts.at(-1)!]; this.core.set('config', config); return;
    }
    this.electron.delete(key);
  }

  has(key: string): boolean {
    if (this.core) return this.get(key) !== undefined;
    return this.electron.has(key);
  }

  // -- typed accessors for the memory subsystem. Its own file since v5; no
  //    subsystem ever touched the raw keys, which is what made the move a
  //    change to this file alone.

  /** The file as it stands, straight off disk. Public only so the v5 migration
   *  can reach it before the cache is trusted; everything else goes through the
   *  accessors below. */
  readMemoryFile(): MemoryFile {
    if (this.core) return normalizeMemoryFile(this.core.get('memories'));
    try {
      if (!existsSync(this.memoriesFile)) return { ...EMPTY_MEMORY_FILE };
      return normalizeMemoryFile(JSON.parse(readFileSync(this.memoriesFile, 'utf8')));
    } catch (error) {
      // Losing her memories is bad; refusing to start is worse, and the backup
      // taken before every migration is the way back to them.
      console.warn(`[store] could not read ${this.memoriesFile}:`, error instanceof Error ? error.message : error);
      return { ...EMPTY_MEMORY_FILE };
    }
  }

  /** Temp file then rename, so a crash mid-write cannot leave half a memory
   *  file behind — the same write knowledge.json and archive.json get. */
  writeMemoryFile(file: MemoryFile): void {
    if (this.core) { this.core.set('memories', file); return; }
    mkdirSync(path.dirname(this.memoriesFile), { recursive: true });
    const tmp = `${this.memoriesFile}.tmp-${process.pid}-${Date.now().toString(36)}`;
    writeFileSync(tmp, JSON.stringify(file));
    renameSync(tmp, this.memoriesFile);
    this.memoryCache = file;
  }

  private memories(): MemoryFile {
    if (this.core) return this.readMemoryFile();
    if (!this.memoryCache) this.memoryCache = this.readMemoryFile();
    return this.memoryCache;
  }

  getMemories(): MemoryRecord[] {
    return this.memories().memories;
  }

  setMemories(items: MemoryRecord[]): void {
    this.setMemoryState(items, this.getMemoryDeletions());
  }

  getMemoryDeletions(): MemoryDeletion[] {
    return mergeDeletions(this.memories().deletions);
  }

  /** Records and their deletion markers commit together, including pruning. */
  setMemoryState(items: MemoryRecord[], incoming: MemoryDeletion[]): void {
    this.writeMemoryFile(corePolicySync('memory-tools.storeState',[this.memories(),items,incoming,new Date().toISOString()]));return;
  }

  getSessions(): SessionSummary[] {
    return this.memories().sessions;
  }

  setSessions(items: SessionSummary[]): void {
    this.writeMemoryFile({ ...this.memories(), sessions: items });
  }

  getMonthNotes(): MonthNote[] {
    return this.memories().monthNotes;
  }

  setMonthNotes(items: MonthNote[]): void {
    this.writeMemoryFile({ ...this.memories(), monthNotes: items });
  }

  /** The trail of what she forgot and why — bounded so the log itself cannot
   *  grow forever. */
  getForgettingLog(): ForgettingEntry[] {
    return corePolicySync('memory-tools.forgetting',[this.memories()]);
  }

  setForgettingLog(entries: ForgettingEntry[]): void {
    this.writeMemoryFile({...this.memories(),forgettingLog:corePolicySync('memory-tools.boundForgetting',[entries])});return;
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

  // -- the day at the desk. Its own file for the archive's reason: it is
  //    appended to on every window change and holds nothing config.json needs.

  getActivityLog(): ActivityLog {
    if (this.core) return this.core.get('activity');
    if (!this.activityCache) {
      try {
        this.activityCache = existsSync(this.activityFile)
          ? normalizeActivityLog(JSON.parse(readFileSync(this.activityFile, 'utf8')))
          : {};
      } catch (error) {
        console.warn(`[store] could not read ${this.activityFile}:`, error instanceof Error ? error.message : error);
        this.activityCache = {};
      }
    }
    // Top-level copy, so a caller pruning a day it was only reading does not
    // prune it for everyone — the same guard getArchive makes.
    return { ...this.activityCache };
  }

  setActivityLog(log: ActivityLog): void {
    if (this.core) { this.core.set('activity', log); return; }
    this.activityCache = log;
    mkdirSync(path.dirname(this.activityFile), { recursive: true });
    const tmp = `${this.activityFile}.tmp-${process.pid}-${Date.now().toString(36)}`;
    writeFileSync(tmp, JSON.stringify(log));
    renameSync(tmp, this.activityFile);
  }

  // -- who is who. Its own file: rewritten once per piece of a day read, and
  //    nothing in config.json needs it.

  getFactGraph(): FactGraph {
    if (this.core) return this.core.get('graph');
    if (!this.graphCache) {
      try {
        this.graphCache = existsSync(this.graphFile) ? normalizeGraph(JSON.parse(readFileSync(this.graphFile, 'utf8'))) : normalizeGraph(null);
      } catch (error) {
        console.warn(`[store] could not read ${this.graphFile}:`, error instanceof Error ? error.message : error);
        this.graphCache = normalizeGraph(null);
      }
    }
    return this.graphCache;
  }

  setFactGraph(graph: FactGraph): void {
    if (this.core) { this.core.set('graph', graph); return; }
    this.graphCache = graph;
    mkdirSync(path.dirname(this.graphFile), { recursive: true });
    const tmp = `${this.graphFile}.tmp-${process.pid}-${Date.now().toString(36)}`;
    writeFileSync(tmp, JSON.stringify(graph));
    renameSync(tmp, this.graphFile);
  }

  // -- for later. Its own file, written before every run it records.

  getSchedule(): ScheduleFile {
    if (this.core) return this.core.get('schedule');
    if (!this.scheduleCache) {
      try {
        this.scheduleCache = existsSync(this.scheduleFile) ? normalizeSchedule(JSON.parse(readFileSync(this.scheduleFile, 'utf8'))) : normalizeSchedule(null);
      } catch (error) {
        console.warn(`[store] could not read ${this.scheduleFile}:`, error instanceof Error ? error.message : error);
        this.scheduleCache = normalizeSchedule(null);
      }
    }
    return this.scheduleCache;
  }

  setSchedule(file: ScheduleFile): void {
    if (this.core) { this.core.set('schedule', file); return; }
    this.scheduleCache = file;
    mkdirSync(path.dirname(this.scheduleFile), { recursive: true });
    const tmp = `${this.scheduleFile}.tmp-${process.pid}-${Date.now().toString(36)}`;
    writeFileSync(tmp, JSON.stringify(file));
    renameSync(tmp, this.scheduleFile);
  }

  // -- on her mind. Its own file, written each time she thinks something through.

  getThoughts(): ThoughtState {
    if (this.core) return this.core.get('thoughts');
    if (!this.thoughtsCache) {
      try {
        this.thoughtsCache = existsSync(this.thoughtsFile) ? normalizeThoughtState(JSON.parse(readFileSync(this.thoughtsFile, 'utf8'))) : normalizeThoughtState(null);
      } catch (error) {
        console.warn(`[store] could not read ${this.thoughtsFile}:`, error instanceof Error ? error.message : error);
        this.thoughtsCache = normalizeThoughtState(null);
      }
    }
    return this.thoughtsCache;
  }

  setThoughts(state: ThoughtState): void {
    if (this.core) { this.core.set('thoughts', state); return; }
    this.thoughtsCache = state;
    mkdirSync(path.dirname(this.thoughtsFile), { recursive: true });
    const tmp = `${this.thoughtsFile}.tmp-${process.pid}-${Date.now().toString(36)}`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, this.thoughtsFile);
  }

  // -- knowledge. The file is read and written only here; main.ts holds its own
  //    in-memory copy and hands it over through these two methods.

  /** Always a well-formed store: a missing file, an unparseable one, or one
   *  full of the wrong shapes all come back empty rather than throwing.
   *  loadKnowledge normalises what it reads, so this does not do it again. */
  getKnowledge(): KnowledgeStore {
    if (this.core) return this.core.get('knowledge');
    return loadKnowledge(this.knowledgeFile);
  }

  setKnowledge(value: KnowledgeStore): void {
    if (this.core) { this.core.set('knowledge', value); return; }
    saveKnowledge(this.knowledgeFile, value);
  }

  // -- the archive. Its own file since v4: see archive.ts for why.

  /** Every day of transcript she still has. Always an object, never undefined —
   *  callers used to write `?? {}` after every read of the old key. */
  getArchive(): Archive {
    if (this.core) return this.core.get('archive');
    if (!this.archiveCache) this.archiveCache = loadArchive(this.archiveFile);
    // A copy of the top level, so a caller that deletes a day it was only
    // reading cannot quietly delete it for everyone else too. The transcripts
    // themselves are shared; nothing appends to one in place.
    return { ...this.archiveCache };
  }

  setArchive(archive: Archive): void {
    if (this.core) { this.core.set('archive', archive); return; }
    this.archiveCache = archive;
    saveArchive(this.archiveFile, archive);
  }

  memorySourceRevision(): string {
    return this.core ? this.core.sourceRevision() : memorySourceRevision({ profile: this.get('profile'), her: { slate: this.get('her.slate') }, vault: { admitted: this.get('vault.admitted') } }, this.readMemoryFile(), this.getFactGraph());
  }

  resetMemoryAssets(): void { this.core?.clearExperiences(); }
  memoryBackend(): string { return this.core ? 'core' : 'desktop'; }
  close(): void { this.core?.close(); }

  // -- lifecycle safety.

  /**
   * Run several mutations as one unit: if the function throws, the store is
   * rolled back to the state it had when the transaction began. Writes during
   * the function still happen (electron-store saves on every set); the rollback
   * restores the previous state afterwards.
   */
  transactionAsync<T>(fn: () => T): Promise<T> {
    return this.core ? this.core.transactionAsync(fn) : Promise.resolve(this.transaction(fn));
  }

  /** The value now, the commit behind it (CoreStore.transactionBehind); plain transaction without a core. */
  transactionBehind<T>(fn: () => T): T {
    return this.core ? this.core.transactionBehind(fn) : this.transaction(fn);
  }

  transaction<T>(fn: () => T): T {
    if (this.core) return this.core.transaction(fn);
    const snapshot = JSON.parse(JSON.stringify(this.electron.store)) as Record<string, unknown>;
    // The memories are no longer inside electron-store, so restoring its
    // snapshot alone would roll back half of what the block tools do in here:
    // replace_in_block supersedes a memory and edits a block as one unit, and a
    // throw between them used to be safe. Snapshotted whether or not the body
    // touches them, because the body is the thing that decides that.
    const memories = JSON.parse(JSON.stringify(this.memories())) as MemoryFile;
    try {
      return fn();
    } catch (error) {
      this.electron.store = snapshot;
      // Written back only if something actually moved, so a transaction that
      // threw without touching a memory does not rewrite the file for nothing.
      if (JSON.stringify(this.memories()) !== JSON.stringify(memories)) this.writeMemoryFile(memories);
      throw error;
    }
  }

  /**
   * Copy every store file to timestamped backups, then drop the oldest so at
   * most `maxBackups` survive per reason. Returns the backup paths created.
   */
  backup(reason: string): string[] {
    if (this.core) return [this.core.backup(reason)];
    const made: string[] = [];
    for (const file of [this.electron.path, this.knowledgeFile, this.archiveFile, this.memoriesFile, this.activityFile, this.graphFile, this.scheduleFile, this.thoughtsFile]) {
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

  /** Whether every store file parses as JSON right now. */
  verify(): boolean {
    if (this.core) { try { return this.core.health().integrity === 'ok'; } catch { return false; } }
    const ok = (file: string) => {
      if (!existsSync(file)) return true;
      try {
        JSON.parse(readFileSync(file, 'utf8'));
        return true;
      } catch {
        return false;
      }
    };
    return ok(this.electron.path) && ok(this.knowledgeFile) && ok(this.archiveFile) && ok(this.memoriesFile) && ok(this.activityFile) && ok(this.graphFile) && ok(this.scheduleFile) && ok(this.thoughtsFile);
  }

  /**
   * Restore only damaged files, using the newest valid backup of each. Healthy
   * files may be newer than their backups and must not be rolled back. The
   * electron-store constructor parses config itself, so recovery is static.
   * Returns true only if something was restored and config can now be opened:
   * config is the one file the store cannot start without. Every other file
   * has a reader that warns and starts empty, so one of them damaged with no
   * backup is logged and left for salvage rather than allowed to keep her
   * from booting.
   */
  static recoverBackups(options: HaruStoreOptions): boolean {
    if (options.core || options.core !== false && coreStoreOptions()) return false;
    const files = storePaths(options);
    let restored = false;
    for (const file of new Set(Object.values(files))) {
      if (!existsSync(file)) continue;
      try {
        if (validStoreJson(readFileSync(file, 'utf8'))) continue;
        const newest = this.newestBackup(file);
        if (!newest) {
          console.warn(`[store] no valid backup for ${file}; leaving the damaged file in place`);
          continue;
        }
        const stamp = backupStamp();
        const damaged = `${file}.corrupt-${stamp}`;
        const temporary = `${file}.recovering-${stamp}`;
        // Keep the damaged bytes for manual salvage. Neither a failed write nor
        // a failed rename may destroy the only live copy.
        copyFileSync(file, damaged, constants.COPYFILE_EXCL);
        try {
          writeFileSync(temporary, newest.contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          renameSync(temporary, file);
        } finally {
          try { rmSync(temporary, { force: true }); } catch { /* best effort after a failed restore */ }
        }
        console.warn(`[store] recovered ${file} from ${newest.file}; damaged copy kept at ${damaged}`);
        restored = true;
      } catch (error) {
        console.warn(`[store] could not recover ${file}:`, error instanceof Error ? error.message : error);
      }
    }
    const configOpens = (): boolean => {
      try { return validStoreJson(readFileSync(files.config, 'utf8')); } catch { return false; }
    };
    return restored && (!existsSync(files.config) || configOpens());
  }

  /**
   * Restrict the store files to the current user (Windows). Headless Linux
   * relies on the same user-only permissions the rest of the app expects.
   * Best effort — a failure to tighten is logged, not fatal.
   */
  hardenPermissions(): void {
    if (this.core) return; // Core enforces 0600 for its database and backups.
    if (process.platform !== 'win32') return;
    // Every store file, not just the two that existed when this was written:
    // archive.json is ninety days of what was said and memories.json is what
    // she knows about them, and neither is less private than config.json.
    const targets = [this.electron.path, this.knowledgeFile, this.archiveFile, this.memoriesFile, this.activityFile, this.graphFile, this.scheduleFile, this.thoughtsFile].filter(existsSync);
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

  private static newestBackup(file: string): { file: string; contents: string } | null {
    const dir = path.dirname(file);
    const base = path.basename(file);
    const matches = readdirSync(dir)
      .filter(name => name.startsWith(`${base}.before-`))
      .flatMap(name => {
        try {
          const stat = statSync(path.join(dir, name));
          return stat.isFile() ? [{ name, mtime: stat.mtimeMs }] : [];
        } catch { return []; }
      })
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
    for (const match of matches) {
      const backup = path.join(dir, match.name);
      try {
        const contents = readFileSync(backup, 'utf8');
        if (validStoreJson(contents)) return { file: backup, contents };
      } catch { /* an unreadable backup must not hide an older usable one */ }
    }
    return null;
  }
}
