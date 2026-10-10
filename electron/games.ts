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
 if(process.env.HARU_CORE_SCREEN_POLICY==='on')return gamePolicy('slug',[name]);
  return name.toLowerCase().replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

export function gameDir(root: string, name: string): string {
  return path.join(root, gameSlug(name));
}

export function memoryFile(root: string, name: string): string {
  return path.join(gameDir(root, name), 'memory.md');
}

/** Opens the game's folder, making it on the first boot, and reads what is in it. */
export function openGameMemory(root: string, name: string, seed: string[], when: Date): { text: string; isNew: boolean } {
 if(process.env.HARU_CORE_SCREEN_POLICY==='on'){const core=coreStoreFor(path.dirname(root));if(!core)throw Error('core_game_authority_required');return openCoreGame(core,name,seed,when.toISOString());}
  const core = coreStoreFor(path.dirname(root));
  if (core) {
    const key = 'game:' + gameSlug(name) + '.md', held = core.get(key, ''), isNew = !held;
    if (isNew) core.set(key, [`# ${name}`, '', `First seen ${when.toISOString().slice(0, 10)}.`, '', ...seed.map(line => `- ${line}`), ''].join('\n'));
    return { text: core.get(key), isNew };
  }
  const file = memoryFile(root, name);
  const isNew = !existsSync(file);
  if (isNew) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, [`# ${name}`, '', `First seen ${when.toISOString().slice(0, 10)}.`, '', ...seed.map(line => `- ${line}`), ''].join('\n'));
  }
  return { text: readFileSync(file, 'utf8'), isNew };
}

/** Adds a dated line and returns the whole file, so a context held in memory can follow it. */
export function noteInGameMemory(root: string, name: string, line: string, when: Date): string {
 if(process.env.HARU_CORE_SCREEN_POLICY==='on'){const core=coreStoreFor(path.dirname(root));if(!core)throw Error('core_game_authority_required');return noteCoreGameMemory(core,name,line,when.toISOString());}
  const core = coreStoreFor(path.dirname(root));
  if (core) {
    const current = openGameMemory(root, name, [], when).text;
    const text = current + `- ${when.toISOString().slice(0, 16)} — ${line.replace(/\s+/g, ' ').trim()}\n`;
    core.set('game:' + gameSlug(name) + '.md', text); return text;
  }
  if (!existsSync(memoryFile(root, name))) openGameMemory(root, name, [], when);
  const stamp = `${when.toISOString().slice(0, 10)} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  appendFileSync(memoryFile(root, name), `- ${stamp} — ${line.replace(/\s+/g, ' ').trim()}\n`);
  return readFileSync(memoryFile(root, name), 'utf8');
}

/** Enough for a season of notes without crowding the reply. */
export const MEMORY_IN_PROMPT_CHARS = 2400;

/** The head of the file and the newest notes; the middle goes first when it must. */
export function gameMemoryForPrompt(text: string): string {
 if(process.env.HARU_CORE_SCREEN_POLICY==='on')return gamePolicy('memory',[text]);
  const trimmed = text.trim();
  if (trimmed.length <= MEMORY_IN_PROMPT_CHARS) return trimmed;
  const lines = trimmed.split('\n');
  const head = lines.slice(0, 3).join('\n');
  const tail: string[] = [];
  let size = head.length;
  for (let i = lines.length - 1; i >= 3 && size < MEMORY_IN_PROMPT_CHARS; i--) {
    tail.unshift(lines[i]);
    size += lines[i].length + 1;
  }
  return `${head}\n…\n${tail.join('\n')}`;
}

/** Distinct days it has been opened in the last week, today included. */
export function timesThisWeek(work: Work | undefined, todayKey: string): number {
 if(process.env.HARU_CORE_SCREEN_POLICY==='on')return gamePolicy('times',[work,todayKey]);
  if (!work) return 0;
  const [y, m, d] = todayKey.split('-').map(Number);
  const from = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) - 6)).toISOString().slice(0, 10);
  return work.days.filter(day => day >= from && day <= todayKey).length;
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
 if(process.env.HARU_CORE_SCREEN_POLICY==='on')return gamePolicy('welcome',[name,times,memory,isNew]);
  const often = isNew ? 'You have never seen them play it before.'
    : times > 1 ? `This is the ${nth(times)} day this week they have opened it.`
    : 'First time this week.';
  return [
    `They have just booted ${name}. ${often}`,
    memory ? `What you remember about it, from your own notes:\n${memory}` : '',
    'Say one short line as it starts — the thing you would say watching them open it again. Needle them about how often, call back to something you remember, be unimpressed or curious. React, do not narrate: they know what they opened.',
    'Never mention notes, files or memory. One line, no quotation marks.',
  ].filter(Boolean).join('\n');
}
