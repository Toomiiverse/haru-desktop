// Her side of the WhatsApp door (2026-09-19).
//
// The socket is not here. It lives in ~/haru-whatsapp, a separate process
// holding a Baileys companion device on his own account, for the reason the
// Minecraft and Game Boy workers are separate: a reverse-engineered protocol
// that reconnects on its own schedule should not be able to take her down with
// it, and its dependency tree should not be in her build. This file is the
// door that worker knocks on, the words a WhatsApp message is put into for
// her, and the shape her reply goes back out in.
//
// Two rules are not hers to bend, and both are enforced in the worker as well
// as here, because a rule that lives in one place is a rule that is one
// refactor from being gone:
//
//   - She answers in his own chat and nowhere else. A message from an allowed
//     chat is something she comes to know, not something she replies to.
//   - She never sends to anybody but him unless he has switched it on and
//     named them, which is a config edit and a restart.

export type WhatsAppConfig = {
  enabled: boolean;
  /** The worker's loopback door. */
  url: string;
  /** Shared with the worker's haru.token. Both directions present it. */
  token: string;
  /** Tier 1: what she makes of the chats he let her read (overheard.ts). */
  reading: {
    /** Off, and an allowed chat is heard and goes no further. */
    enabled: boolean;
    /**
     * The facts half, which writes into the graph.
     *
     * Its own switch, and off, because a wrong plan on his list is visible and
     * deletable and a wrong fact in the graph is neither. graphBrain() already
     * refuses to read his own days with a local model for that reason.
     */
    facts: boolean;
    /** How often a pass runs over what has been said since the last one. */
    everyMinutes: number;
  };
};

export const DEFAULT_WHATSAPP: WhatsAppConfig = {
  enabled: false,
  url: 'http://127.0.0.1:8793',
  token: '',
  reading: { enabled: false, facts: false, everyMinutes: 45 },
};

/** The `whatsapp` block, read forward. Off unless it says otherwise. */
export function readWhatsAppConfig(saved: unknown): WhatsAppConfig {
  const raw = ((saved && typeof saved === 'object' ? saved : {}) ?? {}) as Record<string, unknown>;
  const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim().replace(/\/+$/, '') : DEFAULT_WHATSAPP.url;
  const reading = (raw.reading ?? {}) as Record<string, unknown>;
  const everyMinutes = typeof reading.everyMinutes === 'number' && Number.isFinite(reading.everyMinutes)
    // Not below ten: a pass is a call to the local brain, which is the same card
    // her own replies come off, and one every minute would be felt in them.
    ? Math.min(24 * 60, Math.max(10, Math.round(reading.everyMinutes)))
    : DEFAULT_WHATSAPP.reading.everyMinutes;
  return {
    // Unlike her other workers, this one defaults off. Turning it on puts a
    // companion device on his real number, which is not a thing a missing
    // config key should decide.
    enabled: raw.enabled === true,
    url,
    token: typeof raw.token === 'string' ? raw.token.trim() : '',
    reading: { enabled: reading.enabled === true, facts: reading.facts === true, everyMinutes },
  };
}

/** What the worker posts through the door. */
export type Heard = {
  id: string;
  chat: string;
  /** The chat as a person would name it -- "Sam", not a JID. '' when the worker has no name for it. */
  chatName: string;
  from: string;
  text: string;
  kind: string | null;
  mine: boolean;
  at: string;
  selfChat: boolean;
};

/** Whether the body of an inbound post is one, without trusting any of it. */
export function readHeard(body: unknown): Heard | null {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const kind = typeof raw.kind === 'string' && raw.kind.trim() ? raw.kind.trim() : null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const chat = typeof raw.chat === 'string' ? raw.chat.trim() : '';
  if (!id || !chat) return null;
  if (!text.trim() && !kind) return null;
  return {
    id,
    chat,
    chatName: typeof raw.chatName === 'string' ? raw.chatName.trim().slice(0, 80) : '',
    from: typeof raw.from === 'string' && raw.from.trim() ? raw.from.trim() : 'someone',
    // Long enough for anything he would type at her, short enough that a
    // pasted wall of text cannot become the whole of her prompt.
    text: text.slice(0, 4000),
    kind,
    mine: raw.mine === true,
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    selfChat: raw.selfChat === true,
  };
}

