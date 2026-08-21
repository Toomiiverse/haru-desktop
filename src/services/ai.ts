import type { ChatResult, Message, ProviderConfig } from '../types';

export interface AIProvider { send(messages: Message[], config: ProviderConfig): Promise<ChatResult>; }

// Falls back to an echo stub outside Electron (e.g. `vite preview` in a plain browser tab),
// where window.haru doesn't exist and there's no main-process bridge to reach Ollama through.
export const demoProvider: AIProvider = { async send(messages) { const last = messages.at(-1)?.content ?? ''; await new Promise(resolve => setTimeout(resolve, 650)); return { content: `I hear you. You said: “${last}”\n\nConnect an AI provider in Settings when you're ready, and I'll be able to give you a real response.`, ignored: false, irritation: 0, ego: 0 }; } };

export const ollamaProvider: AIProvider = {
  async send(messages, config) {
    if (!window.haru) return demoProvider.send(messages, config);
    // A deliberate subset rather than the whole message: her id, the thumbs she
    // was given and what was misheard are the window's business, not the model's.
    //
    // `at` and `attachments` do have to travel. Without `at` every message looks
    // like it was said just now — which is what markTimeGaps exists to fix and
    // could not, because the field was being dropped here. Without `attachments`
    // a picture never reaches her at all.
    return window.haru.ai.send(
      messages.map(message => ({
        role: message.role,
        content: message.content,
        ...(message.at ? { at: message.at } : {}),
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      })),
      config,
    );
  },
};

export function getProvider(config: ProviderConfig): AIProvider {
  switch (config.provider) {
    case 'ollama': return ollamaProvider;
    default: return demoProvider;
  }
}

export async function testConnection(endpoint: string, provider?: string): Promise<string[]> {
  if (!window.haru) throw new Error('Testing a connection requires the desktop app.');
  // The provider decides which dialect to ask in — Ollama's /api/tags or the
  // OpenAI /models list — so it has to travel with the endpoint.
  return window.haru.ai.test(endpoint, provider);
}
