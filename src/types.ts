// 'system' never enters the stored conversation — it is only used for notes
// passed alongside a message on the way to the model, such as a reply reference.
export type Role = 'user' | 'assistant' | 'system';
export type Reaction = 'up' | 'down';
// replyTo points at an earlier message of Haru's, so feedback can be aimed at
// the reply it is actually about rather than at whatever she said last.
/**
 * 'time' is what the bubble prints and has always been the literal string
 * 'now'. 'at' is when the message was actually said, which is what lets old
 * context be told from new. Optional: everything written before this existed
 * has none, and guessing one would be worse than the flatness it fixes.
 */
export interface Message { id: string; role: Role; content: string; time: string; at?: string;
  /** Set when this message arrived by voice, holding what the speech server
   *  actually returned. Kept so a correction can be taught against the exact
   *  text that was misheard rather than against whatever was edited afterwards. */
  heard?: string; reaction?: Reaction; ignored?: boolean; replyTo?: { id: string; excerpt: string }; }
export interface ChatResult { content: string; ignored: boolean; irritation: number; ego: number; }
export interface Mood { irritation: number; ego: number; }
export interface Vitals { energy: number; happiness: number; curiosity: number; affection: number; sleepiness: number; stress: number; focus: number; }
export interface LifeTick { vitals: Vitals; action: string | null; night: boolean; }
export type EmotionName = 'neutral' | 'happy' | 'curious' | 'smug' | 'annoyed' | 'bored' | 'sleepy' | 'surprised' | 'affectionate' | 'embarrassed' | 'determined' | 'worried';
export type Intent = 'listen' | 'explain' | 'tease' | 'dismiss' | 'celebrate' | 'soothe';
export type FocusTarget = 'user' | 'self' | 'task' | 'away';
export interface Emotion { emotion: EmotionName; confidence: number; energy: number; intent: Intent; focus: FocusTarget; }
export interface Beat { emotion: Emotion; gesture?: 'nod' | 'shake' | 'stare'; }
// completedAt records when a task was ticked off, which is not the same as when
// it was due — see the agenda block in electron/agenda.ts.
export interface KeptItem { id: string; title: string; date: string; time?: string; kind: 'task' | 'event'; done: boolean; completedAt?: string; heardAbout?: string; googleEventId?: string; googleTaskId?: string; }
export interface GoogleStatus { hasCredentials: boolean; connected: boolean; email?: string; lastSync?: string; lastError?: string; tasksGranted?: boolean; }
export interface Character { identity: string; style: string; }
// Speech to text. 'local' is any server speaking OpenAI's /v1/audio/transcriptions
// — see electron/listen.ts.
export type ListenEngine = 'off' | 'local';
export interface ListenConfig { engine: ListenEngine; endpoint: string; language: string; autoSend: boolean; wakeWord: boolean; replyWindow: boolean; chimeVolume: number; }
export type SearchProvider = 'duckduckgo' | 'brave' | 'google';
export interface SearchConfig { enabled: boolean; provider: SearchProvider; limit: number; engineId: string; readPages: boolean; place: string; }
export interface DesktopConfig { launch: boolean; power: boolean; }
export interface WatchingConfig { enabled: boolean; everyMinutes: number; gamesOnly: boolean; }
export interface ScreenshotConfig { enabled: boolean; folder: string; quietMinutes: number; }
export interface VisionConfig { enabled: boolean; model: string; folder: string; }
export interface GamingConfig { enabled: boolean; model: string; quiet: boolean; }
export interface AniListConfig { enabled: boolean; username: string; }
// Self-reported 0-10 ratings kept beside the day's words. Not a screening tool
// and nothing scores them — see electron/journal.ts.
export interface JournalConfig { enabled: boolean; askHour: number; askUnprompted: boolean; }
export interface JournalEntry { id: string; date: string; createdAt: string; updatedAt?: string; text: string; mood?: number; anxiety?: number; energy?: number; sleep?: number; prompted: boolean; }
export type JournalRange = 'week' | 'fortnight' | 'month';
export type JournalField = 'mood' | 'anxiety' | 'energy' | 'sleep';
export interface JournalFieldStats { average?: number; lowest?: number; highest?: number; rated: number; change?: number; }
export interface JournalStats { days: number; written: number; streak: number; fields: Record<JournalField, JournalFieldStats>; series: { date: string; mood?: number; anxiety?: number; energy?: number; sleep?: number; written: boolean }[]; }
export interface HaruNote { tone: 'proud' | 'pleased' | 'watching' | 'grumpy'; text: string; }
export interface JournalTrend { days: number; mood?: number; anxiety?: number; entries: number; }
export interface RoamConfig { enabled: boolean; restlessness: number; avoidFullscreen: boolean; }
export interface Profile { nickname: string; occupation: string; about: string; }
export type MemoryKind = 'preference' | 'relationship' | 'event' | 'fact';
export interface Memory { id: string; text: string; kind: MemoryKind; subject?: string; createdAt: string; lastSeenAt: string; mentions: number; }
export interface SessionSummary { day: string; summary: string; createdAt: string; }
export interface ProviderConfig { provider: 'ollama' | 'openai' | 'xai' | 'venice'; model: string; endpoint: string; temperature: number; }
// 'windows' is spoken by the renderer through the built-in SAPI voices; the rest
// are synthesised in main and arrive as audio. See electron/voice.ts.
export type VoiceEngine = 'off' | 'windows' | 'openai' | 'gpt-sovits';
// A clip and what it says, kept together because a transcript that does not match
// its clip changes the cloned voice, not just the words.
export interface VoiceReference { clip: string; text: string; }
export interface VoiceConfig { engine: VoiceEngine; voice: string; referenceText: string; endpoint: string; language: string; speed: number; volume: number; emotionVoices: Partial<Record<EmotionName, VoiceReference>>; }
// turn identifies which reply this belongs to, so clips left over from a reply
// she has been interrupted out of can be dropped instead of played.
export interface SpeechClip { turn: number; text: string; audio?: Uint8Array; mime?: string; }
// What she can change about how she looks. Discovered from the model's own
// DisplayInfo rather than hardcoded — see electron/wardrobe.ts.
export interface WardrobeControl { id: string; name: string; kind: 'toggle' | 'option' | 'pose'; values: number[]; }

/** A phone or tablet that has been told to stay signed in. */
export type WebDevice = { id: string; name: string; added: string; lastSeen: string };

export type WebStatus = {
  enabled: boolean;
  username: string;
  /** Whether one is set. The password itself never comes back across the bridge. */
  hasPassword: boolean;
  running: boolean;
  port: number;
  /** Why it is shut, when it is meant to be open. */
  trouble: string;
  devices: WebDevice[];
};