/**
 * Whether this becomes a turn she answers.
 *
 * Only his own chat, and only something with words or a thing in it. A message
 * from an allowed chat is awareness, not a question — she is not in Sam's
 * conversation, she is reading over his shoulder because he asked her to.
 */
export function isForHer(message: Heard): boolean {
  return message.selfChat && (!!message.text.trim() || !!message.kind);
}

/**
 * What he said, as her turn.
 *
 * A message that is a photo or a voice note and no words is given to her as
 * the plain fact of it rather than as nothing: a turn where he sent something
 * and she was told nothing reads, from inside her prompt, as him having said
 * nothing at all, and she answers it as silence.
 */
export function asTurn(message: Heard): string {
  const words = message.text.trim();
  if (words && message.kind) return `${words}\n\n(he sent ${message.kind} with that, on WhatsApp)`;
  if (words) return words;
  return `(he sent ${message.kind ?? 'something'} on WhatsApp, with nothing written)`;
}

/**
 * Her reply, cut into the messages it should arrive as.
 *
 * Paragraphs, and nothing cleverer. She already writes in short paragraphs that
 * the phone paints as separate bubbles, and WhatsApp has no length limit worth
 * splitting on -- so the split that is right here is the one she is already
 * writing for. Discord needed sentence and width fallbacks because of its 2000
 * character ceiling; there is nothing to fall back from.
 *
 * Capped, though. Four bubbles is a person with more to say; eight in a row is
 * a bot, both to read and to whatever counts messages on the other end.
 */
export function splitForWhatsApp(text: string, maxBubbles = 4): string[] {
  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  if (paragraphs.length <= 1) {
    const whole = text.trim();
    return whole ? [whole] : [];
  }
  if (paragraphs.length <= maxBubbles) return paragraphs;
  // The overflow joins the last bubble rather than being dropped or becoming a
  // fifth: losing the end of what she said is worse than a long final message.
  const kept = paragraphs.slice(0, maxBubbles - 1);
  kept.push(paragraphs.slice(maxBubbles - 1).join('\n\n'));
  return kept;
}

/**
 * How long to wait before the next bubble.
 *
 * Long enough to read as somebody typing, short enough not to be a wait. It is
 * also the only pacing this integration has: there is no typing indicator to
 * soften a gap with, because announcing presence is what stops his phone
 * showing notifications (see the worker's link.ts).
 */
export function gapBefore(bubble: string): number {
  return Math.min(4_000, 600 + bubble.length * 18);
}

/** What to call this chat in her reading pass: its name when there is one, never a bare JID. */
export function chatLabel(message: Heard): string {
  if (message.chatName) return message.chatName;
  // A group with no subject yet, or somebody with no name in her address book.
  // "a group chat" tells the model more than 12036-1699@g.us does, and unlike
  // the JID it cannot be mistaken for something to extract.
  return message.chat.endsWith('@g.us') ? 'a group chat' : 'an unnamed chat';
}

/** A line from a chat she is allowed to read, as she comes to know it. Tier 1 reads these. */
export function asOverheard(message: Heard): string {
  const who = message.mine ? 'he' : message.from;
  const what = message.text.trim() || `sent ${message.kind ?? 'something'}`;
  return `${who}: ${what}`;
}

export type Door = { url: string; token: string };

/** Sends through the worker. Never throws; the caller gets the refusal in words. */
export async function sendThroughWorker(door: Door, jid: string, text: string): Promise<{ ok: boolean; why?: string }> {
  try {
    const response = await fetch(`${door.url}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${door.token}` },
      body: JSON.stringify({ jid, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true };
    const said = await response.json().catch(() => ({})) as { error?: string };
    // 403 is a rule saying no -- not on the allowlist, sending switched off --
    // and it is worth her knowing in those words rather than as a number.
    return { ok: false, why: said.error || `the WhatsApp worker answered ${response.status}` };
  } catch (error) {
    return { ok: false, why: `the WhatsApp worker is not answering (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** What the worker knows about itself, for the settings panel and for her own tools. */
export async function workerStatus(door: Door): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${door.url}/status`, {
      headers: { authorization: `Bearer ${door.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}
