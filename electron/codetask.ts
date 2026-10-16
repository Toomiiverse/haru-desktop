// Coding jobs she hands to OpenCode on this machine: agent haru-coder (MiMo V2.6 Pro through the
// haru-coder LiteLLM key, capped at $5/day and $30/30 days). Edits run; any other command waits for
// his OK, which she asks him for and he gives in his own words. Driven over the OpenCode server API,
// because `opencode run` refuses every permission request by itself.
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { LOCAL_DIRS, resolveSessionDir } from './claudesession';

export type CodeJob = { id: string; dir: string; task: string; at: string; told?: string; done?: boolean };
export type CodeCommand = { action: 'start' | 'status' | 'approve' | 'deny' | 'stop'; folder?: string; task?: string; id?: string | null };
export type CodeApi = (method: string, route: string, body?: unknown) => Promise<any>;
export type CodeLink = {
  run(c: CodeCommand): Promise<Record<string, unknown>>;
  waiting(): boolean;
  watch(notify: (line: string, about: string) => void, now?: number): Promise<void>;
};

export const CODE_AGENT = 'haru-coder';
export const CODE_MODEL = { providerID: 'haru', id: 'mimo-v2.6-pro' };

/** `opencode api` against the background server; the CLI carries the server's own credentials. */
export function openCodeApi(bin: string, home: string): CodeApi {
  return (method, route, body) => new Promise((resolve, reject) => execFile(bin, ['api', method, route, ...(body === undefined ? [] : ['-d', JSON.stringify(body)])],
    { cwd: home, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      let parsed: any = null;
      try { parsed = stdout.trim() ? JSON.parse(stdout.trim().split('\n')[0]) : {}; } catch { /* not JSON */ }
      if (error || !parsed || parsed._tag) return reject(Error(String(parsed?.message || stderr || error?.message || 'opencode_api_failed').trim().slice(0, 200)));
      resolve(parsed.data ?? parsed);
    }));
}

