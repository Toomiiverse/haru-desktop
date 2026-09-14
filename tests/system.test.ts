import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNvidiaSmi,
  parseFree,
  parseDf,
  parsePs,
  parseDockerPsJson,
  applyDockerStats,
  applyDockerRestarts,
  parseOsRelease,
  parseUptime,
  parseCpuCount,
  parseCpuModel,
  parseProcStat,
  cpuUsagePercent,
  parseIpBrief,
  parseSystemctlState,
  diagnose,
  type SystemCollected,
  type Diagnosis,
} from '../electron/system';
import { sampleFromCollectors, checkEvents, type SystemSample } from '../electron/systemState';

// ---- parsers ---------------------------------------------------------------

test('parseNvidiaSmi turns the CSV into structured GPU objects', () => {
  const csv = 'NVIDIA GeForce GTX 1660 Ti, 6144, 4878, 73, 38\nNVIDIA GeForce RTX 4090, 24564, 1000, 20, 45\n';
  const gpus = parseNvidiaSmi(csv);
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].name, 'NVIDIA GeForce GTX 1660 Ti');
  assert.equal(gpus[0].vram_total_gb, 6);
  assert.equal(gpus[0].vram_used_gb, 4.8);
  assert.equal(gpus[0].utilization_percent, 73);
  assert.equal(gpus[0].temperature_c, 38);
});

test('parseFree reads Mem totals and usage percent', () => {
  const out = [
    '              total        used        free      shared  buff/cache   available',
    'Mem:   67550359552  14318305280  29148258304   123207680  24083804160  49376509952',
    'Swap:  17179869184           0  17179869184',
  ].join('\n');
  const memory = parseFree(out);
  assert.equal(memory?.total_gb, 67.6);
  assert.equal(memory?.used_gb, 14.3);
  assert.equal(memory?.usage_percent, 21);
});

test('parseDf keeps real mounts and drops pseudo filesystems', () => {
  const out = [
    'Filesystem     1024-blocks     Used Available Capacity Mounted on',
    '/dev/sda1       480345384 113429372 342615248      25% /',
    'tmpfs           131684832     61376 131623456       1% /dev/shm',
  ].join('\n');
  const mounts = parseDf(out);
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].mount, '/');
  assert.equal(mounts[0].usage_percent, 25);
  assert.equal(mounts[0].total_gb, 491.9);
});

test('parsePs reads pid, name, cpu, rss', () => {
  const out = ['  1234 bash              0.0   0.0   5872 xvfb', '  5678 node              12.3   1.2  123456 /usr/bin/node server.js'].join('\n');
  const processes = parsePs(out);
  assert.equal(processes.length, 2);
  assert.equal(processes[1].pid, 5678);
  assert.equal(processes[1].name, 'node');
  assert.equal(processes[1].cpu_percent, 12.3);
  assert.equal(processes[1].rss_mb, 121);
});

test('parseDockerPsJson reads container state and health from status', () => {
  const line = JSON.stringify({ Names: 'jellyfin', Image: 'jellyfin/jellyfin', State: 'running', Status: 'Up 6 days (healthy)' });
  const containers = parseDockerPsJson(line);
  assert.equal(containers.length, 1);
  assert.equal(containers[0].name, 'jellyfin');
  assert.equal(containers[0].health, 'healthy');
});

test('applyDockerStats fills cpu and memory per container', () => {
  const base = [{ name: 'jellyfin', image: 'jellyfin/jellyfin', status: 'Up', state: 'running' }];
  const stats = JSON.stringify({ name: 'jellyfin', cpu_percentage: '0.06%', mem_usage: '123.4MiB / 7.7GiB' });
  const containers = applyDockerStats(base, stats);
  assert.equal(containers[0].cpu_percent, 0.06);
  assert.equal(containers[0].memory_mb, 123.4);
});

test('applyDockerRestarts reads restart counts and health', () => {
  const base = [{ name: 'sonarr', image: 'x', status: 'Up', state: 'running', restart_count: 0, cpu_percent: 0, memory_mb: 0 }];
  const containers = applyDockerRestarts(base, '/sonarr|12|');
  assert.equal(containers[0].restart_count, 12);
});

