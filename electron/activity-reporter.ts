// Reuses a successful sync login; never signs in or queues historical samples.
import { randomUUID } from 'node:crypto';
import { isTailnetAddress, type CheckInSource } from './checkinsource';
type Reading = { idleSeconds: number; windowFocused: boolean; onBattery: boolean };
export class ActivityReporter {
  private session: { source: CheckInSource; cookie: string } | null = null;
  private readonly client = randomUUID();
  private sequence = 0;
  private busy = false;
  private lastSent = -Infinity;
  constructor(private readonly request: typeof fetch) {}
  connected(source: CheckInSource, cookie: string): void {
    this.session = cookie && isTailnetAddress(source.url) ? { source: { ...source }, cookie } : null;
  }
  async report(source: CheckInSource | null, sample: () => Reading, now = performance.now()): Promise<void> {
    const session = this.session;
    if (!source || !session || source.url !== session.source.url || source.username !== session.source.username) {
      this.session = null; return;
    }
    if (this.busy || !Number.isFinite(now) || now - this.lastSent < 30_000) return;
    this.lastSent = now; this.busy = true;
    try {
      const { idleSeconds, windowFocused, onBattery } = sample();
      const response = await this.request(source.url + '/api/attention/input', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ kind: 'desktop', client: this.client, sequence: ++this.sequence, sampleAgeMs: 0,
          idleSeconds, windowFocused, onBattery }),
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if ((response.status === 401 || response.status === 404) && this.session === session) this.session = null;
    } catch { /* Diagnostic transport cannot interrupt the life loop or retry stale input. */ }
    finally { this.busy = false; }
  }
}
