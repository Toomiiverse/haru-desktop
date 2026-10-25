import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mail, RefreshCw } from 'lucide-react';
import { browserMailAPI, type MailAPI, type MailDraft, type MailMessage, type MailStatus, type MailThread } from '../electron/mail';

interface MailPageProps { className?: string; api?: MailAPI }
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Perth' }).format(new Date(value)) : 'Unknown time';
const errorText = (error: unknown) => {
  const value = (error instanceof Error ? error.message : 'Mail request failed.').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  const messages: Record<string, string> = {
    openmail_key_required: 'Add an OpenMail inbox key in Connection.',
    openmail_key_rejected: 'OpenMail rejected this key. Check that it is still active.',
    openmail_key_invalid: 'Paste a complete OpenMail API key without extra spaces.',
    use_an_inbox_scoped_key_for_tommy: 'Use a key scoped to the tommy@haru.build inbox.',
    openmail_permission_denied: 'OpenMail refused this operation. Check the key and inbox permissions.',
    openmail_rate_limited: 'OpenMail’s rate limit was reached. Wait before trying again.',
    openmail_request_failed: 'OpenMail rejected the request. Check its console for details.',
    openmail_draft_changed: 'The draft changed. Review the latest version before saving.',
    openmail_send_preview_changed: 'The reply or conversation changed. Review and save the latest draft before sending.',
    openmail_monitoring_paused: 'Resume monitoring in Connection before sending.',
    openmail_unreachable: 'OpenMail is unavailable. Your saved drafts are preserved.',
  };
  return messages[value] ?? value;
};

