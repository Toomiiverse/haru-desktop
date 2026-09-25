// Short-lived delivery receipts, not a second conversation store. A lost phone
// connection must not require running the model/tools a second time.
export type ChatReceipt = {
  input: string; at: number; state: 'pending' | 'done' | 'error';
  reply?: string; ignored?: boolean; error?: string;
};
export class ChatReceipts {
  private entries = new Map<string, ChatReceipt>();
  private scope: string | null = null;
  constructor(private readonly capacity = 128, private readonly ttl = 30 * 60_000) {}
  private prune(scope: string, now: number) {
    if (scope !== this.scope) { this.entries.clear(); this.scope = scope; }
    for (const [id, entry] of this.entries) if (now - entry.at > this.ttl) this.entries.delete(id);
  }
  get(id: string, scope: string, now = Date.now()) {
    this.prune(scope, now);
    return this.entries.get(id);
  }
  begin(id: string, input: string, scope: string, now = Date.now()): { entry: ChatReceipt; fresh: boolean } {
    this.prune(scope, now);
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.input !== input) throw new Error('receipt_conflict');
      return { entry: existing, fresh: false };
    }
    if (this.entries.size >= this.capacity) {
      const finished = [...this.entries].find(([, value]) => value.state !== 'pending');
      if (!finished) throw new Error('receipts_busy');
      this.entries.delete(finished[0]);
    }
    const entry: ChatReceipt = { input, at: now, state: 'pending' };
    this.entries.set(id, entry);
    return { entry, fresh: true };
  }
}
