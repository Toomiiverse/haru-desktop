import { useEffect, useRef, useState } from 'react';
import { CharacterDrawer, Composer, Kept, MessageBubble, SettingsDrawer, Suggestion, Topbar } from './components';
import { getProvider, testConnection } from './services/ai';
import type { KeptItem, Message, ProviderConfig } from './types';

const greeting: Message = { id: 'greeting', role: 'assistant', time: 'now', content: "Hey! About time you showed up. We’ve got work to do. Move it!" };
const defaultProviderConfig: ProviderConfig = { provider: 'ollama', model: 'qwen2.5:14b', endpoint: 'http://localhost:11434', temperature: 0.7 };

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]); const [hydrated, setHydrated] = useState(false); const [kept, setKept] = useState<KeptItem[]>([]); const [sending, setSending] = useState(false); const [drawer, setDrawer] = useState<'character'|'settings'|null>(null); const [live2dModel, setLive2dModel] = useState<{name: string; path: string; url: string} | null>(null); const [importing, setImporting] = useState(false); const [providerConfig, setProviderConfig] = useState<ProviderConfig>(defaultProviderConfig);
  useEffect(() => { window.haru?.live2d.get().then(model => { if (model) setLive2dModel(model); }); }, []);
  useEffect(() => { window.haru?.settings.get('ai.config').then(saved => { if (saved) setProviderConfig(current => ({ ...current, ...(saved as Partial<ProviderConfig>) })); }); }, []);
  // Alerts are owned by the main process — it is what holds the timer and shows
  // the notification — so the toggle reads back whatever the store settled on
  // rather than assuming the write landed.
  const [alerts, setAlerts] = useState(true);
  useEffect(() => { window.haru?.alerts.get().then(setAlerts); }, []);
  async function toggleAlerts() {
    if (!window.haru) { setAlerts(current => !current); return; }
    setAlerts(await window.haru.alerts.set(!alerts));
  }
  // Kept items are owned by the main process — the chat tool loop writes to them
  // there — so the panel reloads on every broadcast instead of holding its own copy.
  useEffect(() => {
    if (!window.haru) return;
    window.haru.kept.get().then(setKept);
    return window.haru.kept.onChange(setKept);
  }, []);
  function saveProviderConfig(config: ProviderConfig) { setProviderConfig(config); window.haru?.settings.set('ai.config', config); }
  // Replies land below the fold once the day's history is long enough to scroll,
  // so pin the view to the newest message whenever the list or pending state changes.
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = messagesRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, sending]);
  // Chat is persisted through the main process (electron-store), not localStorage,
  // and gets wiped there once a day — see chat:reset. Loading is gated behind
  // `hydrated` so the persist effect below can't clobber saved messages with the
  // initial empty array before the real ones have loaded.
  // Bumped whenever the conversation is cleared, so a reply that was already in
  // flight can't be appended to the fresh chat it no longer belongs to.
  const conversation = useRef(0);
  useEffect(() => {
    if (!window.haru) { setHydrated(true); return; }
    window.haru.chat.getMessages().then(saved => { setMessages(saved); setHydrated(true); });
    return window.haru.chat.onReset(() => { conversation.current++; setMessages([]); });
  }, []);
  async function newChat() {
    if (sending) return;
    if (!window.haru) { conversation.current++; setMessages([]); return; }
    await window.haru.chat.newConversation();
  }
  useEffect(() => { if (hydrated) window.haru?.chat.setMessages(messages); }, [messages, hydrated]);
  async function send(content: string) {
    const epoch = conversation.current;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content, time: 'now' };
    setMessages(current => [...current, user]);
    setSending(true);
    try {
      const reply = await getProvider(providerConfig).send([...messages, user], providerConfig);
      if (conversation.current !== epoch) return;
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: reply, time: 'now' }]);
    } catch (error) {
      if (conversation.current !== epoch) return;
      const detail = error instanceof Error ? error.message : String(error);
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: `Couldn't reach ${providerConfig.provider} (${detail}). Check the setup in Setup → Ollama connection.`, time: 'now' }]);
    } finally {
      setSending(false);
    }
  }
  const empty = !messages.length;
  async function importLive2d() { if (!window.haru?.live2d) { alert('Live2D import is available in the desktop app.'); return; } setImporting(true); try { const model = await window.haru.live2d.import(); if (model) setLive2dModel(model); } finally { setImporting(false); } }
  async function removeLive2d() { await window.haru?.live2d.remove(); setLive2dModel(null); }
  return <main className="haru-app"><Topbar characterOpen={drawer==='character'} settingsOpen={drawer==='settings'} canStartNewChat={!!messages.length && !sending} onNewChat={newChat} onCharacter={() => setDrawer(drawer==='character'?null:'character')} onSettings={() => setDrawer(drawer==='settings'?null:'settings')}/>{drawer === 'character' && <CharacterDrawer onClose={() => setDrawer(null)}/>} {drawer === 'settings' && <SettingsDrawer config={providerConfig} alerts={alerts} onToggleAlerts={toggleAlerts} onSave={saveProviderConfig} onTest={testConnection} onClose={() => setDrawer(null)}/>}<div className="haru-body"><section className="chat-panel"><div className="messages" ref={messagesRef}>{empty ? <div className="empty-state"><MessageBubble message={greeting}/><p>Anything that sounds like a task or an appointment gets captured for real — not just talked about.</p><div className="suggestions"><Suggestion onClick={() => send('Set me a reminder for 8am to take my medication')}>Set a reminder for 8am</Suggestion><Suggestion onClick={() => send('Dentist Thursday at 10, lasts an hour')}>Dentist Thursday at 10</Suggestion><Suggestion onClick={() => send('What have I got coming up?')}>What have I got coming up?</Suggestion></div></div> : messages.map(message => <MessageBubble key={message.id} message={message}/>)}</div><Composer sending={sending} onSend={send}/></section><Kept items={kept} onToggle={id => { window.haru ? window.haru.kept.toggle(id) : setKept(items => items.map(item => item.id===id ? {...item, done: !item.done} : item)); }} model={live2dModel} importing={importing} onImport={importLive2d} onRemove={removeLive2d}/></div></main>;
}
