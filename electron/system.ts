import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {corePolicySync} from './core-policy-sync';

export type SystemInfo = { hostname: string; os: string; kernel: string; uptime: string; load: number[] };
export type CpuInfo = { model: string; cores: number; usage_percent: number };
export type GpuInfo = { name: string; vram_total_gb: number; vram_used_gb: number; utilization_percent: number; temperature_c: number }[];
export type MemoryInfo = { total_gb: number; used_gb: number; available_gb: number; usage_percent: number };
export type DiskMount = { filesystem: string; mount: string; total_gb: number; used_gb: number; available_gb: number; usage_percent: number };
export type NetworkInfo = { interfaces: { name: string; addresses: string[] }[]; default_route: string; status: 'online' | 'offline' | 'unknown' };
export type ProcessInfo = { pid: number; name: string; cpu_percent: number; rss_mb: number; args: string };
export type DockerContainer = { name: string; image: string; status: string; state: string; health?: string; restart_count: number; cpu_percent: number; memory_mb: number };
export type DockerStatus = { daemon: 'up' | 'down'; containers: DockerContainer[] };
export type ServiceStatus = { name: string; state: 'active' | 'inactive' | 'failed' | 'unknown' };
export type SystemCollected = {
  system: SystemInfo | null;
  cpu: CpuInfo | null;
  gpu: GpuInfo | null;
  memory: MemoryInfo | null;
  disk: DiskMount[] | null;
  network: NetworkInfo | null;
  processes: ProcessInfo[];
  docker: DockerStatus | null;
  services: ServiceStatus[];
  /** What is computing on the GPU (collectGpuApps), when it was asked. */
  gpuApps?: string[];
};
export type Diagnosis = { target: string; status: 'ok' | 'warning' | 'critical'; findings: string[] };

const round1 = (n: number) => Math.round(n * 10) / 10;

function run(file: string, args: string[]): Promise<string> {
  return new Promise(resolve => {
    execFile(file, args, { timeout: 5000 }, (error, stdout) => resolve(error ? '' : String(stdout)));
  });
}

/** Like run, but a non-zero exit is an answer, not a failure — `systemctl is-active` reports "inactive" that way. */
function runKeep(file: string, args: string[]): Promise<string> {
  return new Promise(resolve => {
    execFile(file, args, { timeout: 5000 }, (_error, stdout) => resolve(String(stdout)));
  });
}

// ---- Parsers (pure, tested without the shell) ------------------------------

export function parseNvidiaSmi(csv: string): GpuInfo {
  const out: GpuInfo = [];
  for (const line of csv.split('\n')) {
    const parts = line.split(',').map(part => part.trim());
    if (parts.length < 5) continue;
    const [name, total, used, util, temp] = parts;
    if (!name || !/^\d/.test(total)) continue;
    out.push({
      name,
      vram_total_gb: round1(Number(total) / 1024),
      vram_used_gb: round1(Number(used) / 1024),
      utilization_percent: Number(util),
      temperature_c: Number(temp),
    });
  }
  return out;
}

export function parseFree(output: string): MemoryInfo | null {
  const line = output.split('\n').find(entry => entry.startsWith('Mem:'));
  if (!line) return null;
  const cols = line.split(/\s+/).map(Number);
  if (cols.length < 7) return null;
  const [, total, used, , , , available] = cols;
  const gb = (n: number) => round1(n / 1e9);
  return { total_gb: gb(total), used_gb: gb(used), available_gb: gb(available), usage_percent: total ? Math.round((used / total) * 100) : 0 };
}

export function parseDf(output: string): DiskMount[] {
  const out: DiskMount[] = [];
  for (const line of output.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const [filesystem, blocks, used, available, capacity, mount] = cols;
    if (filesystem === 'Filesystem') continue;
    if (/^(tmpfs|devtmpfs|overlay|squashfs|proc|sysfs|shm|cgroup|udev|efivarfs|none)/.test(filesystem)) continue;
    const gb = (n: string) => round1((Number(n) * 1024) / 1e9);
    out.push({ filesystem, mount, total_gb: gb(blocks), used_gb: gb(used), available_gb: gb(available), usage_percent: Number(capacity.replace('%', '')) });
  }
  return out;
}

