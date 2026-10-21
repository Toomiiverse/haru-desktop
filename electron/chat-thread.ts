import { AsyncLocalStorage } from 'node:async_hooks';

// 4550: the desk is its own conversation on the same brain. A turn runs inside
// its thread, and the store answers 'chat.messages' with that thread's rows, so
// every reader in the turn sees the conversation it belongs to. The marker dies
// with the turn: a timer the turn happened to start must not keep writing to the
// desk once it is over.
export type ChatThread = 'phone' | 'desk';
const current = new AsyncLocalStorage<{ thread: ChatThread; live: boolean }>();

export function readThread(value: unknown): ChatThread { return value === 'desk' ? 'desk' : 'phone'; }
export const chatThread = (): ChatThread => { const turn = current.getStore(); return turn?.live ? turn.thread : 'phone'; };
export const threadKey = (thread: ChatThread) => thread === 'desk' ? 'chat.desk.messages' : 'chat.messages';
export const otherThread = (thread: ChatThread): ChatThread => thread === 'desk' ? 'phone' : 'desk';

export async function withChatThread<T>(thread: ChatThread | undefined, run: () => T | Promise<T>): Promise<T> {
  if (thread !== 'desk') return run();
  const turn = { thread, live: true };
  try { return await current.run(turn, run); } finally { turn.live = false; }
}
/** For reading the other conversation from inside a turn. */
export const outsideThread = <T>(run: () => T): T => current.exit(run);

type Row = { role: string; content?: unknown; at?: string };
const WHERE: Record<ChatThread, string> = { phone: 'on the phone', desk: 'at the desktop' };
/**
 * The other conversation's last few hours, as she would recall it: short,
 * newest kept, labelled as somewhere else so she knows it happened without
 * answering it here. Bounded well under the natural route's 4000-char context.
 */
export function elsewhereNote(rows: Row[], thread: ChatThread, now: number, { hours = 6, turns = 12, chars = 1000 } = {}): string {
  const since = now - hours * 3_600_000;
  const lines = rows
    .filter(row => (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string' && row.content.trim() && Date.parse(row.at ?? '') >= since)
    .slice(-turns)
    .map(row => `${row.role === 'user' ? 'Them' : 'You'}: ${(row.content as string).replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  if (!lines.length) return '';
  const head = `Meanwhile, ${WHERE[thread]} (a separate conversation with them, already answered there; know it happened, do not reply to it here):`;
  while (lines.length > 1 && head.length + lines.join('\n').length > chars) lines.shift();
  return (head + '\n' + lines.join('\n')).slice(0, chars);
}
