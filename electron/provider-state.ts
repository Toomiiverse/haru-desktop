import type { ChatMessage } from './provider';
import { toolReceiptPrivacyText } from './tool-receipt';

// Only values actually received in protocol fields may bypass content heuristics.
// A fabricated tool ID, tool arguments, messages and tool output are still scanned.
const received = new Set<string>();
const fields = ['id', 'call_id', 'signature', 'encrypted_content'] as const;
const remember = (value: unknown) => {
  if (typeof value !== 'string' || !value || value.length > 250_000) return;
  received.add(value);
  while (received.size > 10_000) received.delete(received.values().next().value!);
};
export function receivedProviderMessage(message: ChatMessage): ChatMessage {
  for (const call of message.tool_calls ?? []) remember(call.id);
  for (const block of message.provider_state?.content ?? []) for (const key of fields) remember(block[key]);
  return message;
}
const opaque = (value: unknown) => typeof value === 'string' && received.has(value) ? '[provider protocol value]' : value;
export function providerPrivacyView(message: ChatMessage): ChatMessage {
  return { ...message,
    ...(message.role === 'tool' && message.content ? { content: toolReceiptPrivacyText(message.content) } : {}),
    ...(message.tool_call_id ? { tool_call_id: opaque(message.tool_call_id) as string } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({ ...call, id: opaque(call.id) as string | undefined })) } : {}),
    ...(message.provider_state ? { provider_state: { ...message.provider_state, content: message.provider_state.content.map(block => {
      const copy = { ...block }; for (const key of fields) if (key in copy) copy[key] = opaque(copy[key]); return copy;
    }) } } : {}),
  };
}
