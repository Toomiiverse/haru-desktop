// What she can actually do on the machine she is running on, said out loud at
// startup.
//
// Parts of Haru are Windows-only and always have been: the PowerShell helper
// that reports the foreground window and the system volume, the launcher and
// power controls, the location fix. That is fine. What is not fine is how they
// behaved everywhere else — listRunning() resolved an empty list on spawn
// failure, so "she cannot see your windows on Linux" and "you have no windows
// open" were the same answer; the location call rejected into a catch; the
// helper spawned regardless and left one ENOENT per launch in the log.
//
// This is the same failure as the calendar that synced to nothing for months:
// a feature that is off looks exactly like a feature with nothing to say. So
// the platform-dependent features are named here, once, and reported at
// startup — on or off, and if off, why. The report costs four lines in a log
// and is the difference between a known gap and a mystery.

export type Capability = {
  /** What it does, in the terms someone would ask for it. */
  name: string;
  on: boolean;
  /** What it needs, and only when it is off. */
  needs?: string;
};

/** Everything whose availability depends on which OS this is. */
const PLATFORM_FEATURES: { name: string; needs: string }[] = [
  { name: 'ducking her voice over other audio, and noticing fullscreen', needs: 'the Windows helper (PowerShell)' },
  { name: 'seeing which program you are in', needs: 'the Windows helper (PowerShell)' },
  { name: 'opening, closing and powering the machine', needs: 'Windows (cmd, taskkill, shutdown)' },
  { name: 'a location fix', needs: 'the Windows location service' },
];

export function describeCapabilities(platform: NodeJS.Platform): Capability[] {
  const on = platform === 'win32';
  return PLATFORM_FEATURES.map(feature => on
    ? { name: feature.name, on: true }
    : { name: feature.name, on: false, needs: feature.needs });
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
