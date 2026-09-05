// The socket to Hume, one per open call.
//
// Kept apart from evi.ts so that file stays pure and testable. This one holds
// a WebSocket, which is the same reason discord.ts and browserctl.ts use
// Node's own client: no library, one connection, a handful of events.
//
// The phone's audio arrives before Hume has answered the handshake more often
// than not — the app opens both at once — so a little is held and sent on
// open rather than dropped. A few seconds is the most worth keeping; a
// handshake slower than that is a call worth abandoning.

import { audioInput, relay, sessionSettingsFor } from './evi';

export const EVI_URL = 'wss://api.hume.ai/v0/evi/chat';

/** About two seconds of 16 kHz PCM16, as 40 ms frames. */
const HELD_FRAMES = 50;

export type EviSession = {
  sendAudio(pcm: Uint8Array): void;
  /** Hangs up. `reason` is for the log; Hume is told nothing but the close. */
  close(reason?: string): void;
  readonly open: boolean;
};

export type EviSessionOptions = {
  apiKey: string;
  configId: string;
  sessionId: string;
  /** The bearer Hume presents at the brain hook; sent once, in session settings. */
  secret: string;
  /** Every relayed event (see relay in evi.ts), in order. */
  onEvent(event: Record<string, unknown>): void;
  /** Once, when the socket is gone for any reason. `seconds` is how long it was up. */
  onClose(reason: string, seconds: number): void;
  /** Injectable for tests; the global WebSocket otherwise. */
  connect?(url: string): WebSocket;
};

export function openEviSession(options: EviSessionOptions): EviSession {
  const url = `${EVI_URL}?config_id=${encodeURIComponent(options.configId)}&api_key=${encodeURIComponent(options.apiKey)}`;
  const startedAt = Date.now();
  const socket = options.connect ? options.connect(url) : new WebSocket(url);
  const held: Uint8Array[] = [];
  let isOpen = false;
  let closed = false;

  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    isOpen = false;
    options.onClose(reason, Math.round((Date.now() - startedAt) / 1000));
  };

  socket.onopen = () => {
    isOpen = true;
    console.log(`[evi] hume took the call in ${Date.now() - startedAt}ms`);
    socket.send(JSON.stringify(sessionSettingsFor(options.sessionId, options.secret)));
    for (const frame of held.splice(0)) socket.send(JSON.stringify(audioInput(frame)));
  };
  socket.onmessage = (message: MessageEvent) => {
    let event: unknown;
    try { event = JSON.parse(typeof message.data === 'string' ? message.data : String(message.data)); } catch { return; }
    const relayed = relay(event);
    if (!relayed) return;
    if (relayed.type === 'error') console.warn(`[evi] hume: ${relayed.message}${relayed.slug ? ` (${relayed.slug})` : ''}`);
    options.onEvent(relayed);
  };
  socket.onerror = () => {
    // The close that follows carries the reason worth logging; an error event
    // in the browser-shaped API has nothing in it but the fact of itself.
    if (!isOpen) finish('hume did not take the call');
  };
  socket.onclose = (event: CloseEvent) => finish(event.reason ? `hume closed: ${event.reason}` : `hume closed (${event.code})`);

  return {
    get open() { return isOpen; },
    sendAudio(pcm) {
      if (closed) return;
      if (!isOpen) {
        held.push(pcm);
        if (held.length > HELD_FRAMES) held.shift();
        return;
      }
      socket.send(JSON.stringify(audioInput(pcm)));
    },
    close(reason = 'hung up') {
      if (closed) return;
      try { socket.close(1000, 'hung up'); } catch { /* already gone */ }
      finish(reason);
    },
  };
}
