import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleDot, Import, MessageSquarePlus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { Character, GoogleStatus, KeptItem, Message, ProviderConfig } from './types';
import { buildMonthGrid, dayLabel, monthLabel, toISODate } from './date';
export class StageFailureBoundary extends Component<{ children: ReactNode; onError(message: string): void }, { failed: boolean }> { state = { failed: false }; componentDidCatch(error: Error) { this.props.onError(error.message || 'Haru could not start the Live2D renderer.'); } render() { return this.state.failed ? null : this.props.children; } static getDerivedStateFromError() { return { failed: true }; } }

export function Topbar({ characterOpen, settingsOpen, canStartNewChat, onNewChat, onCharacter, onSettings }: { characterOpen: boolean; settingsOpen: boolean; canStartNewChat: boolean; onNewChat(): void; onCharacter(): void; onSettings(): void }) {
  return <header className="topbar"><div className="wordmark">はる <span>· Haru</span></div><div className="connection"><i/><span>local companion</span></div><div className="top-actions"><button className="pill" onClick={onNewChat} disabled={!canStartNewChat} title="Archive this conversation and start fresh"><MessageSquarePlus size={13}/> New chat</button><button className={characterOpen ? 'pill selected' : 'pill'} onClick={onCharacter}>Character</button><button className={settingsOpen ? 'pill selected' : 'pill'} onClick={onSettings}>Setup</button></div></header>;
}

