import type { ChatResult, Message, ProviderConfig } from '../types';

export interface AIProvider { send(messages: Message[], config: ProviderConfig): Promise<ChatResult>; }

// Falls back to an echo stub outside Electron (e.g. `vite preview` in a plain browser tab),
// where window.haru doesn't exist and there's no main-process bridge to reach Ollama through.
export const demoProvider: AIProvider = { async send(messages) { const last = messages.at(-1)?.content ?? ''; await new Promise(resolve => setTimeout(resolve, 650)); return { content: `I hear you. You said: “${last}”\n\nConnect an AI provider in Settings when you're ready, and I'll be able to give you a real response.`, ignored: false, irritation: 0, ego: 0 }; } };

export const ollamaProvider: AIProvider = {
  async send(messages, config) {
    if (!window.haru) return demoProvider.send(messages, config);
    return window.haru.ai.send(messages.map(m => ({ role: m.role, content: m.content })), config);
  },
};

export function getProvider(config: ProviderConfig): AIProvider {
  switch (config.provider) {
    case 'ollama': return ollamaProvider;
    default: return demoProvider;
  }
}

export async function testConnection(endpoint: string): Promise<string[]> {
  if (!window.haru) throw new Error('Testing a connection requires the desktop app.');
  return window.haru.ai.test(endpoint);
}
