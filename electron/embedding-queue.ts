/** One local embedding request at a time. Short queries go ahead of the next
 * background batch; a refresh cannot put hundreds of texts ahead of a reply. */
export class EmbeddingQueue {
  private active = false;
  private jobs: { query: boolean; start(): void }[] = [];

  run<T>(query: boolean, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        this.jobs = this.jobs.filter(other => other !== job);
        reject(signal?.reason ?? new Error('embedding_cancelled'));
      };
      const job = { query, start: () => {
        signal?.removeEventListener('abort', cancel);
        this.active = true;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active = false;
          this.next();
        });
      } };
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      this.jobs.push(job);
      this.next();
    });
  }

  private next() {
    if (this.active || !this.jobs.length) return;
    const query = this.jobs.findIndex(job => job.query);
    this.jobs.splice(query < 0 ? 0 : query, 1)[0].start();
  }
}

/** Abort the transport and also bound callers using a transport that ignores
 * cancellation. Late results never reach a retrieval or its cache. */
export function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new Error('embedding_cancelled'));
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    void Promise.resolve().then(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
