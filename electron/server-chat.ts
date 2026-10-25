import { readAttachments, type Attachment } from './attachments';
import { isTailnetAddress } from './checkinsource';

export const SERVER_PARTITION = 'persist:haru-server';
export function serverOrigin(saved: unknown): string | null {
  if (typeof saved !== 'string' || !saved.trim()) return null;
  const url = new URL(saved);
  if (url.protocol !== 'https:' || url.username || url.password || !isTailnetAddress(url.origin)) {
    throw new Error('Haru server must use an HTTPS Tailscale address.');
  }
  return url.origin;
}

export type ServerRequest = (route: string, init?: RequestInit) => Promise<Response>;

export async function serverJson<T>(request: ServerRequest, route: string, init?: RequestInit): Promise<T> {
  const response = await request(route, init);
  if (response.status === 401 || response.status === 403) throw new Error('Haru server login has expired. Sign in to the server again.');
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null) throw new Error(body?.error || `Haru server returned ${response.status}.`);
  return body as T;
}

export const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// Only this turn crosses the network. The server owns its history and routing.
/** Her reply as the server writes it (server-sent events: text, sentence, tool, done, error, pending). */
export async function readStreamedReply(response: Response, onText: (text: string) => void, onSentence?: (sentence: string, emotion: string | null) => void, onTool?: (name: string) => void): Promise<{ reply: string; ignored?: boolean }> {
  if (response.status === 401 || response.status === 403) throw new Error('Haru server login has expired. Sign in to the server again.');
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Haru server returned ${response.status}.`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!event.startsWith('data: ')) continue;   // a heartbeat
      const data = JSON.parse(event.slice(6));
      // A tool she is about to use (its name only, sent before the server checks or runs it).
      if (typeof data.tool === 'string' && data.tool) onTool?.(data.tool);
      if (typeof data.text === 'string' && data.text) onText(data.text);
      // A finished sentence, for her voice to start on while the rest is written.
      if (typeof data.sentence === 'string' && data.sentence) onSentence?.(data.sentence, typeof data.emotion === 'string' ? data.emotion : null);
      if (data.done) return { reply: data.reply, ignored: data.ignored };
      if (data.error) throw new Error(data.error);
      if (data.pending) throw new Error('Haru server is still answering. Check the conversation before sending again.');
    }
  }
  throw new Error('Haru server stopped mid-reply. Check the conversation before sending again.');
}

export async function sendServerChat(request: ServerRequest, text: string, files: { attachment: Attachment; bytes: Uint8Array }[], onText: (text: string) => void = () => {}, onSentence?: (sentence: string, emotion: string | null) => void, onTool?: (name: string) => void) {
  if (files.length > 6) throw new Error('Attach up to six files per message.');
  if (!text.trim() && !files.length) throw new Error('Write a message or attach a file.');
  const uploaded: Attachment[] = [];
  try {
    for (const { attachment, bytes } of files) {
      const body = await serverJson<{ attachment: unknown }>(request, '/api/attach?name=' + encodeURIComponent(attachment.name), {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes),
      });
      const file = readAttachments([body.attachment])[0];
      if (!file) throw new Error('Haru server did not accept the attachment.');
      uploaded.push(file);
    }
  } catch (error) {
    // No chat has been sent yet, so these staged copies are safe to discard.
    await Promise.allSettled(uploaded.map(attachment => request('/api/attach/discard', jsonPost({ attachment }))));
    throw error;
  }
  // Never retry a send automatically: a lost response may still have been saved.
  const answer = await readStreamedReply(await request('/api/chat/stream?thread=desk', jsonPost({ text, attachments: uploaded })), onText, onSentence, onTool);
  if (typeof answer.reply !== 'string') throw new Error('Haru server returned an invalid reply. Check the conversation before sending again.');
  return { content: answer.reply, ignored: Boolean(answer.ignored), irritation: 0, ego: 0 };
}
