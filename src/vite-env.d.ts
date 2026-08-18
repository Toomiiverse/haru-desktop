/// <reference types="vite/client" />
type Live2DModel = { path: string; name: string; url: string };
interface Window {
  PIXI?: unknown;
  Live2DCubismCore?: unknown;
  haru?: {
    settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
    startup: { get(): Promise<{ autoStart: boolean; shortcut: boolean; packaged: boolean }>; setAutoStart(enabled: boolean): Promise<boolean>; createShortcut(): Promise<string> };
    listen: {
      correct(heard: string, meant: string): Promise<number>;
      corrections(): Promise<{ heard: string; meant: string; used: number }[]>;
      forgetCorrection(heard: string): Promise<{ heard: string; meant: string; used: number }[]>;
      get(): Promise<import('./types').ListenConfig>;
      set(config: import('./types').ListenConfig): Promise<import('./types').ListenConfig>;
      transcribe(audio: Uint8Array, mime: string): Promise<string>;
      onChange(callback: (config: import('./types').ListenConfig) => void): () => void;
    };
    roam: {
      get(): Promise<import('./types').RoamConfig>;
      set(config: import('./types').RoamConfig): Promise<import('./types').RoamConfig>;
      nudge(): Promise<boolean>;
    };
    watching: { get(): Promise<import('./types').WatchingConfig>; set(config: import('./types').WatchingConfig): Promise<import('./types').WatchingConfig> };
    desktop: { get(): Promise<import('./types').DesktopConfig & { apps: number }>; set(config: import('./types').DesktopConfig): Promise<import('./types').DesktopConfig & { apps: number }> };
    screenshots: { get(): Promise<import('./types').ScreenshotConfig>; set(config: import('./types').ScreenshotConfig): Promise<import('./types').ScreenshotConfig> };
    openai: { status(): Promise<{ hasKey: boolean; ffmpeg: boolean }>; setKey(apiKey: string): Promise<boolean> };
    vision: {
      get(): Promise<import('./types').VisionConfig>;
      set(config: import('./types').VisionConfig): Promise<import('./types').VisionConfig>;
      show(note: string, only?: 'picture' | 'any'): Promise<{ reaction: string | null; saved: string; held?: boolean } | null>;
      openFolder(): Promise<void>;
    };
    gaming: { get(): Promise<import('./types').GamingConfig>; set(config: import('./types').GamingConfig): Promise<import('./types').GamingConfig> };
    discord: { status(): Promise<{ enabled: boolean; ownerId: string; pesterHours: number; hasToken: boolean; connected: boolean; botName: string; trouble: string }>; setToken(token: string): Promise<boolean>; set(next: { ownerId: string; pesterHours: number; enabled: boolean }): Promise<{ enabled: boolean; connected: boolean }> };
    web: { status(): Promise<import('./types').WebStatus>; setPassword(username: string, password: string): Promise<boolean>; setEnabled(enabled: boolean): Promise<boolean>; forgetDevice(id: string): Promise<import('./types').WebDevice[]> };
    ui: { page(page: string): Promise<void> };
    journal: {
      list(): Promise<import('./types').JournalEntry[]>;
      save(entry: Partial<import('./types').JournalEntry> & { text: string }): Promise<import('./types').JournalEntry[]>;
      remove(id: string): Promise<import('./types').JournalEntry[]>;
      getConfig(): Promise<import('./types').JournalConfig>;
      setConfig(config: import('./types').JournalConfig): Promise<import('./types').JournalConfig>;
      stats(range: import('./types').JournalRange): Promise<import('./types').JournalStats>;
      note(): Promise<import('./types').HaruNote>;
      trend(): Promise<import('./types').JournalTrend>;
      onChange(callback: (entries: import('./types').JournalEntry[]) => void): () => void;
    };
    anilist: {
      get(): Promise<import('./types').AniListConfig>;
      set(config: import('./types').AniListConfig): Promise<import('./types').AniListConfig>;
      test(): Promise<number>;
    };
    search: {
      get(): Promise<import('./types').SearchConfig & { hasKey: boolean }>;
      set(config: import('./types').SearchConfig): Promise<import('./types').SearchConfig & { hasKey: boolean }>;
      setKey(apiKey: string): Promise<boolean>;
      locate(): Promise<{ place: string; accuracy: number }>;
      test(): Promise<number>;
    };
    chat: { getMessages(): Promise<import('./types').Message[]>; setMessages(messages: import('./types').Message[]): Promise<void>; getArchive(): Promise<Record<string, import('./types').Message[]>>; newConversation(): Promise<void>; opening(): Promise<string | null>; onReset(callback: () => void): () => void; onInterject(callback: (line: string) => void): () => void; onVoiceFailed(callback: (why: string) => void): () => void; onFellBack(callback: (why: string) => void): () => void; onFromPhone(callback: (turn: { text: string; reply: string; ignored: boolean }) => void): () => void; onExpectReply(callback: () => void): () => void; expectAnswer(): Promise<void> };
    ai: { send(messages: { role: string; content: string }[], config: import('./types').ProviderConfig): Promise<import('./types').ChatResult>; test(endpoint: string, provider?: string): Promise<string[]>; defaultEndpoint(provider: string): Promise<string>; verify(endpoint: string, provider: string, model: string): Promise<{ models: string[]; note: string }>; getEscalate(): Promise<{ enabled: boolean; minWords: number; provider: import('./types').ProviderConfig | null }>; setEscalate(setting: { enabled: boolean; minWords: number }, provider: import('./types').ProviderConfig | null): Promise<{ enabled: boolean; minWords: number; provider: import('./types').ProviderConfig | null }>; setKey(apiKey: string): Promise<boolean>; hasKey(): Promise<boolean>; setSelfHostedKey(apiKey: string): Promise<boolean>; hasSelfHostedKey(): Promise<boolean>; retort(disliked: string, config: import('./types').ProviderConfig): Promise<string>; gloat(praised: string, config: import('./types').ProviderConfig): Promise<string> };
    mood: { get(): Promise<import('./types').Mood>; react(reaction: import('./types').Reaction): Promise<import('./types').Mood> };
    profile: { get(): Promise<import('./types').Profile>; set(profile: import('./types').Profile): Promise<import('./types').Profile> };
    memory: {
      list(): Promise<import('./types').Memory[]>;
      add(text: string, kind?: import('./types').MemoryKind): Promise<import('./types').Memory[]>;
      sessions(): Promise<import('./types').SessionSummary[]>;
      forgetSessions(): Promise<import('./types').SessionSummary[]>;
      remove(id: string): Promise<import('./types').Memory[]>;
      clear(): Promise<import('./types').Memory[]>;
      onChange(callback: (items: import('./types').Memory[]) => void): () => void;
    };
    character: { get(): Promise<import('./types').Character>; set(identity: string, style: string): Promise<import('./types').Character>; reset(): Promise<import('./types').Character> };
    kept: { get(): Promise<import('./types').KeptItem[]>; toggle(id: string): Promise<void>; remove(id: string): Promise<void>; onChange(callback: (items: import('./types').KeptItem[]) => void): () => void };
    google: {
      status(): Promise<import('./types').GoogleStatus>;
      saveCredentials(clientId: string, clientSecret: string): Promise<import('./types').GoogleStatus>;
      connect(): Promise<import('./types').GoogleStatus>;
      disconnect(): Promise<import('./types').GoogleStatus>;
      sync(): Promise<import('./types').GoogleStatus>;
      onChange(callback: (status: import('./types').GoogleStatus) => void): () => void;
    };
    voice: {
      get(): Promise<import('./types').VoiceConfig>;
      set(config: import('./types').VoiceConfig): Promise<import('./types').VoiceConfig>;
      test(config: import('./types').VoiceConfig): Promise<string>;
      stop(): Promise<void>;
      setSpeaking(speaking: boolean): Promise<void>;
      pickClip(): Promise<string | null>;
      onClip(callback: (clip: import('./types').SpeechClip) => void): () => void;
      onStop(callback: () => void): () => void;
      onDuck(callback: (factor: number) => void): () => void;
      onInsistence(callback: (factor: number) => void): () => void;
      onChange(callback: (config: import('./types').VoiceConfig) => void): () => void;
    };

    wardrobe: {
      get(): Promise<{ controls: import('./types').WardrobeControl[]; values: Record<string, number> }>;
      set(id: string, value: number): Promise<Record<string, number>>;
      reset(): Promise<Record<string, number>>;
      reportRanges(ranges: Record<string, { min: number; max: number }>): Promise<void>;
      onRefresh(callback: () => void): () => void;
      onChange(callback: (values: Record<string, number>) => void): () => void;
      onOpen(callback: () => void): () => void;
    };
    live2d: { import(): Promise<Live2DModel | null>; get(): Promise<Live2DModel | null>; remove(): Promise<void>; onChange(callback: (model: Live2DModel | null) => void): () => void };
    life: { onTick(callback: (payload: import('./types').LifeTick) => void): () => void; onEmotion(callback: (beat: import('./types').Beat) => void): () => void };
    companion: {
      moveBy(dx: number, dy: number): Promise<void>;
      resizeBy(factor: number): Promise<void>;
      showMenu(): Promise<void>;
      poke(kind: 'poke' | 'right-click'): Promise<void>;
      onWalking(callback: (state: { moving: boolean; facing: number }) => void): () => void;
      onSay(callback: (line: string | null) => void): () => void;
      onWatching(callback: (gaze: { x: number; y: number } | null) => void): () => void;
      onCursor(callback: (point: { x: number; y: number }) => void): () => void;
      onPose(callback: (name: string) => void): () => void;
      onSetExpression(callback: (name: string) => void): () => void;
    };
  };
}
