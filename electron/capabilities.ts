// What she can actually do on the machine she is running on, said out loud at
// startup.
//
// These features were Windows-only and the report said so: five lines, all off,
// every launch on Linux. The Windows half is still the PowerShell helper, the
// launcher and power controls, and the location service — but Linux answers
// four of the five now, through Hyprland, PipeWire and systemd, and a Linux
// laptop is not a machine where the whole report should read as absent.
//
// So the platform question is no longer "is this Windows" but "did the tools
// this needs actually turn up". The answer is computed once, here, from what is
// on PATH, and both the startup lines and the feature gates read the same
// object — so "she cannot see your windows" and "you have no windows open" can
// never again be the same answer.
//
// The fifth is still absent, and says why rather than pretending: a location
// fix on Linux needs the GeoClue portal, which this app has no client for.

import { detectLinuxSupport } from './linuxdesktop';

export type Capability = {
  /** What it does, in the terms someone would ask for it. */
  name: string;
  on: boolean;
  /** What it needs, and only when it is off. */
  needs?: string;
};

/** Which of the platform features this machine can actually offer. */
export type PlatformSupport = {
  /** Ducking her voice over other audio, and noticing something go fullscreen. */
  backgroundHelper: boolean;
  /** Seeing which program is in front of them. */
  activeWindow: boolean;
  /** Opening, closing, shutting down, sleeping, locking. */
  desktopControl: boolean;
  /** A real location fix rather than a place typed by hand. */
  location: boolean;
  /** Standing aside for a game, which needs the foreground window. */
  gameDetection: boolean;
};

const FEATURE_ORDER: { name: string; key: keyof PlatformSupport }[] = [
  { name: 'ducking her voice over other audio, and noticing fullscreen', key: 'backgroundHelper' },
  { name: 'seeing which program you are in', key: 'activeWindow' },
  { name: 'opening, closing and powering the machine', key: 'desktopControl' },
  { name: 'a location fix', key: 'location' },
  { name: 'standing aside for a game', key: 'gameDetection' },
];

/** What each feature needs, said differently on the platform it is missing on. */
const NEEDS: Record<keyof PlatformSupport, (platform: NodeJS.Platform) => string> = {
  backgroundHelper: platform => platform === 'linux'
    ? 'the Hyprland compositor and a PipeWire mixer (hyprctl, wpctl or pactl)'
    : 'the Windows helper (PowerShell)',
  activeWindow: platform => platform === 'linux'
    ? 'the Hyprland compositor (hyprctl)'
    : 'the Windows helper (PowerShell)',
  desktopControl: platform => platform === 'linux'
    ? 'a freedesktop launcher and systemd (gio, systemctl or loginctl)'
    : 'Windows (cmd, taskkill, shutdown)',
  location: platform => platform === 'linux'
    ? 'a location sensor (GeoClue or the desktop portal) — the place set in Setup is used as a stand-in'
    : 'the Windows location service',
  gameDetection: platform => platform === 'linux'
    ? 'the Hyprland compositor (hyprctl)'
    : 'the Windows helper (PowerShell)',
};

/**
 * What the platform offers, detected rather than assumed. Memoised because it
 * walks PATH and is asked on every startup gate; the answer cannot change while
 * the process lives.
 */
let detected: { platform: NodeJS.Platform; support: PlatformSupport } | null = null;

export function defaultSupport(platform: NodeJS.Platform = process.platform): PlatformSupport {
  if (detected?.platform === platform) return detected.support;
  const support = platform === 'win32'
    ? { backgroundHelper: true, activeWindow: true, desktopControl: true, location: true, gameDetection: true }
    : platform === 'linux'
      ? linuxSupport()
      : { backgroundHelper: false, activeWindow: false, desktopControl: false, location: false, gameDetection: false };
  detected = { platform, support };
  return support;
}

function linuxSupport(): PlatformSupport {
  const tools = detectLinuxSupport();
  return {
    backgroundHelper: tools.foreground || tools.audio,
    activeWindow: tools.foreground,
    desktopControl: tools.apps || tools.power,
    // Not "no tools" but "no client for the portal it needs" — the distinction
    // is the whole reason the capability report exists.
    location: false,
    gameDetection: tools.foreground,
  };
}

/**
 * Whether this machine can see what is in front of *it*.
 *
 * The distinction matters now that the desk's activity log syncs here. A game
 * running on the desk is a fact about the desk, and the only reason the server
 * does not act on it is that nothing currently copies a synced entry into
 * currentActivity. A Linux laptop with a compositor can see its own screen, so
 * this is no longer a Windows question.
 */
export function seesItsOwnScreen(platform: NodeJS.Platform = process.platform, support?: PlatformSupport): boolean {
  return (support ?? defaultSupport(platform)).gameDetection;
}

export function describeCapabilities(platform: NodeJS.Platform, support: PlatformSupport = defaultSupport(platform)): Capability[] {
  return FEATURE_ORDER.map(feature => support[feature.key]
    ? { name: feature.name, on: true }
    : { name: feature.name, on: false, needs: NEEDS[feature.key](platform) });
}

/**
 * The report, as the lines to log. Silent about nothing: a platform where
 * everything works still says so, because "no capability lines" would once
 * again be indistinguishable from "the report did not run".
 */
export function capabilityLines(capabilities: Capability[], platform: NodeJS.Platform): string[] {
  const off = capabilities.filter(capability => !capability.on);
  if (!off.length) return [`[capabilities] all ${capabilities.length} platform features available on ${platform}`];
  return [
    `[capabilities] ${off.length} of ${capabilities.length} platform features are off on ${platform}:`,
    ...off.map(capability => `[capabilities]   ${capability.name} — needs ${capability.needs}`),
  ];
}

export function reportCapabilities(platform: NodeJS.Platform = process.platform, log = console.log): Capability[] {
  const capabilities = describeCapabilities(platform);
  for (const line of capabilityLines(capabilities, platform)) log(line);
  return capabilities;
}
