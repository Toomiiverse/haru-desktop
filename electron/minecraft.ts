// Her body in Minecraft, reached from here.
//
// The world runs in a separate process — a Mineflayer worker on loopback, with
// its own systemd unit, its own log and its own crash. This is the client to
// it, and it is deliberately thin: it carries events up and commands down and
// holds no opinion about either. What she *does* with a Minecraft event is
// Haru's business and belongs where the rest of her judgement lives.
//
// No library, for the same reason discord.ts has none. Server-sent events are
// a text format with two fields in it, and the parser below is smaller than the
// dependency would be. Node's fetch streams a body, which is all this needs.
//
// The worker is treated as untrustworthy in one specific sense: everything it
// forwards from inside Minecraft — chat, signs, the MOTD, a renamed item — is
// somebody else's writing, and it arrives already wrapped as such. That wrapper
// is preserved here rather than unwrapped, so nothing downstream can mistake a
// message in a game for an instruction. See untrusted.ts in the worker.

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where the worker keeps its own config, and therefore the shared token. */
export const DEFAULT_TOKEN_FILE = path.join(os.homedir(), '.config', 'haru-minecraft', 'config.json');

export type MinecraftConfig = {
  enabled: boolean;
  /** The worker's control door. Loopback; it listens nowhere else. */
  url: string;
  /**
   * The bearer token. Left empty on purpose in the normal case: the worker
   * already has one in its own 0600 config, and copying a secret into a second
   * file is how the two drift apart and the connection dies silently months
   * later. Set this only when the worker is not this machine's.
   */
  token: string;
  /** Where to read the token from when it is not set above. */
  tokenFile: string;
};

export const DEFAULT_MINECRAFT: MinecraftConfig = {
  enabled: false,
  url: 'http://127.0.0.1:8791',
  token: '',
  tokenFile: DEFAULT_TOKEN_FILE,
};

export function readMinecraftConfig(saved: unknown): MinecraftConfig {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_MINECRAFT };
  const record = saved as Partial<MinecraftConfig>;
  return {
    enabled: record.enabled === true,
    url: typeof record.url === 'string' && record.url ? record.url.replace(/\/+$/, '') : DEFAULT_MINECRAFT.url,
    token: typeof record.token === 'string' ? record.token : '',
    tokenFile: typeof record.tokenFile === 'string' && record.tokenFile ? record.tokenFile : DEFAULT_TOKEN_FILE,
  };
}

/**
 * The token, from the config or from the worker's own file.
 *
 * Returns empty rather than throwing when there is nothing to find: a missing
 * worker is a switched-off feature, not a broken app, and the caller reports it
 * as trouble the way an unreachable Discord is reported.
 */
