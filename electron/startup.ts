// Coming up with the machine, and getting back in when she does not.
//
// Two halves of one problem, which is why they live together. Auto-start goes
// through Electron's own login-item API rather than by writing the Run key
// directly: same registry entry in the end, but removing it is then Electron's
// job too, and an app that cannot uninstall its own auto-start is a nuisance
// somebody has to go into regedit to be rid of.
//
// The shortcut exists because auto-start is the part most likely to quietly not
// work — a moved build, a policy, an antivirus with opinions — and the answer to
// "she did not come up" should not be hunting through Program Files.

import { app, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Her icon on disk, wherever this build keeps it. */
function iconFile(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(process.resourcesPath ?? '', 'build', 'icon.ico'),
  ];
  return candidates.find(candidate => existsSync(candidate));
}

/**
 * Starting at login should not throw a full chat window at somebody who has
 * just logged in and is trying to get at something else. She comes up as the
 * character on the desktop and waits to be talked to; this flag is how the app
 * tells that kind of start from being launched deliberately.
 */
export const HIDDEN_FLAG = '--hidden';

export function startedHidden(argv: string[] = process.argv) {
  return argv.includes(HIDDEN_FLAG);
}

/**
 * What actually has to be run to start this app — not the same thing in a
 * packaged build as it is from source. Packaged, `execPath` is Haru's own exe
 * and needs nothing else. From source it is electron.exe, which is useless
 * without being handed the project directory, and a shortcut that omits it
 * opens a blank Electron window instead of the app.
 */
function launchTarget() {
  return { exe: process.execPath, appArgs: app.isPackaged ? [] : [app.getAppPath()] };
}

// The .lnk API takes one string rather than a list, and this project's own path
// has spaces in it — unquoted, the target directory arrives as three arguments
// and none of them are a directory.
function asCommandLine(args: string[]) {
  return args.map(arg => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
}

export function isAutoStartEnabled() {
  if (process.platform !== 'win32') return false;
  const { exe, appArgs } = launchTarget();
  return app.getLoginItemSettings({ path: exe, args: [...appArgs, HIDDEN_FLAG] }).openAtLogin;
}

/**
 * Registered against the current executable rather than whatever was there
 * before, so moving or repackaging the build and toggling this off and on is
 * enough to repair a stale entry pointing at an exe that no longer exists.
 */
export function setAutoStart(enabled: boolean) {
  if (process.platform !== 'win32') return false;
  const { exe, appArgs } = launchTarget();
  app.setLoginItemSettings({ openAtLogin: enabled, path: exe, args: [...appArgs, HIDDEN_FLAG] });
  return isAutoStartEnabled();
}

export function desktopShortcutPath() {
  return path.join(app.getPath('desktop'), 'Haru.lnk');
}

/**
 * Deliberately not given the hidden flag: this is the one someone reaches for
 * when they think she has not started, and it should open the window that
 * proves she has.
 */
export function createDesktopShortcut() {
  if (process.platform !== 'win32') throw new Error('Desktop shortcuts are a Windows thing.');
  const { exe, appArgs } = launchTarget();
  const target = desktopShortcutPath();
  const ok = shell.writeShortcutLink(target, 'create', {
    target: exe,
    args: asCommandLine(appArgs),
    // Without this a shortcut to a dev build resolves its relative paths against
    // wherever Explorer happened to be.
    cwd: app.isPackaged ? path.dirname(exe) : app.getAppPath(),
    description: 'Haru desktop companion',
    // The packaged exe carries its own icon. Unpackaged, exe is electron.exe and
    // carries Electron's — which this used to hand to Windows regardless, so a
    // shortcut made from source arrived wearing somebody else's logo and looked
    // for all the world like it was starting a different application.
    icon: iconFile() ?? exe,
    iconIndex: 0,
    // Always, not only when packaged: it is what lets Windows tie a pinned
    // shortcut to the window that opens from it, and that is worth more from
    // source than it is in a build nobody has made yet.
    appUserModelId: 'com.haru.desktop',
  });
  if (!ok) throw new Error('Windows refused to write the shortcut.');
  return target;
}
