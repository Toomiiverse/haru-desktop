import { randomUUID } from 'node:crypto';
import { CoreServiceClient } from './core-service-client';
export type AuthoritySnapshot = { revision: number; userData: string; home: string; sourceRevision: string; documents: Record<string, any> };

/** Candidate adapter for asynchronous callers. Existing sync store call sites are not migrated yet. */
export class AsyncCoreStore {
  private state?: AuthoritySnapshot;
  private queue: Promise<unknown> = Promise.resolve();
  private failed = false;
  constructor(private client: CoreServiceClient, private userData: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
  async open(): Promise<void> {
    await this.serial(async () => { this.state = await this.client.call('storage', 'open', { userData: this.userData }); this.failed = false; });
  }
  get(name: string): any {
    if (!this.state || this.failed) throw Error('core_snapshot_unavailable');
    return structuredClone(this.state.documents[name]);
  }
  async update(change: (snapshot: Readonly<AuthoritySnapshot>) => Record<string, unknown>): Promise<void> {
    return this.serial(async () => {
      if (!this.state || this.failed) throw Error('core_snapshot_unavailable');
      const patches = change(structuredClone(this.state));
      if (!patches || typeof patches !== 'object' || typeof (patches as any).then === 'function') throw Error('core_change_must_be_synchronous');
      if (!Object.keys(patches).length) return;
      const id = randomUUID();
      try {
        const result = await this.client.call('storage', 'commit', { id, baseRevision: this.state.revision, patches }, id);
        if (![this.state.revision, this.state.revision + 1].includes(result.revision) || result.currentRevision !== result.revision) throw Error('core_revision_conflict');
        // Refresh sourceRevision and the authoritative snapshot, including derived updates.
        this.state = await this.client.call('storage', 'open', { userData: this.userData });
      } catch (error) { this.failed = true; throw error; }
    });
  }
  /** Disconnecting a client does not stop the shared authority. */
  close(): void { this.failed = true; }
}
