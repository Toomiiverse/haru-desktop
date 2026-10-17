// Coding jobs she hands to OpenCode on this machine: agent haru-coder (Qwen 3.6 Plus Uncensored on Venice through the
// haru-coder LiteLLM key, capped at $5/day and $30/30 days). Edits run; any other command waits for
// his OK, which she asks him for and he gives in his own words. Driven over the OpenCode server API,
// because `opencode run` refuses every permission request by itself.
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_DIRS, resolveSessionDir } from './claudesession';

// direct: his own coding-mode session (codemode.ts), not a job of hers; away: it was working while his phone was not watching.
export type CodeJob = { id: string; dir: string; task: string; at: string; told?: string; done?: boolean; direct?: boolean; away?: boolean; archived?: boolean };
export type CodeCommand = { action: 'start' | 'status' | 'approve' | 'deny' | 'stop'; folder?: string; task?: string; id?: string | null };
export type CodeApi = (method: string, route: string, body?: unknown) => Promise<any>;
export type CodeLink = {
  run(c: CodeCommand): Promise<Record<string, unknown>>;
  waiting(): boolean;
  watch(notify: (line: string, about: string, direct: boolean) => void, now?: number): Promise<void>;
};

export const CODE_AGENT = 'haru-coder';
/** What she knows of the coder on every turn (joined into the server note in the prompt's live part). */
export const CODER_NOTE = 'There is a coder on that server too: OpenCode, a coding agent with its own hands on the files. Two ways to use it. '
  + 'A small, well-defined job you hand it yourself with code_task and report back when it finishes. Anything open-ended, or that he would want to steer line by line, he does himself in the Code tab of his phone app, '
  + 'which talks to the same coder; tell him to open it and name the project folder. Your own code is in his home too: ~/haru-live is a snapshot of exactly what is running now (service = your Core, Python; source = your brain, TypeScript) '
  + 'and ~/haru-desktop is the brain\'s working repo. A change there only reaches the running you after he builds and deploys a release, so when you feel hemmed in by how you are built, say what you would change and ask him to let you; start that job only at his word. '
  + 'When the server itself is the problem, the disk filling up, a service down, propose the fix rather than just reporting it: look with your tools, clear it with him, or point him at a Code tab session.';
export const CODE_MODEL = { providerID: 'haru', id: 'qwen-3-6-plus-uncensored' };

