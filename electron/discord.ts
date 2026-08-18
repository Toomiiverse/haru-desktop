// Reaching her from Discord.
//
// The web version cannot be pushed to — that was a deliberate choice, and it is
// the one thing it cannot do. Discord is already on the phone, already makes a
// noise, and already survives the app being closed, so it is the right place for
// her to be the one who starts a conversation.
//
// No library. Node has WebSocket and fetch now, and the gateway is a handful of
// opcodes: hello, heartbeat, identify, listen. The same reasoning as using
// node:http for the web door rather than adding express — a dependency here
// would be larger than the thing it replaces.
//
// The rules are the same as the web door's: exactly one person gets in, and she
// has no hands. A bot is reachable by anyone who finds it, so "who is allowed"
// is checked on every single message rather than assumed from the token being
// secret.

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const API = 'https://discord.com/api/v10';

/** DMs, their content, and guild messages — nothing else is any of her business. */
const INTENTS = (1 << 12) | (1 << 15) | (1 << 9);

/** Discord refuses anything longer, and truncating her mid-sentence is worse than two messages. */
export const DISCORD_LIMIT = 2000;

export type DiscordConfig = {
  enabled: boolean;
  /** The one account she will answer. Everyone else is ignored in silence. */
  ownerId: string;
  /** Where she pesters, once known. Opened on demand and remembered. */
  dmChannelId: string;
  /** Hours between unprompted messages. Longer than the phone's, by request. */
  pesterHours: number;
};

/**
 * Whether that is a Discord id rather than a username.
 *
 * They look nothing alike — an id is eighteen-odd digits, a username is a name —
 * but the failure of confusing them is silent: she compares it against the
 * author id of every message, never matches, and simply says nothing forever.
 * Worth refusing at the point it is typed, because there is no later moment
 * where it looks wrong.
 */
export function looksLikeUserId(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim());
}

export function readDiscordConfig(saved: unknown): DiscordConfig {
  const record = (saved && typeof saved === 'object' ? saved : {}) as Partial<DiscordConfig>;
  const hours = typeof record.pesterHours === 'number' ? record.pesterHours : 3;
  return {
    enabled: Boolean(record.enabled),
    ownerId: typeof record.ownerId === 'string' ? record.ownerId.trim() : '',
    dmChannelId: typeof record.dmChannelId === 'string' ? record.dmChannelId : '',
    // Floored at an hour: this is the channel that makes a noise on a phone, and
    // a companion that buzzes every ten minutes gets muted — which is a worse
    // outcome than one that says nothing.
    pesterHours: Math.min(12, Math.max(1, hours)),
  };
}

/**
 * Whether this message is one she should answer at all.
 *
 * Her own messages, other bots, empty content, and — the one that matters —
 * anybody who is not the owner. A bot token is a secret, not a lock: the moment
 * it leaks, or the bot is added to somebody's server, this check is what stands
 * between a stranger and everything she remembers.
 */
export function shouldAnswer(
  message: { author?: { id?: string; bot?: boolean }; content?: string },
  ownerId: string,
  selfId: string,
): boolean {
  if (!ownerId) return false;
  const author = message.author?.id ?? '';
  if (!author || author === selfId) return false;
  if (message.author?.bot) return false;
  if (author !== ownerId) return false;
  return Boolean(message.content && message.content.trim());
}

/**
 * Her reply, cut into pieces Discord will accept.
 *
 * Paragraphs first, then sentences, then — only if one sentence is genuinely
 * enormous — on width. She writes in short paragraphs, so in practice the first
 * split is the only one that ever runs.
 */
export function splitForDiscord(text: string, limit = DISCORD_LIMIT): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const out: string[] = [];
  let held = '';
  const flush = () => { if (held.trim()) out.push(held.trim()); held = ''; };
  for (const paragraph of clean.split(/\n{2,}/)) {
    if ((held ? held + '\n\n' + paragraph : paragraph).length <= limit) {
      held = held ? held + '\n\n' + paragraph : paragraph;
      continue;
    }
    flush();
    if (paragraph.length <= limit) { held = paragraph; continue; }
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      if ((held ? held + ' ' + sentence : sentence).length <= limit) {
        held = held ? held + ' ' + sentence : sentence;
        continue;
      }
      flush();
      let rest = sentence;
      while (rest.length > limit) { out.push(rest.slice(0, limit)); rest = rest.slice(limit); }
      held = rest;
    }
  }
  flush();
  return out;
}

/**
 * How long to wait before trying the gateway again.
 *
 * Doubling, capped at a minute. A disconnected bot retrying in a tight loop is
 * how a token gets rate limited, and a rate-limited token is down for far longer
 * than the outage would have lasted.
 */
export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

type Sink = {
  answer(text: string): Promise<{ reply: string; ignored?: boolean }>;
  onReady?(username: string): void;
};

