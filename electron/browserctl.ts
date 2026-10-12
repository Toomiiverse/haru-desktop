// Her browser, and the two ways of having one.
//
// The default is her own: Playwright MCP, run headless as a child of this
// process (playwright.ts), with no window and no debug port. The other is a
// Chrome somebody started on the desk with --remote-debugging-port, driven over
// Chrome DevTools Protocol — the client for that is the second half of this
// file, a thin JSON-RPC bridge over the built-in WebSocket with no dependency.
// Both answer the same questions through the Browser interface below, so the
// tool that drives them (tools.ts) does not know which one it has.

import type { PageReading } from './pagesnapshot';

export type CdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export const DEFAULT_BROWSER_PORT = 9222;

export type BrowserBackend = 'playwright' | 'chrome';

export type BrowserControlConfig = {
  enabled: boolean;
  /** `playwright`: her own headless browser, inside this process. `chrome`: a Chrome on the desk, over its debug port. */
  backend: BrowserBackend;
  /** The CDP port, for the chrome backend. */
  port: number;
  /** A Chromium to use instead of the one Playwright downloads — the system one on a server, say. */
  executablePath: string;
};

export const DEFAULT_BROWSER_CONTROL: BrowserControlConfig = { enabled: false, backend: 'playwright', port: DEFAULT_BROWSER_PORT, executablePath: '' };

export function readBrowserControlConfig(saved: unknown): BrowserControlConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_BROWSER_CONTROL;
  const record = saved as Partial<BrowserControlConfig>;
  const port = typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 ? record.port : DEFAULT_BROWSER_PORT;
  const backend: BrowserBackend = record.backend === 'chrome' ? 'chrome' : 'playwright';
  return { enabled: record.enabled === true, backend, port, executablePath: typeof record.executablePath === 'string' ? record.executablePath.trim() : '' };
}

/** A picture she took, for the conversation. */
export type Picture = { image: string; mimeType: string; caption: string };

/**
 * What either backend can do. Every method that moves the page answers with a
 * reading of where it ended up, so one call is one round for her. Numbers are
 * the numbers of the last reading — a link or an element she was shown.
 */
export interface Browser {
  readonly backend: BrowserBackend;
  /** Open an address, or search for some words. */
  open(url: string): Promise<PageReading>;
  /** The page as it is now. */
  read(): Promise<PageReading>;
  /** Follow link number `n` of the last reading. */
  follow(n: number): Promise<PageReading>;
  /** One screen up or down, for pages that load as they scroll. */
  scroll(direction: 'up' | 'down'): Promise<PageReading>;
  back(): Promise<PageReading>;
  /** Click element number `n` of the last reading. */
  click(n: number): Promise<PageReading>;
  /** Type into element number `n`, and press Enter when `submit`. */
  type(n: number, text: string, submit: boolean): Promise<PageReading>;
  screenshot(full: boolean): Promise<Picture>;
  /** The host of the page she is on, for captions and logs; empty when nowhere. */
  where(): string;
  /** Close the page, and the browser with it when it is hers. */
  close(): Promise<void>;
}

/** The error for an action a backend cannot do. */
export class Unsupported extends Error {}

/** An address, or words to look up. Bare "youtube.com" becomes https; a phrase becomes a search. */
export function asAddress(input: string): string {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) throw new Error('Only http and https addresses can be opened.');
  if (!/\s/.test(text) && /^[\w-]+(?:\.[\w-]+)+(?:[/?#].*)?$/.test(text)) return `https://${text}`;
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
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

/**
 * The desk Chrome as a Browser. It reads text and takes pictures; it has no
 * accessibility tree to number links and buttons from, so following, clicking
 * and typing are not on offer — she opens addresses instead.
 */
export function cdpBrowser(port: number, fetchImpl: FetchLike, settleMs = 1500): Browser {
  let tab = '';
  let url = '';
  const current = async () => {
    if (tab) return tab;
    const targets = await listTargets(port, fetchImpl);
    tab = targets[0]?.id ?? '';
    url = targets[0]?.url ?? url;
    if (!tab) throw new Error('no tab is open — open one first.');
    return tab;
  };
  const reading = async (): Promise<PageReading> => {
    const id = await current();
    const text = await pageText(port, id, fetchImpl, 120_000);
    const target = (await listTargets(port, fetchImpl)).find(item => item.id === id);
    url = target?.url ?? url;
    return { url, title: target?.title ?? '', text, links: [], elements: [] };
  };
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, settleMs));
  const not = (what: string) => Promise.reject(new Unsupported(`${what} is not possible with the desk browser — open the address you want instead.`));
  return {
    backend: 'chrome',
    async open(input) {
      const address = asAddress(input);
      if (tab) await navigate(port, tab, address, fetchImpl);
      else tab = await openTab(port, address, fetchImpl);
      url = address;
      await settle();
      return reading();
    },
    read: reading,
    follow: () => not('following a link by number'),
    scroll: () => not('scrolling'),
    back: () => not('going back'),
    click: () => not('clicking'),
    type: () => not('typing'),
    async screenshot() {
      const id = await current();
      const png = await screenshot(port, id, fetchImpl);
      if (!png) throw new Error('the screenshot came back empty.');
      return { image: Buffer.from(png).toString('base64'), mimeType: 'image/png', caption: hostOf(url) };
    },
    where: () => hostOf(url),
    async close() {
      if (!tab) return;
      await closeTab(port, tab, fetchImpl);
      tab = '';
      url = '';
    },
  };
}