export function parsePs(output: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, pid, name, cpu, , rss, args] = match;
    out.push({ pid: Number(pid), name, cpu_percent: Number(cpu), rss_mb: Math.round(Number(rss) / 1024), args: args.trim().slice(0, 140) });
  }
  return out;
}

export function parseDockerPsJson(psJson: string): Omit<DockerContainer, 'restart_count' | 'cpu_percent' | 'memory_mb'>[] {
  const out: Omit<DockerContainer, 'restart_count' | 'cpu_percent' | 'memory_mb'>[] = [];
  for (const line of psJson.split('\n').filter(Boolean)) {
    try {
      const container = JSON.parse(line) as { Names?: string; Image?: string; Status?: string; State?: string };
      const name = container.Names || '';
      if (!name) continue;
      const status = String(container.Status || '');
      const health = (status.match(/\((healthy|unhealthy|starting)\)/) || [])[1];
      out.push({ name, image: String(container.Image || ''), status, state: String(container.State || ''), health });
    } catch { /* malformed line */ }
  }
  return out;
}

function memTextToMb(text: string): number {
  const match = /([\d.]+)\s*([KMG])?i?B?/i.exec(text);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = (match[2] || 'M').toUpperCase();
  if (unit === 'G') return value * 1024;
  if (unit === 'K') return value / 1024;
  return value;
}

export function applyDockerStats(base: Omit<DockerContainer, 'restart_count' | 'cpu_percent' | 'memory_mb'>[], statsJson: string): DockerContainer[] {
  const stats = new Map<string, { cpu: number; mem: number }>();
  for (const line of statsJson.split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as { name?: string; cpu_percentage?: string; mem_usage?: string };
      const name = entry.name || '';
      if (!name) continue;
      const cpu = Number.parseFloat(String(entry.cpu_percentage ?? '0').replace('%', ''));
      stats.set(name, { cpu: Number.isFinite(cpu) ? cpu : 0, mem: memTextToMb(String(entry.mem_usage ?? '')) });
    } catch { /* malformed line */ }
  }
  return base.map(container => ({ ...container, restart_count: 0, cpu_percent: stats.get(container.name)?.cpu ?? 0, memory_mb: stats.get(container.name)?.mem ?? 0 }));
}

export function applyDockerRestarts(containers: DockerContainer[], inspectOut: string): DockerContainer[] {
  const restarts = new Map<string, number>();
  const health = new Map<string, string>();
  for (const line of inspectOut.split('\n').filter(Boolean)) {
    const bits = line.split('|');
    const name = (bits[0] || '').replace(/^\//, '');
    if (!name) continue;
    restarts.set(name, Number(bits[1] || 0));
    const status = bits.slice(2).join('|').trim();
    if (status) health.set(name, status);
  }
  return containers.map(container => ({
    ...container,
    restart_count: restarts.get(container.name) ?? 0,
    health: container.health || health.get(container.name),
  }));
}

export function parseOsRelease(output: string): string {
  const match = /^PRETTY_NAME="?([^"\n]+)/m.exec(output);
  return match ? match[1] : 'Linux';
}

export function parseUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.join(' ') || 'moments';
}

export function parseCpuCount(proc: string): number {
  return (proc.match(/^processor\s*:/gm) || []).length;
}

export function parseCpuModel(lscpu: string): string {
  const match = /Model name:\s*(.+)/.exec(lscpu);
  return match ? match[1].trim() : 'unknown';
}

export function parseProcStat(line: string): number[] {
  return line.trim().split(/\s+/).slice(1).map(Number);
}

export function cpuUsagePercent(before: number[], after: number[]): number {
  const idle = (sample: number[]) => sample[3] + (sample[4] ?? 0);
  const total = (sample: number[]) => sample.reduce((sum, n) => sum + n, 0);
  const dTotal = total(after) - total(before);
  const dIdle = idle(after) - idle(before);
  if (dTotal <= 0) return 0;
  return Math.min(100, Math.round((1 - dIdle / dTotal) * 100));
}

