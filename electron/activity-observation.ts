// Short-lived, content-free evidence. Unknown is not a claim of absence.
export type ActivityReport = { kind: 'input'; client?: string; sequence?: number } | {
  kind: 'desktop'; client: string; sequence: number; sampleAgeMs: number;
  idleSeconds: number; windowFocused: boolean; onBattery: boolean;
};
export type ActivityObservation = {
  availability: 'recent-input' | 'idle' | 'unknown';
  source: 'browser' | 'desktop' | 'conversation' | null;
  idleSeconds: number | null; windowFocused: boolean | null; onBattery: boolean | null;
  receivedAgeMs: number | null; freshSources: number;
};
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export function readActivityReport(value: unknown): ActivityReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  // Existing open pages send this legacy receipt-only shape until reloaded.
  if (r.kind === 'input' && Object.keys(r).length === 1) return { kind: 'input' };
  if (typeof r.client !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(r.client)
      || !Number.isSafeInteger(r.sequence) || (r.sequence as number) < 0) return null;
  if (r.kind === 'input' && Object.keys(r).length === 3) return r as ActivityReport;
  if (r.kind !== 'desktop' || Object.keys(r).length !== 7
      || !finite(r.sampleAgeMs) || r.sampleAgeMs < 0 || r.sampleAgeMs > 5000
      || !finite(r.idleSeconds) || r.idleSeconds < 0 || r.idleSeconds > 366 * 86400
      || typeof r.windowFocused !== 'boolean' || typeof r.onBattery !== 'boolean') return null;
  return r as ActivityReport;
}
type Evidence = {
  receivedAt: number; sequence: number; source: NonNullable<ActivityObservation['source']>;
  sampleAgeMs: number; idleSeconds: number; windowFocused: boolean | null; onBattery: boolean | null;
};
export class ActivityObservations {
  private held = new Map<string, Evidence>();
  private lastNow = 0;
  note(source: string, report: ActivityReport, now: number): boolean {
    if (!finite(now) || now < 0 || now < this.lastNow) return false;
    this.lastNow = now;
    const key = source + ':' + (report.client ?? 'legacy');
    const before = this.held.get(key);
    const sequence = report.sequence ?? (before?.sequence ?? -1) + 1;
    if (before && (sequence <= before.sequence || now < before.receivedAt)) return false;
    this.held.set(key, { receivedAt: now, sequence, source: report.kind === 'input' ? 'browser' : 'desktop',
      sampleAgeMs: report.kind === 'desktop' ? report.sampleAgeMs : 0,
      idleSeconds: report.kind === 'desktop' ? report.idleSeconds : 0,
      windowFocused: report.kind === 'desktop' ? report.windowFocused : null,
      onBattery: report.kind === 'desktop' ? report.onBattery : null });
    // Keep expired sequence watermarks until bounded eviction, not just expiry.
    this.trim();
    return true;
  }
  private trim(): void {
    if (this.held.size > 32) {
      const oldest = [...this.held].sort((a, b) => a[1].receivedAt - b[1].receivedAt)[0][0];
      this.held.delete(oldest);
    }
  }
  conversation(now: number): void {
    if (!finite(now) || now < 0 || now < this.lastNow) return;
    this.lastNow = now;
    this.held.set('conversation', { receivedAt: now, sequence: 0, source: 'conversation', sampleAgeMs: 0,
      idleSeconds: 0, windowFocused: null, onBattery: null });
    this.trim();
  }
  read(now: number, local?: { idleSeconds: number; windowFocused: boolean; onBattery: boolean }): ActivityObservation {
    const unknown: ActivityObservation = { availability: 'unknown', source: null, idleSeconds: null,
      windowFocused: null, onBattery: null, receivedAgeMs: null, freshSources: 0 };
    if (!finite(now) || now < 0) return unknown;
    if (now < this.lastNow) { this.held.clear(); this.lastNow = now; return unknown; }
    this.lastNow = now;
    const fresh = [...this.held.values()].filter(e => {
      const age = now - e.receivedAt + e.sampleAgeMs;
      return age >= 0 && age <= (e.source === 'desktop' ? 90_000 : 300_000);
    });
    if (local && finite(local.idleSeconds) && local.idleSeconds >= 0) fresh.push({
      ...local, receivedAt: now, sampleAgeMs: 0, sequence: 0, source: 'desktop',
    });
    if (!fresh.length) return unknown;
    // An idle device cannot erase evidence of input on another device. Focus
    // belongs to the selected observation; never borrow another device's focus.
    const idle = (e: Evidence) => e.idleSeconds + (now - e.receivedAt + e.sampleAgeMs) / 1000;
    fresh.sort((a, b) => idle(a) - idle(b));
    const selected = fresh[0];
    const idleSeconds = idle(selected);
    return { availability: idleSeconds <= 300 ? 'recent-input' : 'idle', source: selected.source,
      idleSeconds, windowFocused: selected.windowFocused, onBattery: selected.onBattery,
      receivedAgeMs: now - selected.receivedAt, freshSources: fresh.length };
  }
}
