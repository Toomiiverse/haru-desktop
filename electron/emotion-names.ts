// Apart from emotion.ts so the window can name her emotions without pulling in Core's Node-only policy bridge.
export const EMOTIONS = ['neutral', 'happy', 'curious', 'smug', 'annoyed', 'bored', 'sleepy', 'surprised', 'affectionate', 'embarrassed', 'determined', 'worried'] as const;
export type EmotionName = typeof EMOTIONS[number];