test('parseOsRelease, parseUptime, cpu and network parsers', () => {
  assert.equal(parseOsRelease('PRETTY_NAME="Ubuntu 26.04 LTS"\n'), 'Ubuntu 26.04 LTS');
  assert.equal(parseUptime(270000), '3 days 3 hours');
  assert.equal(parseUptime(45), 'moments');
  assert.equal(parseCpuModel('Model name:                              Intel i7-8700K\n'), 'Intel i7-8700K');
  assert.equal(parseCpuCount('processor : 0\nprocessor : 1\nprocessor : 2'), 3);
  const before = parseProcStat('cpu  100 0 50 700 0 0 0 0');
  const after = parseProcStat('cpu  110 0 60 760 0 0 0 0');
  assert.equal(cpuUsagePercent(before, after), 25);
  const net = parseIpBrief('lo               UNKNOWN        127.0.0.1/8 ::1/128\nenp0s31f6        UP             192.168.50.15/24 fe80::7349/64\n');
  assert.equal(net.length, 2);
  assert.deepEqual(net[1].addresses, ['192.168.50.15', 'fe80::7349']);
});

test('parseSystemctlState maps known and unknown output', () => {
  assert.equal(parseSystemctlState('active'), 'active');
  assert.equal(parseSystemctlState('failed'), 'failed');
  assert.equal(parseSystemctlState('inactive'), 'inactive');
  assert.equal(parseSystemctlState('not-a-real-state'), 'unknown');
});

// ---- diagnose --------------------------------------------------------------

function collected(overrides: Partial<SystemCollected> = {}): SystemCollected {
  return {
    system: { hostname: 'haruserver', os: 'Ubuntu 26.04', kernel: '6.0', uptime: '3 days', load: [1, 1, 1] },
    cpu: { model: 'Intel', cores: 8, usage_percent: 10 },
    gpu: [{ name: 'GTX 1660 Ti', vram_total_gb: 6, vram_used_gb: 2, utilization_percent: 20, temperature_c: 45 }],
    memory: { total_gb: 64, used_gb: 10, available_gb: 54, usage_percent: 16 },
    disk: [{ filesystem: '/dev/sda1', mount: '/', total_gb: 458, used_gb: 100, available_gb: 358, usage_percent: 22 }],
    network: { interfaces: [{ name: 'enp0s31f6', addresses: ['192.168.50.15'] }], default_route: 'default via 192.168.50.1', status: 'online' },
    processes: [],
    docker: { daemon: 'up', containers: [{ name: 'jellyfin', image: 'jellyfin/jellyfin', status: 'Up (healthy)', state: 'running', health: 'healthy', restart_count: 0, cpu_percent: 0.1, memory_mb: 100 }] },
    services: [{ name: 'haru', state: 'active' }],
    ...overrides,
  };
}

function assertStatus(d: Diagnosis, expected: Diagnosis['status']) {
  assert.equal(d.status, expected, `expected ${expected}, got ${d.status} (${d.findings.join('; ')})`);
}

test('diagnose reports ok on a healthy machine', () => {
  assertStatus(diagnose('all', collected()), 'ok');
});

test('diagnose flags a saturated GPU', () => {
  const gpu = [{ name: 'GTX 1660 Ti', vram_total_gb: 6, vram_used_gb: 5.8, utilization_percent: 95, temperature_c: 80 }];
  const d = diagnose('gpu', collected({ gpu }));
  assertStatus(d, 'critical');
  assert.ok(d.findings.some(finding => /95%/.test(finding)));
});

test('diagnose flags a full disk', () => {
  const disk = [{ filesystem: '/dev/sda1', mount: '/', total_gb: 100, used_gb: 96, available_gb: 4, usage_percent: 96 }];
  assertStatus(diagnose('disk', collected({ disk })), 'critical');
});

test('diagnose flags an unhealthy docker container', () => {
  const docker = { daemon: 'up' as const, containers: [{ name: 'redis', image: 'redis:7', status: 'Up (unhealthy)', state: 'running', health: 'unhealthy', restart_count: 3, cpu_percent: 0.1, memory_mb: 50 }] };
  assertStatus(diagnose('docker', collected({ docker })), 'critical');
});

test('diagnose flags the docker daemon being down', () => {
  assertStatus(diagnose('docker', collected({ docker: null })), 'critical');
});

test('diagnose flags an offline network', () => {
  const network = { interfaces: [], default_route: '', status: 'offline' as const };
  assertStatus(diagnose('network', collected({ network })), 'critical');
});

test('diagnose flags haru not active', () => {
  const services = [{ name: 'haru', state: 'failed' as const }];
  assertStatus(diagnose('haru', collected({ services })), 'critical');
});

// ---- event detector --------------------------------------------------------

const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const base: SystemSample = {
  cpu_percent: 10, ram_percent: 20, gpu_percent: 20, vram_percent: 30, disk_percent: 30,
  temperature_c: 40, network_status: 'online', docker_problems: [], docker_problem: false, at: at(10),
};

