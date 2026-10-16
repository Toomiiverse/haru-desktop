// Coding mode on his phone: he talks to the OpenCode coder himself (Codex / Claude Code-style) on routes of
// its own beside the chat (webserver.ts /api/code/*). None of it enters Haru's chat history or memory; she
// gets one deed when he leaves the mode.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CODE_AGENT, cut, errorText, repoDir, type CodeApi, type CodeJob, type OpenCodeAuth } from './codetask';

/** What the model switch offers; all of them go through the haru-coder LiteLLM key and its cap. */
export const CODE_MODELS = [
  { id: 'haru/mimo-v2.6-pro', name: 'MiMo V2.6 Pro' },
  { id: 'haru/claude-opus-5-5', name: 'Opus 5.5' },
];
const modelRef = (id: string) => ({ providerID: id.split('/')[0], id: id.split('/').slice(1).join('/') });

export type CodeEvent = { kind: string; [key: string]: unknown };
type Frame = { type?: string; data?: any };

const rel = (dir: string, value: unknown) => String(value ?? '').split(dir + '/').join('');
function parsed(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') return input && typeof input === 'object' ? input as Record<string, unknown> : {};
  try { return JSON.parse(input); } catch { return {}; }
}
/** One line for a tool card: the command, the path, the pattern. */
export function toolTitle(input: unknown, dir: string): string {
  const i = parsed(input);
  return cut(rel(dir, i.command ?? i.path ?? i.filePath ?? i.pattern ?? i.url ?? i.query ?? i.description ?? '').replace(/\s+/g, ' ').trim(), 200);
}
function toolResult(content: any, metadata: any, error: any, dir: string) {
  const output = (Array.isArray(content) ? content : []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text)).join('\n');
  const patch = (Array.isArray(metadata?.files) ? metadata.files : []).map((f: any) => String(f.patch ?? '')).join('\n');
  return { output: cut(rel(dir, error ? errorText(error) + (output ? '\n' + output : '') : output), 8000),
    ...(patch ? { patch: cut(patch, 16000) } : {}), ...(typeof metadata?.exit === 'number' ? { exit: metadata.exit } : {}) };
}

/** The session so far, oldest first, as the phone draws it. */
export function phoneItems(messages: any[], dir: string): CodeEvent[] {
  const items: CodeEvent[] = [];
  for (const m of [...(Array.isArray(messages) ? messages : [])].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))) {
    if (m.type === 'user') items.push({ kind: 'you', id: m.id, text: String(m.text ?? m.payload?.text ?? '') });
    if (m.type !== 'assistant') continue;
    let ordinal = 0;
    for (const c of m.content ?? []) {
      if (c.type === 'text') items.push({ kind: 'said', id: `${m.id}:${ordinal++}`, text: String(c.text) });
      if (c.type === 'tool') {
        const status = c.state?.status === 'completed' ? 'done' : c.state?.status === 'error' ? 'failed' : 'running';
        items.push({ kind: 'tool', id: c.id, name: c.name, status, title: toolTitle(c.state?.input, dir), ...(status === 'running' ? {} : toolResult(c.state?.content, c.state?.metadata, c.state?.error, dir)) });
      }
    }
    if (m.error) items.push({ kind: 'error', id: m.id + ':error', text: errorText(m.error) });
  }
  return items;
}

/** One OpenCode server event as a phone event, or null. Items are upserted by kind and id; "said" deltas append. */
export function phoneEvent(frame: Frame, names: Map<string, string>, dir: string): CodeEvent | null {
  const d = frame.data ?? {};
  switch (frame.type) {
    case 'session.text.delta': return { kind: 'said', id: `${d.assistantMessageID}:${d.ordinal ?? 0}`, delta: String(d.delta ?? '') };
    case 'session.text.ended': return { kind: 'said', id: `${d.assistantMessageID}:${d.ordinal ?? 0}`, text: String(d.text ?? '') };
    case 'session.tool.input.started': names.set(d.id, d.name); return { kind: 'tool', id: d.id, name: d.name, status: 'running', title: '' };
    case 'session.tool.called': return { kind: 'tool', id: d.id, ...(names.has(d.id) ? { name: names.get(d.id) } : {}), status: 'running', title: toolTitle(d.input, dir) };
    case 'session.tool.success': case 'session.tool.failed':
      return { kind: 'tool', id: d.id, ...(names.has(d.id) ? { name: names.get(d.id) } : {}), status: frame.type === 'session.tool.success' ? 'done' : 'failed', ...toolResult(d.content, d.metadata, d.error, dir) };
    case 'permission.asked': return { kind: 'ask', id: d.id, resources: Array.isArray(d.resources) ? d.resources.map(String) : [] };
    case 'permission.replied': return { kind: 'ask', id: d.requestID, reply: d.reply };
    case 'session.execution.started': return { kind: 'run', running: true };
    case 'session.execution.succeeded': return { kind: 'run', running: false };
    case 'session.execution.interrupted': return { kind: 'run', running: false, note: 'Stopped.' };
    case 'session.execution.failed': return { kind: 'run', running: false, error: errorText(d.error) };
    case 'session.usage.updated': return { kind: 'usage', cost: Number(d.cost ?? 0), tokens: Number(d.tokens?.input ?? 0) + Number(d.tokens?.output ?? 0) };
  }
  return null;
}

