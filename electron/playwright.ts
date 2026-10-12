// Her own browser: Playwright MCP, headless, as a child of this process.
//
// Nothing is installed on the box beyond what npm brings — @playwright/mcp and
// a Chromium — and nothing listens on a port: the server speaks over its own
// stdin and stdout (mcpclient.ts). It is started on the first thing she asks of
// it and stopped after a couple of idle minutes, because the machine also runs
// her model on the GPU and a browser sat open all day is memory she needs
// elsewhere. Every request the browser makes goes through the guard proxy
// (webguard.ts), which is where "not this machine, not this network" is kept.
//
// Playwright MCP has two dozen tools of its own. She is offered none of them
// directly: her model struggles with a large table (see textToolCall in
// toolloop.ts), so the handful she needs are mapped onto browser_control's
// actions here, and the ones that run arbitrary code are never called.

import { McpClient, imageOf, textOf, type McpChild, type McpToolResult } from './mcpclient';
import { readError, readPageHeader, readSnapshot, type PageReading } from './pagesnapshot';
import { admit, type Resolver } from './webguard';
import { asAddress, hostOf, type Browser, type BrowserControlConfig, type Picture } from './browserctl';

/** The one version this was written against. Its snapshot format is what pagesnapshot.ts reads. */
export const PLAYWRIGHT_MCP_VERSION = '0.0.83';

/** Two minutes of nothing asked and the browser goes. */
export const BROWSER_IDLE_MS = 2 * 60_000;
/** A page gets this long to load before she is answered with what is there. */
export const NAVIGATION_TIMEOUT_MS = 15_000;
/** A click or a keystroke gets this long to take. */
export const ACTION_TIMEOUT_MS = 10_000;
export const VIEWPORT = '1280x900';

/**
 * The command line for the server. Pure, so the flags are pinned by a test:
 * isolated means the profile lives in memory and nothing is kept between
 * runs; the proxy flags send every request, loopback included, through the
 * guard; the timeouts are hers rather than Playwright's minute-long defaults.
 */
export function playwrightArgs(cli: string, config: Pick<BrowserControlConfig, 'executablePath'>, proxyPort: number, outputDir: string): string[] {
  return [
    cli,
    '--headless',
    '--isolated',
    '--browser', 'chromium',
    '--viewport-size', VIEWPORT,
    '--image-responses', 'allow',
    '--output-dir', outputDir,
    '--proxy-server', `http://127.0.0.1:${proxyPort}`,
    '--proxy-bypass', '<-loopback>',
    '--block-service-workers',
    '--timeout-navigation', String(NAVIGATION_TIMEOUT_MS),
    '--timeout-action', String(ACTION_TIMEOUT_MS),
    ...(config.executablePath ? ['--executable-path', config.executablePath] : []),
  ];
}

export type PlaywrightDeps = {
  /** Start the server process. Given the proxy's port, because the flags name it. */
  spawn(proxyPort: number): Promise<McpChild> | McpChild;
  /** Start the guard proxy; answers its port. Called once per browser life. */
  startProxy(): Promise<{ port: number; close(): Promise<void> }>;
  resolve?: Resolver;
  idleMs?: number;
  log?(line: string): void;
  warn?(line: string): void;
};

/** The pieces of a running browser, made together and torn down together. */
type Running = { client: McpClient; proxy: { port: number; close(): Promise<void> } };

export type PlaywrightBrowser = Browser & {
  /** Whether the process is up right now. */
  running(): boolean;
  /** Stop it, if it is up. Idempotent, and what app quit calls. */
  stop(): Promise<void>;
};

