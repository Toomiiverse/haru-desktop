// The channel bus.
//
// Both of her faces on the laptop — the terminal client and the desktop
// window — speak one contract: a named channel, one JSON request, one JSON
// answer, and events pushed as they happen. On this machine those channels are
// ipcMain handlers and broadcasts to the window. This serves the very same
// contract over a WebSocket, so the laptop can be a client of the real Haru
// instead of running a second one beside her.
//
// It listens on loopback only. `tailscale serve` (never funnel) is what puts it
// on the tailnet, and a bearer token from ~/.config/haru-desktop/console.json
// is required on top of that. This surface can change settings and hold keys:
// it must never be reachable through the public web door.

import { app, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { WebSocketServer, type WebSocket } from 'ws';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

type Handler = (event: IpcMainInvokeEvent | null, ...args: unknown[]) => unknown;

/** Every channel main.ts has registered, in the same shape the daemon uses. */
export const consoleHandlers = new Map<string, Handler>();

const listeners = new Set<(channel: string, args: unknown[]) => void>();
const configFile = process.env.HARU_CONSOLE_CONFIG_FILE || path.join(os.homedir(), '.config', 'haru-desktop', 'console.json');
let boundPort: number | null = null;
export function consolePort(): number | null { return boundPort; }
export function broadcastConsole(channel: string, args: unknown[]): void {
  for (const listener of listeners) listener(channel, args);
}
const deviceChannels = new Set(['live2d:import','voice:pickClip','companion:moveBy','companion:resizeBy',
  'companion:poke','companion:open','companion:close','companion:ask','companion:showMenu']);
function channelHandler(channel:string,handler:Handler):Handler {
  return process.env.HARU_CORE_BRAIN_WORKER==='on'&&deviceChannels.has(channel)
    ? ()=>{throw Error('desktop_device_unavailable');}:handler;
}

function token(): string {
  try {
    const read = JSON.parse(readFileSync(configFile, 'utf8')) as { token?: unknown };
    if (typeof read.token === 'string' && read.token) return read.token;
  } catch { /* first run */ }
  const made = randomBytes(32).toString('base64url');
  mkdirSync(path.dirname(configFile), { recursive: true });
  writeFileSync(configFile, JSON.stringify({ token: made }, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(configFile, 0o600); } catch { /* best effort */ }
  return made;
}

let installed = false;

export function installConsole(port = Number(process.env.HARU_CONSOLE_PORT || 8788)): void {
  if (installed) return;
  installed = true;

  // 1. Remember every handler as it is registered. main.ts still gets the real
  //    ipcMain semantics; we only shadow the three registration methods and
  //    keep a copy of what went in.
  const handle = ipcMain.handle.bind(ipcMain);
  const handleOnce = ipcMain.handleOnce.bind(ipcMain);
  const removeHandler = ipcMain.removeHandler.bind(ipcMain);
  const on = ipcMain.on.bind(ipcMain);
  const once = ipcMain.once.bind(ipcMain);
  const api = ipcMain as unknown as Record<string, unknown>;
  api.handle = (channel: string, handler: Handler) => { handler=channelHandler(channel,handler);consoleHandlers.set(channel, handler); return handle(channel, handler); };
  api.handleOnce = (channel: string, handler: Handler) => { handler=channelHandler(channel,handler);consoleHandlers.set(channel, handler); return handleOnce(channel, handler); };
  api.removeHandler = (channel: string) => { consoleHandlers.delete(channel); return removeHandler(channel); };
  api.on = (channel: string, handler: Handler) => { handler=channelHandler(channel,handler);consoleHandlers.set(channel, handler); return on(channel, handler); };
  api.once = (channel: string, handler: Handler) => { handler=channelHandler(channel,handler);consoleHandlers.set(channel, handler); return once(channel, handler); };

  // 2. Forward every broadcast, exactly as the window receives it. Wrapping the
  //    instance shadows the method for this webContents only.
  app.on('web-contents-created', (_event, contents: WebContents) => {
    const send = contents.send.bind(contents);
    (contents as unknown as Record<string, unknown>).send = (channel: string, ...args: unknown[]) => {
      broadcastConsole(channel, args);
      return send(channel, ...args);
    };
  });

  // 3. Serve the contract. Loopback, token-gated; tailscale serve puts it on
  //    the tailnet without ever exposing it to the public funnel.
  const secret = token();
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const sockets = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });

  sockets.on('connection', (ws, req) => {
    if (String(req.headers['authorization'] ?? '') !== `Bearer ${secret}`) {
      ws.close(1008, 'unauthorized');
      return;
    }
    const forward = (channel: string, args: unknown[]) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event: channel, args }));
    };
    listeners.add(forward);
    ws.on('message', data => { void answer(ws, String(data)); });
    const gone = () => listeners.delete(forward);
    ws.on('close', gone);
    ws.on('error', gone);
    forward('console:ready', [{ channels: consoleHandlers.size }]);
  });

  server.listen(port, '127.0.0.1', () => {
    const address=server.address();boundPort=address&&typeof address==='object'?address.port:null;
    console.log(`[console] channel bus on 127.0.0.1:${port} (${consoleHandlers.size} channels so far)`);
  });
}

function reply(ws: WebSocket, message: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

async function answer(ws: WebSocket, line: string): Promise<void> {
  let request: { id?: number; call?: string; args?: unknown[] };
  try { request = JSON.parse(line) as typeof request; } catch { return reply(ws, { ok: false, error: 'not JSON' }); }
  const { id, call, args = [] } = request;
  if (call === 'daemon:channels') return reply(ws, { id, ok: true, result: [...consoleHandlers.keys()].sort() });
  const handler = call ? consoleHandlers.get(call) : undefined;
  if (!handler) return reply(ws, { id, ok: false, error: `nothing answers '${call}'` });
  try {
    reply(ws, { id, ok: true, result: (await handler(null, ...args)) ?? null });
  } catch (error) {
    reply(ws, { id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
