export type Role = 'user' | 'assistant';
export interface Message { id: string; role: Role; content: string; time: string; }
export interface KeptItem { id: string; title: string; date: string; time?: string; kind: 'reminder' | 'event'; done: boolean; }
export interface ProviderConfig { provider: 'ollama' | 'openai' | 'xai'; model: string; endpoint: string; temperature: number; }
