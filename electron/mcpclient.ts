// A Model Context Protocol client, the stdio half only.
//
// Haru runs Playwright MCP as a child process and talks to it over its stdin
// and stdout: one JSON-RPC 2.0 message per line, which is all the protocol is
// on this transport. Written against the wire rather than against the SDK for
// the reason browserctl.ts speaks raw CDP — three methods are needed
// (initialize, tools/list, tools/call) and the SDK is a dependency tree for
// something a hundred lines covers. The child is an argument, so the whole
// client is exercised in tests with two PassThrough streams and no process.

import type { ChildProcess } from 'node:child_process';

/** What a tool call hands back: text to read, pictures to look at. */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

export type McpToolResult = { content: McpContent[]; isError?: boolean };

/** The streams of a child process, which is all the client needs of it. */
export type McpChild = Pick<ChildProcess, 'stdin' | 'stdout' | 'kill' | 'on' | 'once' | 'pid'>;

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** How long one request may take before it is given up on. Navigations are
 *  bounded inside Playwright MCP itself; this is the backstop for a server
 *  that stopped answering altogether. */
export const MCP_CALL_TIMEOUT_MS = 60_000;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class McpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private closed: Error | null = null;

  constructor(private child: McpChild, private timeoutMs = MCP_CALL_TIMEOUT_MS) {
    child.stdout?.on('data', (chunk: Buffer | string) => this.feed(String(chunk)));
    const gone = (why: string) => this.fail(new Error(why));
    child.on('exit', (code, signal) => gone(`the browser process exited (${signal ?? code ?? 'unknown'})`));
    child.on('error', error => gone(`the browser process failed: ${error.message}`));
    child.stdout?.on('close', () => gone('the browser process closed its output'));
  }

  /** Whether the child has gone away. A client that is done is not reused. */
  get alive(): boolean {
    return this.closed === null;
  }

  /** The handshake: initialize, then the notification that we are ready. */
  async initialize(): Promise<{ name: string; version: string }> {
    const result = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'haru', version: '1' },
    }) as { serverInfo?: { name?: string; version?: string } };
    this.notify('notifications/initialized', {});
    return { name: result.serverInfo?.name ?? 'unknown', version: result.serverInfo?.version ?? '' };
  }

  async listTools(): Promise<string[]> {
    const result = await this.request('tools/list', {}) as { tools?: { name: string }[] };
    return (result.tools ?? []).map(tool => tool.name);
  }

  /** One tool call. A result marked isError is still a result — the text says
   *  what went wrong, and the caller decides what to tell her. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const result = await this.request('tools/call', { name, arguments: args }) as Partial<McpToolResult> | undefined;
    return { content: Array.isArray(result?.content) ? result!.content : [], isError: result?.isError === true };
  }

  close() {
    this.fail(new Error('the browser was closed'));
    try { this.child.kill(); } catch { /* already gone */ }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the browser did not answer ${method} in ${Math.round(this.timeoutMs / 1000)}s`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(message: Record<string, unknown>) {
    try {
      this.child.stdin?.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private feed(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: { id?: number; result?: unknown; error?: { message?: string; code?: number } };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue; // a stray log line on stdout, not a message
      }
      if (typeof message.id !== 'number') continue; // a notification, which nothing here waits for
      const entry = this.pending.get(message.id);
      if (!entry) continue;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message ?? `MCP error ${message.error.code ?? ''}`.trim()));
      else entry.resolve(message.result);
    }
  }

  /** Everything waiting is told the same thing, once. */
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = error;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

/** The text parts of a result, joined — what a tool said, without the pictures. */
export function textOf(result: McpToolResult): string {
  return result.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof (part as { text?: unknown }).text === 'string').map(part => part.text).join('\n');
}

/** The first picture in a result, as base64, with its type. */
export function imageOf(result: McpToolResult): { data: string; mimeType: string } | null {
  const found = result.content.find(part => part.type === 'image' && typeof (part as { data?: unknown }).data === 'string') as { data: string; mimeType?: string } | undefined;
  return found ? { data: found.data, mimeType: found.mimeType ?? 'image/jpeg' } : null;
}