export function playwrightBrowser(deps: PlaywrightDeps): PlaywrightBrowser {
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? log;
  const idleMs = deps.idleMs ?? BROWSER_IDLE_MS;
  let running: Running | null = null;
  let starting: Promise<Running> | null = null;
  let idle: NodeJS.Timeout | null = null;
  /** The last reading, whose numbers her next call means. */
  let current: PageReading | null = null;

  const stop = async () => {
    if (idle) { clearTimeout(idle); idle = null; }
    const was = running;
    running = null;
    starting = null;
    current = null;
    if (!was) return;
    was.client.close();
    await was.proxy.close().catch(() => {});
    log('[browser] closed her browser');
  };

  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { void stop(); }, idleMs);
    idle.unref?.();
  };

  const start = async (): Promise<Running> => {
    if (running?.client.alive) return running;
    if (running) await stop(); // the process died under us
    if (!starting) {
      starting = (async () => {
        const proxy = await deps.startProxy();
        try {
          const child = await deps.spawn(proxy.port);
          const client = new McpClient(child);
          const info = await client.initialize();
          log(`[browser] started ${info.name} ${info.version} (pid ${child.pid ?? '?'}), guarded on 127.0.0.1:${proxy.port}`);
          running = { client, proxy };
          return running;
        } catch (error) {
          await proxy.close().catch(() => {});
          throw error;
        } finally {
          starting = null;
        }
      })();
    }
    return starting;
  };

  /** One tool call, with the server's own error turned into a thrown one. */
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> => {
    const { client } = await start();
    touch();
    const result = await client.callTool(name, args);
    const text = textOf(result);
    if (result.isError) {
      const reason = readError(text) ?? text.split('\n')[0] ?? 'the browser refused';
      throw new Error(tidy(reason));
    }
    return result;
  };

  /** The page as it stands, read into numbers she can use. */
  const snapshot = async (): Promise<PageReading> => {
    const result = await call('browser_snapshot');
    const reading = readSnapshot(textOf(result));
    current = reading;
    return reading;
  };

  const numbered = <T extends { n: number }>(list: T[], n: number, what: string): T => {
    const found = list.find(item => item.n === Math.round(n));
    if (!found) throw new Error(list.length ? `there is no ${what} ${n} on this page — the list has ${list.length}. Read the page again for the current numbers.` : `this page has no ${what}s to pick from.`);
    return found;
  };

  return {
    backend: 'playwright',
    async open(input) {
      const address = asAddress(input);
      // Checked before the browser is pointed at it, for a plain answer; the
      // proxy would refuse it anyway, with a page that says so.
      const verdict = await admit(hostOf(address), deps.resolve);
      if (!verdict.ok) throw new Error(`that address is not one you reach: ${verdict.reason}.`);
      const result = await call('browser_navigate', { url: address });
      const header = readPageHeader(textOf(result));
      const reading = await snapshot();
      if (!reading.url && header.url) reading.url = header.url;
      return reading;
    },
    read: snapshot,
    async follow(n) {
      const page = current ?? await snapshot();
      const link = numbered(page.links, n, 'link');
      await call('browser_click', { target: link.ref, element: `link "${link.text.slice(0, 60)}"` });
      return snapshot();
    },
    async scroll(direction) {
      await call('browser_press_key', { key: direction === 'up' ? 'PageUp' : 'PageDown' });
      return snapshot();
    },
    async back() {
      await call('browser_navigate_back');
      return snapshot();
    },
    async click(n) {
      const page = current ?? await snapshot();
      const element = numbered(page.elements, n, 'element');
      await call('browser_click', { target: element.ref, element: `${element.role} "${element.label.slice(0, 60)}"` });
      return snapshot();
    },
    async type(n, text, submit) {
      const page = current ?? await snapshot();
      const element = numbered(page.elements, n, 'element');
      await call('browser_type', { target: element.ref, element: `${element.role} "${element.label.slice(0, 60)}"`, text, submit });
      return snapshot();
    },
    async screenshot(full) {
      const result = await call('browser_take_screenshot', { type: 'jpeg', scale: 'css', fullPage: full });
      const picture = imageOf(result);
      if (!picture) throw new Error('the screenshot came back empty.');
      return { image: picture.data, mimeType: picture.mimeType, caption: hostOf(current?.url ?? '') } satisfies Picture;
    },
    where: () => hostOf(current?.url ?? ''),
    async close() {
      await stop();
    },
    running: () => running !== null,
    stop,
  };

  function tidy(reason: string): string {
    // Playwright's errors carry a call log nobody needs read out.
    const line = reason.split('\n')[0].replace(/^Error:\s*/, '').trim();
    if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/.test(line)) return 'the page could not be reached, or is not one you are allowed to reach';
    if (/Timeout \d+ms exceeded/.test(line)) return 'the page took too long to load';
    if (/Ref \S+ not found/.test(line)) return 'the page changed under you — read it again for the current numbers';
    warn(`[browser] ${line}`);
    return line;
  }
}
