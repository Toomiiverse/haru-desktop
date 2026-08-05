export type Role = 'user' | 'assistant';
export type Reaction = 'up' | 'down';
export interface Message { id: string; role: Role; content: string; time: string; reaction?: Reaction; ignored?: boolean; }
export interface ChatResult { content: string; ignored: boolean; irritation: number; ego: number; }
export interface Mood { irritation: number; ego: number; }
export interface Vitals { energy: number; happiness: number; curiosity: number; affection: number; sleepiness: number; stress: number; focus: number; }
export interface LifeTick { vitals: Vitals; action: string | null; night: boolean; }
export interface KeptItem { id: string; title: string; date: string; time?: string; kind: 'reminder' | 'event'; done: boolean; googleEventId?: string; }
export interface GoogleStatus { hasCredentials: boolean; connected: boolean; email?: string; lastSync?: string; lastError?: string; }
export interface Character { identity: string; style: string; }
export interface Profile { nickname: string; occupation: string; about: string; }
export interface Memory { id: string; text: string; createdAt: string; }
export interface ProviderConfig { provider: 'ollama' | 'openai' | 'xai'; model: string; endpoint: string; temperature: number; }
