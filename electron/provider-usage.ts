import type { ChatMessage } from './provider';

export type UsageReceipt = { format: 'openai' | 'anthropic'; usage: unknown };
// Transport-only, one-shot metadata: never part of prompts, history or model text.
const receipts = new WeakMap<ChatMessage, UsageReceipt>();
export function withProviderUsage(message: ChatMessage, usage: unknown, format: UsageReceipt['format'] = 'openai'): ChatMessage {
  if (usage !== undefined && usage !== null) receipts.set(message, { format, usage: structuredClone(usage) });
  return message;
}
export function takeProviderUsage(message: ChatMessage): UsageReceipt | undefined {
  const receipt = receipts.get(message);
  receipts.delete(message);
  return receipt;
}
