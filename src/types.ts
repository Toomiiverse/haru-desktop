// 'system' never enters the stored conversation — it is only used for notes
// passed alongside a message on the way to the model, such as a reply reference.
export type Role = 'user' | 'assistant' | 'system';
export type Reaction = 'up' | 'down';
// replyTo points at an earlier message of Haru's, so feedback can be aimed at
// the reply it is actually about rather than at whatever she said last.
export interface Message { id: string; role: Role; content: string; time: string; reaction?: Reaction; ignored?: boolean; replyTo?: { id: string; excerpt: string }; }
export interface ChatResult { content: string; ignored: boolean; irritation: number; ego: number; }
export interface Mood { irritation: number; ego: number; }
export interface Vitals { energy: number; happiness: number; curiosity: number; affection: number; sleepiness: number; stress: number; focus: number; }
export interface LifeTick { vitals: Vitals; action: string | null; night: boolean; }
export type EmotionName = 'neutral' | 'happy' | 'curious' | 'smug' | 'annoyed' | 'bored' | 'sleepy' | 'surprised' | 'affectionate' | 'embarrassed';
export type Intent = 'listen' | 'explain' | 'tease' | 'dismiss' | 'celebrate' | 'soothe';
export type FocusTarget = 'user' | 'self' | 'task' | 'away';
export interface Emotion { emotion: EmotionName; confidence: number; energy: number; intent: Intent; focus: FocusTarget; }
export interface Beat { emotion: Emotion; gesture?: 'nod' | 'shake' | 'stare'; }
export interface KeptItem { id: string; title: string; date: string; time?: string; kind: 'task' | 'event'; done: boolean; googleEventId?: string; googleTaskId?: string; }
export interface GoogleStatus { hasCredentials: boolean; connected: boolean; email?: string; lastSync?: string; lastError?: string; tasksGranted?: boolean; }
export interface Character { identity: string; style: string; }
export interface Profile { nickname: string; occupation: string; about: string; }
export type MemoryKind = 'preference' | 'relationship' | 'event' | 'fact';
export interface Memory { id: string; text: string; kind: MemoryKind; subject?: string; createdAt: string; lastSeenAt: string; mentions: number; }
export interface SessionSummary { day: string; summary: string; createdAt: string; }
export interface ProviderConfig { provider: 'ollama' | 'openai' | 'xai'; model: string; endpoint: string; temperature: number; }
