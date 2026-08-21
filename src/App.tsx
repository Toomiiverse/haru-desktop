import { useCallback, useEffect, useRef, useState } from 'react';
import { AsidesPage, JournalDrawer, CharacterDrawer, Composer, Kept, MessageBubble, ProfileDrawer, SettingsDrawer, Suggestion, Topbar, WardrobeDrawer } from './components';
import { getProvider, testConnection } from './services/ai';
import { randomGloat, randomRetort } from './retorts';
import type { KeptItem, Message, ProviderConfig, Reaction } from './types';

const greeting: Message = { id: 'greeting', role: 'assistant', time: 'now', content: "Hey! About time you showed up. We’ve got work to do. Move it!" };
const defaultProviderConfig: ProviderConfig = { provider: 'ollama', model: 'qwen2.5:14b', endpoint: 'http://localhost:11434', temperature: 0.7 };

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]); const [hydrated, setHydrated] = useState(false); const [kept, setKept] = useState<KeptItem[]>([]); const [sending, setSending] = useState(false); const [page, setPage] = useState<'chat'|'asides'|'character'|'profile'|'settings'|'journal'>('chat'); const [wardrobeOpen, setWardrobeOpen] = useState(false); const [live2dModel, setLive2dModel] = useState<{name: string; path: string; url: string} | null>(null); const [importing, setImporting] = useState(false); const [providerConfig, setProviderConfig] = useState<ProviderConfig>(defaultProviderConfig); const [replyingTo, setReplyingTo] = useState<{ id: string; excerpt: string } | null>(null);
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
  // Asking her to change her outfit makes her call show_wardrobe, which lands
  // here. The panel opens alongside whatever she says about being asked.
  // Still an overlay, and deliberately the only one left. She opens this herself
  // mid-conversation; navigating the user off the chat page because she decided
  // to show them a hat would take the reply they were reading away with it.
  useEffect(() => window.haru?.wardrobe.onOpen(() => setWardrobeOpen(true)), []);
  // A voice that failed is otherwise pure silence: the line is already on
  // screen, so nothing distinguishes the server timing out from her simply
  // choosing not to speak.
  useEffect(() => window.haru?.chat.onVoiceFailed(why => {
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'system' as const, content: why, time: 'now', at: new Date().toISOString() }]);
  }), []);
  // The far model going quiet is otherwise invisible: she carries on answering,
  // several times slower, and nothing on screen says the pod is off.
  useEffect(() => window.haru?.chat.onFellBack(why => {
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'system' as const, content: why, time: 'now', at: new Date().toISOString() }]);
  }), []);
  // A conversation held on the phone is the same conversation, so it lands here
  // too — otherwise coming back to the desk means finding her half of an
  // exchange missing, and her remembering things that were never said on screen.
  useEffect(() => window.haru?.chat.onFromPhone(turn => {
    setMessages(current => [
      ...current,
      { id: crypto.randomUUID(), role: 'user' as const, content: turn.text, time: 'now', at: new Date().toISOString() },
      ...(turn.ignored ? [] : [{ id: crypto.randomUUID(), role: 'assistant' as const, content: turn.reply, time: 'now', at: new Date().toISOString() }]),
    ]);
  }), []);
  // What is left on this channel is only the handful of lines that belong to an
  // exchange the user started — "hold on, I'm looking at it" while she opens an
  // attachment they asked about. Everything she says off her own back goes to
  // the Asides tab instead: see electron/asides.ts for why, and note that the
  // split is made in main, so nothing unprompted can arrive here to be appended.
  useEffect(() => window.haru?.chat.onInterject(line => {
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant' as const, content: line, time: 'now', at: new Date().toISOString() }]);
  }), []);
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
  // She opens rather than waiting to be spoken to — on launch, and again whenever
  // the conversation is cleared. Main decides whether a line is warranted at all
  // and returns null when it is not, so the rule about how often she speaks up
  // lives with the rest of her behaviour rather than in the view.
  // Which conversation has already been opened. Without this StrictMode's double
  // mount asks twice, and because main shares one in-flight request both callers
  // resolve with the same line and both append it — she says it once out loud and
  // twice on screen. Deduping the generation was not enough; the append needed it too.
  const openedEpoch = useRef(-1);
  const askForOpening = useCallback(() => {
    if (!window.haru) return;
    const epoch = conversation.current;
    if (openedEpoch.current === epoch) return;
    openedEpoch.current = epoch;
    void window.haru.chat.opening().then(line => {
      // A conversation cleared while the line was being written is no longer the
      // one it was written for.
      if (!line || conversation.current !== epoch) return;
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant' as const, content: line, time: 'now', at: new Date().toISOString() }]);
    });
  }, []);

  useEffect(() => {
    if (!window.haru) { setHydrated(true); return; }
    window.haru.chat.getMessages().then(saved => { setMessages(saved); setHydrated(true); askForOpening(); });
    return window.haru.chat.onReset(() => { conversation.current++; setMessages([]); askForOpening(); });
  }, [askForOpening]);
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
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant' as const, content: content || fallback, time: 'now', at: new Date().toISOString() }]);
  }

  async function send(content: string, heard?: string) {
    const epoch = conversation.current;
    const target = replyingTo;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content, time: 'now', at: new Date().toISOString(), ...(heard ? { heard } : {}), ...(target ? { replyTo: target } : {}) };
    setMessages(current => [...current, user]);
    setReplyingTo(null);
    setSending(true);
    try {
      // The reference travels as its own note rather than being spliced into
      // what was typed, so the message stays the user's own words and the model
      // is told plainly that this is feedback about one particular line.
      const note: Message[] = target ? [{
        id: `${user.id}-ref`, role: 'system', time: 'now', at: new Date().toISOString(),
        content: `The user's next message is a reply to one specific earlier line of yours: "${target.excerpt}". It is feedback about that line in particular, not a new topic. Take it as a correction and say what you will do differently.`,
      }] : [];
      const reply = await getProvider(providerConfig).send([...messages, ...note, user], providerConfig);
      if (conversation.current !== epoch) return;
      // She has stopped answering. Marked rather than left blank so it reads as
      // her ignoring you, not as the app having dropped the message.
      setMessages(current => [...current, reply.ignored
        ? { id: crypto.randomUUID(), role: 'assistant', content: 'Haru is ignoring you.', time: 'now', at: new Date().toISOString(), ignored: true }
        : { id: crypto.randomUUID(), role: 'assistant', content: reply.content, time: 'now', at: new Date().toISOString() }]);
    } catch (error) {
      if (conversation.current !== epoch) return;
      // Electron prefixes anything thrown across IPC; it means nothing here and
      // pushes the part that matters off the end of the line.
      const detail = (error instanceof Error ? error.message : String(error))
        .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
      // The main process names whichever model actually answered, which is not
      // always the configured one — a question can be escalated to the remote
      // model mid-turn, and blaming the local one sent people to check a setting
      // that was never involved. Only fall back to the configured provider when
      // the failure happened before a model was ever chosen.
      const attributed = / at \S+ —/.test(detail);
      setMessages(current => [...current, {
        id: crypto.randomUUID(), role: 'assistant', time: 'now', at: new Date().toISOString(),
        content: attributed ? `Couldn't get an answer — ${detail}` : `Couldn't reach ${providerConfig.provider} (${detail}). Check Setup → Where she thinks.`,
      }]);
    } finally {
      setSending(false);
    }
  }
  const empty = !messages.length;
  // Her opening line is a real message, so the conversation stops being empty the
  // moment she speaks. The starters are still worth offering at that point —
  // they are what explains that saying something is enough to get it saved.
  const onlyOpening = messages.length === 1 && messages[0].role === 'assistant';
  const suggestions = <div className="suggestions"><Suggestion onClick={() => send('Set me a reminder for 8am to take my medication')}>Set a reminder for 8am</Suggestion><Suggestion onClick={() => send('Dentist Thursday at 10, lasts an hour')}>Dentist Thursday at 10</Suggestion><Suggestion onClick={() => send('What have I got coming up?')}>What have I got coming up?</Suggestion></div>;
  async function importLive2d() { if (!window.haru?.live2d) { alert('Live2D import is available in the desktop app.'); return; } setImporting(true); try { const model = await window.haru.live2d.import(); if (model) setLive2dModel(model); } finally { setImporting(false); } }
  async function removeLive2d() { await window.haru?.live2d.remove(); setLive2dModel(null); }
  const backToChat = () => setPage('chat');
  // Told on every change; main decides whether it is worth saying anything, and
  // nearly always decides it is not. Kept here rather than inside setPage's
  // callers so a page reached any other way still counts as arriving there.
  useEffect(() => { void window.haru?.ui.page(page); }, [page]);
  return <main className="haru-app"><Topbar page={page} onNavigate={setPage} canStartNewChat={!!messages.length && !sending} onNewChat={newChat}/>
    {wardrobeOpen && <WardrobeDrawer onClose={() => setWardrobeOpen(false)}/>}
    {page === 'character' && <CharacterDrawer onClose={backToChat}/>}
    {page === 'profile' && <ProfileDrawer onClose={backToChat}/>}
    {page === 'settings' && <SettingsDrawer config={providerConfig} onSave={saveProviderConfig} onTest={testConnection} onClose={backToChat}/>}
    {page === 'journal' && <JournalDrawer onClose={backToChat}/>}
    {page === 'asides' && <AsidesPage/>}
    {page === 'chat' && <div className="haru-body"><section className="chat-panel"><div className="messages" ref={messagesRef}>{empty ? <div className="empty-state"><MessageBubble message={greeting}/><p>Anything that sounds like a task or an appointment gets captured for real — not just talked about.</p>{suggestions}</div> : <>{messages.map(message => <MessageBubble key={message.id} message={message} onReact={reaction => react(message.id, reaction)} onReply={() => setReplyingTo({ id: message.id, excerpt: message.content.replace(/\s+/g, ' ').trim().slice(0, 80) })}/>)}{onlyOpening && <div className="empty-state">{suggestions}</div>}</>}</div><Composer sending={sending} replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} onSend={send} onShowPicture={(reaction, saved) => setMessages(current => [...current,
        // The picture itself goes in as theirs, so there is a record of having
        // shown it even when she says nothing back — which is the normal case.
        { id: crypto.randomUUID(), role: 'user' as const, content: `Showed her ${saved.replace(/^.*[\/]/, '')}`, time: 'now', at: new Date().toISOString() },
        ...(reaction ? [{ id: crypto.randomUUID(), role: 'assistant' as const, content: reaction, time: 'now', at: new Date().toISOString() }] : []),
      ])}/></section><Kept items={kept} onToggle={id => { window.haru ? window.haru.kept.toggle(id) : setKept(items => items.map(item => item.id===id ? {...item, done: !item.done} : item)); }} model={live2dModel} importing={importing} onImport={importLive2d} onRemove={removeLive2d}/></div>}
  </main>;
}
