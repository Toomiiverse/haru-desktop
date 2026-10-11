import {coreSteamLibraries,coreSteamGames,coreSteamExecutables,coreSteamIndex} from './core-steam-observation';
import {devicePolicy} from './core-device-activity';
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
 return coreSteamLibraries(STEAM_ROOTS,readFile,exists);
}

/** What is installed, from the manifests Steam writes next to the games. */
export function installedGames(): SteamGame[] {
 return coreSteamGames(libraryFolders());
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
 return coreSteamExecutables(dir,depth);
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
 return coreSteamIndex(games);
}

/**
 * What they are playing, given the foreground process.
 *
 * Falls back to nothing rather than to a guess. A wrong game name is worse than
 * none: she will happily build a whole remark on it, and being confidently wrong
 * about what someone is playing is exactly the failure this replaces.
 */
export function gameFor(processName: string, index: Map<string, string>): string | null {
 return devicePolicy('gameFor',[processName,[...index]]);
}
