// Driving the browser on this machine, through Chrome DevTools Protocol.
//
// Chrome runs with --remote-debugging-port and answers CDP over HTTP (for the
// target list) and a WebSocket per target (for commands). This client is a thin
// JSON-RPC bridge over the built-in WebSocket — no dependency, matching how
// everything else here talks to its servers. Works for any Chromium browser.

export type CdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export const DEFAULT_BROWSER_PORT = 9222;

export type BrowserControlConfig = { enabled: boolean; port: number };

export const DEFAULT_BROWSER_CONTROL: BrowserControlConfig = { enabled: false, port: DEFAULT_BROWSER_PORT };

export function readBrowserControlConfig(saved: unknown): BrowserControlConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_BROWSER_CONTROL;
  const record = saved as Partial<BrowserControlConfig>;
  const port = typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 ? record.port : DEFAULT_BROWSER_PORT;
  return { enabled: record.enabled === true, port };
}

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** The pages open in the browser. */
export async function listTargets(port: number, fetchImpl: FetchLike): Promise<CdpTarget[]> {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`the browser did not answer on port ${port} — is it running?`);
  const list = await response.json() as CdpTarget[];
  return list.filter(target => target.type === 'page' || target.type === 'tab');
}

async function browserWs(port: number, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`);
  const info = await response.json() as { webSocketDebuggerUrl?: string };
  if (!info.webSocketDebuggerUrl) throw new Error('the browser did not expose a debugger endpoint');
  return info.webSocketDebuggerUrl;
}

async function pageWs(port: number, id: string, fetchImpl: FetchLike): Promise<string> {
  const all = await listTargets(port, fetchImpl);
  const found = all.find(target => target.id === id);
  if (!found?.webSocketDebuggerUrl) throw new Error('no such tab');
  return found.webSocketDebuggerUrl;
}

/** One WebSocket to one CDP target: send a command, get its result. */
export class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      let message: { id?: number; error?: { message?: string }; result?: unknown };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (message.id === undefined) return; // an event, not an answer
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? 'CDP command failed'));
      else entry.resolve(message.result);
    });
  }

  static async connect(url: string): Promise<CdpSession> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('could not connect to the browser')), { once: true });
    });
    return new CdpSession(ws);
  }

  command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function withBrowserSession<T>(wsUrl: string, run: (session: CdpSession) => Promise<T>): Promise<T> {
  const session = await CdpSession.connect(wsUrl);
  try {
    return await run(session);
  } finally {
    session.close();
  }
}

/** Open a new tab and bring it to the front. Returns the new target id. */
export async function openTab(port: number, url: string, fetchImpl: FetchLike): Promise<string> {
  const wsUrl = await browserWs(port, fetchImpl);
  return withBrowserSession(wsUrl, async session => {
    const result = await session.command('Target.createTarget', { url }) as { targetId?: string };
    const id = result.targetId ?? '';
    if (id) await session.command('Target.activateTarget', { targetId: id });
    return id;
  });
}

export async function closeTab(port: number, id: string, fetchImpl: FetchLike): Promise<void> {
  const wsUrl = await browserWs(port, fetchImpl);
  await withBrowserSession(wsUrl, session => session.command('Target.closeTarget', { targetId: id }) as Promise<unknown>);
}

export async function activateTab(port: number, id: string, fetchImpl: FetchLike): Promise<void> {
  const wsUrl = await browserWs(port, fetchImpl);
  await withBrowserSession(wsUrl, session => session.command('Target.activateTarget', { targetId: id }) as Promise<unknown>);
}

export async function navigate(port: number, id: string, url: string, fetchImpl: FetchLike): Promise<void> {
  const wsUrl = await pageWs(port, id, fetchImpl);
  await withBrowserSession(wsUrl, session => session.command('Page.navigate', { url }) as Promise<unknown>);
}

/** What is actually on the page — body text, not a blurb. */
export async function pageText(port: number, id: string, fetchImpl: FetchLike, max = 4000): Promise<string> {
  const wsUrl = await pageWs(port, id, fetchImpl);
  return withBrowserSession(wsUrl, async session => {
    const result = await session.command('Runtime.evaluate', {
      expression: 'document.body.innerText',
      returnByValue: true,
    }) as { result?: { value?: string } };
    return (result.result?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  });
}

/** A PNG of the page, for the screenshot store. */
export async function screenshot(port: number, id: string, fetchImpl: FetchLike): Promise<Uint8Array | null> {
  const wsUrl = await pageWs(port, id, fetchImpl);
  return withBrowserSession(wsUrl, async session => {
    const result = await session.command('Page.captureScreenshot', { format: 'png' }) as { data?: string };
    if (!result.data) return null;
    return new Uint8Array(Buffer.from(result.data, 'base64'));
  });
}