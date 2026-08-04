import { contextBridge, ipcRenderer } from 'electron';

type Live2DModel = { path: string; name: string; url: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; time: string };
type ProviderConfig = { provider: string; model: string; endpoint: string; temperature: number };
type KeptItem = { id: string; title: string; date: string; time?: string; kind: 'reminder' | 'event'; done: boolean; googleEventId?: string };
type GoogleStatus = { hasCredentials: boolean; connected: boolean; email?: string; lastSync?: string; lastError?: string };
type Character = { identity: string; style: string };
type Profile = { nickname: string; occupation: string; about: string };
type Memory = { id: string; text: string; createdAt: string };
type ChatResult = { content: string; ignored: boolean; irritation: number; ego: number };
type Mood = { irritation: number; ego: number };

contextBridge.exposeInMainWorld('haru', {
  settings: { get: (key: string) => ipcRenderer.invoke('settings:get', key), set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value) },
  chat: {
    getMessages: () => ipcRenderer.invoke('chat:getMessages') as Promise<Message[]>,
    setMessages: (messages: Message[]) => ipcRenderer.invoke('chat:setMessages', messages),
    getArchive: () => ipcRenderer.invoke('chat:getArchive') as Promise<Record<string, Message[]>>,
    newConversation: () => ipcRenderer.invoke('chat:newConversation') as Promise<void>,
    onReset: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('chat:reset', listener);
      return () => ipcRenderer.removeListener('chat:reset', listener);
    },
  },
  ai: {
    send: (messages: { role: string; content: string }[], config: ProviderConfig) => ipcRenderer.invoke('ai:send', messages, config) as Promise<ChatResult>,
    test: (endpoint: string) => ipcRenderer.invoke('ai:test', endpoint) as Promise<string[]>,
    retort: (disliked: string, config: ProviderConfig) => ipcRenderer.invoke('ai:retort', disliked, config) as Promise<string>,
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
    add: (text: string) => ipcRenderer.invoke('memory:add', text) as Promise<Memory[]>,
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
  companion: {
    moveBy: (dx: number, dy: number) => ipcRenderer.invoke('companion:moveBy', dx, dy),
    resizeBy: (factor: number) => ipcRenderer.invoke('companion:resizeBy', factor),
    showMenu: () => ipcRenderer.invoke('companion:showMenu'),
    onCursor: (callback: (point: { x: number; y: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, point: { x: number; y: number }) => callback(point);
      ipcRenderer.on('companion:cursor', listener);
      return () => ipcRenderer.removeListener('companion:cursor', listener);
    },
    onSetExpression: (callback: (name: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, name: string) => callback(name);
      ipcRenderer.on('companion:setExpression', listener);
      return () => ipcRenderer.removeListener('companion:setExpression', listener);
    },
  },
});
