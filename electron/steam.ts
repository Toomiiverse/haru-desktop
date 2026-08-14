// Knowing which game it actually is.
//
// The foreground window gives a process name and a title, and for a great many
// games neither is the game. The Walking Dead reports itself as "Telltale
// Games", which is the publisher — so she spent an evening naming a company at
// somebody playing a story about Clementine. Titles are worse than useless here
// because they are confidently wrong.
//
// Steam already knows. Every installed game leaves an appmanifest listing its
// real name and its folder, so the mapping from "the thing that is running" to
// "The Walking Dead: The Telltale Definitive Series" is a few file reads and no
// model at all. This is not a speed fix — looking at the screen costs what it
// costs — it is the difference between reacting to a game and reacting to a
// company.

import fs from 'node:fs';
import path from 'node:path';

export type SteamGame = { appId: string; name: string; dir: string };

/**
 * Where Steam is. The registry would be more correct, but reading it costs a
 * process spawn and these four paths cover essentially everyone; a library on a
 * second drive is found through libraryfolders.vdf below rather than guessed.
 */
const STEAM_ROOTS = [
  'C:/Program Files (x86)/Steam',
  'C:/Program Files/Steam',
  `${process.env.LOCALAPPDATA ?? ''}/Steam`,
  `${process.env.PROGRAMFILES ?? ''}/Steam`,
];

/** Valve's own key-value format, read only as far as this needs it. */
function valveField(text: string, key: string): string | null {
  return new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(text)?.[1] ?? null;
}

/**
 * Every steamapps folder, including libraries on other drives.
 *
 * libraryfolders.vdf is the only way to find those: games installed to a second
 * disk leave nothing behind in the Steam directory itself.
 */
export function libraryFolders(readFile = fs.readFileSync, exists = fs.existsSync): string[] {
  const found = new Set<string>();
  for (const root of STEAM_ROOTS) {
    const apps = path.join(root, 'steamapps');
    if (!exists(apps)) continue;
    found.add(apps);
    const index = path.join(apps, 'libraryfolders.vdf');
    if (!exists(index)) continue;
    try {
      const text = String(readFile(index, 'utf8'));
      for (const [, folder] of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
        const other = path.join(folder.replace(/\\\\/g, '\\'), 'steamapps');
        if (exists(other)) found.add(other);
      }
    } catch { /* an unreadable index is not worth failing over */ }
  }
  return [...found];
}

/** What is installed, from the manifests Steam writes next to the games. */
export function installedGames(): SteamGame[] {
  const games: SteamGame[] = [];
  for (const apps of libraryFolders()) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(apps); } catch { continue; }
    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue;
      try {
        const text = fs.readFileSync(path.join(apps, entry), 'utf8');
        const appId = valveField(text, 'appid');
        const name = valveField(text, 'name');
        const installDir = valveField(text, 'installdir');
        if (!appId || !name || !installDir) continue;
        // Valve's own bundles are not games and would only ever be noise.
        if (/^Steamworks|^Steam Linux Runtime|Redistributables$/i.test(name)) continue;
        games.push({ appId, name, dir: path.join(apps, 'common', installDir) });
      } catch { /* a half-written manifest during an update */ }
    }
  }
  return games;
}

/**
 * Folders that hold an engine rather than a game, and would otherwise contribute
 * a UnityCrashHandler or a vcredist to the map and drown the real executable.
 */
const NOT_THE_GAME = /^(engine|binaries|_?commonredist|redist|directx|vcredist|dotnet|support|tools?|sdk|launcher)$/i;
const NOT_A_GAME_EXE = /(crashhandler|crashreport|unins|setup|installer|vcredist|dxsetup|dotnet|launcher|touchup|prereq|helper|service)/i;

/**
 * Executable names inside a game's folder, shallowly.
 *
 * Depth three finds the usual `Game/Binaries/Win64/Game.exe` without walking an
 * entire asset tree — a full scan of a modern install is tens of thousands of
 * files, once per game, for a string that is nearly always within three levels.
 */
function executablesIn(dir: string, depth = 3): string[] {
  if (depth < 0) return [];
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (NOT_THE_GAME.test(entry.name)) continue;
      found.push(...executablesIn(path.join(dir, entry.name), depth - 1));
    } else if (/\.exe$/i.test(entry.name) && !NOT_A_GAME_EXE.test(entry.name)) {
      found.push(entry.name.replace(/\.exe$/i, '').toLowerCase());
    }
  }
  return found;
}

/**
 * Process name to real game name.
 *
 * Built once and held, because it costs a directory walk per installed game and
 * the answer only changes when something is installed. Missing a newly installed
 * game until the next restart is a fair price for not doing this every time she
 * looks at the screen.
 */
export function buildGameIndex(games = installedGames()): Map<string, string> {
  const index = new Map<string, string>();
  for (const game of games) {
    // The folder name itself, for the many games whose exe matches it.
    index.set(path.basename(game.dir).toLowerCase(), game.name);
    for (const executable of executablesIn(game.dir)) {
      // First writer wins: an earlier, shallower executable is likelier to be
      // the game than a deeper one with the same name.
      if (!index.has(executable)) index.set(executable, game.name);
    }
  }
  return index;
}

/**
 * What they are playing, given the foreground process.
 *
 * Falls back to nothing rather than to a guess. A wrong game name is worse than
 * none: she will happily build a whole remark on it, and being confidently wrong
 * about what someone is playing is exactly the failure this replaces.
 */
export function gameFor(processName: string, index: Map<string, string>): string | null {
  const key = (processName ?? '').replace(/\.exe$/i, '').trim().toLowerCase();
  if (!key) return null;
  return index.get(key) ?? null;
}