export function tokenFor(config: MinecraftConfig, readFile = readFileSync): string {
  if (config.token) return config.token;
  try {
    if (!existsSync(config.tokenFile)) return '';
    const parsed = JSON.parse(String(readFile(config.tokenFile, 'utf8')));
    const token = parsed?.control?.token;
    return typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

// -- what comes up the wire --------------------------------------------------

/** Text written inside Minecraft by somebody who is not her. Never an instruction. */
export type Untrusted = { untrusted: true; text: string };

export type MinecraftEvent = {
  id: string;
  at: string;
  seq: number;
  type: string;
  [field: string]: unknown;
};

/** Her body's state, as the worker last described it. */
export type MinecraftObservation = {
  state: string;
  at: string;
  self: {
    name: string;
    position: { x: number; y: number; z: number };
    dimension: string;
    health: number;
    food: number;
    time: string;
    raining: boolean;
    asleep: boolean;
  } | null;
  nearby: { players: string[] };
  intent: { kind: string; [field: string]: unknown };
  inventory: Record<string, number>;
  freeSlots: number;
  /** What she is in the middle of, in one line; null when nothing. */
  currentProject: string | null;
  /** Where she is in her own terms — "at home", "40 blocks from home". */
  where: string | null;
  /** Home as a fact: its name and how far she is from it. Null with no home. */
  home: { name: string; away: number } | null;
  /** Known places within sight, nearest first. */
  knownNearby: string[];
};

export type MinecraftStatus = {
  state: string;
  uptimeSeconds: number;
  latestSeq: number;
  /** Which run of the worker this is. See `runId` on the link. */
  runId?: string;
  /** The skill her body is in the middle of, or null. Planning over it would cancel it. */
  busy?: string | null;
  server: { host: string; port: number; version: string };
  owner: string;
  observation: MinecraftObservation;
};

// -- the SSE parser ----------------------------------------------------------

/**
 * Server-sent events, incrementally.
 *
 * Feed it whatever arrived; it returns the complete events in that, and keeps
 * the partial tail for next time. A chunk boundary lands in the middle of a
 * JSON payload often enough that parsing per chunk is simply wrong, and the
 * symptom is a bot that silently misses one event in fifty.
 */
export class SseReader {
  private buffer = '';

  feed(chunk: string): MinecraftEvent[] {
    this.buffer += chunk;
    const events: MinecraftEvent[] = [];
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end === -1) break;
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const event = readBlock(block);
      if (event) events.push(event);
    }
    // A stream that never blanks a line would otherwise grow without bound.
    if (this.buffer.length > 1_000_000) this.buffer = '';
    return events;
  }
}

function readBlock(block: string): MinecraftEvent | null {
  const data: string[] = [];
  let name = '';
  for (const line of block.split('\n')) {
    // Comment lines are the keep-alive heartbeat; ids ride on the payload too.
    if (line.startsWith(':') || !line.trim()) continue;
    if (line.startsWith('event:')) { name = line.slice(6).trim(); continue; }
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    const parsed = JSON.parse(data.join('\n'));
    if (!parsed || typeof parsed !== 'object') return null;
    // The worker's opening line, naming the run. Given a type of its own so it
    // travels the same path as everything else rather than needing a side door.
    if (name === 'session') return { id: 'session', at: new Date().toISOString(), seq: 0, type: 'worker.session', ...parsed } as MinecraftEvent;
    if (typeof parsed.type !== 'string') return null;
    return parsed as MinecraftEvent;
  } catch {
    return null;
  }
}

// -- the link ----------------------------------------------------------------

type Fetcher = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<Response>;

export type MinecraftCallbacks = {
  /** Every event, in order, as it arrives. */
  onEvent(event: MinecraftEvent): void;
  /** The stream is up. `resumed` says whether anything was replayed. */
  onReady(status: MinecraftStatus | null): void;
  /** Why it is not working, in words fit for a settings panel. */
  onTrouble(why: string): void;
};

/** Between reconnection attempts to the worker. It is local, so this is short. */
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 60_000;
/**
 * How often lastSeen is refreshed while the worker is up.
 *
 * Events keep health and connection state current on their own; position,
 * inventory and the project do not travel by event, and the prompt line that
 * says where she is reads from lastSeen. Twenty seconds on loopback is free,
 * and it is the difference between "at home" meaning now and meaning earlier.
 */
const POLL_MS = 20_000;