type Listener = (frame: Frame) => void;
/** One subscription to the server-wide OpenCode event stream, fanned out by session; reconnects while anyone listens. */
export function codeEventHub(auth: OpenCodeAuth, wait = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const listeners = new Map<string, Set<Listener>>();
  let running = false, abort: AbortController | null = null;
  const all = (frame: Frame) => { for (const set of listeners.values()) for (const fn of set) fn(frame); };
  async function loop() {
    let connected = false;
    while (listeners.size) {
      abort = new AbortController();
      try {
        const { url, header } = auth();
        const response = await fetch(url + '/api/event', { headers: { authorization: header, accept: 'text/event-stream' }, signal: abort.signal });
        if (!response.ok || !response.body) throw Error('opencode_events_' + response.status);
        // Frames missed while disconnected are gone ("volatile by contract"): everyone re-reads the session.
        if (connected) all({ type: 'haru.reload' });
        connected = true;
        let buffer = '';
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += Buffer.from(chunk).toString('utf8');
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1);
            if (!line.startsWith('data:')) continue;
            let frame: Frame;
            try { frame = JSON.parse(line.slice(5)); } catch { continue; }
            for (const fn of listeners.get(frame.data?.sessionID) ?? []) fn(frame);
          }
        }
      } catch { /* dropped, refused or aborted: tried again below while anyone listens */ }
      if (listeners.size) await wait(2000);
    }
  }
  return {
    listen(sessionID: string, fn: Listener): () => void {
      let set = listeners.get(sessionID);
      if (!set) listeners.set(sessionID, set = new Set());
      set.add(fn);
      if (!running) { running = true; void loop().finally(() => { running = false; }); }
      return () => { set!.delete(fn); if (!set!.size) listeners.delete(sessionID); if (!listeners.size) abort?.abort(); };
    },
    listening: (sessionID: string) => (listeners.get(sessionID)?.size ?? 0) > 0,
  };
}

type ModeState = { sessionId?: string; folder?: string; dir?: string; model: string; first?: string; prompts?: number; noted?: number };
type Hub = ReturnType<typeof codeEventHub>;
type Jobs = { read(): CodeJob[]; add(job: CodeJob): void; update(id: string, patch: Partial<CodeJob>): void };

/** His git repositories directly in home, most recently touched first. */
export function codeProjects(home: string): string[] {
  try {
    return readdirSync(home, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(path.join(home, e.name, '.git')))
      .map(e => ({ name: e.name, at: statSync(path.join(home, e.name, '.git')).mtimeMs })).sort((a, b) => b.at - a.at).slice(0, 40).map(e => e.name);
  } catch { return []; }
}

/** `git diff` against HEAD, one entry per file, plus files git does not track yet. */
export function gitDiff(dir: string, run = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })) {
  const files = run(['diff', '--no-color', 'HEAD']).split(/^(?=diff --git )/m).filter(Boolean).map(patch => {
    const lines = patch.split('\n');
    return { file: /^diff --git a\/(.+?) b\//.exec(lines[0])?.[1] ?? lines[0], additions: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
      deletions: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length, patch: cut(patch, 60_000) };
  });
  return { files, untracked: run(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).slice(0, 100) };
}

