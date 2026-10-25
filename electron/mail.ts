export interface MailDraft {
  id: string; threadId: string; to: string; subject: string; body: string;
  revision: number; sourceId: string; edited: boolean; stale: boolean;
  status: 'draft' | 'sending' | 'accepted' | 'unknown' | 'failed';
  error: string | null; messageId?: string; previewHash: string;
}
export interface MailMessage {
  id: string; direction: 'inbound' | 'outbound'; from: string; to: string;
  subject: string; body: string; at: string;
  attachments: { name: string; bytes: number }[];
}
export interface MailThread {
  id: string; subject: string; sender: string; at: string; summary: string;
  pending: boolean; error: string | null; draft: MailDraft | null;
}
export interface MailStatus {
  configured: boolean; enabled: boolean; address: string; connected: boolean;
  lastSync: number; lastError: string | null; localModel: string;
  pending: number; drafts: number;
}
export interface MailAPI {
  status(): Promise<MailStatus>;
  configure(input: { enabled: boolean; apiKey?: string }): Promise<MailStatus>;
  sync(): Promise<MailStatus>;
  threads(offset?: number): Promise<{ items: MailThread[]; total: number }>;
  thread(id: string): Promise<{ thread: MailThread; messages: MailMessage[] }>;
  saveDraft(input: { threadId: string; revision: number; to: string; body: string }): Promise<MailDraft>;
  discardDraft(input: { threadId: string; revision: number }): Promise<{ ok: boolean }>;
  send(input: { threadId: string; revision: number; previewHash: string }): Promise<MailDraft>;
  reconcile(input: { threadId: string }): Promise<MailDraft>;
}

export function browserMailAPI(): MailAPI {
  const request = async <T,>(op: string, args: unknown = {}): Promise<T> => {
    const response = await fetch(`/api/openmail/${op}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Haru-Mail-UI': '1' },
      body: JSON.stringify(args),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Mail request failed.');
    return value;
  };
  return {
    status: () => request('status'), configure: input => request('configure', input), sync: () => request('sync'),
    threads: (offset = 0) => request('threads', { offset }), thread: threadId => request('thread', { threadId }),
    saveDraft: input => request('save-draft', input), discardDraft: input => request('discard-draft', input),
    send: input => request('send', input), reconcile: input => request('reconcile', input),
  };
}