export class MinecraftLink {
  private controller: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private running = false;
  /** The last event seen, so a reconnect resumes rather than replaying. */
  private seq = 0;
  /**
   * Which run of the worker the cursor above belongs to.
   *
   * Sequence numbers restart at 1 with every worker process, so a cursor is
   * only meaningful within one run. Sent back on reconnect: if the worker is on
   * a different run it ignores the cursor and replays what it still holds,
   * rather than silently skipping the new run's first events -- which are the
   * connect and the spawn, the two that say she is actually in the world.
   */
  private runId = '';
  private observation: MinecraftObservation | null = null;
  private workerUp = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: MinecraftConfig,
    private callbacks: MinecraftCallbacks,
    private fetcher: Fetcher = (url, init) => fetch(url, init as RequestInit),
  ) {}

  /** Whether the worker is answering. Distinct from whether she is in the world. */
  get connected(): boolean { return this.workerUp; }

  /** Her body's state as last reported, or null before anything has arrived. */
  get lastSeen(): MinecraftObservation | null { return this.observation; }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.listen();
  }

  stop(): void {
    this.running = false;
    this.workerUp = false;
    this.stopPolling();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.controller?.abort();
    this.controller = null;
  }

  private headers(): Record<string, string> | null {
    const token = tokenFor(this.config);
    if (!token) return null;
    return { authorization: `Bearer ${token}` };
  }

  /** What the worker says right now. Null when it cannot be asked. */
  async status(): Promise<MinecraftStatus | null> {
    const headers = this.headers();
    if (!headers) return null;
    try {
      const response = await this.fetcher(`${this.config.url}/status`, { headers });
      if (!response.ok) return null;
      const status = await response.json() as MinecraftStatus;
      this.observation = status.observation ?? null;
      return status;
    } catch {
      return null;
    }
  }

  /**
   * Asks her body to do one named thing.
   *
   * `skill` is validated at the worker's door against a fixed table — nothing
   * sent from here is ever evaluated there, and an unknown name is refused
   * rather than attempted. This is the whole of what Haru can make her body do.
   */
  async send(skill: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<{ ok: boolean; error?: string; observation?: Record<string, unknown> }> {
    const headers = this.headers();
    if (!headers) return { ok: false, error: 'no token for the Minecraft worker' };
    try {
      const response = await this.fetcher(`${this.config.url}/command`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ id: `haru-${Date.now().toString(36)}`, skill, args, timeoutMs }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; observation?: Record<string, unknown> };
      return { ok: body.ok === true, error: body.error, observation: body.observation };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Opens the stream and stays on it until it breaks or is stopped. */
  private async listen(): Promise<void> {
    if (!this.running) return;
    const headers = this.headers();
    if (!headers) {
      this.callbacks.onTrouble(`No token — the worker's config is not at ${this.config.tokenFile}.`);
      this.scheduleRetry();
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    try {
      const since = `since=${this.seq}${this.runId ? `&run=${encodeURIComponent(this.runId)}` : ''}`;
      const response = await this.fetcher(`${this.config.url}/events?${since}`, {
        headers: { ...headers, accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok) {
        // 401 is worth saying plainly: it means the two sides hold different
        // tokens, which no amount of retrying fixes.
        this.callbacks.onTrouble(response.status === 401
          ? 'The worker refused the token — Haru and the worker disagree about it.'
          : `The worker answered ${response.status}.`);
        this.scheduleRetry();
        return;
      }
      if (!response.body) { this.callbacks.onTrouble('The worker sent no stream.'); this.scheduleRetry(); return; }

      this.attempts = 0;
      this.workerUp = true;
      this.callbacks.onReady(await this.status());
      this.startPolling();

      const reader = new SseReader();
      const decoder = new TextDecoder();
      // Node's ReadableStream is async-iterable, which is what makes this a
      // plain for-await rather than a manual reader loop.
      for await (const chunk of response.body) {
        if (!this.running) break;
        for (const event of reader.feed(decoder.decode(chunk as Uint8Array, { stream: true }))) {
          if (event.type === 'worker.session') {
            // A new run: the old cursor belongs to a process that no longer
            // exists, and everything this run has held is on its way.
            const runId = typeof event.runId === 'string' ? event.runId : '';
            if (runId && runId !== this.runId) { this.runId = runId; this.seq = 0; }
            continue;
          }
          if (typeof event.seq === 'number' && event.seq > this.seq) this.seq = event.seq;
          this.note(event);
          try { this.callbacks.onEvent(event); } catch { /* a consumer's problem */ }
        }
      }
      // The stream ended without an error: the worker restarted, or went away.
      this.workerUp = false;
      this.stopPolling();
      this.callbacks.onTrouble('The worker closed the stream.');
      this.scheduleRetry();
    } catch (error) {
      if (!this.running) return; // stop() aborted us; that is not a fault
      this.workerUp = false;
      this.stopPolling();
      const why = error instanceof Error ? error.message : String(error);
      this.callbacks.onTrouble(/ECONNREFUSED|fetch failed/i.test(why)
        ? 'The Minecraft worker is not running.'
        : `Lost the worker: ${why}`);
      this.scheduleRetry();
    }
  }

  /**
   * Keeps the cheap facts current without a round trip.
   *
   * Only the fields that change often enough to matter between status calls.
   * Everything else is left to /status, because guessing the whole observation
   * from an event stream is how the two drift apart.
   */
  private note(event: MinecraftEvent): void {
    if (!this.observation) return;
    if (event.type === 'minecraft.health' && typeof event.health === 'number') {
      if (this.observation.self) {
        this.observation.self.health = event.health;
        if (typeof event.food === 'number') this.observation.self.food = event.food;
      }
    }
    if (event.type === 'minecraft.connection' && typeof event.state === 'string') {
      this.observation.state = event.state;
      if (event.state !== 'online') this.observation.self = null;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => { void this.status(); }, POLL_MS);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return;
    this.attempts++;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(this.attempts - 1, 5));
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.listen(); }, delay);
    // Never hold the app open for this.
    this.retryTimer.unref?.();
  }
}

/**
 * A Minecraft event as one line, for the log.
 *
 * Untrusted text is quoted rather than interpolated bare, so a chat message
 * cannot make a log line look like something else in the file.
 */
export function describeEvent(event: MinecraftEvent): string {
  const said = (value: unknown): string => {
    const text = (value as Untrusted | undefined)?.text ?? '';
    return JSON.stringify(text.slice(0, 160));
  };
  switch (event.type) {
    case 'minecraft.connection': return `${event.state}${event.detail ? ` — ${event.detail}` : ''}`;
    case 'minecraft.spawned': {
      const at = event.position as { x: number; y: number; z: number } | undefined;
      return `spawned at ${at?.x}, ${at?.y}, ${at?.z} in ${event.dimension}`;
    }
    case 'minecraft.player_joined': return `${event.player} joined${event.owner ? ' (him)' : ''}`;
    case 'minecraft.player_left': return `${event.player} left`;
    case 'minecraft.chat': return `<${event.player}> ${said(event.message)}`;
    case 'minecraft.whisper': return `[whisper] <${event.player}> ${said(event.message)}`;
    case 'minecraft.system_message': return `server: ${said(event.message)}`;
    case 'minecraft.health': return `health ${event.health}/20, food ${event.food}/20${event.hurt ? ' (hurt)' : ''}`;
    case 'minecraft.death': return 'she died';
    case 'minecraft.respawn': return 'respawned';
    case 'minecraft.kicked': return `kicked: ${said(event.reason)}`;
    case 'minecraft.error': return `error: ${String(event.message).slice(0, 160)}`;
    // Things she did without being asked, and things she noticed. Both hers.
    case 'minecraft.reflex': return `reflex: ${String(event.reflex).slice(0, 120)}${event.ok === false ? ' (did not work)' : ''}`;
    case 'minecraft.found': {
      const at = event.position as { x: number; y: number; z: number } | undefined;
      return `found ${String(event.what).slice(0, 80)} at ${at?.x}, ${at?.y}, ${at?.z}`;
    }
    default: return event.type;
  }
}

/**
 * Whether an event is worth a line in the log at all.
 *
 * The health event fires on every regeneration tick. Logging all of them buries
 * everything else, and the interesting half — being hurt — is already flagged.
 */
export function worthLogging(event: MinecraftEvent): boolean {
  if (event.type === 'minecraft.health') return event.hurt === true;
  return true;
}