/**
 * The connection itself.
 *
 * Deliberately small: identify, heartbeat, resume, one message handler. The
 * parts most likely to be wrong at three in the morning — reconnection and
 * resume — are kept simplest, because a bot that silently stops answering is
 * worse than one that visibly restarts.
 */
export class DiscordLink {
  private socket: WebSocket | null = null;
  private heart: ReturnType<typeof setInterval> | null = null;
  private sequence: number | null = null;
  private session = '';
  private resumeUrl = '';
  private selfId = '';
  private attempt = 0;
  private closed = false;

  constructor(private token: string, private ownerId: string, private sink: Sink) {}

  start() { this.closed = false; this.open(GATEWAY); }

  stop() {
    this.closed = true;
    if (this.heart) clearInterval(this.heart);
    this.heart = null;
    try { this.socket?.close(1000); } catch { /* already gone */ }
    this.socket = null;
  }

  /** Opens a DM channel with the owner, so she can speak without being spoken to. */
  async dmChannel(): Promise<string> {
    const res = await fetch(API + '/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: 'Bot ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: this.ownerId }),
    });
    if (!res.ok) throw new Error('Discord refused to open a DM (' + res.status + '). Do you share a server with the bot?');
    return String(((await res.json()) as { id: string }).id);
  }

  async send(channelId: string, text: string) {
    for (const part of splitForDiscord(text)) {
      const res = await fetch(API + '/channels/' + channelId + '/messages', {
        method: 'POST',
        headers: { Authorization: 'Bot ' + this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: part }),
      });
      if (!res.ok) { console.warn('[discord] could not send (' + res.status + ')'); return; }
    }
  }

  private open(url: string) {
    if (this.closed) return;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('message', event => void this.receive(String(event.data)));
    socket.addEventListener('error', () => { /* a close always follows */ });
    socket.addEventListener('close', event => {
      if (this.heart) clearInterval(this.heart);
      this.heart = null;
      if (this.closed) return;
      // 4004 is a rejected token. Retrying that forever helps nobody and only
      // makes the real problem harder to see in the log.
      if (event.code === 4004) { console.error('[discord] the token was rejected — set it again in Setup'); return; }
      this.attempt += 1;
      const wait = backoffMs(this.attempt);
      console.warn('[discord] disconnected (' + event.code + ') — trying again in ' + Math.round(wait / 1000) + 's');
      const next = this.session && this.resumeUrl ? this.resumeUrl + '/?v=10&encoding=json' : GATEWAY;
      setTimeout(() => this.open(next), wait);
    });
  }

  private say(payload: unknown) {
    try { this.socket?.send(JSON.stringify(payload)); } catch { /* the close handler deals with it */ }
  }

  private async receive(raw: string) {
    let packet: { op: number; d?: unknown; s?: number; t?: string };
    try { packet = JSON.parse(raw) as typeof packet; } catch { return; }
    if (typeof packet.s === 'number') this.sequence = packet.s;

    if (packet.op === 10) {
      const hello = packet.d as { heartbeat_interval: number };
      this.heart = setInterval(() => this.say({ op: 1, d: this.sequence }), hello.heartbeat_interval);
      if (this.session) this.say({ op: 6, d: { token: this.token, session_id: this.session, seq: this.sequence } });
      else this.say({ op: 2, d: { token: this.token, intents: INTENTS, properties: { os: process.platform, browser: 'haru', device: 'haru' } } });
      return;
    }
    // Asked to reconnect, or told the session is dead.
    if (packet.op === 7) { try { this.socket?.close(4000); } catch { /* closing anyway */ } return; }
    if (packet.op === 9) { this.session = ''; this.sequence = null; try { this.socket?.close(4000); } catch { /* closing anyway */ } return; }
    if (packet.op !== 0) return;

    if (packet.t === 'READY') {
      const ready = packet.d as { session_id: string; resume_gateway_url: string; user: { id: string; username: string } };
      this.session = ready.session_id;
      this.resumeUrl = ready.resume_gateway_url;
      this.selfId = ready.user.id;
      this.attempt = 0;
      console.log('[discord] connected as ' + ready.user.username);
      this.sink.onReady?.(ready.user.username);
      return;
    }

    if (packet.t !== 'MESSAGE_CREATE') return;
    const message = packet.d as { channel_id: string; content: string; author?: { id?: string; bot?: boolean } };
    if (!shouldAnswer(message, this.ownerId, this.selfId)) return;

    try {
      // Typing, because she takes several seconds and silence reads as a bot
      // that has died rather than one that is thinking.
      void fetch(API + '/channels/' + message.channel_id + '/typing', {
        method: 'POST',
        headers: { Authorization: 'Bot ' + this.token },
      });
      const answer = await this.sink.answer(message.content);
      if (answer.ignored || !answer.reply.trim()) return;
      await this.send(message.channel_id, answer.reply);
    } catch (error) {
      console.warn('[discord] could not answer:', error instanceof Error ? error.message : error);
    }
  }
}
