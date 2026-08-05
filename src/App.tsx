import { useEffect, useRef, useState } from 'react';
import { CharacterDrawer, Composer, Kept, MessageBubble, ProfileDrawer, SettingsDrawer, Suggestion, Topbar } from './components';
import { getProvider, testConnection } from './services/ai';
import { randomGloat, randomRetort } from './retorts';
import type { KeptItem, Message, ProviderConfig, Reaction } from './types';

const greeting: Message = { id: 'greeting', role: 'assistant', time: 'now', content: "Hey! About time you showed up. We’ve got work to do. Move it!" };
const defaultProviderConfig: ProviderConfig = { provider: 'ollama', model: 'qwen2.5:14b', endpoint: 'http://localhost:11434', temperature: 0.7 };

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]); const [hydrated, setHydrated] = useState(false); const [kept, setKept] = useState<KeptItem[]>([]); const [sending, setSending] = useState(false); const [drawer, setDrawer] = useState<'character'|'profile'|'settings'|null>(null); const [live2dModel, setLive2dModel] = useState<{name: string; path: string; url: string} | null>(null); const [importing, setImporting] = useState(false); const [providerConfig, setProviderConfig] = useState<ProviderConfig>(defaultProviderConfig); const [replyingTo, setReplyingTo] = useState<{ id: string; excerpt: string } | null>(null);
  useEffect(() => { window.haru?.live2d.get().then(model => { if (model) setLive2dModel(model); }); }, []);
  useEffect(() => { window.haru?.settings.get('ai.config').then(saved => { if (saved) setProviderConfig(current => ({ ...current, ...(saved as Partial<ProviderConfig>) })); }); }, []);
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
  // Re-picking the same reaction is ignored rather than toggled off, so a stray
  // second click cannot silently withdraw feedback or fire another retort.
  function react(id: string, reaction: Reaction) {
    const target = messages.find(message => message.id === id);
    if (!target || target.reaction === reaction) return;
    setMessages(current => current.map(message => message.id === id ? { ...message, reaction } : message));
    // The mood shifts before the quip is written, so a thumbs-up that tips her
    // into coasting is already reflected in what she says about it.
    void window.haru?.mood.react(reaction).then(() => answerBack(reaction, target.content));
    if (!window.haru) answerBack(reaction, target.content);
  }

  // The rating lands immediately and her comeback follows a beat later, since it
  // is written fresh against the reply you rated. The canned lines stay as a
  // fallback for when the model is unreachable.
  async function answerBack(reaction: Reaction, rated: string) {
    let content = '';
    try {
      if (window.haru) content = await (reaction === 'down' ? window.haru.ai.retort(rated, providerConfig) : window.haru.ai.gloat(rated, providerConfig));
    } catch {
      // Falls through to a canned line below.
    }
    const fallback = reaction === 'down' ? randomRetort() : randomGloat();
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant' as const, content: content || fallback, time: 'now' }]);
  }

  async function send(content: string) {
    const epoch = conversation.current;
    const target = replyingTo;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content, time: 'now', ...(target ? { replyTo: target } : {}) };
    setMessages(current => [...current, user]);
    setReplyingTo(null);
    setSending(true);
    try {
      // The reference travels as its own note rather than being spliced into
      // what was typed, so the message stays the user's own words and the model
      // is told plainly that this is feedback about one particular line.
      const note: Message[] = target ? [{
        id: `${user.id}-ref`, role: 'system', time: 'now',
        content: `The user's next message is a reply to one specific earlier line of yours: "${target.excerpt}". It is feedback about that line in particular, not a new topic. Take it as a correction and say what you will do differently.`,
      }] : [];
      const reply = await getProvider(providerConfig).send([...messages, ...note, user], providerConfig);
      if (conversation.current !== epoch) return;
      // She has stopped answering. Marked rather than left blank so it reads as
      // her ignoring you, not as the app having dropped the message.
      setMessages(current => [...current, reply.ignored
        ? { id: crypto.randomUUID(), role: 'assistant', content: 'Haru is ignoring you.', time: 'now', ignored: true }
        : { id: crypto.randomUUID(), role: 'assistant', content: reply.content, time: 'now' }]);
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
  return <main className="haru-app"><Topbar characterOpen={drawer==='character'} profileOpen={drawer==='profile'} settingsOpen={drawer==='settings'} canStartNewChat={!!messages.length && !sending} onNewChat={newChat} onCharacter={() => setDrawer(drawer==='character'?null:'character')} onProfile={() => setDrawer(drawer==='profile'?null:'profile')} onSettings={() => setDrawer(drawer==='settings'?null:'settings')}/>{drawer === 'character' && <CharacterDrawer onClose={() => setDrawer(null)}/>} {drawer === 'profile' && <ProfileDrawer onClose={() => setDrawer(null)}/>} {drawer === 'settings' && <SettingsDrawer config={providerConfig} onSave={saveProviderConfig} onTest={testConnection} onClose={() => setDrawer(null)}/>}<div className="haru-body"><section className="chat-panel"><div className="messages" ref={messagesRef}>{empty ? <div className="empty-state"><MessageBubble message={greeting}/><p>Anything that sounds like a task or an appointment gets captured for real — not just talked about.</p><div className="suggestions"><Suggestion onClick={() => send('Set me a reminder for 8am to take my medication')}>Set a reminder for 8am</Suggestion><Suggestion onClick={() => send('Dentist Thursday at 10, lasts an hour')}>Dentist Thursday at 10</Suggestion><Suggestion onClick={() => send('What have I got coming up?')}>What have I got coming up?</Suggestion></div></div> : messages.map(message => <MessageBubble key={message.id} message={message} onReact={reaction => react(message.id, reaction)} onReply={() => setReplyingTo({ id: message.id, excerpt: message.content.replace(/\s+/g, ' ').trim().slice(0, 80) })}/>)}</div><Composer sending={sending} replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} onSend={send}/></section><Kept items={kept} onToggle={id => { window.haru ? window.haru.kept.toggle(id) : setKept(items => items.map(item => item.id===id ? {...item, done: !item.done} : item)); }} model={live2dModel} importing={importing} onImport={importLive2d} onRemove={removeLive2d}/></div></main>;
}
