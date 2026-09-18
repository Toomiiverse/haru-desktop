// The Linux desktop answers, read from captured output so the tests neither
// need a compositor nor leave one alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findApps, onPath, parseActiveWindow, parseClients, parseDesktopEntry, parsePactlVolume, parseWpctlVolume, powerCommand } from '../electron/linuxdesktop';

test('a focused window becomes a process, a title and a rectangle', () => {
  const window = parseActiveWindow(JSON.stringify({ class: 'firefox', title: 'GitHub', at: [100, 50], size: [1200, 800], fullscreen: 0 }));
  assert.deepEqual(window, { process: 'firefox', title: 'GitHub', fullscreen: false, left: 100, top: 50, right: 1300, bottom: 850 });
});

test('nothing focused is nothing, not a window with an empty name', () => {
  assert.equal(parseActiveWindow('{}'), null);
  assert.equal(parseActiveWindow('not json'), null);
  assert.equal(parseActiveWindow('null'), null);
});

test('a fullscreen window is flagged, whichever of Hyprland\'s modes it is', () => {
  const full = parseActiveWindow(JSON.stringify({ class: 'mpv', title: 'A Film', at: [0, 0], size: [1920, 1080], fullscreen: 2 }));
  assert.equal(full?.fullscreen, true);
  const maximised = parseActiveWindow(JSON.stringify({ class: 'code', title: 'x', at: [0, 0], size: [1920, 1040], fullscreen: 1 }));
  assert.equal(maximised?.fullscreen, true);
});

test('clients are deduped by class and ordered', () => {
  const running = parseClients(JSON.stringify([
    { class: 'steam', title: 'Steam' },
    { class: 'firefox', title: 'A tab' },
    { class: 'firefox', title: 'Another tab' },
  ]));
  assert.deepEqual(running.map(entry => entry.name), ['firefox', 'steam']);
  assert.equal(running[0].title, 'A tab');
  assert.deepEqual(parseClients('nonsense'), []);
});

test('a desktop entry is a name and an exec, or it is not an app', () => {
  assert.deepEqual(
    parseDesktopEntry('[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox %u\n'),
    { name: 'Firefox', exec: 'firefox %u' },
  );
  // Hidden from the menu is not something to offer her to open.
  assert.equal(parseDesktopEntry('[Desktop Entry]\nType=Application\nName=Help\nExec=help\nNoDisplay=true\n'), null);
  assert.equal(parseDesktopEntry('[Desktop Entry]\nType=Link\nName=Website\nExec=x\n'), null);
  assert.equal(parseDesktopEntry('[Desktop Entry]\nType=Application\nName=NoExec\n'), null);
});

test('findApps walks a menu directory and drops what is not an app', () => {
  const files = new Map([
    ['/apps/firefox.desktop', '[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox\n'],
    ['/apps/help.desktop', '[Desktop Entry]\nType=Application\nName=Help\nExec=help\nNoDisplay=true\n'],
    ['/apps/readme.txt', 'not an entry'],
  ]);
  const apps = findApps(
    ['/apps'],
    () => [...files.keys()].map(file => file.slice('/apps/'.length)),
    file => files.get(file) ?? '',
    dir => dir === '/apps',
  );
  assert.deepEqual(apps, [{ name: 'Firefox', target: '/apps/firefox.desktop' }]);
});

test('the volume comes back from wpctl or pactl', () => {
  assert.equal(parseWpctlVolume('Volume: 0.35'), 0.35);
  assert.equal(parseWpctlVolume('Volume: 1.00 [MUTED]'), 1);
  assert.equal(parseWpctlVolume('no volume here'), null);
  assert.equal(parsePactlVolume('Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50% / -18.06 dB'), 0.5);
  assert.equal(parsePactlVolume('Failure: No such entity'), null);
});

test('power goes through systemd and logind', () => {
  assert.deepEqual(powerCommand('shutdown'), { file: 'shutdown', args: ['-h', '+1'] });
  assert.deepEqual(powerCommand('restart'), { file: 'shutdown', args: ['-r', '+1'] });
  assert.deepEqual(powerCommand('sleep'), { file: 'systemctl', args: ['suspend'] });
  assert.deepEqual(powerCommand('lock'), { file: 'loginctl', args: ['lock-session'] });
});

test('onPath tells what is installed from what is not', () => {
  assert.equal(onPath('sh'), true);
  assert.equal(onPath('haru-definitely-not-installed'), false);
});
