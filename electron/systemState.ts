import type { SystemCollected } from './system';

export type SystemSample = {
  cpu_percent: number;
  ram_percent: number;
  gpu_percent: number;
  vram_percent: number;
  disk_percent: number;
  temperature_c: number;
  network_status: 'online' | 'offline' | 'unknown';
  /** Container names that are not running, restarting, or unhealthy. */
  docker_problems: string[];
  docker_problem: boolean;
  at: string;
};

export type Threshold = { value: number; seconds: number };
export type EventThresholds = {
  gpu_percent?: Threshold;
  ram_percent?: Threshold;
  disk_percent?: Threshold;
  gpu_temp_c?: Threshold;
  network_down?: { seconds: number };
  docker_crash?: boolean;
};

export type SystemEvent = { kind: string; message: string; at: string };

export function sampleFromCollectors(collected: SystemCollected, now: Date = new Date()): SystemSample {
  const disk = (collected.disk ?? []).find(mount => mount.mount === '/') ?? (collected.disk ?? [])[0];
  const gpu = collected.gpu?.[0];
  const vram = gpu && gpu.vram_total_gb > 0 ? Math.round((gpu.vram_used_gb / gpu.vram_total_gb) * 100) : 0;
  const dockerProblems = !collected.docker
    ? []
    : collected.docker.daemon !== 'up'
      ? ['docker daemon']
      : collected.docker.containers
          .filter(container => container.state !== 'running' || container.health === 'unhealthy' || /restarting|unhealthy/i.test(container.status))
          .map(container => container.name);
  return {
    cpu_percent: collected.cpu?.usage_percent ?? 0,
    ram_percent: collected.memory?.usage_percent ?? 0,
    gpu_percent: gpu?.utilization_percent ?? 0,
    vram_percent: vram,
    disk_percent: disk?.usage_percent ?? 0,
    temperature_c: gpu?.temperature_c ?? 0,
    network_status: collected.network?.status ?? 'unknown',
    docker_problems: dockerProblems,
    docker_problem: dockerProblems.length > 0,
    at: now.toISOString(),
  };
}

/**
 * How long the newest run of consecutive samples satisfying `pred` has lasted.
 * A spike is one sample and a short span; "sustained above the threshold" is a
 * long span, which is the distinction the event thresholds are drawn around.
 */
function sustainedSpan(samples: SystemSample[], now: Date, pred: (sample: SystemSample) => boolean): number {
  if (!samples.length) return 0;
  let oldest = samples.length;
  for (let index = samples.length - 1; index >= 0; index--) {
    if (!pred(samples[index])) break;
    oldest = index;
  }
  if (oldest === samples.length) return 0;
  return now.getTime() - Date.parse(samples[oldest].at);
}

export function checkEvents(
  samples: SystemSample[],
  thresholds: EventThresholds,
  now: Date,
  minGapMs: number,
  lastFired: Record<string, number>,
): SystemEvent[] {
  const events: SystemEvent[] = [];
  const fire = (kind: string, message: string) => {
    if (now.getTime() - (lastFired[kind] ?? 0) < minGapMs) return;
    lastFired[kind] = now.getTime();
    events.push({ kind, message, at: now.toISOString() });
  };

  const latest = samples[samples.length - 1];

  if (thresholds.gpu_percent) {
    const span = sustainedSpan(samples, now, sample => sample.gpu_percent >= (thresholds.gpu_percent?.value ?? 0));
    if (span >= (thresholds.gpu_percent.seconds ?? 0) * 1000) fire('gpu_percent', `Your GPU has been above ${thresholds.gpu_percent.value}% utilisation for the last ${thresholds.gpu_percent.seconds} seconds.`);
  }

  if (thresholds.ram_percent) {
    const span = sustainedSpan(samples, now, sample => sample.ram_percent >= (thresholds.ram_percent?.value ?? 0));
    if (span >= (thresholds.ram_percent.seconds ?? 0) * 1000) fire('ram_percent', `RAM has been above ${thresholds.ram_percent.value}% for the last ${thresholds.ram_percent.seconds} seconds.`);
  }

  if (thresholds.disk_percent) {
    const span = sustainedSpan(samples, now, sample => sample.disk_percent >= (thresholds.disk_percent?.value ?? 0));
    if (span >= (thresholds.disk_percent.seconds ?? 0) * 1000) fire('disk_percent', `The disk has been above ${thresholds.disk_percent.value}% full for the last ${thresholds.disk_percent.seconds} seconds.`);
  }

  if (thresholds.gpu_temp_c) {
    const span = sustainedSpan(samples, now, sample => sample.temperature_c >= (thresholds.gpu_temp_c?.value ?? 0));
    if (span >= (thresholds.gpu_temp_c.seconds ?? 0) * 1000) fire('gpu_temp_c', `The GPU has been above ${thresholds.gpu_temp_c.value}°C for the last ${thresholds.gpu_temp_c.seconds} seconds.`);
  }

  if (thresholds.network_down && latest) {
    const span = sustainedSpan(samples, now, sample => sample.network_status !== 'online');
    if (span >= (thresholds.network_down.seconds ?? 0) * 1000) fire('network_down', 'The server has lost its network connection.');
  }

  if (thresholds.docker_crash && latest?.docker_problems?.length) {
    // Fires on a problem that was not there a sample ago, so a container that
    // was already stopped before she was watching does not nag every few
    // minutes forever.
    const previous = samples[samples.length - 2];
    if (previous) {
      const known = new Set(previous.docker_problems ?? []);
      const fresh = latest.docker_problems.filter(name => !known.has(name));
      if (fresh.length) fire('docker_crash', `Docker container${fresh.length === 1 ? '' : 's'} ${fresh.join(', ')} stopped, is restarting, or is unhealthy.`);
    }
  }

  return events;
}
