import {gamePolicy,openCoreGame,noteCoreGameMemory} from './core-games';
import { coreStoreFor } from './core-store';
// One Markdown document per game, held in Core when primary storage is on.
// The folder behavior below belongs to the legacy file backend.
//
// Everything she knew about a game was scattered: a Work in the following
// tracker, a guide note among the nights, captions in the activity log, and
// the last scene she glanced at. None of it was hers to open when the game
// came up. So each game gets a folder under userData/games/<slug>/ with a
// memory.md in it — made on the first boot, seeded with whatever she had
// already read about it, and added to as she watches. She reads it when the
// game starts, and it rides along in her context while it is running.
//
// Markdown, not JSON, because it is theirs to open too: a note typed into the
// file by hand is a memory she has the next time the game boots.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Work } from './following';

export function gameSlug(name: string): string {
 return gamePolicy('slug',[name]);
}

export function gameDir(root: string, name: string): string {
  return path.join(root, gameSlug(name));
}

export function memoryFile(root: string, name: string): string {
  return path.join(gameDir(root, name), 'memory.md');
}

/** Opens the game's folder, making it on the first boot, and reads what is in it. */
export function openGameMemory(root: string, name: string, seed: string[], when: Date): { text: string; isNew: boolean } {
 {const core=coreStoreFor(path.dirname(root));if(!core)throw Error('core_game_authority_required');return openCoreGame(core,name,seed,when.toISOString());}
}

/** Adds a dated line and returns the whole file, so a context held in memory can follow it. */
export function noteInGameMemory(root: string, name: string, line: string, when: Date): string {
 {const core=coreStoreFor(path.dirname(root));if(!core)throw Error('core_game_authority_required');return noteCoreGameMemory(core,name,line,when.toISOString());}
}

/** Enough for a season of notes without crowding the reply. */
export const MEMORY_IN_PROMPT_CHARS = 2400;

/** The head of the file and the newest notes; the middle goes first when it must. */
export function gameMemoryForPrompt(text: string): string {
 return gamePolicy('memory',[text]);
}

/** Distinct days it has been opened in the last week, today included. */
export function timesThisWeek(work: Work | undefined, todayKey: string): number {
 return gamePolicy('times',[work,todayKey]);
}

function nth(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * What she is told as the game comes up.
 *
 * The line reacts to their opening it — how often, what she remembers of the
 * last time — not to the game. They know what they just launched.
 */
export function welcomePrompt(name: string, times: number, memory: string, isNew: boolean): string {
 return gamePolicy('welcome',[name,times,memory,isNew]);
}
