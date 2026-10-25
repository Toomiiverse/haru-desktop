import type { ServerRequest } from './server-chat';
import { serverJson, jsonPost } from './server-chat';
import type { MailAPI } from './mail';

// Presentation transport only. Python Core validates inputs, owns drafts and authorizes sends.
export function mailClient(request: ServerRequest): MailAPI {
  const call = <T>(op: string, input: unknown = {}) => serverJson<T>(request, `/api/openmail/${op}`, {
    ...jsonPost(input), headers: { 'content-type': 'application/json', 'x-haru-mail-ui': '1' },
  });
  return {
    status: () => call('status'), configure: input => call('configure', input), sync: () => call('sync'),
    threads: (offset = 0) => call('threads', { offset }), thread: threadId => call('thread', { threadId }),
    saveDraft: input => call('save-draft', input), discardDraft: input => call('discard-draft', input),
    send: input => call('send', input), reconcile: input => call('reconcile', input),
  };
}