export function parseIpBrief(output: string): { name: string; addresses: string[] }[] {
  const out: { name: string; addresses: string[] }[] = [];
  for (const line of output.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) continue;
    out.push({ name: cols[0], addresses: cols.slice(2).map(address => address.split('/')[0]).filter(address => address.includes('.') || address.includes(':')) });
  }
  return out;
}

export function parseSystemctlState(output: string): ServiceStatus['state'] {
  const state = output.trim();
  if (state === 'active' || state === 'inactive' || state === 'failed') return state;
  return 'unknown';
}

// ---- Known services ---------------------------------------------------------

// Refreshed 2026-09-18: gpt-sovits is parked; Breeze, the emotion model, Chrome and the PC Project app run now.
export const USER_SERVICES = ['haru', 'breeze-tts', 'haru-asr', 'ollama-emotion', 'obsidian', 'chrome', 'xvfb', 'x11vnc', 'pc-project-ops'];
export const SYSTEM_READABLE = ['ollama'];
export const KNOWN_SERVICES = [...USER_SERVICES, ...SYSTEM_READABLE];

// ---- Collectors (fixed commands, never LLM text) ----------------------------

export async function collectSystem(): Promise<Pick<SystemCollected, 'system' | 'cpu' | 'memory' | 'disk' | 'network'>> {
  const [hostname, osRelease, kernel, uptimeRaw, loadRaw, lscpu, cpuinfo, stat1, stat2, freeOut, dfOut, ipBrief, route] = await Promise.all([
    run('hostname', []),
    run('cat', ['/etc/os-release']),
    run('uname', ['-r']),
    run('cat', ['/proc/uptime']),
    run('cat', ['/proc/loadavg']),
    run('lscpu', []),
    run('cat', ['/proc/cpuinfo']),
    run('cat', ['/proc/stat']),
    (async () => { await new Promise(done => setTimeout(done, 200)); return run('cat', ['/proc/stat']); })(),
    run('free', ['-b']),
    run('df', ['-Pk']),
    run('ip', ['-brief', 'addr']),
    run('ip', ['route', 'show', 'default']),
  ]);
  const firstStat = parseProcStat((stat1.match(/^cpu\s.*/m) || [''])[0]);
  const secondStat = parseProcStat((stat2.match(/^cpu\s.*/m) || [''])[0]);
  const uptimeSeconds = Number((uptimeRaw.trim().split(/\s+/)[0] ?? '0'));
  const system: SystemInfo = {
    hostname: hostname.trim(),
    os: parseOsRelease(osRelease),
    kernel: kernel.trim(),
    uptime: parseUptime(Number.isFinite(uptimeSeconds) ? uptimeSeconds : 0),
    load: loadRaw.trim().split(/\s+/).slice(0, 3).map(Number),
  };
  const cpu: CpuInfo = {
    model: parseCpuModel(lscpu),
    cores: parseCpuCount(cpuinfo) || 0,
    usage_percent: firstStat.length && secondStat.length ? cpuUsagePercent(firstStat, secondStat) : 0,
  };
  return { system, cpu, memory: parseFree(freeOut), disk: parseDf(dfOut), network: networkFrom(ipBrief, route) };
}

function networkFrom(ipBrief: string, route: string): NetworkInfo {
  return {
    interfaces: parseIpBrief(ipBrief),
    default_route: route.trim().split('\n')[0] ?? '',
    status: route.trim() ? 'online' : 'offline',
  };
}

export async function collectCpu(): Promise<CpuInfo | null> {
  const [lscpu, cpuinfo, stat1, stat2] = await Promise.all([
    run('lscpu', []),
    run('cat', ['/proc/cpuinfo']),
    run('cat', ['/proc/stat']),
    (async () => { await new Promise(done => setTimeout(done, 200)); return run('cat', ['/proc/stat']); })(),
  ]);
  const first = parseProcStat((stat1.match(/^cpu\s.*/m) || [''])[0]);
  const second = parseProcStat((stat2.match(/^cpu\s.*/m) || [''])[0]);
  return { model: parseCpuModel(lscpu), cores: parseCpuCount(cpuinfo) || 0, usage_percent: first.length && second.length ? cpuUsagePercent(first, second) : 0 };
}

