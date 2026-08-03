import { Component, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleDot, Import, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { KeptItem, Message, ProviderConfig } from './types';
import { buildMonthGrid, dayLabel, monthLabel, toISODate } from './date';
export class StageFailureBoundary extends Component<{ children: ReactNode; onError(message: string): void }, { failed: boolean }> { state = { failed: false }; componentDidCatch(error: Error) { this.props.onError(error.message || 'Haru could not start the Live2D renderer.'); } render() { return this.state.failed ? null : this.props.children; } static getDerivedStateFromError() { return { failed: true }; } }

export function Topbar({ characterOpen, settingsOpen, onCharacter, onSettings }: { characterOpen: boolean; settingsOpen: boolean; onCharacter(): void; onSettings(): void }) {
  return <header className="topbar"><div className="wordmark">はる <span>· Haru</span></div><div className="connection"><i/><span>local companion</span></div><div className="top-actions"><button className={characterOpen ? 'pill selected' : 'pill'} onClick={onCharacter}>Character</button><button className={settingsOpen ? 'pill selected' : 'pill'} onClick={onSettings}>Setup</button></div></header>;
}

export function CharacterDrawer({ onClose }: { onClose(): void }) { return <section className="drawer"><button className="drawer-close" onClick={onClose}><X size={16}/></button><div className="field"><h2>Who Haru is</h2><p>Haru’s personality is separate from the operating system, so future providers and tools can share it safely.</p><textarea defaultValue={'You are Haru, an ambitious AI companion. You are quick-witted, direct, curious, and determined to make ordinary days more interesting. You take initiative, challenge lazy thinking, and care through honest feedback.'}/></div><div className="field"><h2>Stay in character</h2><p>This instruction stays at the end of Haru’s future provider prompt.</p><textarea className="short" defaultValue={'Be playful, incisive, and energetic. Choose banter and ambitious brainstorming over flattery. Do not drift into generic assistant language.'}/></div><div className="drawer-foot"><button className="ghost">Reset to card</button><span className="saved"><Check size={13}/> Saved</span><button className="solid">Save character</button></div></section>; }

export function SettingsDrawer({ config, onSave, onTest, onClose }: { config: ProviderConfig; onSave(config: ProviderConfig): void; onTest(endpoint: string): Promise<string[]>; onClose(): void }) {
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [model, setModel] = useState(config.model);
  const [status, setStatus] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ state: 'idle' });
  const [saved, setSaved] = useState(false);
  async function test() {
    setStatus({ state: 'testing' });
    try {
      const models = await onTest(endpoint);
      setStatus({ state: 'ok', message: models.length ? `Connected. Models available: ${models.join(', ')}` : 'Connected, but no models are pulled yet — try `ollama pull qwen3:8b`.' });
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  function save() {
    onSave({ ...config, endpoint, model });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return <section className="drawer"><button className="drawer-close" onClick={onClose}><X size={16}/></button><div className="field"><h2>Ollama connection</h2><p>Haru will be able to talk to Ollama on your machine. Provider credentials will stay outside the renderer.</p><div className="form-grid"><input value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="http://localhost:11434"/><input value={model} onChange={event => setModel(event.target.value)} placeholder="qwen3:8b"/></div>{status.state !== 'idle' && <p className={status.state === 'error' ? 'status-error' : 'status-ok'}>{status.state === 'testing' ? 'Testing…' : status.message}</p>}</div><div className="drawer-foot"><button className="ghost" onClick={test} disabled={status.state === 'testing'}>{status.state === 'testing' ? 'Testing…' : 'Test connection'}</button><button className="ghost">Enable alerts</button>{saved && <span className="saved"><Check size={13}/> Saved</span>}<button className="solid" onClick={save}>Save setup</button></div></section>;
}

export function CharacterModelRow({ model, importing, onImport, onRemove }: { model: { name: string; url: string } | null; importing: boolean; onImport(): void; onRemove(): void }) {
  if (model) return <div className="model-row" aria-label="Live2D character model"><Sparkles size={13}/><span className="model-name" title={model.name}>{model.name}</span><button className="remove-model" onClick={onRemove}><Trash2 size={12}/> Remove</button></div>;
  return <div className="model-row" aria-label="Live2D character model"><Sparkles size={13}/><span className="model-name muted">No character model imported</span><button className="import-model" onClick={onImport} disabled={importing}><Import size={13}/>{importing ? 'Opening…' : 'Import model'}</button></div>;
}

export function MessageBubble({ message }: { message: Message }) { return <article className={'bubble-row '+message.role}><div className="assistant-dot" aria-hidden="true"/><div className="bubble">{message.content}</div></article>; }
export function Composer({ sending, onSend }: { sending: boolean; onSend(text: string): void }) { let draft = ''; return <form className="compose" onSubmit={event => { event.preventDefault(); if (draft.trim()) onSend(draft); }}><input disabled={sending} placeholder="Say something to Haru…" onChange={event => draft=event.target.value}/><button disabled={sending}>{sending ? 'Thinking…' : 'Send'}</button></form>; }

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
