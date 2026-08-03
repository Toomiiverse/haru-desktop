import { useEffect, useState } from 'react';
import { CharacterDrawer, Composer, Kept, MessageBubble, SettingsDrawer, Suggestion, Topbar } from './components';
import { getProvider, testConnection } from './services/ai';
import { toISODate } from './date';
import type { KeptItem, Message, ProviderConfig } from './types';

const greeting: Message = { id: 'greeting', role: 'assistant', time: 'now', content: "Hey! About time you showed up. We’ve got work to do. Move it!" };
const defaultProviderConfig: ProviderConfig = { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507', endpoint: 'http://localhost:11434', temperature: 0.7 };

// Demo seed data: there's no real capture pipeline wired up yet (chat is a stub
// provider), so the calendar would otherwise always be empty. Remove once messages
// actually get parsed into kept items.
function relativeDate(offsetDays: number) { const d = new Date(); d.setDate(d.getDate() + offsetDays); return toISODate(d); }
const seedKept: KeptItem[] = [
  { id: 'seed-1', title: 'Take morning medication', date: relativeDate(0), time: '8:00 AM', kind: 'reminder', done: false },
  { id: 'seed-2', title: 'Dentist appointment', date: relativeDate(1), time: '10:00 AM', kind: 'event', done: false },
  { id: 'seed-3', title: 'Team standup', date: relativeDate(3), time: '9:30 AM', kind: 'event', done: false },
  { id: 'seed-4', title: 'Pay rent', date: relativeDate(5), kind: 'reminder', done: false },
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]); const [hydrated, setHydrated] = useState(false); const [kept, setKept] = useState<KeptItem[]>(seedKept); const [sending, setSending] = useState(false); const [drawer, setDrawer] = useState<'character'|'settings'|null>(null); const [live2dModel, setLive2dModel] = useState<{name: string; path: string; url: string} | null>(null); const [importing, setImporting] = useState(false); const [providerConfig, setProviderConfig] = useState<ProviderConfig>(defaultProviderConfig);
  useEffect(() => { window.haru?.live2d.get().then(model => { if (model) setLive2dModel(model); }); }, []);
  useEffect(() => { window.haru?.settings.get('ai.config').then(saved => { if (saved) setProviderConfig(current => ({ ...current, ...(saved as Partial<ProviderConfig>) })); }); }, []);
  function saveProviderConfig(config: ProviderConfig) { setProviderConfig(config); window.haru?.settings.set('ai.config', config); }
  // Chat is persisted through the main process (electron-store), not localStorage,
  // and gets wiped there once a day — see chat:reset. Loading is gated behind
  // `hydrated` so the persist effect below can't clobber saved messages with the
  // initial empty array before the real ones have loaded.
  useEffect(() => {
    if (!window.haru) { setHydrated(true); return; }
    window.haru.chat.getMessages().then(saved => { setMessages(saved); setHydrated(true); });
    return window.haru.chat.onReset(() => setMessages([]));
  }, []);
  useEffect(() => { if (hydrated) window.haru?.chat.setMessages(messages); }, [messages, hydrated]);
  async function send(content: string) {
    const user: Message = { id: crypto.randomUUID(), role: 'user', content, time: 'now' };
    setMessages(current => [...current, user]);
    setSending(true);
    try {
      const reply = await getProvider(providerConfig).send([...messages, user], providerConfig);
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: reply, time: 'now' }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: `Couldn't reach ${providerConfig.provider} (${detail}). Check the setup in Setup → Ollama connection.`, time: 'now' }]);
    } finally {
      setSending(false);
    }
  }
  const empty = !messages.length;
  async function importLive2d() { if (!window.haru?.live2d) { alert('Live2D import is available in the desktop app.'); return; } setImporting(true); try { const model = await window.haru.live2d.import(); if (model) setLive2dModel(model); } finally { setImporting(false); } }
  async function removeLive2d() { await window.haru?.live2d.remove(); setLive2dModel(null); }
  return <main className="haru-app"><Topbar characterOpen={drawer==='character'} settingsOpen={drawer==='settings'} onCharacter={() => setDrawer(drawer==='character'?null:'character')} onSettings={() => setDrawer(drawer==='settings'?null:'settings')}/>{drawer === 'character' && <CharacterDrawer onClose={() => setDrawer(null)}/>} {drawer === 'settings' && <SettingsDrawer config={providerConfig} onSave={saveProviderConfig} onTest={testConnection} onClose={() => setDrawer(null)}/>}<div className="haru-body"><section className="chat-panel"><div className="messages">{empty ? <div className="empty-state"><MessageBubble message={greeting}/><p>Anything that sounds like a task or an appointment gets captured for real — not just talked about.</p><div className="suggestions"><Suggestion onClick={() => send('Set me a reminder for 8am to take my medication')}>Set a reminder for 8am</Suggestion><Suggestion onClick={() => send('Dentist Thursday at 10, lasts an hour')}>Dentist Thursday at 10</Suggestion><Suggestion onClick={() => send('What have I got coming up?')}>What have I got coming up?</Suggestion></div></div> : messages.map(message => <MessageBubble key={message.id} message={message}/>)}</div><Composer sending={sending} onSend={send}/></section><Kept items={kept} onToggle={id => setKept(items => items.map(item => item.id===id ? {...item, done: !item.done} : item))} model={live2dModel} importing={importing} onImport={importLive2d} onRemove={removeLive2d}/></div></main>;
}
