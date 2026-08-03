/// <reference types="vite/client" />
type Live2DModel = { path: string; name: string; url: string };
interface Window {
  PIXI?: unknown;
  Live2DCubismCore?: unknown;
  haru?: {
    settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
    chat: { getMessages(): Promise<import('./types').Message[]>; setMessages(messages: import('./types').Message[]): Promise<void>; getArchive(): Promise<Record<string, import('./types').Message[]>>; newConversation(): Promise<void>; onReset(callback: () => void): () => void };
    ai: { send(messages: { role: string; content: string }[], config: import('./types').ProviderConfig): Promise<string>; test(endpoint: string): Promise<string[]> };
    kept: { get(): Promise<import('./types').KeptItem[]>; toggle(id: string): Promise<void>; remove(id: string): Promise<void>; onChange(callback: (items: import('./types').KeptItem[]) => void): () => void };
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