export async function collectGpu(): Promise<GpuInfo | null> {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits']);
  return out.trim() ? parseNvidiaSmi(out) : null;
}

/** The processes computing on the GPU, by executable path — nvidia-smi's compute apps. */
export async function collectGpuApps(): Promise<string[]> {
  const out = await run('nvidia-smi', ['--query-compute-apps=process_name', '--format=csv,noheader']);
  return out.split('\n').map(line => line.trim()).filter(Boolean);
}

export async function collectMemory(): Promise<MemoryInfo | null> {
  return parseFree(await run('free', ['-b']));
}

export async function collectDisk(): Promise<DiskMount[] | null> {
  return parseDf(await run('df', ['-Pk']));
}

export async function collectNetwork(): Promise<NetworkInfo> {
  const [ipBrief, route] = await Promise.all([run('ip', ['-brief', 'addr']), run('ip', ['route', 'show', 'default'])]);
  return networkFrom(ipBrief, route);
}

export async function collectProcesses(limit = 10): Promise<ProcessInfo[]> {
  const out = await run('ps', ['-eo', 'pid=,comm=,%cpu=,%mem=,rss=,args=', '--sort=-%cpu']);
  return parsePs(out).slice(0, Math.max(1, Math.min(50, limit)));
}

export async function collectDockerLight(): Promise<DockerStatus | null> {
  const out = await run('docker', ['ps', '-a', '--format', 'json']);
  if (!out.trim()) return null;
  return { daemon: 'up', containers: applyDockerStats(parseDockerPsJson(out), '') };
}

export async function collectDocker(): Promise<DockerStatus | null> {
  const psOut = await run('docker', ['ps', '-a', '--format', 'json']);
  if (!psOut.trim()) return null;
  const base = parseDockerPsJson(psOut);
  const names = base.map(container => container.name);
  const [statsOut, inspectOut] = await Promise.all([
    run('docker', ['stats', '--no-stream', '--format', 'json']),
    names.length ? run('docker', ['inspect', '--format', '{{.Name}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}', ...names]) : Promise.resolve(''),
  ]);
  const withStats = applyDockerStats(base, statsOut);
  return { daemon: 'up', containers: applyDockerRestarts(withStats, inspectOut) };
}

export async function collectServices(wanted?: string): Promise<ServiceStatus[]> {
  {
    const commands=corePolicySync<{name:string;user:boolean}[]>('diagnostic.services',[wanted??null,(true as boolean)]);
    const observed:ServiceStatus[]=[];
    for(const command of commands){
      if(!command||typeof command.name!=='string'||!command.name||command.name.startsWith('-')||typeof command.user!=='boolean')throw Error('core_diagnostic_service_protocol');
      observed.push({name:command.name,state:parseSystemctlState(await runKeep('systemctl',command.user?['--user','is-active',command.name]:['is-active',command.name]))});
    }
    return observed;
  }
}

export function readCpuTemp(): number | null {
  for (const zone of ['/sys/class/thermal/thermal_zone0/temp', '/sys/class/thermal/thermal_zone1/temp']) {
    try {
      const value = Number(readFileSync(zone, 'utf8').trim());
      if (value > 0) return Math.round(value / 1000);
    } catch { /* next zone */ }
  }
  return null;
}

export async function collectAll(): Promise<SystemCollected> {
  const [light, gpu, processes, docker, services] = await Promise.all([
    collectSystem(),
    collectGpu(),
    collectProcesses(10),
    collectDocker(),
    collectServices(),
  ]);
  return { ...light, gpu, processes, docker, services };
}

// ---- Diagnostics -------------------------------------------------------------

export function diagnose(target: string, collected: SystemCollected): Diagnosis {
  return corePolicySync<Diagnosis>('diagnostic.diagnose',[target,collected,(true as boolean)]);
}
