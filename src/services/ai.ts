import type { Message, ProviderConfig } from '../types';

export interface AIProvider { send(messages: Message[], config: ProviderConfig): Promise<string>; }
// Replace this with provider implementations; UI consumes the stable interface only.
export const demoProvider: AIProvider = { async send(messages) { const last = messages.at(-1)?.content ?? ''; await new Promise(resolve => setTimeout(resolve, 650)); return `I hear you. You said: “${last}”\n\nConnect an AI provider in Settings when you're ready, and I'll be able to give you a real response.`; } };
