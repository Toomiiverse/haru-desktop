import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, Paperclip } from 'lucide-react';
import { Composer, MessageBubble } from './components';
import { readStudyPreferences, studyMessages, studyPrompt, STUDY_MODES, type StudyMode, type StudyPreferences } from './study';
import type { Attachment, Message, Reaction } from './types';
import './study.css';

interface StudyPageProps {
  className?: string;
  active: boolean;
  messages: Message[];
  hydrated: boolean;
  sending: boolean;
  staged: Attachment[];
  onStage(files: Attachment[]): void;
  onUnstage(file: Attachment): void;
  onSend(content: string): Promise<boolean>;
  onReact(id: string, reaction: Reaction): void;
}

export function StudyPage({ className = '', active, messages, hydrated, sending, staged, onStage, onUnstage, onSend, onReact }: StudyPageProps) {
  const [preferences, setPreferences] = useState(() => {
    try { return readStudyPreferences(JSON.parse(localStorage.getItem('haru.study') || 'null')); }
    catch { return readStudyPreferences(null); }
  });
  const current = useRef(preferences);
  function update(next: Partial<StudyPreferences>) {
    current.current = { ...current.current, ...next };
    setPreferences(current.current);
    try { localStorage.setItem('haru.study', JSON.stringify(current.current)); } catch { /* The workspace remains usable when storage is full. */ }
  }
  const { mode, topic, draft } = preferences;
  const activity = STUDY_MODES[mode];
  const turns = useMemo(() => studyMessages(messages), [messages]);
  const materials = [...new Map(messages.flatMap(turn => turn.attachments || []).map(file => [file.id, file])).values()];
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = transcript.current; if (el && active) el.scrollTop = el.scrollHeight; }, [turns, sending, active]);

  async function send(text: string) {
    if (sending || !hydrated) return;
    setError('');
    if (text === current.current.draft) update({ draft: '' });
    const ok = await onSend(studyPrompt(mode, topic, text, staged.length > 0 || materials.length > 0));
    if (!ok) {
      if (text && !current.current.draft) update({ draft: text });
      setError('Could not confirm the reply. Your materials are kept. Check Chat before retrying in case the message arrived.');
    }
  }
  async function attach(paths?: string[]) {
    if (!window.haru) { setError('Open Haru desktop to attach your materials.'); return; }
    try {
      const files = paths ? await window.haru.attachments.stageFiles(paths) : await window.haru.attachments.pick('any');
      onStage(files);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not attach these files.'); }
  }

  return <section hidden={!active} className={`study-page ${className}${dragging ? ' dropping' : ''}`} aria-label="Study workspace"
    onDragOver={event => { event.preventDefault(); setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => {
      event.preventDefault(); setDragging(false);
      const paths = [...event.dataTransfer.files].map(file => window.haru?.attachments.pathFor(file) || '').filter(Boolean);
      if (paths.length) void attach(paths);
    }}>
    <aside className="study-tools" aria-label="Study setup">
      <header className="study-heading"><BookOpen size={25} aria-hidden="true"/><h1>Study with Haru</h1></header>
      <label className="study-topic">What are we studying?
        <input value={topic} maxLength={240} placeholder="Course, chapter or concept" disabled={sending} onChange={event => update({ topic: event.target.value })}/>
      </label>
      <fieldset className="study-modes" disabled={sending}><legend>How would you like to learn?</legend>
        {(Object.entries(STUDY_MODES) as [StudyMode, typeof activity][]).map(([key, option]) => <label key={key} className={mode === key ? 'study-mode selected' : 'study-mode'}>
          <input type="radio" name="study-mode" value={key} checked={mode === key} onChange={() => update({ mode: key })}/>
          <span><strong>{option.label}</strong><small>{option.hint}</small></span>
        </label>)}
      </fieldset>
      <section className="study-materials" aria-label="Study materials"><h2>Materials <span>{materials.length + staged.length}</span></h2>
        <button className="study-attach" onClick={() => void attach()} disabled={sending}><Paperclip size={16}/> Add materials</button>
        <p>Drop PDFs, notes or screenshots here. Up to six files per message.</p>
        {materials.length > 0 && <ul>{materials.map(file => <li key={file.id} title={file.name}><FileText size={14} aria-hidden="true"/><span>{file.name}</span></li>)}</ul>}
        {staged.length > 0 && <p>{staged.length} ready to send below.</p>}
      </section>
      <p className="study-shared">Study exchanges also appear in Chat. Your topic and draft stay on this desktop.</p>
    </aside>
    <section className="study-conversation" aria-label="Study conversation">
      <header className="study-session"><div><span className="study-eyebrow">{activity.label}</span><h2>{topic.trim() || 'Your next small breakthrough'}</h2></div>
        <button className="study-start" disabled={sending || !hydrated || (!topic.trim() && !draft.trim() && !staged.length && !materials.length && !turns.length)} onClick={() => void send(draft)}>{activity.action}</button>
      </header>
      <div className="messages study-messages" ref={transcript} aria-busy={!hydrated || sending}>
        {!hydrated ? <div className="study-skeleton" role="status" aria-label="Loading study conversation"><span/><span/><span/></div>
          : turns.length ? turns.map(message => <MessageBubble key={message.id} message={message} onReact={reaction => onReact(message.id, reaction)}/>)
          : <div className="study-empty"><BookOpen size={36} aria-hidden="true"/><h2>Bring something you want to understand.</h2><p>Add your course materials or name a topic, then choose how you want to learn. You can also ask a question below.</p><div className="study-example">Try “Help me understand the first topic in these notes.”</div></div>}
        {sending && <p className="study-progress" role="status">Haru is working through your study request…</p>}
      </div>
      {error && <p className="study-error" role="alert">{error}</p>}
      {active && <Composer sending={sending || !hydrated} draft={draft} onDraftChange={value => update({ draft: value })} placeholder="Ask a question, answer Haru, or paste your notes…" waitingText="Working through your study request…" onSend={text => void send(text)} staged={staged} onStage={onStage} onUnstage={onUnstage}/>}
    </section>
  </section>;
}