/** Her jobs, kept beside her other files. Every change re-reads first and writes at once, so a watch tick and a tool call cannot undo each other. */
export function codeJobs(file: string) {
  const read = (): CodeJob[] => { try { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = (jobs: CodeJob[]) => { writeFileSync(file + '.tmp', JSON.stringify(jobs.slice(-20))); renameSync(file + '.tmp', file); };
  return {
    read,
    add: (job: CodeJob) => write([...read(), job]),
    update: (id: string, patch: Partial<CodeJob>) => write(read().map(j => j.id === id ? { ...j, ...patch } : j)),
  };
}

/** What the coder said last, and whether that turn is over. */
export function lastWords(messages: any[]): { text: string; error: string; finished: boolean } {
  const said = (Array.isArray(messages) ? messages : []).filter(m => m?.type === 'assistant').sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))[0];
  if (!said) return { text: '', error: '', finished: false };
  const text = (said.content ?? []).filter((c: any) => c?.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n').trim();
  const error = said.error ? String(said.error.message ?? said.error.type ?? 'failed').slice(0, 200) : '';
  return { text, error, finished: Boolean(said.time?.completed || error) };
}

function changedFiles(dir: string): string[] {
  try { return execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', timeout: 5000 }).split('\n').filter(Boolean).map(l => l.slice(3)); } catch { return []; }
}
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

export function codeLink({ api, jobs, home, changed = changedFiles }: { api: CodeApi; jobs: ReturnType<typeof codeJobs>; home: string; changed?: (dir: string) => string[] }): CodeLink {
  const pick = (id?: string | null) => { const list = jobs.read(); return id ? list.find(j => j.id === id) : list.filter(j => !j.done).at(-1) ?? list.at(-1); };
  const waitingOn = async (job: CodeJob) => ((await api('GET', `/api/session/${job.id}/permission`)) ?? [])[0] as { id: string; resources: string[] } | undefined;
  return {
    async run(c) {
      if (c.action === 'start') {
        const where = resolveSessionDir(c.folder ?? '', { dir: home }, home, LOCAL_DIRS);
        if ('error' in where) return { error: where.error, notDispatched: true };
        // A repository, not home itself: whatever it edits shows in git and can be undone.
        if (where.dir === LOCAL_DIRS.real(home) || !existsSync(path.join(where.dir, '.git')))
          return { error: `"${c.folder}" is not a git repository in their home — the coder only works inside one, so its changes can be seen and undone.`, notDispatched: true };
        const task = c.task ?? '', folder = path.basename(where.dir);
        const session = await api('POST', '/api/session', { location: { directory: where.dir }, agent: CODE_AGENT, model: CODE_MODEL, title: cut(`Haru · ${folder}: ${task}`, 80) });
        jobs.add({ id: session.id, dir: where.dir, task, at: new Date().toISOString() });
        try { await api('POST', `/api/session/${session.id}/prompt`, { text: task }); } catch (error) { jobs.update(session.id, { done: true }); throw error; }
        return { started: true, id: session.id, folder, note: 'Handed over. It works in the background and you will hear when it finishes or needs their OK. Say you have handed it over — never that it is done.' };
      }
      const job = pick(c.id);
      if (!job) return { error: 'There is no coding job to ask about.', notDispatched: true };
      const folder = path.basename(job.dir);
      if (c.action === 'status') {
        const [active, waiting, messages] = await Promise.all([api('GET', '/api/session/active'), waitingOn(job), api('GET', `/api/session/${job.id}/message`)]);
        const words = lastWords(messages);
        return { id: job.id, folder, task: cut(job.task, 300), state: waiting ? 'waiting for their OK' : active?.[job.id] ? 'working' : 'finished',
          ...(waiting ? { waitingToRun: waiting.resources } : {}), lastSaid: cut(words.text, 600), ...(words.error ? { error: words.error } : {}), changed: changed(job.dir).slice(0, 10) };
      }
      if (c.action === 'approve' || c.action === 'deny') {
        const waiting = await waitingOn(job);
        // Only the request she put to him; a newer one has not been asked yet.
        if (!waiting || waiting.id !== job.told)
          return { error: waiting ? 'It is waiting on something you have not asked them about yet — ask them first.' : 'It is not waiting on anything.', notDispatched: true };
        await api('POST', `/api/session/${job.id}/permission/${waiting.id}/reply`, { decision: c.action === 'approve' ? 'once' : 'reject' });
        jobs.update(job.id, { told: undefined });
        return { [c.action === 'approve' ? 'approved' : 'denied']: waiting.resources, folder };
      }
      const waiting = await waitingOn(job);
      if (waiting) await api('POST', `/api/session/${job.id}/permission/${waiting.id}/reply`, { decision: 'reject' });
      await api('POST', `/api/session/${job.id}/interrupt`, {});
      jobs.update(job.id, { done: true, told: undefined });
      return { stopped: true, folder };
    },
    waiting: () => jobs.read().some(j => !j.done && j.told),
    async watch(notify, now = Date.now()) {
      const open = jobs.read().filter(j => !j.done);
      if (!open.length) return;
      const active = await api('GET', '/api/session/active');
      for (const job of open) {
        const folder = path.basename(job.dir);
        try {
          const waiting = await waitingOn(job);
          if (waiting) {
            if (waiting.id !== job.told) { jobs.update(job.id, { told: waiting.id }); notify(`My coder wants to run \`${cut(waiting.resources.join(' && '), 200)}\` in ${folder} (for: ${cut(job.task, 80)}) — okay?`, folder); }
            continue;
          }
          if (active?.[job.id] || now - Date.parse(job.at) < 15_000) continue;
          const words = lastWords(await api('GET', `/api/session/${job.id}/message`));
          if (!words.finished) continue;
          jobs.update(job.id, { done: true, told: undefined });
          const files = changed(job.dir);
          notify(words.error ? `The coding job in ${folder} stopped: ${words.error}`
            : `The coding job in ${folder} is done${files.length ? ` (changed ${cut(files.slice(0, 5).join(', '), 160)})` : ' (no files changed)'}. It says: ${cut(words.text || 'nothing', 500)}`, folder);
        } catch (error) {
          // A session deleted in OpenCode is over; anything else is tried again next tick.
          if (/not ?found/i.test(error instanceof Error ? error.message : '')) jobs.update(job.id, { done: true });
          else throw error;
        }
      }
    },
  };
}
