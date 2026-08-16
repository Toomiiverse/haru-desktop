import { contextBridge, ipcRenderer } from 'electron';

type Live2DModel = { path: string; name: string; url: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; time: string };
type ProviderConfig = { provider: string; model: string; endpoint: string; temperature: number };
type KeptItem = { id: string; title: string; date: string; time?: string; kind: 'task' | 'event'; done: boolean; heardAbout?: string; googleEventId?: string; googleTaskId?: string };
type GoogleStatus = { hasCredentials: boolean; connected: boolean; email?: string; lastSync?: string; lastError?: string; tasksGranted?: boolean };
type Character = { identity: string; style: string };
type WebDevice = { id: string; name: string; added: string; lastSeen: string };
type WebStatus = { enabled: boolean; username: string; hasPassword: boolean; running: boolean; port: number; trouble: string; devices: WebDevice[] };
type ListenConfig = { engine: string; endpoint: string; language: string; autoSend: boolean; wakeWord: boolean; replyWindow: boolean; chimeVolume: number };
type SearchConfig = { enabled: boolean; provider: string; limit: number; engineId: string; readPages: boolean; place: string };
type DesktopConfig = { launch: boolean; power: boolean };
type WatchingConfig = { enabled: boolean; everyMinutes: number; gamesOnly: boolean };
type ScreenshotConfig = { enabled: boolean; folder: string; quietMinutes: number };
type VisionConfig = { enabled: boolean; model: string; folder: string };
type GamingConfig = { enabled: boolean; model: string; quiet: boolean };
type AniListConfig = { enabled: boolean; username: string };
type JournalConfig = { enabled: boolean; askHour: number; askUnprompted: boolean };
type JournalEntry = { id: string; date: string; createdAt: string; updatedAt?: string; text: string; mood?: number; anxiety?: number; energy?: number; sleep?: number; prompted: boolean };
type RoamConfig = { enabled: boolean; restlessness: number; avoidFullscreen: boolean };
type Profile = { nickname: string; occupation: string; about: string };
type Memory = { id: string; text: string; kind: string; subject?: string; createdAt: string; lastSeenAt: string; mentions: number };
type SessionSummary = { day: string; summary: string; createdAt: string };
type ChatResult = { content: string; ignored: boolean; irritation: number; ego: number };
type Mood = { irritation: number; ego: number };
type Vitals = { energy: number; happiness: number; curiosity: number; affection: number; sleepiness: number; stress: number; focus: number };
type LifeTick = { vitals: Vitals; action: string | null; night: boolean };
type Emotion = { emotion: string; confidence: number; energy: number; intent: string; focus: string };
type Beat = { emotion: Emotion; gesture?: 'nod' | 'shake' | 'stare' };
type VoiceReference = { clip: string; text: string };
type WardrobeControl = { id: string; name: string; kind: 'toggle' | 'option'; max: number };
type VoiceConfig = { engine: string; voice: string; referenceText: string; endpoint: string; language: string; speed: number; volume: number; emotionVoices: Record<string, VoiceReference> };
type SpeechClip = { turn: number; text: string; audio?: Uint8Array; mime?: string };

