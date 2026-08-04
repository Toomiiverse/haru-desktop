/// <reference types="vite/client" />
type Live2DModel = { path: string; name: string; url: string };
interface Window {
  PIXI?: unknown;
  Live2DCubismCore?: unknown;
  haru?: {
    settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
    chat: { getMessages(): Promise<import('./types').Message[]>; setMessages(messages: import('./types').Message[]): Promise<void>; getArchive(): Promise<Record<string, import('./types').Message[]>>; newConversation(): Promise<void>; onReset(callback: () => void): () => void };
    ai: { send(messages: { role: string; content: string }[], config: import('./types').ProviderConfig): Promise<import('./types').ChatResult>; test(endpoint: string): Promise<string[]>; retort(disliked: string, config: import('./types').ProviderConfig): Promise<string> };
    mood: { get(): Promise<import('./types').Mood>; react(reaction: import('./types').Reaction): Promise<import('./types').Mood> };
    profile: { get(): Promise<import('./types').Profile>; set(profile: import('./types').Profile): Promise<import('./types').Profile> };
    memory: {
      list(): Promise<import('./types').Memory[]>;
      add(text: string): Promise<import('./types').Memory[]>;
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
    live2d: { import(): Promise<Live2DModel | null>; get(): Promise<Live2DModel | null>; remove(): Promise<void>; onChange(callback: (model: Live2DModel | null) => void): () => void };
    companion: {
      moveBy(dx: number, dy: number): Promise<void>;
      resizeBy(factor: number): Promise<void>;
      showMenu(): Promise<void>;
      onCursor(callback: (point: { x: number; y: number }) => void): () => void;
      onSetExpression(callback: (name: string) => void): () => void;
    };
  };
}