export function MailPage({ className = '', api: supplied }: MailPageProps) {
  const api = useRef(supplied ?? window.haru?.mail ?? browserMailAPI()).current;
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [items, setItems] = useState<MailThread[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<MailThread | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const currentRef = useRef<string | null>(null);
  const [key, setKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  async function refresh() {
    const [next, list] = await Promise.all([api.status(), api.threads(offset)]);
    setStatus(next); setItems(list.items); setTotal(list.total);
  }
  async function read(id: string) {
    const detail = await api.thread(id);
    if (currentRef.current !== id) return;
    setThread(detail.thread); setMessages(detail.messages);
    if (!dirtyRef.current) { setBody(detail.thread.draft?.body ?? ''); setTo(detail.thread.draft?.to ?? ''); }
  }
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (busyRef.current || !alive) return;
      try {
        await refresh();
        if (currentRef.current) await read(currentRef.current);
      } catch (e) { if (alive) setError(errorText(e)); }
      finally { if (alive) setLoading(false); }
    };
    void poll(); const timer = setInterval(() => void poll(), 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [offset]);
  async function select(id: string) {
    if (dirtyRef.current && id !== selected) { setError('Save or discard your edits before opening another thread.'); return; }
    currentRef.current = id; setSelected(id); setThread(null); setMessages([]); setDetailLoading(true); setError('');
    try { await read(id); } catch (e) { setError(errorText(e)); } finally { setDetailLoading(false); }
  }
  async function action(run: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await run(); await refresh(); if (currentRef.current) await read(currentRef.current); }
    catch (e) { setError(errorText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function edited() { dirtyRef.current = true; setDirty(true); }
  function clean() { dirtyRef.current = false; setDirty(false); }
  async function save(draft: MailDraft) {
    await api.saveDraft({ threadId: draft.threadId, revision: draft.revision, to, body }); clean();
  }
  const draft = thread?.draft;
  return <section className={`mail-page ${selected ? 'mail-detail-open' : ''} ${className}`} aria-label="Haru mail">
    <header className="mail-toolbar"><div><h2>{status?.address ?? 'tommy@haru.build'}</h2><p>{status?.enabled ? 'Monitoring on the Haru server' : 'Monitoring paused'} · {status?.localModel ?? 'Local model'}</p></div>
      <button className="ghost" disabled={busy || !status?.configured} onClick={() => void action(() => api.sync())}><RefreshCw size={15}/> Check mail</button>
      <button className="ghost" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>Connection</button>
    </header>
    {(settingsOpen || status && !status.configured) && <div className="field mail-connection"><h2>OpenMail connection</h2>
      <p>Use an inbox-scoped key for tommy@haru.build. The key is stored privately on the server and never returned here.</p>
      <label>API key<input type="password" autoComplete="off" value={key} disabled={busy} placeholder={status?.configured ? 'Paste only to replace the saved key' : 'OpenMail inbox → API keys'} onChange={e => setKey(e.target.value)}/></label>
      <div className="mail-actions"><button className="ghost" disabled={busy || (!key.trim() && !status?.configured)} onClick={() => void action(async () => { await api.configure({ enabled: true, ...(key.trim() ? { apiKey: key.trim() } : {}) }); setKey(''); })}>Save and monitor</button>
        <button className="ghost" disabled={busy || !status?.enabled} onClick={() => void action(() => api.configure({ enabled: false }))}>Pause monitoring</button></div>
      <p>Summaries and drafts use a local model. OpenMail stores the mailbox overseas and uses Anthropic for outbound abuse screening.</p>
    </div>}
    {error && <p className="mail-error" role="alert">{error}</p>}
    {status?.lastError && <p className="mail-error" role="status">{status.lastError}</p>}
    <div className="mail-layout"><aside className="mail-list" aria-label="Mail threads">
      <p className="mail-count">{total} conversations · {status?.drafts ?? 0} drafts · {status?.pending ?? 0} awaiting analysis</p>
      {loading ? <div className="mail-skeleton" role="status" aria-label="Loading mail"><i/><i/><i/></div> : !items.length ? <div className="mail-empty"><Mail size={26}/><h3>No mail yet</h3><p>Incoming messages appear here after Haru checks the inbox.</p></div> : items.map(item => <button key={item.id} className={`mail-thread ${item.id === selected ? 'selected' : ''}`} aria-current={item.id === selected ? 'true' : undefined} disabled={busy} onClick={() => void select(item.id)}>
        <strong>{item.subject || '(No subject)'}</strong><span>{item.sender}</span><small>{date(item.at)} · {item.pending ? 'Awaiting analysis' : item.draft?.stale ? 'Draft needs review' : item.draft?.status === 'draft' ? 'Draft ready' : item.draft?.status ?? ''}</small><p>{item.summary || item.error || 'Summary pending'}</p>
      </button>)}
      <div className="mail-actions"><button className="ghost" disabled={busy || dirty || offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button><button className="ghost" disabled={busy || dirty || offset + items.length >= total} onClick={() => setOffset(offset + 30)}>Next</button></div>
    </aside><div className="mail-detail" aria-label="Selected conversation">
      <button className="ghost mail-back" disabled={busy || dirty} onClick={() => { currentRef.current = null; setSelected(null); }}><ArrowLeft size={15}/> Conversations</button>
      {detailLoading ? <div className="mail-skeleton" role="status" aria-label="Loading conversation"><i/><i/></div> : !thread ? <div className="mail-empty"><Mail size={26}/><h3>Choose a conversation</h3><p>Read the original message and review Haru’s reply.</p></div> : <>
        <h2>{thread.subject || '(No subject)'}</h2><p className="mail-summary">{thread.summary || 'Awaiting local analysis.'}</p>
        {thread.error && <p className="mail-error">{thread.error}</p>}
        {messages.map(message => <article className="mail-message" key={message.id}><header><strong>{message.from}</strong><span>{date(message.at)}</span></header><p>To: {message.to}</p><pre>{message.body || '(No plain-text body)'}</pre>{message.attachments.length > 0 && <p>Attachments: {message.attachments.map(file => `${file.name} (${Math.ceil(file.bytes / 1024)} KB)`).join(', ')} · not analysed</p>}</article>)}
        {draft && <section className="field mail-draft"><h3>Haru’s reply draft</h3>
          {draft.stale && <p className="mail-error">New mail arrived after this draft. Review the latest conversation and save the draft before sending.</p>}
          {draft.status === 'accepted' ? <p role="status">OpenMail accepted this reply. Recipient delivery has not been confirmed.</p> : draft.status === 'unknown' || draft.status === 'sending' ? <><p role="alert">Sending is unresolved. Don’t send another copy.</p><button className="ghost" disabled={busy} onClick={() => void action(() => api.reconcile({ threadId: thread.id }))}>Check send status</button></> : <>
            <label>Recipient<input value={to} disabled={busy} onChange={e => { setTo(e.target.value); edited(); }}/></label>
            <label>Reply<textarea value={body} disabled={busy} onChange={e => { setBody(e.target.value); edited(); }}/></label>
            {draft.error && <p className="mail-error">{draft.error}</p>}
            <div className="mail-actions"><button className="ghost" disabled={busy || !dirty && !draft.stale || !body.trim() || !to.trim()} onClick={() => void action(() => save(draft))}>Save draft</button>
              <button className="ghost" disabled={busy} onClick={() => void action(async () => { await api.discardDraft({ threadId: draft.threadId, revision: draft.revision }); clean(); })}>Discard draft</button>
              <button className="solid" disabled={busy || dirty || draft.stale || !body.trim() || !to.trim()} onClick={() => void action(() => api.send({ threadId: draft.threadId, revision: draft.revision, previewHash: draft.previewHash }))}>Send reply</button></div>
          </>}
        </section>}
      </>}
    </div></div>
  </section>;
}