contextBridge.exposeInMainWorld('haru', {
  settings: { get: (key: string) => ipcRenderer.invoke('settings:get', key), set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value) },
  listen: {
    correct: (heard: string, meant: string) => ipcRenderer.invoke('listen:correct', heard, meant) as Promise<number>,
    corrections: () => ipcRenderer.invoke('listen:corrections') as Promise<{ heard: string; meant: string; used: number }[]>,
    forgetCorrection: (heard: string) => ipcRenderer.invoke('listen:forgetCorrection', heard) as Promise<{ heard: string; meant: string; used: number }[]>,
    get: () => ipcRenderer.invoke('listen:get') as Promise<ListenConfig>,
    set: (config: ListenConfig) => ipcRenderer.invoke('listen:set', config) as Promise<ListenConfig>,
    transcribe: (audio: Uint8Array, mime: string) => ipcRenderer.invoke('listen:transcribe', audio, mime) as Promise<string>,
    onChange: (callback: (config: ListenConfig) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, config: ListenConfig) => callback(config);
      ipcRenderer.on('listen:changed', listener);
      return () => ipcRenderer.removeListener('listen:changed', listener);
    },
  },
  search: {
    get: () => ipcRenderer.invoke('search:get') as Promise<SearchConfig & { hasKey: boolean }>,
    set: (config: SearchConfig) => ipcRenderer.invoke('search:set', config) as Promise<SearchConfig & { hasKey: boolean }>,
    setKey: (apiKey: string) => ipcRenderer.invoke('search:setKey', apiKey) as Promise<boolean>,
    locate: () => ipcRenderer.invoke('search:locate') as Promise<{ place: string; accuracy: number }>,
    test: () => ipcRenderer.invoke('search:test') as Promise<number>,
  },
  roam: {
    get: () => ipcRenderer.invoke('roam:get') as Promise<RoamConfig>,
    set: (config: RoamConfig) => ipcRenderer.invoke('roam:set', config) as Promise<RoamConfig>,
    nudge: () => ipcRenderer.invoke('roam:nudge') as Promise<boolean>,
  },
  watching: {
    get: () => ipcRenderer.invoke('watching:get') as Promise<WatchingConfig>,
    set: (config: WatchingConfig) => ipcRenderer.invoke('watching:set', config) as Promise<WatchingConfig>,
  },
  desktop: {
    get: () => ipcRenderer.invoke('desktop:get') as Promise<DesktopConfig & { apps: number }>,
    set: (config: DesktopConfig) => ipcRenderer.invoke('desktop:set', config) as Promise<DesktopConfig & { apps: number }>,
  },
  screenshots: {
    get: () => ipcRenderer.invoke('screenshots:get') as Promise<ScreenshotConfig>,
    set: (config: ScreenshotConfig) => ipcRenderer.invoke('screenshots:set', config) as Promise<ScreenshotConfig>,
  },
  openai: {
    status: () => ipcRenderer.invoke('openai:status') as Promise<{ hasKey: boolean; ffmpeg: boolean }>,
    setKey: (apiKey: string) => ipcRenderer.invoke('openai:setKey', apiKey) as Promise<boolean>,
  },
  vision: {
    get: () => ipcRenderer.invoke('vision:get') as Promise<VisionConfig>,
    set: (config: VisionConfig) => ipcRenderer.invoke('vision:set', config) as Promise<VisionConfig>,
    show: (note: string, only: 'picture' | 'any' = 'any') => ipcRenderer.invoke('vision:show', note, only) as Promise<{ reaction: string | null; saved: string; held?: boolean } | null>,
    openFolder: () => ipcRenderer.invoke('vision:openFolder') as Promise<void>,
  },
  gaming: {
    get: () => ipcRenderer.invoke('gaming:get') as Promise<GamingConfig>,
    set: (config: GamingConfig) => ipcRenderer.invoke('gaming:set', config) as Promise<GamingConfig>,
  },
  ui: { page: (page: string) => ipcRenderer.invoke('ui:page', page) as Promise<void> },
  // The door a phone comes in by. The password goes one way only — there is no
  // getter here, and there is not meant to be.
  web: {
    status: () => ipcRenderer.invoke('web:status') as Promise<WebStatus>,
    setPassword: (username: string, password: string) => ipcRenderer.invoke('web:setPassword', username, password) as Promise<boolean>,
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('web:setEnabled', enabled) as Promise<boolean>,
    forgetDevice: (id: string) => ipcRenderer.invoke('web:forgetDevice', id) as Promise<WebDevice[]>,
  },
  journal: {
    list: () => ipcRenderer.invoke('journal:list') as Promise<JournalEntry[]>,
    save: (entry: Partial<JournalEntry> & { text: string }) => ipcRenderer.invoke('journal:save', entry) as Promise<JournalEntry[]>,
    remove: (id: string) => ipcRenderer.invoke('journal:remove', id) as Promise<JournalEntry[]>,
    getConfig: () => ipcRenderer.invoke('journal:getConfig') as Promise<JournalConfig>,
    setConfig: (config: JournalConfig) => ipcRenderer.invoke('journal:setConfig', config) as Promise<JournalConfig>,
    stats: (range: string) => ipcRenderer.invoke('journal:stats', range),
    note: () => ipcRenderer.invoke('journal:note'),
    trend: () => ipcRenderer.invoke('journal:trend') as Promise<{ days: number; mood?: number; anxiety?: number; entries: number }>,
    onChange: (callback: (entries: JournalEntry[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entries: JournalEntry[]) => callback(entries);
      ipcRenderer.on('journal:changed', listener);
      return () => ipcRenderer.removeListener('journal:changed', listener);
    },
  },
  anilist: {
    get: () => ipcRenderer.invoke('anilist:get') as Promise<AniListConfig>,
    set: (config: AniListConfig) => ipcRenderer.invoke('anilist:set', config) as Promise<AniListConfig>,
    test: () => ipcRenderer.invoke('anilist:test') as Promise<number>,
  },
  startup: {
    get: () => ipcRenderer.invoke('startup:get') as Promise<{ autoStart: boolean; shortcut: boolean; packaged: boolean }>,
    setAutoStart: (enabled: boolean) => ipcRenderer.invoke('startup:setAutoStart', enabled) as Promise<boolean>,
    createShortcut: () => ipcRenderer.invoke('startup:createShortcut') as Promise<string>,
  },
  chat: {
    getMessages: () => ipcRenderer.invoke('chat:getMessages') as Promise<Message[]>,
    setMessages: (messages: Message[]) => ipcRenderer.invoke('chat:setMessages', messages),
    getArchive: () => ipcRenderer.invoke('chat:getArchive') as Promise<Record<string, Message[]>>,
    newConversation: () => ipcRenderer.invoke('chat:newConversation') as Promise<void>,
    opening: () => ipcRenderer.invoke('chat:opening') as Promise<string | null>,
    onReset: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('chat:reset', listener);
      return () => ipcRenderer.removeListener('chat:reset', listener);
    },
    // She said something unprompted and has finished saying it, so an answer is
    // expected. Separate from onInterject because the gap between the two is the
    // whole point — the microphone must not open while she is still talking.
    expectAnswer: () => ipcRenderer.invoke('chat:expectAnswer') as Promise<void>,
    onExpectReply: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('chat:expectReply', listener);
      return () => ipcRenderer.removeListener('chat:expectReply', listener);
    },
    onVoiceFailed: (callback: (why: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, why: string) => callback(why);
      ipcRenderer.on('voice:failed', listener);
      return () => ipcRenderer.removeListener('voice:failed', listener);
    },
    // Said once when the far model stops answering and the one on this machine
    // takes over. Same shape as a failed voice: a note in the transcript, not
    // something she says.
    onFellBack: (callback: (why: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, why: string) => callback(why);
      ipcRenderer.on('ai:fellBack', listener);
      return () => ipcRenderer.removeListener('ai:fellBack', listener);
    },
    // Said from a phone. The renderer owns the conversation and writes it to
    // disk, so both halves are handed to it rather than saved behind its back.
    onFromPhone: (callback: (turn: { text: string; reply: string; ignored: boolean }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, turn: { text: string; reply: string; ignored: boolean }) => callback(turn);
      ipcRenderer.on('chat:fromPhone', listener);
      return () => ipcRenderer.removeListener('chat:fromPhone', listener);
    },
    onInterject: (callback: (line: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, line: string) => callback(line);
      ipcRenderer.on('chat:interject', listener);
      return () => ipcRenderer.removeListener('chat:interject', listener);
    },
  },
  ai: {
    send: (messages: { role: string; content: string }[], config: ProviderConfig) => ipcRenderer.invoke('ai:send', messages, config) as Promise<ChatResult>,
    test: (endpoint: string, provider?: string) => ipcRenderer.invoke('ai:test', endpoint, provider) as Promise<string[]>,
    defaultEndpoint: (provider: string) => ipcRenderer.invoke('ai:defaultEndpoint', provider) as Promise<string>,
    verify: (endpoint: string, provider: string, model: string) => ipcRenderer.invoke('ai:verify', endpoint, provider, model) as Promise<{ models: string[]; note: string }>,
    getEscalate: () => ipcRenderer.invoke('ai:getEscalate') as Promise<{ enabled: boolean; minWords: number; provider: ProviderConfig | null }>,
    setEscalate: (setting: { enabled: boolean; minWords: number }, provider: ProviderConfig | null) => ipcRenderer.invoke('ai:setEscalate', setting, provider) as Promise<{ enabled: boolean; minWords: number; provider: ProviderConfig | null }>,
    setKey: (apiKey: string) => ipcRenderer.invoke('ai:setKey', apiKey) as Promise<boolean>,
    hasKey: () => ipcRenderer.invoke('ai:hasKey') as Promise<boolean>,
    // The token for our own server, wherever it is today. Kept apart from the
    // one above, which belongs to xAI.
    setSelfHostedKey: (apiKey: string) => ipcRenderer.invoke('ai:setSelfHostedKey', apiKey) as Promise<boolean>,
    hasSelfHostedKey: () => ipcRenderer.invoke('ai:hasSelfHostedKey') as Promise<boolean>,
    retort: (disliked: string, config: ProviderConfig) => ipcRenderer.invoke('ai:retort', disliked, config) as Promise<string>,
    gloat: (praised: string, config: ProviderConfig) => ipcRenderer.invoke('ai:gloat', praised, config) as Promise<string>,
  },
  voice: {
    get: () => ipcRenderer.invoke('voice:get') as Promise<VoiceConfig>,
    set: (config: VoiceConfig) => ipcRenderer.invoke('voice:set', config) as Promise<VoiceConfig>,
    test: (config: VoiceConfig) => ipcRenderer.invoke('voice:test', config) as Promise<string>,
    stop: () => ipcRenderer.invoke('voice:stop') as Promise<void>,
    setSpeaking: (speaking: boolean) => ipcRenderer.invoke('voice:speaking', speaking) as Promise<void>,
    pickClip: () => ipcRenderer.invoke('voice:pickClip') as Promise<string | null>,
    onClip: (callback: (clip: SpeechClip) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, clip: SpeechClip) => callback(clip);
      ipcRenderer.on('speech:clip', listener);
      return () => ipcRenderer.removeListener('speech:clip', listener);
    },
    onInsistence: (callback: (factor: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, factor: number) => callback(factor);
      ipcRenderer.on('voice:insistence', listener);
      return () => ipcRenderer.removeListener('voice:insistence', listener);
    },
    onDuck: (callback: (factor: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, factor: number) => callback(factor);
      ipcRenderer.on('voice:duck', listener);
      return () => ipcRenderer.removeListener('voice:duck', listener);
    },
    onStop: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('speech:stop', listener);
      return () => ipcRenderer.removeListener('speech:stop', listener);
    },
    onChange: (callback: (config: VoiceConfig) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, config: VoiceConfig) => callback(config);
      ipcRenderer.on('voice:changed', listener);
      return () => ipcRenderer.removeListener('voice:changed', listener);
    },
  },

  wardrobe: {
    get: () => ipcRenderer.invoke('wardrobe:get') as Promise<{ controls: WardrobeControl[]; values: Record<string, number> }>,
    set: (id: string, value: number) => ipcRenderer.invoke('wardrobe:set', id, value) as Promise<Record<string, number>>,
    reset: () => ipcRenderer.invoke('wardrobe:reset') as Promise<Record<string, number>>,
    reportRanges: (ranges: Record<string, { min: number; max: number }>) => ipcRenderer.invoke('wardrobe:ranges', ranges) as Promise<void>,
    onRefresh: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('wardrobe:refresh', listener);
      return () => ipcRenderer.removeListener('wardrobe:refresh', listener);
    },
    onChange: (callback: (values: Record<string, number>) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, values: Record<string, number>) => callback(values);
      ipcRenderer.on('wardrobe:changed', listener);
      return () => ipcRenderer.removeListener('wardrobe:changed', listener);
    },
    onOpen: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('wardrobe:open', listener);
      return () => ipcRenderer.removeListener('wardrobe:open', listener);
    },
  },
  google: {
    status: () => ipcRenderer.invoke('google:status') as Promise<GoogleStatus>,
    saveCredentials: (clientId: string, clientSecret: string) => ipcRenderer.invoke('google:saveCredentials', clientId, clientSecret) as Promise<GoogleStatus>,
    connect: () => ipcRenderer.invoke('google:connect') as Promise<GoogleStatus>,
    disconnect: () => ipcRenderer.invoke('google:disconnect') as Promise<GoogleStatus>,
    sync: () => ipcRenderer.invoke('google:sync') as Promise<GoogleStatus>,
    onChange: (callback: (status: GoogleStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: GoogleStatus) => callback(status);
      ipcRenderer.on('google:changed', listener);
      return () => ipcRenderer.removeListener('google:changed', listener);
    },
  },
  mood: {
    get: () => ipcRenderer.invoke('mood:get') as Promise<Mood>,
    react: (reaction: 'up' | 'down') => ipcRenderer.invoke('mood:react', reaction) as Promise<Mood>,
  },
  profile: {
    get: () => ipcRenderer.invoke('profile:get') as Promise<Profile>,
    set: (profile: Profile) => ipcRenderer.invoke('profile:set', profile) as Promise<Profile>,
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list') as Promise<Memory[]>,
    add: (text: string, kind?: string) => ipcRenderer.invoke('memory:add', text, kind) as Promise<Memory[]>,
    sessions: () => ipcRenderer.invoke('memory:sessions') as Promise<SessionSummary[]>,
    forgetSessions: () => ipcRenderer.invoke('memory:forgetSessions') as Promise<SessionSummary[]>,
    remove: (id: string) => ipcRenderer.invoke('memory:remove', id) as Promise<Memory[]>,
    clear: () => ipcRenderer.invoke('memory:clear') as Promise<Memory[]>,
    onChange: (callback: (items: Memory[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, items: Memory[]) => callback(items);
      ipcRenderer.on('memory:changed', listener);
      return () => ipcRenderer.removeListener('memory:changed', listener);
    },
  },
  character: {
    get: () => ipcRenderer.invoke('character:get') as Promise<Character>,
    set: (identity: string, style: string) => ipcRenderer.invoke('character:set', identity, style) as Promise<Character>,
    reset: () => ipcRenderer.invoke('character:reset') as Promise<Character>,
  },
  kept: {
    get: () => ipcRenderer.invoke('kept:get') as Promise<KeptItem[]>,
    toggle: (id: string) => ipcRenderer.invoke('kept:toggle', id) as Promise<void>,
    remove: (id: string) => ipcRenderer.invoke('kept:remove', id) as Promise<void>,
    onChange: (callback: (items: KeptItem[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, items: KeptItem[]) => callback(items);
      ipcRenderer.on('kept:changed', listener);
      return () => ipcRenderer.removeListener('kept:changed', listener);
    },
  },
  live2d: {
    import: () => ipcRenderer.invoke('live2d:import'),
    get: () => ipcRenderer.invoke('live2d:get'),
    remove: () => ipcRenderer.invoke('live2d:remove'),
    onChange: (callback: (model: Live2DModel | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, model: Live2DModel | null) => callback(model);
      ipcRenderer.on('live2d:changed', listener);
      return () => ipcRenderer.removeListener('live2d:changed', listener);
    },
  },
  life: {
    onTick: (callback: (payload: LifeTick) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: LifeTick) => callback(payload);
      ipcRenderer.on('life:tick', listener);
      return () => ipcRenderer.removeListener('life:tick', listener);
    },
    onEmotion: (callback: (beat: Beat) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, beat: Beat) => callback(beat);
      ipcRenderer.on('emotion:changed', listener);
      return () => ipcRenderer.removeListener('emotion:changed', listener);
    },
  },
  companion: {
    moveBy: (dx: number, dy: number) => ipcRenderer.invoke('companion:moveBy', dx, dy),
    resizeBy: (factor: number) => ipcRenderer.invoke('companion:resizeBy', factor),
    showMenu: () => ipcRenderer.invoke('companion:showMenu'),
    poke: (kind: 'poke' | 'right-click') => ipcRenderer.invoke('companion:poke', kind),
    onSay: (callback: (line: string | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, line: string | null) => callback(line);
      ipcRenderer.on('companion:say', listener);
      return () => ipcRenderer.removeListener('companion:say', listener);
    },
    // Main is carrying the window; this is how the legs find out.
    onWalking: (callback: (state: { moving: boolean; facing: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: { moving: boolean; facing: number }) => callback(state);
      ipcRenderer.on('companion:walking', listener);
      return () => ipcRenderer.removeListener('companion:walking', listener);
    },
    onWatching: (callback: (gaze: { x: number; y: number } | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, gaze: { x: number; y: number } | null) => callback(gaze);
      ipcRenderer.on('companion:watching', listener);
      return () => ipcRenderer.removeListener('companion:watching', listener);
    },
    onCursor: (callback: (point: { x: number; y: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, point: { x: number; y: number }) => callback(point);
      ipcRenderer.on('companion:cursor', listener);
      return () => ipcRenderer.removeListener('companion:cursor', listener);
    },
    onPose: (callback: (name: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, name: string) => callback(name);
      ipcRenderer.on('companion:pose', listener);
      return () => ipcRenderer.removeListener('companion:pose', listener);
    },
    onSetExpression: (callback: (name: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, name: string) => callback(name);
      ipcRenderer.on('companion:setExpression', listener);
      return () => ipcRenderer.removeListener('companion:setExpression', listener);
    },
  },
});