export function codeMode({ api, hub, jobs, home, file, diff = gitDiff }: { api: CodeApi; hub: Hub; jobs: Jobs; home: string; file: string; diff?: typeof gitDiff }) {
  const read = (): ModeState => { try { return { model: CODE_MODELS[0].id, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { return { model: CODE_MODELS[0].id }; } };
  const write = (s: ModeState) => { writeFileSync(file + '.tmp', JSON.stringify(s)); renameSync(file + '.tmp', file); };
  const session = () => { const s = read(); if (!s.sessionId || !s.dir) throw Error('Pick a project folder first.'); return s as Required<Pick<ModeState, 'sessionId' | 'dir'>> & ModeState; };
  const asks = async (id: string) => ((await api('GET', `/api/session/${id}/permission`)) ?? []) as { id: string; resources: string[] }[];

  async function state() {
    const s = read(), base = { folder: s.folder ?? null, model: s.model, models: CODE_MODELS, projects: codeProjects(home), sessionId: s.sessionId ?? null };
    if (!s.sessionId || !s.dir) return { ...base, items: [], running: false, cost: 0 };
    const [messages, waiting, active, info] = await Promise.all([api('GET', `/api/session/${s.sessionId}/message?limit=200`), asks(s.sessionId), api('GET', '/api/session/active'), api('GET', `/api/session/${s.sessionId}`)]);
    return { ...base, items: [...phoneItems(messages, s.dir), ...waiting.map(w => ({ kind: 'ask', id: w.id, resources: w.resources }))], running: Boolean(active?.[s.sessionId]), cost: Number(info?.cost ?? 0) };
  }

  return {
    state,
    /** A fresh session in a project, on the chosen model; the one before it is left alone in OpenCode. */
    async start(folder: string, model?: string) {
      const where = repoDir(folder, home);
      if ('error' in where) throw Error(where.error);
      const s = read(), chosen = model ?? s.model;
      if (!CODE_MODELS.some(m => m.id === chosen)) throw Error('That model is not on the list.');
      const name = path.basename(where.dir);
      const created = await api('POST', '/api/session', { location: { directory: where.dir }, agent: CODE_AGENT, model: modelRef(chosen), title: `Code · ${name}` });
      if (s.sessionId) jobs.update(s.sessionId, { done: true });
      jobs.add({ id: created.id, dir: where.dir, task: '(coding mode)', at: new Date().toISOString(), direct: true });
      write({ sessionId: created.id, folder: name, dir: where.dir, model: chosen, prompts: 0, noted: 0 });
      return state();
    },
    async prompt(text: string) {
      const s = session();
      if (!text.trim()) throw Error('Say what it should do.');
      await api('POST', `/api/session/${s.sessionId}/prompt`, { text });
      write({ ...s, first: s.first ?? cut(text.replace(/\s+/g, ' ').trim(), 120), prompts: (s.prompts ?? 0) + 1 });
      return { ok: true };
    },
    async model(model: string) {
      if (!CODE_MODELS.some(m => m.id === model)) throw Error('That model is not on the list.');
      const s = read();
      if (s.sessionId) await api('POST', `/api/session/${s.sessionId}/model`, { model: modelRef(model) });
      write({ ...s, model });
      return { model };
    },
    /** His answer to what the coder asked; only an ask the session is really waiting on. */
    async permission(id: string, decision: string) {
      if (!['once', 'always', 'reject'].includes(decision)) throw Error('Unknown answer.');
      const s = session();
      if (!(await asks(s.sessionId)).some(w => w.id === id)) throw Error('It is not waiting on that any more.');
      await api('POST', `/api/session/${s.sessionId}/permission/${id}/reply`, { decision });
      return { ok: true };
    },
    async stop() {
      const s = session();
      for (const w of await asks(s.sessionId)) await api('POST', `/api/session/${s.sessionId}/permission/${w.id}/reply`, { decision: 'reject' });
      await api('POST', `/api/session/${s.sessionId}/interrupt`, {});
      return { ok: true };
    },
    diff() { return diff(session().dir); },
    /** Leaving the mode: what Haru should remember, once per stretch of work. */
    leave(): { folder: string; task: string } | null {
      const s = read();
      if (!s.sessionId || !s.folder || (s.prompts ?? 0) <= (s.noted ?? 0)) return null;
      write({ ...s, noted: s.prompts });
      return { folder: s.folder, task: s.first ?? '' };
    },
    /** The session's events for one phone stream: the whole state first, then live changes; null without a session. */
    async subscribe(emit: (event: CodeEvent) => void): Promise<(() => void) | null> {
      const s = read();
      if (!s.sessionId || !s.dir) { emit({ kind: 'state', ...(await state()) }); return null; }
      const names = new Map<string, string>(), dir = s.dir;
      let queue: CodeEvent[] | null = [];
      const stop = hub.listen(s.sessionId, frame => {
        if (frame.type === 'haru.reload') { void state().then(v => emit({ kind: 'state', ...v })).catch(() => {}); return; }
        const event = phoneEvent(frame, names, dir);
        if (event) queue ? queue.push(event) : emit(event);
      });
      try { emit({ kind: 'state', ...(await state()) }); } catch (error) { stop(); throw error; }
      for (const event of queue) emit(event);
      queue = null;
      return stop;
    },
  };
}
export type CodeModeLink = ReturnType<typeof codeMode>;