export type OpenCodeAuth = () => { url: string; header: string };
/** The background server's own address and password, read per call so a service restart is followed. */
export function openCodeAuth(file = path.join(os.homedir(), '.local/state/opencode/service.json')): OpenCodeAuth {
  return () => { const s = JSON.parse(readFileSync(file, 'utf8')); return { url: String(s.url), header: 'Basic ' + Buffer.from('opencode:' + s.password).toString('base64') }; };
}
/** The OpenCode server API over HTTP (`opencode api` cut piped output off at ~150 KB). */
export function openCodeApi(auth: OpenCodeAuth = openCodeAuth()): CodeApi {
  return async (method, route, body) => {
    const { url, header } = auth();
    const response = await fetch(url + route, { method, headers: { authorization: header, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    if (!response.ok || !parsed || parsed._tag) throw Error(String(parsed?.message || `opencode_api_${response.status}`).slice(0, 200));
    return parsed.data ?? parsed;
  };
}

/** A git repository directly in his home (not home itself): whatever the coder edits shows in git and can be undone. */
export function repoDir(folder: string, home: string): { dir: string } | { error: string } {
  const where = resolveSessionDir(folder, { dir: home }, home, LOCAL_DIRS);
  if ('error' in where) return where;
  if (where.dir === LOCAL_DIRS.real(home) || !existsSync(path.join(where.dir, '.git')))
    return { error: `"${folder}" is not a git repository in their home — the coder only works inside one, so its changes can be seen and undone.` };
  return where;
}

/** Her jobs, kept beside her other files. Every change re-reads first and writes at once, so a watch tick and a tool call cannot undo each other. */
export function codeJobs(file: string) {
  const read = (): CodeJob[] => { try { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  // 60: room for his recent coding-mode sessions (the Recent list) beside her own jobs.
  const write = (jobs: CodeJob[]) => { writeFileSync(file + '.tmp', JSON.stringify(jobs.slice(-60))); renameSync(file + '.tmp', file); };
  return {
    read,
    add: (job: CodeJob) => write([...read(), job]),
    update: (id: string, patch: Partial<CodeJob>) => write(read().map(j => j.id === id ? { ...j, ...patch } : j)),
    remove: (id: string) => write(read().filter(j => j.id !== id)),
  };
}

/** A provider error as one readable line: the first "message" when the text wraps a JSON body (OpenRouter's 402 is several hundred characters). */
export function errorText(error: any): string {
  const raw = String(error?.message ?? error?.type ?? error ?? 'failed');
  const inner = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1];
  return cut((inner ? inner.replace(/\\"/g, '"') : raw.replace(/^(?:litellm\.\w+: )?(?:\w+Error: )+/, '')).trim(), 240);
}

/** What the coder said last, and whether that turn is over. */
export function lastWords(messages: any[]): { text: string; error: string; finished: boolean } {
  const said = (Array.isArray(messages) ? messages : []).filter(m => m?.type === 'assistant').sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))[0];
  if (!said) return { text: '', error: '', finished: false };
  const text = (said.content ?? []).filter((c: any) => c?.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n').trim();
  const error = said.error ? errorText(said.error) : '';
  return { text, error, finished: Boolean(said.time?.completed || error) };
}

function changedFiles(dir: string): string[] {
  try { return execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', timeout: 5000 }).split('\n').filter(Boolean).map(l => l.slice(3)); } catch { return []; }
}
export const cut = (s: string, n: number) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

export function codeLink({ api, jobs, home, changed = changedFiles, listening = () => false }: { api: CodeApi; jobs: ReturnType<typeof codeJobs>; home: string; changed?: (dir: string) => string[]; listening?: (id: string) => boolean }): CodeLink {
  const pick = (id?: string | null) => { const list = jobs.read().filter(j => !j.direct); return id ? list.find(j => j.id === id) : list.filter(j => !j.done).at(-1) ?? list.at(-1); };
  const waitingOn = async (job: CodeJob) => ((await api('GET', `/api/session/${job.id}/permission`)) ?? [])[0] as { id: string; resources: string[] } | undefined;
  return {
    async run(c) {
      if (c.action === 'start') {
        const where = repoDir(c.folder ?? '', home);
        if ('error' in where) return { error: where.error, notDispatched: true };
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
    waiting: () => jobs.read().some(j => !j.done && !j.direct && j.told),
    async watch(notify, now = Date.now()) {
      const open = jobs.read().filter(j => !j.done);
      if (!open.length) return;
      const active = await api('GET', '/api/session/active');
      for (const job of open) {
        const folder = path.basename(job.dir);
        try {
          // His own coding-mode session: news only while his phone is not watching it, and straight to him, not through her.
          if (job.direct) {
            if (listening(job.id)) { if (job.away) jobs.update(job.id, { away: false }); continue; }
            const waiting = await waitingOn(job);
            if (waiting) { if (waiting.id !== job.told) { jobs.update(job.id, { told: waiting.id }); notify(`The coder wants to run \`${cut(waiting.resources.join(' && '), 200)}\` in ${folder}. Open coding mode to allow it.`, folder, true); } continue; }
            if (active?.[job.id]) { if (!job.away) jobs.update(job.id, { away: true }); continue; }
            if (job.away) {
              jobs.update(job.id, { away: false });
              const words = lastWords(await api('GET', `/api/session/${job.id}/message`));
              notify(words.error ? `The coder stopped in ${folder}: ${words.error}` : `The coder finished in ${folder}: ${cut(words.text || 'nothing to say', 300)}`, folder, true);
            }
            continue;
          }
          const waiting = await waitingOn(job);
          if (waiting) {
            if (waiting.id !== job.told) { jobs.update(job.id, { told: waiting.id }); notify(`My coder wants to run \`${cut(waiting.resources.join(' && '), 200)}\` in ${folder} (for: ${cut(job.task, 80)}) — okay?`, folder, false); }
            continue;
          }
          if (active?.[job.id] || now - Date.parse(job.at) < 15_000) continue;
          const words = lastWords(await api('GET', `/api/session/${job.id}/message`));
          if (!words.finished) continue;
          jobs.update(job.id, { done: true, told: undefined });
          const files = changed(job.dir);
          notify(words.error ? `The coding job in ${folder} stopped: ${words.error}`
            : `The coding job in ${folder} is done${files.length ? ` (changed ${cut(files.slice(0, 5).join(', '), 160)})` : ' (no files changed)'}. It says: ${cut(words.text || 'nothing', 500)}`, folder, false);
        } catch (error) {
          // A session deleted in OpenCode is over; anything else is tried again next tick.
          if (/not ?found/i.test(error instanceof Error ? error.message : '')) jobs.update(job.id, { done: true });
          else throw error;
        }
      }
    },
  };
}
