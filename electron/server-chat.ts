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
export async function sendServerChat(request: ServerRequest, text: string, files: { attachment: Attachment; bytes: Uint8Array }[]) {
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
  const answer = await serverJson<{ reply: string; ignored?: boolean }>(request, '/api/chat', jsonPost({ text, attachments: uploaded }));
  if (typeof answer.reply !== 'string') throw new Error('Haru server returned an invalid reply. Check the conversation before sending again.');
  return { content: answer.reply, ignored: Boolean(answer.ignored), irritation: 0, ego: 0 };
}
