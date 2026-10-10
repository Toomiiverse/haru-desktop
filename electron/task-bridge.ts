import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { CoreServiceClient, coreServiceOptions } from './core-service-client';
import type { CoreReadOnlyBridge } from './core-read-only';
export type TaskRPC = (method: string, params: Record<string, unknown>) => Promise<any>;

/** One Node worker owns the separate durable task database for this Electron process. */
export class TaskBridge {
  private remote?: CoreServiceClient;
  private child?: ChildProcessWithoutNullStreams;
  private next = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private root = process.env.HARU_CORE_ROOT ?? path.join(os.homedir(), 'haru-core'), private db = process.env.HARU_TASK_DB ?? path.join(root, 'data/haru-tasks.db')) {
    const options = coreServiceOptions();
    if (options) this.remote = new CoreServiceClient(options);
  }
  close = () => { this.child?.stdin.end(); };
  get readOnlyWorkflow():CoreReadOnlyBridge['decide']|undefined {
    return this.remote && process.env.HARU_CORE_READ_ONLY_WORKFLOWS==='on'
      ? input=>this.remote!.readOnlyWorkflow(input) : undefined;
  }
  private start() {
    const child = spawn(process.env.HARU_CORE_NODE ?? '/usr/bin/node', ['--import', 'tsx',
      path.join(this.root, 'src/cli/task-worker.ts'), '--db', this.db], { cwd: this.root, stdio: 'pipe' });
    this.child = child;
    const fail = () => {
      if (this.child !== child) return;
      this.child = undefined;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('task_worker_unavailable')); }
      this.pending.clear();
    };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
    child.stderr.on('data', data => console.warn('[task-worker]', String(data).slice(0, 1000))); // Worker diagnostics contain no caller payload; surface a stable error above.
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const reply = JSON.parse(line), pending = this.pending.get(reply.id);
        if (!pending) return;
        if (reply.protocol !== 1) { child.kill(); fail(); return; }
        clearTimeout(pending.timer); this.pending.delete(reply.id);
        if (reply.ok) pending.resolve(reply.result); else pending.reject(new Error(reply.error?.code ?? 'task_worker_error'));
      } catch { child.kill(); fail(); }
    });
  }
  call: TaskRPC = (method, params) => {
    if (this.remote) return this.remote.call('tasks', method, params);
    if (!this.child) this.start();
    const child = this.child!, id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ protocol: 1, id, method, params }) + '\n');
    });
  };
}