export function CharacterDrawer({ onClose }: { onClose(): void }) {
  const [character, setCharacter] = useState<Character>({ identity: '', style: '' });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.haru?.character.get().then(current => { setCharacter(current); setLoaded(true); }); }, []);

  async function apply(action: () => Promise<Character>) {
    setBusy(true);
    try {
      setCharacter(await action());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  const edit = (field: keyof Character) => (event: React.ChangeEvent<HTMLTextAreaElement>) => setCharacter(current => ({ ...current, [field]: event.target.value }));
  return <section className="drawer"><button className="drawer-close" onClick={onClose}><X size={16}/></button>
    <div className="field"><h2>Who Haru is</h2><p>This opens Haru’s prompt, so it shapes how she answers everywhere — chat, reminders and all.</p><textarea value={character.identity} disabled={!loaded} onChange={edit('identity')}/></div>
    <div className="field"><h2>Stay in character</h2><p>This instruction sits at the very end of the prompt, the last thing read before Haru replies.</p><textarea className="short" value={character.style} disabled={!loaded} onChange={edit('style')}/></div>
    <div className="drawer-foot">
      <button className="ghost" disabled={!loaded || busy} onClick={() => apply(() => window.haru!.character.reset())}>Reset to card</button>
      {saved && <span className="saved"><Check size={13}/> Saved</span>}
      <button className="solid" disabled={!loaded || busy} onClick={() => apply(() => window.haru!.character.set(character.identity, character.style))}>Save character</button>
    </div></section>;
}

export function SettingsDrawer({ config, onSave, onTest, onClose }: { config: ProviderConfig; onSave(config: ProviderConfig): void; onTest(endpoint: string): Promise<string[]>; onClose(): void }) {
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [model, setModel] = useState(config.model);
  const [status, setStatus] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ state: 'idle' });
  const [saved, setSaved] = useState(false);
  async function test() {
    setStatus({ state: 'testing' });
    try {
      const models = await onTest(endpoint);
      setStatus({ state: 'ok', message: models.length ? `Connected. Models available: ${models.join(', ')}` : 'Connected, but no models are pulled yet — try `ollama pull llama3.1:8b`.' });
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  function save() {
    onSave({ ...config, endpoint, model });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return <section className="drawer"><button className="drawer-close" onClick={onClose}><X size={16}/></button><div className="field"><h2>Ollama connection</h2><p>Haru will be able to talk to Ollama on your machine. Provider credentials will stay outside the renderer.</p><div className="form-grid"><input value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="http://localhost:11434"/><input value={model} onChange={event => setModel(event.target.value)} placeholder="qwen3:8b"/></div>{status.state !== 'idle' && <p className={status.state === 'error' ? 'status-error' : 'status-ok'}>{status.state === 'testing' ? 'Testing…' : status.message}</p>}</div><GoogleCalendarField/><div className="drawer-foot"><button className="ghost" onClick={test} disabled={status.state === 'testing'}>{status.state === 'testing' ? 'Testing…' : 'Test connection'}</button><button className="ghost">Enable alerts</button>{saved && <span className="saved"><Check size={13}/> Saved</span>}<button className="solid" onClick={save}>Save setup</button></div></section>;
}

function GoogleCalendarField() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<'saving' | 'connecting' | 'syncing' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  // Subscribed as well as fetched: a sync running on the timer updates the panel
  // without the drawer having to be reopened.
  useEffect(() => {
    if (!window.haru) return;
    window.haru.google.status().then(setStatus);
    return window.haru.google.onChange(setStatus);
  }, []);

  async function run(kind: 'saving' | 'connecting' | 'syncing', action: () => Promise<GoogleStatus>, done: string) {
    setBusy(kind); setMessage(null);
    try {
      setStatus(await action());
      setMessage({ text: done });
      // Credentials live in the main process from here on; no need to keep the
      // secret sitting in renderer state.
      if (kind === 'saving') { setClientId(''); setClientSecret(''); }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  if (!window.haru) return null;
  return <div className="field"><h2>Google Calendar</h2>
    {!status?.hasCredentials
      ? <>
          <p>Create an OAuth client of type <b>Desktop app</b> in Google Cloud Console with the Calendar API enabled, then paste its ID and secret here. Both are encrypted before they touch the disk.</p>
          <div className="form-grid"><input value={clientId} onChange={event => setClientId(event.target.value)} placeholder="Client ID"/><input type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder="Client secret"/></div>
          <div className="row-actions"><button className="ghost" disabled={busy !== null || !clientId.trim() || !clientSecret.trim()} onClick={() => run('saving', () => window.haru!.google.saveCredentials(clientId, clientSecret), 'Credentials saved. Now connect your account.')}>{busy === 'saving' ? 'Saving…' : 'Save credentials'}</button></div>
        </>
      : <>
          <p>{status.connected ? `Connected${status.email ? ` as ${status.email}` : ''}. Reminders Haru saves are added to your calendar.` : 'Credentials saved. Connect your account to start syncing.'}</p>
          <div className="row-actions">
            {status.connected
              ? <>
                  <button className="ghost" disabled={busy !== null} onClick={() => run('syncing', () => window.haru!.google.sync(), 'Calendar synced.')}>{busy === 'syncing' ? 'Syncing…' : 'Sync now'}</button>
                  <button className="ghost" disabled={busy !== null} onClick={() => run('connecting', () => window.haru!.google.disconnect(), 'Disconnected from Google.')}>Disconnect</button>
                </>
              : <button className="ghost" disabled={busy !== null} onClick={() => run('connecting', () => window.haru!.google.connect(), 'Connected to Google Calendar.')}>{busy === 'connecting' ? 'Waiting for your browser…' : 'Connect Google account'}</button>}
          </div>
          {status.lastSync && !message && <p className="status-ok">Last synced {new Date(status.lastSync).toLocaleString()}</p>}
        </>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
    {!message && status?.lastError && <p className="status-error">{status.lastError}</p>}
  </div>;
}

export function CharacterModelRow({ model, importing, onImport, onRemove }: { model: { name: string; url: string } | null; importing: boolean; onImport(): void; onRemove(): void }) {
  if (model) return <div className="model-row" aria-label="Live2D character model"><Sparkles size={13}/><span className="model-name" title={model.name}>{model.name}</span><button className="remove-model" onClick={onRemove}><Trash2 size={12}/> Remove</button></div>;
  return <div className="model-row" aria-label="Live2D character model"><Sparkles size={13}/><span className="model-name muted">No character model imported</span><button className="import-model" onClick={onImport} disabled={importing}><Import size={13}/>{importing ? 'Opening…' : 'Import model'}</button></div>;
}

export function MessageBubble({ message }: { message: Message }) { return <article className={'bubble-row '+message.role}><div className="assistant-dot" aria-hidden="true"/><div className="bubble">{message.content}</div></article>; }
// The draft lives in state, not a plain local: `sending` toggling re-renders the
// composer, which would reset a local and leave the (uncontrolled) input showing
// text that submit could no longer see.
export function Composer({ sending, onSend }: { sending: boolean; onSend(text: string): void }) {
  const [draft, setDraft] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    onSend(text);
  }
  return <form className="compose" onSubmit={submit}><input value={draft} disabled={sending} placeholder="Say something to Haru…" onChange={event => setDraft(event.target.value)}/><button disabled={sending || !draft.trim()}>{sending ? 'Thinking…' : 'Send'}</button></form>;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function Calendar({ items, selected, onSelect }: { items: KeptItem[]; selected: string; onSelect(date: string): void }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const marks = useMemo(() => {
    const map = new Map<string, { reminder: boolean; event: boolean }>();
    for (const item of items) {
      const entry = map.get(item.date) ?? { reminder: false, event: false };
      entry[item.kind] = true;
      map.set(item.date, entry);
    }
    return map;
  }, [items]);
  const today = toISODate(new Date());
  function shiftMonth(delta: number) { const d = new Date(cursor.year, cursor.month + delta, 1); setCursor({ year: d.getFullYear(), month: d.getMonth() }); }
  function jumpToday() { const d = new Date(); setCursor({ year: d.getFullYear(), month: d.getMonth() }); onSelect(today); }
  return <div className="calendar"><div className="calendar-head"><button className="cal-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={13}/></button><button className="cal-month" onClick={jumpToday}>{monthLabel(cursor.year, cursor.month)}</button><button className="cal-nav" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={13}/></button></div><div className="calendar-weekdays">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div><div className="calendar-grid">{grid.map(cell => { const mark = marks.get(cell.date); const classes = ['cal-day']; if (!cell.inMonth) classes.push('outside'); if (cell.date === today) classes.push('today'); if (cell.date === selected) classes.push('selected'); return <button key={cell.date} className={classes.join(' ')} onClick={() => onSelect(cell.date)}><span>{cell.day}</span>{mark && <i className="cal-dots">{mark.event && <em className="dot event"/>}{mark.reminder && <em className="dot reminder"/>}</i>}</button>; })}</div></div>;
}

export function Agenda({ items, selected, onToggle }: { items: KeptItem[]; selected: string; onToggle(id: string): void }) {
  const dayItems = useMemo(() => items.filter(item => item.date === selected).sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '').localeCompare(b.time ?? '')), [items, selected]);
  return <div className="agenda"><h3>{dayLabel(selected)}</h3>{!dayItems.length ? <p className="nothing">Nothing kept for this day.</p> : dayItems.map(item => <button key={item.id} className={item.done ? 'agenda-item done' : 'agenda-item'} onClick={() => onToggle(item.id)}><i>{item.kind === 'event' ? <CircleDot size={11}/> : <Plus size={11}/>}</i><div className="agenda-text"><b>{item.title}</b>{item.time && <small>{item.time}</small>}</div></button>)}</div>;
}

export function Kept({ items, model, importing, onImport, onRemove, onToggle }: { items: KeptItem[]; model: { name: string; url: string } | null; importing: boolean; onImport(): void; onRemove(): void; onToggle(id: string): void }) {
  const [selected, setSelected] = useState(() => toISODate(new Date()));
  const pending = items.filter(item => !item.done).length;
  return <aside className="kept"><h2>Kept{pending > 0 && <span className="kept-count">{pending}</span>}</h2><Calendar items={items} selected={selected} onSelect={setSelected}/><Agenda items={items} selected={selected} onToggle={onToggle}/><div className="stage-slot"><CharacterModelRow model={model} importing={importing} onImport={onImport} onRemove={onRemove}/></div></aside>;
}
export function Suggestion({ children, onClick }: { children: React.ReactNode; onClick(): void }) { return <button className="suggestion" onClick={onClick}>{children}</button>; }