test('a sustained GPU overload fires exactly once', () => {
  const fired: Record<string, number> = {};
  const events = checkEvents(
    [{ ...base, gpu_percent: 95, at: at(70) }, { ...base, gpu_percent: 95, at: at(40) }, { ...base, gpu_percent: 95, at: at(10) }],
    { gpu_percent: { value: 90, seconds: 60 } },
    new Date(),
    0,
    fired,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'gpu_percent');
  assert.ok(/above 90%/.test(events[0].message));
});

test('a single spike does not fire', () => {
  const events = checkEvents(
    [{ ...base, gpu_percent: 10, at: at(70) }, { ...base, gpu_percent: 10, at: at(40) }, { ...base, gpu_percent: 95, at: at(10) }],
    { gpu_percent: { value: 90, seconds: 60 } },
    new Date(),
    0,
    {},
  );
  assert.equal(events.length, 0);
});

test('events are rate-limited by minGap', () => {
  const fired: Record<string, number> = {};
  checkEvents([{ ...base, gpu_percent: 95, at: at(70) }, { ...base, gpu_percent: 95, at: at(10) }], { gpu_percent: { value: 90, seconds: 60 } }, new Date(), 0, fired);
  const again = checkEvents([{ ...base, gpu_percent: 95, at: at(70) }, { ...base, gpu_percent: 95, at: at(10) }], { gpu_percent: { value: 90, seconds: 60 } }, new Date(), 15 * 60_000, fired);
  assert.equal(again.length, 0);
});

test('a sustained network outage fires', () => {
  const events = checkEvents(
    [{ ...base, network_status: 'offline', at: at(50) }, { ...base, network_status: 'offline', at: at(20) }],
    { network_down: { seconds: 30 } },
    new Date(),
    0,
    {},
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'network_down');
});

test('a docker crash fires only when a container newly goes down', () => {
  const healthy = { ...base, docker_problems: [] as string[], docker_problem: false, at: at(40) };
  const crashed = { ...base, docker_problems: ['sonarr'] as string[], docker_problem: true, at: at(10) };
  const events = checkEvents([healthy, crashed], { docker_crash: true }, new Date(), 0, {});
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'docker_crash');
  assert.ok(/sonarr/.test(events[0].message));
});

test('a container that was already down does not nag', () => {
  const down = { ...base, docker_problems: ['pensive_banzai'] as string[], docker_problem: true, at: at(40) };
  const events = checkEvents([down, down], { docker_crash: true }, new Date(), 0, {});
  assert.equal(events.length, 0);
});

// ---- sampler ---------------------------------------------------------------

test('sampleFromCollectors compresses a collection into a compact sample', () => {
  const sample = sampleFromCollectors(collected(), new Date('2026-08-26T00:00:00.000Z'));
  assert.equal(sample.cpu_percent, 10);
  assert.equal(sample.ram_percent, 16);
  assert.equal(sample.disk_percent, 22);
  assert.equal(sample.gpu_percent, 20);
  assert.equal(sample.vram_percent, 33);
  assert.equal(sample.network_status, 'online');
  assert.equal(sample.docker_problem, false);
});

test('sampleFromCollectors flags a stopped container', () => {
  const docker = { daemon: 'up' as const, containers: [{ name: 'sonarr', image: 'x', status: 'Exited (0)', state: 'exited', restart_count: 2, cpu_percent: 0, memory_mb: 0 }] };
  const sample = sampleFromCollectors(collected({ docker }));
  assert.equal(sample.docker_problem, true);
});

test('a run past its threshold is announced once, not again every gap, until it lets go', () => {
  // RAM on this box sits above 90% for days; the warning went out twice an
  // hour all night (2026-09-14). Sampled every thirty seconds, as the app does.
  const now = new Date();
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
  const above = (seconds: number): SystemSample => ({ ...base, ram_percent: 95, at: ago(seconds) });
  const below = (seconds: number): SystemSample => ({ ...base, ram_percent: 50, at: ago(seconds) });
  const thresholds = { ram_percent: { value: 90, seconds: 60 } };
  const fired: Record<string, number> = {};
  const check = (samples: SystemSample[]) => checkEvents(samples, thresholds, now, 0, fired).length;
  assert.equal(check([above(0)]), 0);
  assert.equal(check([above(30), above(0)]), 0, 'half a minute is a spike');
  assert.equal(check([above(60), above(30), above(0)]), 1, 'the minute is up: said');
  assert.equal(check([above(90), above(60), above(30), above(0)]), 0, 'the same run, not said again');
  assert.equal(check([above(120), above(90), above(60), above(30), above(0)]), 0);
  // It lets go for one sample and comes back: a new run, said again once.
  assert.equal(check([above(150), above(120), below(90), above(60), above(30), above(0)]), 1);
  assert.equal(check([above(180), above(150), below(120), above(90), above(60), above(30), above(0)]), 0, 'the new run, not said again');
});
