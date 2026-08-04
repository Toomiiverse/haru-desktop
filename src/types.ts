export type Role = 'user' | 'assistant';
export type Reaction = 'up' | 'down';
export interface Message { id: string; role: Role; content: string; time: string; reaction?: Reaction; }
export interface KeptItem { id: string; title: string; date: string; time?: string; kind: 'reminder' | 'event'; done: boolean; googleEventId?: string; }
export interface GoogleStatus { hasCredentials: boolean; connected: boolean; email?: string; lastSync?: string; lastError?: string; }
export interface Character { identity: string; style: string; }
export interface Profile { nickname: string; occupation: string; about: string; }
export interface Memory { id: string; text: string; createdAt: string; }
export interface ProviderConfig { provider: 'ollama' | 'openai' | 'xai'; model: string; endpoint: string; temperature: number; }
