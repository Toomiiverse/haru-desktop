import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Paperclip, MicOff, CalendarDays, Check, ChevronDown, CornerDownRight, Mic, Reply, SquareCheck, ChevronLeft, ChevronRight, CircleDot, Import, MessageSquarePlus, Plus, NotebookPen, MessageSquare, Square, ImagePlus, Sparkles, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import type { AniListConfig, Character, DesktopConfig, GamingConfig, ScreenshotConfig, WatchingConfig, VisionConfig, HaruNote, JournalConfig, JournalEntry, JournalField, JournalRange, JournalStats, JournalFieldStats, RoamConfig, EmotionName, GoogleStatus, KeptItem, ListenConfig, Memory, MemoryKind, Message, Profile, ProviderConfig, Reaction, SearchConfig, SessionSummary, VoiceConfig, VoiceEngine, VoiceReference, WardrobeControl, WebStatus } from './types';
import { buildMonthGrid, datesInView, dayLabel, rangeLabel, shiftISODate, toISODate, weekOf, type CalendarView } from './date';
import { startListening, startRecording, type Listener, type Recorder } from './companion/microphone';
import { isUsableFollowUp, matchWake, readsAsFarewell } from './companion/wake';
import { chimeListening, chimeStoppedListening, setChimeVolume } from './companion/chime';
export class StageFailureBoundary extends Component<{ children: ReactNode; onError(message: string): void }, { failed: boolean }> { state = { failed: false }; componentDidCatch(error: Error) { this.props.onError(error.message || 'Haru could not start the Live2D renderer.'); } render() { return this.state.failed ? null : this.props.children; } static getDerivedStateFromError() { return { failed: true }; } }

export type Page = 'chat' | 'character' | 'profile' | 'settings' | 'journal';

// Chat is a tab like the rest rather than the thing the others cover up. That is
// the whole difference between a panel that slides over your conversation and a
// set of pages you move between: somewhere to go back to that is named.
const TABS: { page: Page; label: string; icon?: typeof NotebookPen }[] = [
  { page: 'chat', label: 'Chat', icon: MessageSquare },
  { page: 'journal', label: 'Journal', icon: NotebookPen },
  { page: 'profile', label: 'You' },
  { page: 'character', label: 'Character' },
  { page: 'settings', label: 'Setup' },
];

export function Topbar({ page, onNavigate, canStartNewChat, onNewChat }: { page: Page; onNavigate(page: Page): void; canStartNewChat: boolean; onNewChat(): void }) {
  return <header className="topbar">
    <div className="wordmark">はる <span>· Haru</span></div>
    <div className="connection"><i/><span>local companion</span></div>
    <nav className="tabs" role="tablist">
      {TABS.map(tab => {
        const Icon = tab.icon;
        return <button key={tab.page} role="tab" aria-selected={page === tab.page}
          className={page === tab.page ? 'tab selected' : 'tab'} onClick={() => onNavigate(tab.page)}>
          {Icon && <Icon size={13}/>} {tab.label}
        </button>;
      })}
    </nav>
    <div className="top-actions">
      {/* Only on the chat page: archiving a conversation from inside the journal
          is an action with no visible effect, which is how you press it twice. */}
      {page === 'chat' && <button className="pill" onClick={onNewChat} disabled={!canStartNewChat} title="Archive this conversation and start fresh"><MessageSquarePlus size={13}/> New chat</button>}
    </div>
  </header>;
}

// Grouped because an undifferentiated list reads as trivia, while "how they like
// things" is the part that actually shapes how she talks.
const MEMORY_GROUPS: [MemoryKind, string][] = [
  ['preference', 'How you like things'],
  ['relationship', 'People and pets'],
  ['event', 'What’s going on'],
  ['fact', 'Other things'],
];

const SCALE_MAX = 10;

/**
 * A face per rating, five steps across the scale.
 *
 * Kaomoji rather than icons: the app already wears its Japanese on its sleeve
 * (はる in the corner), they carry far more expression per character than a
 * line-art face, and they cost nothing to render or animate. Anxiety runs the
 * other way — its bad end is the top of the scale — so it gets its own row
 * rather than a reversed lookup, which would be unreadable a month from now.
 */
const FACES: Record<'mood' | 'anxiety' | 'energy' | 'sleep', string[]> = {
  mood:    ['(╥﹏╥)', '(・_・;)', '(・_・)', '(◕‿◕)', '(★ω★)'],
  anxiety: ['(－ω－)', '(・_・)', '(・_・;)', '(°ロ°)', '(ﾉ˚Д˚)ﾉ'],
  energy:  ['(_ _).zZ', '(－_－)', '(・_・)', '(๑>ᴗ<๑)', '(ﾉ>ω<)ﾉ'],
  sleep:   ['(×_×)', '(－_－)', '(・_・)', '(￣ω￣)', '(´｡• ω •｡`)'],
};

const RATINGS: { key: 'mood' | 'anxiety' | 'energy' | 'sleep'; label: string; low: string; high: string; inverted?: boolean }[] = [
  { key: 'mood', label: 'Mood', low: 'awful', high: 'great' },
  { key: 'anxiety', label: 'Anxiety', low: 'calm', high: 'awful', inverted: true },
  { key: 'energy', label: 'Energy', low: 'empty', high: 'full' },
  { key: 'sleep', label: 'Slept', low: 'badly', high: 'well' },
];

function faceFor(key: keyof typeof FACES, value: number | undefined) {
  if (value === undefined) return '( ˘_˘ )';
  return FACES[key][Math.min(4, Math.floor((value / SCALE_MAX) * 4.999))];
}

/**
 * Five steps, named, the way the concept's check-in does it.
 *
 * The store keeps 0–10 and always will — the charts, averages and the thresholds
 * she reacts to are all built on it — so these are five points on that scale
 * rather than a different scale. Picking beats dragging for this: a slider asks
 * you to decide whether today is a 6 or a 7, which is a question nobody can
 * answer honestly, while five named faces ask something you actually know.
 */
const STEPS = [1, 3, 5, 7, 9];

const WORDS: Record<'mood' | 'anxiety' | 'energy' | 'sleep', string[]> = {
  mood:    ['Really struggling', 'Low', 'Okay', 'Good', 'Amazing'],
  anxiety: ['Calm', 'Settled', 'Tense', 'Anxious', 'Overwhelmed'],
  energy:  ['Empty', 'Low', 'Okay', 'Good', 'Buzzing'],
  sleep:   ['Terrible', 'Poor', 'Okay', 'Good', 'Great'],
};

/** Which of the five a stored 0–10 belongs to. */
function stepOf(value: number | undefined) {
  if (value === undefined) return -1;
  let best = 0;
  for (let i = 1; i < STEPS.length; i++) if (Math.abs(STEPS[i] - value) < Math.abs(STEPS[best] - value)) best = i;
  return best;
}

function CheckInRow({ field, value, onChange }: { field: typeof RATINGS[number]; value: number | undefined; onChange(value: number | undefined): void }) {
  const chosen = stepOf(value);
  return <div className="checkin-row">
    <div className="checkin-head">
      <span className="rating-label">{field.label}</span>
      {chosen >= 0 && <span className="checkin-word">{WORDS[field.key][chosen]}</span>}
      <button className="rating-clear" title="Leave this one unanswered" onClick={() => onChange(undefined)} disabled={value === undefined}>×</button>
    </div>
    <div className="checkin-faces" role="radiogroup" aria-label={field.label}>
      {STEPS.map((step, index) => {
        const picked = chosen === index;
        return <button key={step} type="button" role="radio" aria-checked={picked}
          aria-label={`${field.label}: ${WORDS[field.key][index]}`}
          title={WORDS[field.key][index]}
          className={`checkin-face${picked ? ' picked' : ''}${field.inverted ? ' inverted' : ''}`}
          onClick={() => onChange(step)}>
          <span className="checkin-kao">{FACES[field.key][index]}</span>
          <em>{WORDS[field.key][index]}</em>
        </button>;
      })}
    </div>
  </div>;
}

function RatingRow({ field, value, onChange }: { field: typeof RATINGS[number]; value: number | undefined; onChange(value: number | undefined): void }) {
  // Keyed on the face so React remounts the span whenever it changes, which is
  // what restarts the pop animation. Keying on the number would fire it on every
  // step of a drag, which reads as a twitch rather than a reaction.
  const face = faceFor(field.key, value);
  return <div className="rating-row">
    <span className="rating-label">{field.label}</span>
    <span key={face} className={field.inverted ? 'rating-face inverted' : 'rating-face'}>{face}</span>
    <input type="range" min={0} max={SCALE_MAX} step={1} value={value ?? 5}
      className={field.inverted ? 'inverted' : ''}
      aria-label={`${field.label}, ${value ?? 'not answered'} out of ${SCALE_MAX}`}
      onChange={event => onChange(Number(event.target.value))}/>
    <span className={value === undefined ? 'rating-value muted' : 'rating-value'}>{value === undefined ? '–' : value}<em>/{SCALE_MAX}</em></span>
    <button className="rating-clear" title="Leave this one unanswered" onClick={() => onChange(undefined)} disabled={value === undefined}>×</button>
    <span className="rating-ends">{field.low} → {field.high}</span>
  </div>;
}

const RANGE_LABELS: { range: JournalRange; label: string }[] = [
  { range: 'week', label: 'Week' },
  { range: 'fortnight', label: 'Fortnight' },
  { range: 'month', label: 'Month' },
];

/**
 * Mood and anxiety over the window, as bars on a shared baseline.
 *
 * Every day in the range gets a slot whether or not it was written, so gaps read
 * as gaps. A chart drawn only from entries would join three scattered days into
 * a confident line and quietly misrepresent how often someone wrote.
 */
function JournalChart({ stats, field, inverted }: { stats: JournalStats; field: JournalField; inverted?: boolean }) {
  const width = 100;
  const gap = stats.series.length > 20 ? 0.6 : 1.4;
  const slot = width / stats.series.length;
  return <svg className="journal-chart" viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" role="img"
    aria-label={`${field} across ${stats.days} days`}>
    {[10, 20, 30].map(y => <line key={y} x1="0" x2={width} y1={y} y2={y} className="grid"/>)}
    {stats.series.map((point, index) => {
      const value = point[field];
      const height = value === undefined ? 0 : Math.max(1.2, (value / SCALE_MAX) * 36);
      return <rect key={point.date} x={index * slot + gap / 2} width={Math.max(0.8, slot - gap)}
        y={40 - height} height={height || 1}
        className={value === undefined ? 'bar missing' : inverted ? 'bar inverted' : 'bar'}>
        <title>{`${point.date}: ${value ?? 'nothing recorded'}`}</title>
      </rect>;
    })}
  </svg>;
}

function StatBlock({ label, stats, inverted }: { label: string; stats?: JournalFieldStats; inverted?: boolean }) {
  if (!stats?.rated) return <div className="stat empty"><span className="stat-label">{label}</span><span className="stat-none">not tracked</span></div>;
  // For anxiety a fall is the good direction, so the arrow's meaning is flipped
  // rather than its colour being reused to mean the opposite thing.
  const rising = (stats.change ?? 0) > 0.35;
  const falling = (stats.change ?? 0) < -0.35;
  const good = inverted ? falling : rising;
  const bad = inverted ? rising : falling;
  return <div className="stat">
    <span className="stat-label">{label}</span>
    <span className="stat-avg">{stats.average!.toFixed(1)}<em>/{SCALE_MAX}</em></span>
    <span className="stat-range">{stats.lowest}–{stats.highest} · {stats.rated} day{stats.rated === 1 ? '' : 's'}</span>
    {(good || bad) && <span className={good ? 'stat-change good' : 'stat-change bad'}>{rising ? '▲' : '▼'} {Math.abs(stats.change!).toFixed(1)}</span>}
  </div>;
}

/** Debounce, so typing saves itself without a write on every keystroke. */
const AUTOSAVE_MS = 900;

export function JournalDrawer({ onClose }: { onClose(): void }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [config, setConfig] = useState<JournalConfig | null>(null);
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [note, setNote] = useState<HaruNote | null>(null);
  const [range, setRange] = useState<JournalRange>('fortnight');
  const [text, setText] = useState('');
  const [ratings, setRatings] = useState<Partial<Record<JournalField, number>>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loaded, setLoaded] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  // Nothing is written until the first real edit, so opening the page and
  // leaving does not create an empty entry and quietly start a "streak".
  const touched = useRef(false);

  const refresh = useCallback(async () => {
    if (!window.haru) return;
    const [list, s, n] = await Promise.all([window.haru.journal.list(), window.haru.journal.stats(range), window.haru.journal.note()]);
    setEntries(list); setStats(s); setNote(n);
  }, [range]);

  useEffect(() => {
    if (!window.haru) { setLoaded(true); return; }
    void window.haru.journal.getConfig().then(setConfig);
    void window.haru.journal.list().then(list => {
      const todays = list.find(entry => entry.date === today);
      if (todays) { setText(todays.text); setRatings({ mood: todays.mood, anxiety: todays.anxiety, energy: todays.energy, sleep: todays.sleep }); }
      setLoaded(true);
    });
    return window.haru.journal.onChange(() => { void refresh(); });
  }, [today, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Autosave. Switching tabs used to lose whatever was half-typed, because the
  // page unmounts and the only way to keep anything was to have pressed a
  // button — which is a poor bargain for a diary.
  useEffect(() => {
    if (!touched.current || !window.haru) return;
    setStatus('saving');
    const timer = setTimeout(() => {
      void window.haru!.journal.save({ date: today, text, ...ratings }).then(() => {
        setStatus('saved');
        void refresh();
      });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [text, ratings, today, refresh]);

  const edit = (change: () => void) => { touched.current = true; change(); };
  const past = entries.filter(entry => entry.date !== today);
  const todaysEntry = entries.find(entry => entry.date === today);

  return <section className="page journal">
    <div className="journal-main">
      <div className="field">
        <h2>Today</h2>
        <p>How the day went and how you are feeling. Saves itself as you type — she can add to it when you tell her about your day, but she never reads it back to you.</p>
        <textarea className="journal-text" rows={7} value={text} placeholder="However much or little you want. It does not have to be tidy."
          onChange={event => edit(() => setText(event.target.value))}/>
        <p className="checkin-ask">How are you feeling today?</p>
        <div className="ratings">
          {RATINGS.map(field => <CheckInRow key={field.key} field={field} value={ratings[field.key]}
            onChange={value => edit(() => setRatings(current => ({ ...current, [field.key]: value })))}/>)}
        </div>
        <p className={status === 'saved' ? 'autosave saved' : 'autosave'}>
          {status === 'saving' ? 'Saving…' : status === 'saved' ? <><Check size={12}/> Saved automatically</> : 'Saves automatically'}
        </p>
      </div>

      {stats && <div className="field">
        <div className="chart-head">
          <h2>How it has been going</h2>
          <div className="range-tabs">
            {RANGE_LABELS.map(option => <button key={option.range}
              className={range === option.range ? 'range selected' : 'range'}
              onClick={() => setRange(option.range)}>{option.label}</button>)}
          </div>
        </div>
        <p className="status-note">{stats.written} of the last {stats.days} days written{stats.streak > 0 && `, ${stats.streak} in a row right now`}.</p>
        <div className="stat-grid">
          <StatBlock label="Mood" stats={stats.fields.mood}/>
          <StatBlock label="Anxiety" stats={stats.fields.anxiety} inverted/>
          <StatBlock label="Energy" stats={stats.fields.energy}/>
          <StatBlock label="Slept" stats={stats.fields.sleep}/>
        </div>
        <div className="chart-row"><span className="rating-label">Mood</span><JournalChart stats={stats} field="mood"/></div>
        <div className="chart-row"><span className="rating-label">Anxiety</span><JournalChart stats={stats} field="anxiety" inverted/></div>
        <p className="status-note">Self-rated numbers, nothing more — no score, no interpretation. Gaps are days with nothing recorded.</p>
      </div>}

      <div className="field">
        <h2>Everything else{past.length > 0 && <span className="kept-count">{past.length}</span>}</h2>
        {loaded && !entries.length && <p className="status-note">Nothing written yet. She will ask once in the evening if you let her, or you can just type here whenever.</p>}
        {past.map(entry => <article key={entry.id} className="journal-entry">
          <header>
            <strong>{new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
            <span className="journal-marks">
              {entry.mood !== undefined && <em title="Mood">{faceFor('mood', entry.mood)} {entry.mood}</em>}
              {entry.anxiety !== undefined && <em title="Anxiety" className="inverted">{faceFor('anxiety', entry.anxiety)} {entry.anxiety}</em>}
              {entry.prompted && <em title="She asked for this one">asked</em>}
            </span>
            <button className="remove-model" onClick={() => window.haru?.journal.remove(entry.id).then(() => void refresh())}><Trash2 size={12}/></button>
          </header>
          {entry.text && <p>{entry.text}</p>}
        </article>)}
      </div>

      {config && <div className="field">
        <h2>How she asks</h2>
        <label className="check-row">
          <input type="checkbox" checked={config.enabled} onChange={event => window.haru?.journal.setConfig({ ...config, enabled: event.target.checked }).then(setConfig)}/>
          <span>Keep a journal</span>
        </label>
        {config.enabled && <>
          <label className="check-row">
            <input type="checkbox" checked={config.askUnprompted} onChange={event => window.haru?.journal.setConfig({ ...config, askUnprompted: event.target.checked }).then(setConfig)}/>
            <span>Let her ask once in the evening</span>
          </label>
          {config.askUnprompted && <div className="form-grid">
            <label className="stack"><span>Not before</span>
              <input type="range" min={12} max={23} step={1} value={config.askHour}
                onChange={event => window.haru?.journal.setConfig({ ...config, askHour: Number(event.target.value) }).then(setConfig)}/>
            </label>
            <span className="status-note">{config.askHour}:00. Once a day and no more — if you do not answer, she drops it until tomorrow.</span>
          </div>}
        </>}
      </div>}
    </div>

    {/* The column where the calendar sits on the chat page, so the two pages feel
        like the same app rather than two screens that happen to share a top bar. */}
    <aside className="journal-side">
      {note && <div className={`haru-note ${note.tone}`}>
        <span className="haru-note-face">{{ proud: '(๑˃ᴗ˂)ﻭ', pleased: '(◕‿◕)', watching: '(・_・)', grumpy: '(￣ヘ￣)' }[note.tone]}</span>
        <p>{note.text}</p>
      </div>}

      <div className="side-block">
        <h3>Today</h3>
        {todaysEntry ? <>
          <div className="today-faces">
            {RATINGS.filter(field => todaysEntry[field.key] !== undefined).map(field =>
              <span key={field.key} className="today-face" title={`${field.label} ${todaysEntry[field.key]}/${SCALE_MAX}`}>
                {faceFor(field.key, todaysEntry[field.key])}
                <em>{field.label} {todaysEntry[field.key]}</em>
              </span>)}
          </div>
          {todaysEntry.text
            ? <p className="today-text">{todaysEntry.text}</p>
            : <p className="status-note">Ratings only so far — nothing written down.</p>}
        </> : <p className="status-note">Nothing yet today.</p>}
      </div>

      {stats && <div className="side-block">
        <h3>Streak</h3>
        <p className="streak-count">{stats.streak}<em>{stats.streak === 1 ? 'day' : 'days'}</em></p>
        <p className="status-note">{stats.written} of the last {stats.days} days have something in them.</p>
      </div>}
    </aside>
  </section>;
}
export function ProfileDrawer({ onClose }: { onClose(): void }) {
  const [profile, setProfile] = useState<Profile>({ nickname: '', occupation: '', about: '' });
  const [memories, setMemories] = useState<Memory[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<MemoryKind>('preference');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!window.haru) return;
    window.haru.profile.get().then(current => { setProfile(current); setLoaded(true); });
    window.haru.memory.list().then(setMemories);
    window.haru.memory.sessions().then(setSessions);
    // Haru writes memories mid-conversation, so the list follows along rather
    // than going stale while the drawer sits open.
    return window.haru.memory.onChange(setMemories);
  }, []);

  async function save() {
    setProfile(await window.haru!.profile.set(profile));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function addMemory() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setMemories(await window.haru!.memory.add(text, draftKind));
  }

  const edit = (field: keyof Profile) => (event: { target: { value: string } }) => setProfile(current => ({ ...current, [field]: event.target.value }));
  if (!window.haru) return null;
  return <section className="page">
    <div className="field"><h2>About you</h2><p>Haru sees this in every conversation, so it can talk to you as a person it already knows.</p>
      <div className="form-grid"><input value={profile.nickname} disabled={!loaded} onChange={edit('nickname')} placeholder="What should Haru call you?"/><input value={profile.occupation} disabled={!loaded} onChange={edit('occupation')} placeholder="What do you do?"/></div>
      <textarea className="short" value={profile.about} disabled={!loaded} onChange={edit('about')} placeholder="Anything else worth knowing — how you like to be spoken to, what you're working on, who's in your life."/>
    </div>
    <div className="field"><h2>What Haru remembers{memories.length > 0 && <span className="kept-count">{memories.length}</span>}</h2>
      <p>Picked up as you chat. Anything raised repeatedly is marked, since she treats those as things you keep coming back to.</p>
      {memories.length === 0
        ? <p className="nothing">Nothing remembered yet.</p>
        : MEMORY_GROUPS.map(([kind, label]) => {
            const group = memories.filter(memory => memory.kind === kind);
            if (!group.length) return null;
            return <div key={kind} className="memory-group"><h3>{label}</h3>
              <ul className="memory-list">{group.map(memory => <li key={memory.id}>
                <span>{memory.text}{memory.subject && <em> · {memory.subject}</em>}</span>
                {memory.mentions >= 3 && <span className="recurring" title={`Mentioned ${memory.mentions} times`}>×{memory.mentions}</span>}
                <button className="remove-model" onClick={async () => setMemories(await window.haru!.memory.remove(memory.id))} aria-label={`Forget: ${memory.text}`}><Trash2 size={12}/></button>
              </li>)}</ul></div>;
          })}
      <div className="row-actions">
        <input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addMemory(); } }} placeholder="Add something yourself…"/>
        <select value={draftKind} onChange={event => setDraftKind(event.target.value as MemoryKind)}>{MEMORY_GROUPS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
        <button className="ghost" disabled={!draft.trim()} onClick={addMemory}>Add</button>
      </div>
    </div>
    <div className="field"><h2>Past conversations{sessions.length > 0 && <span className="kept-count">{sessions.length}</span>}</h2>
      <p>A line kept from each day, which is what lets her refer back to something you talked about before.</p>
      {sessions.length === 0
        ? <p className="nothing">Nothing from previous days yet — these are written when a conversation is archived.</p>
        : <ul className="memory-list">{sessions.slice().reverse().map(session => <li key={session.day}><span><b>{session.day}</b> — {session.summary}</span></li>)}</ul>}
    </div>
    <div className="drawer-foot">
      <button className="ghost" disabled={!memories.length} onClick={async () => setMemories(await window.haru!.memory.clear())}>Forget everything</button>
      {saved && <span className="saved"><Check size={13}/> Saved</span>}
      <button className="solid" disabled={!loaded} onClick={save}>Save profile</button>
    </div></section>;
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
  return <section className="page">
    <div className="field"><h2>Who Haru is</h2><p>This opens Haru’s prompt, so it shapes how she answers everywhere — chat, reminders and all.</p><textarea value={character.identity} disabled={!loaded} onChange={edit('identity')}/></div>
    <div className="field"><h2>Stay in character</h2><p>This instruction sits at the very end of the prompt, the last thing read before Haru replies.</p><textarea className="short" value={character.style} disabled={!loaded} onChange={edit('style')}/></div>
    <div className="drawer-foot">
      <button className="ghost" disabled={!loaded || busy} onClick={() => apply(() => window.haru!.character.reset())}>Reset to card</button>
      {saved && <span className="saved"><Check size={13}/> Saved</span>}
      <button className="solid" disabled={!loaded || busy} onClick={() => apply(() => window.haru!.character.set(character.identity, character.style))}>Save character</button>
    </div></section>;
}

/**
 * Which saved key an address will actually be sent — the same rule as keyFor()
 * in the main process, and it has to stay the same rule.
 *
 * This box used to be wired to one key regardless of what was typed above it, so
 * with a rented GPU in the endpoint field it reported "a key is saved" about
 * xAI's key, which is no longer sent there — and pasting the pod's token would
 * have overwritten the key Grok escalation runs on, breaking a working feature
 * to configure a different one.
 */
function keySlotFor(endpoint: string): 'xai' | 'openai' | 'self' {
  let host = '';
  try { host = new URL(endpoint.trim()).hostname.toLowerCase(); } catch { return 'self'; }
  if (/(^|\.)x\.ai$/.test(host)) return 'xai';
  if (/(^|\.)openai\.com$/.test(host)) return 'openai';
  return 'self';
}

const KEY_SLOT_NAME = { xai: 'xAI', openai: 'OpenAI', self: 'your own server' } as const;

export function SettingsDrawer({ config, onSave, onTest, onClose }: { config: ProviderConfig; onSave(config: ProviderConfig): void; onTest(endpoint: string, provider?: string): Promise<string[]>; onClose(): void }) {
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [model, setModel] = useState(config.model);
  const [status, setStatus] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ state: 'idle' });
  const [saved, setSaved] = useState(false);
  const [modelKey, setModelKey] = useState('');
  const [hasModelKey, setHasModelKey] = useState(false);
  // Follows the address as it is typed, so the box always describes the key that
  // endpoint would actually use.
  const slot = keySlotFor(endpoint);
  useEffect(() => {
    const haru = window.haru;
    if (!haru) return;
    const saved = slot === 'xai' ? haru.ai.hasKey()
      : slot === 'openai' ? haru.openai.status().then(status => status.hasKey)
      : haru.ai.hasSelfHostedKey();
    void saved.then(setHasModelKey);
  }, [slot]);
  function saveModelKey() {
    const haru = window.haru;
    if (!haru) return;
    const written = slot === 'xai' ? haru.ai.setKey(modelKey)
      : slot === 'openai' ? haru.openai.setKey(modelKey)
      : haru.ai.setSelfHostedKey(modelKey);
    void written.then(ok => { setHasModelKey(ok); setModelKey(''); });
  }
  // Only asked for when the endpoint is not this machine. Localhost needs no
  // token and offering one there is just a box nobody should fill in.
  const remote = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(endpoint.trim());
  // A ref rather than state: re-rendering the drawer every time the voice
  // section edits itself would reset the fields being typed into above it.
  const saveVoice = useRef<(() => Promise<void>) | null>(null);
  const registerVoiceSave = useCallback((fn: () => Promise<void>) => { saveVoice.current = fn; }, []);
  async function test() {
    setStatus({ state: 'testing' });
    try {
      const models = await onTest(endpoint, config.provider);
      setStatus({ state: 'ok', message: models.length ? `Connected. Models available: ${models.join(', ')}` : (config.provider === 'ollama' ? 'Connected, but no models are pulled yet — try `ollama pull llama3.1:8b`.' : 'Connected, but it listed no models.') });
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  async function save() {
    onSave({ ...config, endpoint, model });
    // Voice as well, so the label is honest. The rest of the panel writes as it
    // is changed and needs nothing here.
    try { await saveVoice.current?.(); } catch { /* the section shows its own error */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  /** Switching provider moves the endpoint with it, since the old address is
   *  never right for the new one — but a hand-typed endpoint is left alone. */
  async function chooseProvider(next: ProviderConfig['provider']) {
    const suggested = await window.haru?.ai.defaultEndpoint(next);
    const known = ['http://localhost:11434', 'https://api.openai.com/v1', 'https://api.x.ai/v1'];
    if (suggested && known.includes(endpoint.trim())) setEndpoint(suggested);
    onSave({ ...config, provider: next, endpoint: suggested && known.includes(endpoint.trim()) ? suggested : endpoint, model });
  }

  return <section className="page"><div className="field"><h2>Where she thinks</h2><p>Ollama runs on this machine and nothing leaves it. The others are companies you send the conversation to.</p>
    <div className="form-grid">
      <select value={config.provider} onChange={event => void chooseProvider(event.target.value as ProviderConfig['provider'])}>
        <option value="ollama">Ollama — on this machine</option>
        <option value="xai">xAI — Grok</option>
        <option value="openai">OpenAI</option>
      </select>
      {/* "Ollama" is a kind of server, not a place. Picking it and then typing
          the address of a rented GPU left this saying "nothing sent anywhere"
          immediately above an endpoint that sends everything — so the claim
          follows the address, which is the thing that decides it. */}
      <span className="status-note">{config.provider === 'ollama'
        ? (remote ? 'Ollama, but not on this machine — see below.' : 'Local. No key, no account, nothing sent anywhere.')
        : 'Everything she is given goes to them with every message — the conversation, her memory of you, your list and your journal ratings.'}</span>
    </div>
    <div className="form-grid"><input value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="http://localhost:11434"/><input value={model} onChange={event => setModel(event.target.value)} placeholder={config.provider === 'xai' ? 'grok-4' : config.provider === 'openai' ? 'gpt-4o' : 'qwen3:8b'}/></div>{remote && <>
    <p className="status-note">That is not this machine. Everything she is given goes there with every message — the conversation, what she remembers about you, your profile and your list — so it wants to be somewhere you trust, over https, and behind a token. Ollama has no password of its own: an endpoint on the open internet can be used, and read, by anyone who finds it.</p>
    <div className="form-grid">
      <input type="password" value={modelKey} placeholder={hasModelKey ? `A key is saved for ${KEY_SLOT_NAME[slot]} — type a new one to replace it` : `Bearer token for ${KEY_SLOT_NAME[slot]}`} onChange={event => setModelKey(event.target.value)}/>
      <button className="ghost" disabled={!modelKey.trim()} onClick={saveModelKey}>Save key</button>
    </div>
  </>}{status.state !== 'idle' && <p className={status.state === 'error' ? 'status-error' : 'status-ok'}>{status.state === 'testing' ? 'Testing…' : status.message}</p>}</div><VoiceField registerSave={registerVoiceSave}/><ListenField/><SearchField/><AniListField/><SecondBrainField/><ThemeField/><VisionField/><AttachmentsField/><ScreenshotField/><WatchingField/><DesktopField/><GamingField/><RoamField/><GoogleCalendarField/><DiscordField/><WebField/><StartupField/><div className="drawer-foot"><button className="ghost" onClick={test} disabled={status.state === 'testing'}>{status.state === 'testing' ? 'Testing…' : 'Test connection'}</button><button className="ghost">Enable alerts</button>{saved && <span className="saved"><Check size={13}/> Saved</span>}<button className="solid" onClick={() => void save()}>Save setup</button></div></section>;
}

// What each engine calls the thing it clones or selects a voice with. The label
// changes because the value genuinely differs — a name the server knows versus a
// path to a clip on disk — and one generic "voice" label made that unguessable.
const VOICE_ENGINES: { value: VoiceEngine; label: string; hint: string; voiceLabel?: string }[] = [
  { value: 'off', label: 'Off', hint: 'Haru stays in text.' },
  { value: 'windows', label: 'Windows built-in', hint: 'No setup, but the voice is the stock Microsoft one and her mouth can only be approximated — there is no audio to measure, so it is an animated flap rather than real lip sync.' },
  { value: 'openai', label: 'Local server (OpenAI API)', hint: 'Anything speaking the /v1/audio/speech shape — openedai-speech wrapping an XTTS clone, Kokoro-FastAPI, LocalAI. Point it at the base URL including /v1.', voiceLabel: 'Voice name' },
  { value: 'gpt-sovits', label: 'GPT-SoVITS', hint: 'Clones a voice from one short reference clip, and can be fine-tuned further on your own recordings. Run api_v2.py and point this at it.', voiceLabel: 'Reference clip (full path to a .wav)' },
];

/**
 * Her wardrobe. Options and toggles are discovered from the model's own metadata
 * rather than listed here, so importing a different character produces whatever
 * that one can actually change instead of a panel of dead switches.
 *
 * Every change applies immediately and persists — there is no save button,
 * because the model standing next to the panel is the preview.
 */
export function WardrobeDrawer({ onClose }: { onClose(): void }) {
  const [controls, setControls] = useState<WardrobeControl[] | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!window.haru) return;
    const load = () => window.haru!.wardrobe.get().then(({ controls: found, values: chosen }) => { setControls(found); setValues(chosen); });
    void load();
    const stop = [
      window.haru.wardrobe.onChange(setValues),
      // The companion window reports the model's real parameter bounds shortly
      // after it loads, which can change what each control offers.
      window.haru.wardrobe.onRefresh(() => { void load(); }),
    ];
    return () => { for (const off of stop) off?.(); };
  }, []);

  if (!window.haru) return null;
  const options = (controls ?? []).filter(control => control.kind === 'option');
  const toggles = (controls ?? []).filter(control => control.kind === 'toggle');
  const poses = (controls ?? []).filter(control => control.kind === 'pose');
  const set = (id: string, value: number) => { void window.haru!.wardrobe.set(id, value).then(setValues); };
  // Compared against the offered values rather than assumed, since they can run
  // negative. Nothing chosen shows the model's own default as selected.
  const chosenIndex = (control: WardrobeControl) => {
    const current = values[control.id];
    if (current === undefined) return -1;
    let best = 0;
    control.values.forEach((candidate, index) => { if (Math.abs(candidate - current) < Math.abs(control.values[best] - current)) best = index; });
    return best;
  };

  return <section className="drawer"><button className="drawer-close" onClick={onClose}><X size={16}/></button>
    <div className="field"><h2>Wardrobe</h2>
      {controls === null ? <p>Reading what she can change…</p>
        : !controls.length ? <p>This model has no outfit or colour options to change. Models exported with toggle and slider parameters — hair colour, outfit colour, accessories — will show them here.</p>
        : <>
            <p>Changes apply straight away and are remembered. She may have opinions.</p>
            {/* Labelled 1..n rather than by the underlying value: "-1 0 1" is the
                parameter's business, not something to make anyone read. */}
            {options.map(control => <div className="wardrobe-row" key={control.id}>
              <label>{control.name}</label>
              <div className="wardrobe-options">
                {control.values.map((value, index) =>
                  <button key={value} className={chosenIndex(control) === index ? 'chip selected' : 'chip'} onClick={() => set(control.id, value)}>{index + 1}</button>)}
              </div>
            </div>)}
            {toggles.map(control => <div className="wardrobe-row" key={control.id}>
              <label>{control.name}</label>
              <div className="wardrobe-options">
                <button className={chosenIndex(control) === 0 ? 'chip selected' : 'chip'} onClick={() => set(control.id, control.values[0] ?? 0)}>Off</button>
                <button className={chosenIndex(control) === control.values.length - 1 ? 'chip selected' : 'chip'} onClick={() => set(control.id, control.values[control.values.length - 1] ?? 1)}>On</button>
              </div>
            </div>)}
            {/* Sliders, not buttons: an elbow is a position rather than a
                choice, and nobody can be told in advance which number looks
                right. This model rigs ten arm parameters and no expression
                touches any of them, so wherever the author left them is where
                they stay — which is what reads as "weird". */}
            {poses.length > 0 && <>
              <p className="status-note">Where her arms rest. Drag until she looks right — it is remembered for this model.</p>
              {poses.map(control => {
                const low = control.values[0];
                const high = control.values[control.values.length - 1];
                const current = values[control.id] ?? control.values[Math.floor(control.values.length / 2)];
                return <div className="wardrobe-row" key={control.id}>
                  <label>{control.name}</label>
                  <input type="range" min={low} max={high} step={(high - low) / 100} value={current}
                    onChange={event => set(control.id, Number(event.target.value))}/>
                </div>;
              })}
            </>}
            <div className="row-actions"><button className="ghost" onClick={() => { void window.haru!.wardrobe.reset().then(setValues); }}>Back to how she came</button></div>
          </>}
    </div>
  </section>;
}

/** Just the filename: the full path is too long to read in a button, and the
 *  filename is the part that identifies the clip anyway. */
function clipName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

// Canonical order, matching electron/emotion.ts. Neutral leads because it is
// where she spends most of her time and so the most useful one to map first.
const EMOTION_ORDER: EmotionName[] = ['neutral', 'happy', 'curious', 'smug', 'annoyed', 'bored', 'sleepy', 'surprised', 'affectionate', 'embarrassed'];

/**
 * Per-emotion reference clips. Her face already moves with the emotion the model
 * reports; this lets her voice do the same. Every row is optional — anything left
 * unset falls back to the default clip, so one good reference remains a complete
 * setup and this is purely additive.
 */
function EmotionVoices({ config, onChange }: { config: VoiceConfig; onChange(changes: Partial<VoiceConfig>): void }) {
  const [open, setOpen] = useState(false);
  const mapped = config.emotionVoices ?? {};
  const count = EMOTION_ORDER.filter(emotion => mapped[emotion]?.clip).length;

  function set(emotion: EmotionName, reference: VoiceReference | null) {
    const next = { ...mapped };
    if (reference) next[emotion] = reference; else delete next[emotion];
    onChange({ emotionVoices: next });
  }

  return <div className="emotion-voices">
    <button className="disclosure" onClick={() => setOpen(!open)}>
      {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>} Voice per emotion {count > 0 && <em>{count} set</em>}
    </button>
    {open && <>
      <p>Optional. Anything left blank uses the clip above. She picks the clip matching how the model read the line she just said.</p>
      {EMOTION_ORDER.map(emotion => {
        const reference = mapped[emotion];
        return <div className="emotion-row" key={emotion}>
          <label>{emotion}</label>
          <button className="ghost" onClick={async () => { const picked = await window.haru!.voice.pickClip(); if (picked) set(emotion, { clip: picked, text: reference?.text ?? '' }); }}>{reference?.clip ? clipName(reference.clip) : 'Choose…'}</button>
          <input value={reference?.text ?? ''} disabled={!reference?.clip} onChange={event => reference?.clip && set(emotion, { clip: reference.clip, text: event.target.value })} placeholder="what that clip says"/>
          <button className="ghost icon" disabled={!reference?.clip} onClick={() => set(emotion, null)} title="Clear"><X size={12}/></button>
        </div>;
      })}
    </>}
  </div>;
}

/**
 * `registerSave` hands the drawer's footer a way to commit this section too.
 *
 * Everything else in Setup either writes as you change it or carries its own
 * button. Voice did neither from the footer's point of view: it kept its edits
 * in local state behind a "Save voice" of its own, so a slider moved here and
 * "Save setup" pressed below saved the Ollama endpoint and silently discarded
 * the rest. A button at the foot of a panel is read as saving the panel.
 */
function VoiceField({ registerSave }: { registerSave?(save: () => Promise<void>): void } = {}) {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [busy, setBusy] = useState<'saving' | 'testing' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => { window.haru?.voice.get().then(setConfig); }, []);
  // Re-registered on every edit so the closure the footer holds is never a stale
  // copy of the settings.
  useEffect(() => {
    registerSave?.(async () => { if (config) setConfig(await window.haru!.voice.set(config)); });
  }, [config, registerSave]);
  // The list starts empty and is filled in once the platform has enumerated the
  // installed voices, so it has to be subscribed to as well as read.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const read = () => setSystemVoices(window.speechSynthesis.getVoices());
    read();
    window.speechSynthesis.addEventListener('voiceschanged', read);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', read);
  }, []);

  if (!window.haru || !config) return null;
  const engine = VOICE_ENGINES.find(entry => entry.value === config.engine) ?? VOICE_ENGINES[0];
  const remote = config.engine === 'openai' || config.engine === 'gpt-sovits';
  const update = (changes: Partial<VoiceConfig>) => setConfig({ ...config, ...changes });

  async function run(kind: 'saving' | 'testing', action: () => Promise<unknown>, done?: string) {
    setBusy(kind); setMessage(null);
    try {
      const result = await action();
      setMessage({ text: done ?? String(result) });
    } catch (error) {
      // Electron wraps a rejected invoke in boilerplate longer than the reason
      // itself, and the reason is the only part that says what to fix.
      const detail = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '') : String(error);
      setMessage({ text: detail, error: true });
    } finally {
      setBusy(null);
    }
  }

  return <div className="field"><h2>Voice</h2>
    <p>{engine.hint}</p>
    <div className="row-actions">
      <select value={config.engine} onChange={event => update({ engine: event.target.value as VoiceEngine })}>
        {VOICE_ENGINES.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
      {remote && <input value={config.endpoint} onChange={event => update({ endpoint: event.target.value })} placeholder={config.engine === 'gpt-sovits' ? 'http://127.0.0.1:9880' : 'http://127.0.0.1:8000/v1'}/>}
    </div>
    {/* A name the server already knows, so this one stays a plain text field. */}
    {config.engine === 'openai' && <div className="row-actions"><input value={config.voice} onChange={event => update({ voice: event.target.value })} placeholder={engine.voiceLabel}/></div>}
    {/* Left unset the platform picks its default, which on most Windows installs
        is a male voice — rarely what anyone wants out of this particular app. */}
    {config.engine === 'windows' && <div className="row-actions">
      <select value={config.voice} onChange={event => update({ voice: event.target.value })}>
        <option value="">System default</option>
        {systemVoices.map(entry => <option key={entry.voiceURI} value={entry.voiceURI}>{entry.name}</option>)}
      </select>
    </div>}
    {/* Clips are picked rather than typed: the paths run past 100 characters and a
        typo shows up as a failed synthesis rather than as an obviously wrong path.
        The transcript has to match its clip or the cloned voice drifts off target,
        which is the single most common way a GPT-SoVITS setup sounds wrong. */}
    {config.engine === 'gpt-sovits' && <>
      <div className="row-actions">
        <button className="ghost" onClick={async () => { const picked = await window.haru!.voice.pickClip(); if (picked) update({ voice: picked }); }}>{config.voice ? clipName(config.voice) : 'Choose reference clip…'}</button>
        <input value={config.referenceText} onChange={event => update({ referenceText: event.target.value })} placeholder="Exactly what that clip says"/>
      </div>
      <EmotionVoices config={config} onChange={update}/>
    </>}
    {config.engine !== 'off' && <div className="row-actions">
      {remote && <input value={config.language} onChange={event => update({ language: event.target.value })} placeholder="Language (en, ja, zh)"/>}
      <label className="slider">Speed <input type="range" min="0.5" max="1.6" step="0.05" value={config.speed} onChange={event => update({ speed: Number(event.target.value) })}/></label>
      <label className="slider">Volume <input type="range" min="0" max="1" step="0.05" value={config.volume} onChange={event => update({ volume: Number(event.target.value) })}/></label>
    </div>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
    <div className="row-actions">
      {/* Saves before speaking. The Windows voices are played with whatever
          settings are stored, so testing an unsaved pick would audition the
          previous one and look like the change had not taken. */}
      <button className="ghost" disabled={busy !== null || config.engine === 'off'} onClick={() => run('testing', async () => { setConfig(await window.haru!.voice.set(config)); return window.haru!.voice.test(config); })}>{busy === 'testing' ? 'Testing…' : 'Test voice'}</button>
      <button className="ghost" disabled={busy !== null} onClick={() => run('saving', async () => setConfig(await window.haru!.voice.set(config)), 'Voice saved.')}>{busy === 'saving' ? 'Saving…' : 'Save voice'}</button>
    </div>
  </div>;
}

/**
 * Speaking to her instead of typing. Off until an engine is picked, the same as
 * her voice — and for the same reason: a microphone that turns itself on because
 * the app was installed is not a default anybody should be given.
 */
function ListenField() {
  const [config, setConfig] = useState<ListenConfig | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!window.haru) return;
    // The saved level reaches the chime module here. Both readers do it: the
    // panel so "Hear it" plays what the slider says, and the mic button because
    // that is the component that actually rings it.
    const apply = (saved: ListenConfig) => { setConfig(saved); setChimeVolume(saved.chimeVolume); };
    window.haru.listen.get().then(apply);
    return window.haru.listen.onChange(apply);
  }, []);

  if (!window.haru || !config) return null;
  const save = async (changes: Partial<ListenConfig>) => {
    setBusy(true);
    try { setConfig(await window.haru!.listen.set({ ...config, ...changes })); }
    finally { setBusy(false); }
  };

  async function check() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${config!.endpoint.replace(/\/+$/, '')}/health`);
      if (!response.ok) throw new Error(`returned ${response.status}`);
      const health = await response.json() as { model?: string };
      setMessage({ text: `Reachable${health.model ? ` — running ${health.model}` : ''}.` });
    } catch {
      setMessage({ text: 'Nothing answered. Start electron\\start-haru-asr.cmd and try again.', error: true });
    } finally { setBusy(false); }
  }

  return <div className="field"><h2>Speaking to her</h2>
    <p>A microphone button appears next to the message box. Press it, say your piece, press it again — it transcribes on this machine and nothing is written to disk or sent anywhere.</p>
    <div className="form-grid">
      <select value={config.engine} disabled={busy} onChange={event => save({ engine: event.target.value as ListenConfig['engine'] })}>
        <option value="off">Off</option>
        <option value="local">Local server (Whisper)</option>
      </select>
      <input value={config.endpoint} disabled={busy || config.engine === 'off'} onChange={event => setConfig({ ...config, endpoint: event.target.value })} onBlur={() => save({})} placeholder="http://127.0.0.1:9881"/>
    </div>
    {config.engine !== 'off' && <>
      <label className="check-row">
        <input type="checkbox" checked={config.autoSend} disabled={busy} onChange={event => save({ autoSend: event.target.checked })}/>
        <span>Send as soon as I stop talking, instead of filling the box</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={config.replyWindow} disabled={busy} onChange={event => save({ replyWindow: event.target.checked })}/>
        <span>Listen for {WAKE_WINDOW_MS / 1000} seconds whenever she speaks first</span>
      </label>
      {config.replyWindow && !config.wakeWord && <p className="status-note">Covers the times she starts it — the line when she comes up, a reaction to what you have open, a reminder, being poked. The microphone opens once she has finished talking, not while, and closes again on its own. No name needed; she already has your attention.</p>}
      <div className="stack">
        <span>Chime {config.chimeVolume > 0 ? `— ${Math.round(config.chimeVolume * 100)}%` : '— off'}</span>
        <div className="row-actions">
          <input type="range" min={0} max={40} step={1} value={Math.round(config.chimeVolume * 100)} disabled={busy}
            onChange={event => save({ chimeVolume: Number(event.target.value) / 100 })}/>
          {/* Plays the new level as you drag it, because a volume you cannot
              hear while setting is a volume you set twice. */}
          <button className="ghost" type="button" disabled={busy || config.chimeVolume <= 0} onClick={() => chimeListening()}>Hear it</button>
        </div>
        <span className="status-note">{config.chimeVolume > 0
          ? 'Two short notes when the microphone opens, and two falling ones when it closes. The falling pair matters more than it sounds — without it you carry on talking into a window that shut a while ago. Separate from her speaking volume on purpose: her voice can sit low while the cue still needs to carry across a room.'
          : 'Silent. The only sign she is listening will be the microphone button.'}</span>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={config.wakeWord} disabled={busy} onChange={event => save({ wakeWord: event.target.checked })}/>
        <span>Answer to “Hey Haru” without pressing anything</span>
      </label>
      {config.wakeWord && <p className="status-note">This keeps the microphone open. Everything said nearby is transcribed on this machine to work out whether it was meant for her, then thrown away — nothing is written down and nothing leaves the computer, but it is a different bargain from pressing a button. Say “Haru, remind me to…” in one breath, or just “Haru?” and she will wait {WAKE_WINDOW_MS / 1000} seconds for the rest.</p>}
      <div className="row-actions"><button className="ghost" disabled={busy} onClick={check}>Check the server</button></div>
      <p className="status-note">Run <code>electron\start-haru-asr.cmd</code> to start it. It borrows the Python that GPT-SoVITS already bundles, so there is nothing else to install — the first run downloads the model and takes a minute.</p>
      <Corrections/>
    </>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
  </div>;
}

/**
 * Letting her look things up. The only part of her that leaves the machine, so
 * it says so plainly and starts off — everything else here is local because it
 * was built to be, and quietly breaking that would be the wrong kind of
 * surprise.
 */
function SearchField() {
  const [config, setConfig] = useState<(SearchConfig & { hasKey: boolean }) | null>(null);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [located, setLocated] = useState('');
  useEffect(() => { window.haru?.search.get().then(setConfig); }, []);

  if (!window.haru || !config) return null;
  const save = async (changes: Partial<SearchConfig>) => {
    setBusy(true);
    try { setConfig(await window.haru!.search.set({ ...config, ...changes })); }
    finally { setBusy(false); }
  };
  /**
   * Saved straight away rather than left in the box, because the whole point is
   * that the coordinates are not kept — if the name is not written down now, the
   * next press has to ask Windows and OpenStreetMap all over again.
   */
  const locate = async () => {
    setLocating(true);
    setLocated('');
    try {
      const found = await window.haru!.search.locate();
      await save({ place: found.place });
      setLocated(`Windows put you within ${found.accuracy}m. Change it if that is not right.`);
    } catch (problem) {
      setLocated(problem instanceof Error ? problem.message.replace(/^Error invoking remote method .[^.]*.:\s*(Error:\s*)?/, '') : String(problem));
    } finally { setLocating(false); }
  };

  async function saveKey() {
    setBusy(true); setMessage(null);
    try {
      const hasKey = await window.haru!.search.setKey(key);
      setConfig(current => current && { ...current, hasKey });
      setKey('');
      setMessage({ text: hasKey ? 'Key saved, encrypted by Windows.' : 'Key cleared.' });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Could not save the key.', error: true });
    } finally { setBusy(false); }
  }

  async function check() {
    setBusy(true); setMessage(null);
    try {
      const count = await window.haru!.search.test();
      setMessage(count ? { text: `Working — ${count} results came back.` } : { text: 'It answered, but with nothing in it.', error: true });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : 'The search did not go through.', error: true });
    } finally { setBusy(false); }
  }

  return <div className="field"><h2>Looking things up</h2>
    <p>Lets her search the web when you ask her something she cannot know — the news, a price, who someone is. She decides when it is worth it; there is nothing to type differently.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => save({ enabled: event.target.checked })}/>
      <span>Let her search the web</span>
    </label>
    {config.enabled
      ? <>
        <p className="status-note">Only the words she searches for leave this machine — not your messages, your list, or anything she remembers about you. What comes back is used to answer and is not saved.</p>
        <div className="form-grid">
          <select value={config.provider} disabled={busy} onChange={event => save({ provider: event.target.value as SearchConfig['provider'] })}>
            <option value="duckduckgo">DuckDuckGo — nothing to set up</option>
            <option value="brave">Brave — needs a free key</option>
            <option value="google">Google — needs a free key and an engine ID</option>
          </select>
          <span className="status-note">{config.limit} results at a time — more to go on, and a slower reply.</span>
          <input type="range" min={1} max={8} step={1} value={config.limit} disabled={busy} onChange={event => save({ limit: Number(event.target.value) })}/>
        </div>
        {config.provider === 'duckduckgo' &&
          // Said plainly because it has already happened here, and because the
          // symptom is confusing on its own: she starts saying she cannot look
          // things up, with nothing obviously broken.
          <p className="status-note">Free and immediate, but it is a public page being read by a program — search enough in a short stretch and it stops answering and asks for a picture of a duck instead. She will say so when that happens rather than pretending she found nothing. If it keeps happening, switch to one of the others.</p>}
        {config.provider !== 'duckduckgo' && <>
          {config.provider === 'brave'
            ? <p className="status-note">A proper API, so no challenge pages. Get a free key at <code>brave.com/search/api</code> — the free tier is a couple of thousand searches a month, far more than she will use. Stored encrypted by Windows and never leaves this machine.</p>
            : <p className="status-note">Google's Programmable Search, which is the sanctioned way in — reading google.com with a program is both against its terms and detected far harder than DuckDuckGo. Two things needed, both free: an API key from <code>console.cloud.google.com</code> with "Custom Search API" enabled, and a search engine ID from <code>programmablesearchengine.google.com</code> set to search the whole web. The free tier is 100 searches a day, which is the tightest of the three.</p>}
          <div className="form-grid">
            <input type="password" value={key} disabled={busy} placeholder={config.hasKey ? 'A key is saved — type a new one to replace it' : 'Paste the API key here'} onChange={event => setKey(event.target.value)}/>
            <button className="ghost" disabled={busy || !key.trim()} onClick={() => void saveKey()}>Save key</button>
          </div>
          {config.provider === 'google' &&
            <div className="form-grid">
              <input value={config.engineId} disabled={busy} placeholder="Search engine ID (the cx value)" onChange={event => setConfig({ ...config, engineId: event.target.value })} onBlur={() => save({})}/>
              <span className="status-note">Not a secret — it travels in the address of every search.</span>
            </div>}
        </>}
        <div className="stack">
          <span>Where you are</span>
          <input value={config.place} disabled={busy} placeholder="Perth, Western Australia" onChange={event => setConfig({ ...config, place: event.target.value })} onBlur={() => save({})}/>
          <span className="status-note">{config.place
            ? `Added to questions that only make sense somewhere — "where can I buy this", "the nearest one", "still open". Everything else is searched as asked, and naming a different place yourself wins over this. Nothing but those words is sent, and only on those searches: no coordinates, no address.`
            : 'Left empty, "where can I buy this" is searched with no idea where you are, which usually answers for America.'}</span>
          <div className="row-actions">
            <button className="ghost" disabled={busy || locating} onClick={() => void locate()}>{locating ? 'Asking Windows…' : 'Use my location'}</button>
            {located && <span className="status-note">{located}</span>}
          </div>
          <span className="status-note">Pressing that asks Windows where this machine is, then sends the coordinates <strong>once</strong> to OpenStreetMap to turn them into a suburb name — they are rounded to about 110 metres first, which is as precise as the reading itself. The name lands in the box above and is all that is kept; the coordinates are never saved and never go into a search. Type it yourself instead if you would rather nobody was asked at all.</span>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={config.readPages} disabled={busy} onChange={event => save({ readPages: event.target.checked })}/>
          <span>Let her open a result and read it, not just the summary</span>
        </label>
        <p className="status-note">{config.readPages
          ? 'This is the difference between searching and browsing. A search that turns up four weather sites and no temperature is no use — the forecast is on the page, not in the summary. She opens one page at a time, reads the text, and does not run any of its scripts. Page text reaches her clearly marked as something she read rather than something she was told, so a page cannot talk her into anything.'
          : 'She works from the one-line summaries only. Faster, and nothing but the search itself leaves the machine — but for weather, prices and scores the summary usually does not contain the answer, and she will say she could not find it.'}</p>
        <div className="row-actions"><button className="ghost" disabled={busy} onClick={() => void check()}>Try a search</button></div>
      </>
      : <p className="status-note">Off, so nothing about her leaves this computer. Left off she answers from what she already knows, which for anything recent means guessing.</p>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
  </div>;
}

/**
 * Letting her walk about. The nudge button matters more than it looks: the
 * honest wander interval is minutes long, so without a way to make her do it now
 * the only way to find out whether the setting works is to stop watching.
 */
function RoamField() {
  const [config, setConfig] = useState<RoamConfig | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.haru?.roam.get().then(setConfig); }, []);

  if (!window.haru || !config) return null;
  const save = async (changes: Partial<RoamConfig>) => {
    setBusy(true);
    try { setConfig(await window.haru!.roam.set({ ...config, ...changes })); }
    finally { setBusy(false); }
  };

  const pace = config.restlessness < 0.25 ? 'rarely — every few minutes at most'
    : config.restlessness < 0.6 ? 'now and then'
    : 'often — she will not settle for long';

  return <div className="field"><h2>Wandering</h2>
    <p>Lets her walk along the bottom of the screen instead of standing where she was put. She stays on the display she is already on, keeps to the work area above the taskbar, and stops if you drag her somewhere.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => save({ enabled: event.target.checked })}/>
      <span>Let her wander off on her own</span>
    </label>
    {config.enabled && <>
      <div className="form-grid">
        <label className="stack"><span>How restless</span>
          <input type="range" min={0} max={1} step={0.05} value={config.restlessness} disabled={busy} onChange={event => save({ restlessness: Number(event.target.value) })}/>
        </label>
        <span className="status-note">{pace}.</span>
      </div>
      <p className="status-note">She will not wander mid-sentence, while you are talking to her, or for a minute and a half after you move her by hand — being put somewhere reads as an instruction to stay there.</p>
    </>}
    <label className="check-row">
      <input type="checkbox" checked={config.avoidFullscreen} disabled={busy} onChange={event => save({ avoidFullscreen: event.target.checked })}/>
      <span>Step aside when something goes fullscreen</span>
    </label>
    <p className="status-note">Works whether or not she wanders: she walks to the nearest bottom corner rather than standing in the middle of a film. She does not hide — that is what the pin is for.</p>
    <div className="row-actions"><button className="ghost" disabled={busy} onClick={async () => {
      const went = await window.haru!.roam.nudge();
      setMessage(went ? 'Off she goes — watch the bottom of the screen.' : 'Nowhere useful to walk to from where she is standing.');
    }}>Make her walk somewhere now</button></div>
    {message && <p className="status-ok">{message}</p>}
  </div>;
}

/**
 * A second brain for the hard ones.
 *
 * The panel spends most of its words on what leaves the machine, because that is
 * the part nobody thinks about until afterwards: the switch is about answer
 * quality, but the consequence is that some conversations get posted to a
 * company along with everything she knows about you.
 */
function SecondBrainField() {
  const [setting, setSetting] = useState<{ enabled: boolean; minWords: number; provider: ProviderConfig | null } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    window.haru?.ai.getEscalate().then(setSetting);
    window.haru?.ai.hasKey().then(setHasKey);
  }, []);
  if (!window.haru || !setting) return null;

  const away = setting.provider ?? { provider: 'xai' as const, model: '', endpoint: 'https://api.x.ai/v1', temperature: 0.7 };
  const save = (changes: Partial<typeof setting>, provider = away) =>
    window.haru!.ai.setEscalate({ enabled: changes.enabled ?? setting.enabled, minWords: changes.minWords ?? setting.minWords }, provider).then(setSetting);

  async function list() {
    setChecking(true); setMessage(null);
    try {
      // Verifies by using the key the way she will, rather than by asking for a
      // model list the key may not be permitted to see.
      const result = await window.haru!.ai.verify(away.endpoint, away.provider, away.model);
      setModels(result.models);
      setMessage({ text: result.models.length ? `The key works — ${result.models.length} models available.` : (result.note || 'The key works.') });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') : 'Could not reach it.', error: true });
    } finally { setChecking(false); }
  }

  return <div className="field"><h2>A second model for the hard ones</h2>
    <p>She answers on the local model as usual, and sends only the questions that actually want more thinking to a hosted one. Errands, ticking things off and chit-chat never leave.</p>
    <label className="check-row">
      <input type="checkbox" checked={setting.enabled} onChange={event => void save({ enabled: event.target.checked })}/>
      <span>Send the hard questions to a bigger model</span>
    </label>
    {setting.enabled && <>
      <div className="form-grid">
        <select value={away.provider} onChange={event => void save({}, { ...away, provider: event.target.value as ProviderConfig['provider'], endpoint: event.target.value === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1' })}>
          <option value="xai">xAI — Grok</option>
          <option value="openai">OpenAI</option>
        </select>
        <input value={away.model} placeholder="grok-4" onChange={event => void save({}, { ...away, model: event.target.value })}/>
      </div>
      <div className="form-grid">
        <label className="stack"><span>Long enough to count</span>
          <input type="range" min={8} max={60} step={1} value={setting.minWords} onChange={event => void save({ minWords: Number(event.target.value) })}/>
        </label>
        <span className="status-note">{setting.minWords} words. Anything asking you to explain, compare or decide goes out whatever its length; anything starting with an errand stays home however long it runs.</span>
      </div>
      {/* The key box lives here as well as on the connection above, because the
          one above only appears when the main endpoint is remote — and the whole
          point of this panel is keeping the main one local. It is the same
          stored key either way; setting it in one place sets it in both. */}
      <div className="form-grid">
        <input type="password" value={key} placeholder={hasKey ? 'A key is saved — type a new one to replace it' : 'Paste your API key here'}
          onChange={event => setKey(event.target.value)}/>
        {/* The failure path is the point. Without a catch, a save that throws in
            main — no secure storage, a locked keychain — rejects a promise
            nobody is listening to: the box does not clear, no message appears,
            and it looks exactly like a click that missed. */}
        <button className="ghost" disabled={!key.trim()}
          onClick={() => void window.haru?.ai.setKey(key)
            .then(saved => {
              setHasKey(saved);
              setKey('');
              setMessage(saved
                ? { text: 'Key saved, encrypted by Windows.' }
                : { text: 'Nothing was saved — the box was empty.', error: true });
            })
            .catch(problem => setMessage({
              text: problem instanceof Error ? problem.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') : 'Could not save the key.',
              error: true,
            }))}>Save key</button>
      </div>
      <div className="row-actions">
        <button className="ghost" disabled={checking} onClick={() => void list()}>{checking ? 'Checking…' : 'Check the key and list models'}</button>
      </div>
      {models.length > 0 && <p className="status-note">Available: {models.slice(0, 8).join(', ')}{models.length > 8 ? '…' : ''}</p>}
      <p className="status-note">Uses the same API key as the connection above. What she sends is the whole prompt — the conversation, what she remembers about you, your profile, your list and your journal ratings. Her memory is still stored only on this machine; it is the copy in each question that travels. The log names every question that goes out and why.</p>
    </>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
  </div>;
}

/**
 * Light or dark. Written to the document element rather than held in React, so
 * the choice applies to the companion window too and survives a reload without a
 * flash of the wrong palette.
 */
function ThemeField() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.documentElement.dataset.theme as 'dark' | 'light') ?? 'light');
  function choose(next: 'dark' | 'light') {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    void window.haru?.settings.set('theme', next);
  }
  return <div className="field"><h2>Look</h2>
    <p>Dark is the original. Light follows the concept art — blush grounds, white cards, the same rose.</p>
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button className={theme === 'dark' ? 'selected' : ''} onClick={() => choose('dark')}>Dark</button>
      <button className={theme === 'light' ? 'selected' : ''} onClick={() => choose('light')}>Light</button>
    </div>
  </div>;
}

/**
 * Files she can be shown. The key is optional and the panel says what changes
 * without it, because everything here works locally — slower, and without
 * OpenAI's transcription, which is markedly better on accents and music.
 */
function AttachmentsField() {
  const [status, setStatus] = useState<{ hasKey: boolean; ffmpeg: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { window.haru?.openai.status().then(setStatus); }, []);
  if (!window.haru || !status) return null;
  const save = async (value: string) => {
    setBusy(true); setMessage('');
    try {
      await window.haru!.openai.setKey(value);
      setStatus(await window.haru!.openai.status());
      setKey('');
      setMessage(value.trim() ? 'Saved.' : 'Forgotten.');
    } catch (problem) { setMessage(problem instanceof Error ? problem.message : String(problem)); }
    finally { setBusy(false); }
  };

  return <div className="field"><h2>Files you show her</h2>
    <p>The paperclip takes anything — pictures, sound, video, PDFs, and text or data files. She opens each the way it needs opening: a video becomes a few frames and its sound, a recording becomes what was said, a PDF becomes its text.</p>
    <p className="status-note">{status.ffmpeg
      ? 'ffmpeg is installed, so sound and video work. PDFs and text need nothing extra.'
      : 'ffmpeg is not installed, so pictures, PDFs and text files work but sound and video do not — they need it to be pulled apart at all.'}</p>
    <p className="status-note">A scanned PDF is pictures of pages with no text in it. She will say she cannot read that one rather than guessing at what it says.</p>
    <div className="stack">
      <span>OpenAI key {status.hasKey ? '— saved' : '— optional'}</span>
      <input type="password" value={key} disabled={busy} placeholder={status.hasKey ? 'A key is saved. Type a new one to replace it.' : 'sk-…'} onChange={event => setKey(event.target.value)}/>
      <div className="row-actions">
        <button className="ghost" disabled={busy || !key.trim()} onClick={() => void save(key)}>{busy ? 'Saving…' : 'Save key'}</button>
        {status.hasKey && <button className="ghost" disabled={busy} onClick={() => void save('')}>Forget it</button>}
        {message && <span className="status-note">{message}</span>}
      </div>
    </div>
    <p className="status-note">{status.hasKey
      ? 'Sound and speech in videos are transcribed by OpenAI, which handles accents, background noise and music far better than a local model. The audio is sent to them; pictures and video frames are still looked at on this machine.'
      : 'Without a key everything is done here: your own speech server transcribes sound, and the local vision model looks at pictures and frames. Nothing leaves the machine, and transcription of anything noisy will be noticeably worse.'}</p>
    <p className="status-note">Stored encrypted through Windows, never written to the settings file in plain text, and never handed back to the app once saved. It is a separate key from the second model above — those are different accounts at different companies, and sharing one slot would quietly change who sees your files.</p>
  </div>;
}

/**
 * Letting her touch the machine.
 *
 * The two halves are separate switches because they are separate bargains:
 * opening Discord when you asked is an errand, and turning the computer off is
 * not something you want to discover she can do.
 */
function DesktopField() {
  const [config, setConfig] = useState<(DesktopConfig & { apps: number }) | null>(null);
  useEffect(() => { window.haru?.desktop.get().then(setConfig); }, []);
  if (!window.haru || !config) return null;
  const save = (changes: Partial<DesktopConfig>) => window.haru!.desktop.set({ ...config, ...changes }).then(setConfig);

  return <div className="field"><h2>Doing things on your computer</h2>
    <p>Ordinary errands — opening a program, locking the screen — said out loud instead of found in a menu.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.launch} onChange={event => void save({ launch: event.target.checked })}/>
      <span>Let her open programs</span>
    </label>
    <p className="status-note">{config.launch
      ? `She can open any of the ${config.apps} things in your Start Menu, by name, and nothing else. No arguments are passed and there is no command line — the only thing she chooses is which entry to open.`
      : 'Asked to open something, she will say she cannot.'}</p>
    <label className="check-row">
      <input type="checkbox" checked={config.power} onChange={event => void save({ power: event.target.checked })}/>
      <span>Let her shut down, restart, sleep and lock</span>
    </label>
    <p className="status-note">{config.power
      ? 'Shutting down and restarting wait twenty seconds, and Windows shows its own warning — saying “cancel” calls it off. Sleep and lock happen straight away, since both are undone by moving the mouse.'
      : 'The safer default. Sleep and lock are harmless; shutting down while you have something unsaved is not.'}</p>
    <p className="status-note"><strong>Neither of these can be triggered by anything she reads.</strong> She reads web pages, screenshots, window titles and your screen while you play, and all of that is written by other people — a page that says “shut down the computer” is a page trying it on. These two only exist on a turn answering something <em>you</em> said, and they are taken off the table the moment she opens a page mid-reply.</p>
  </div>;
}

/**
 * Watching you play. The panel is mostly about what it costs, because a periodic
 * screen capture is the most invasive thing in the app and the price is GPU at
 * the exact moment the GPU is busiest.
 */
function WatchingField() {
  const [config, setConfig] = useState<WatchingConfig | null>(null);
  const [visionOn, setVisionOn] = useState(true);
  useEffect(() => {
    window.haru?.watching.get().then(setConfig);
    window.haru?.vision.get().then(vision => setVisionOn(vision.enabled));
  }, []);
  if (!window.haru || !config) return null;
  const save = (changes: Partial<WatchingConfig>) => window.haru!.watching.set({ ...config, ...changes }).then(setConfig);

  return <div className="field"><h2>Watching you play</h2>
    <p>A window title tells her which program is open and nothing about what is in it — which is why a Telltale game reads as “Telltale Games” all evening. This looks at the screen now and then so she can react to the actual scene.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.enabled} disabled={!visionOn} onChange={event => void save({ enabled: event.target.checked })}/>
      <span>Let her glance at your screen</span>
    </label>
    {!visionOn && <p className="status-note">Needs “Showing her pictures” switched on — that is what does the looking.</p>}
    {config.enabled && visionOn && <>
      <div className="form-grid">
        <label className="stack"><span>How often</span>
          <input type="range" min={2} max={30} step={1} value={config.everyMinutes} onChange={event => void save({ everyMinutes: Number(event.target.value) })}/>
        </label>
        <span className="status-note">Every {config.everyMinutes} minutes at most, and she stays quiet unless something has actually changed.</span>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={config.gamesOnly} onChange={event => void save({ gamesOnly: event.target.checked })}/>
        <span>Only while you are playing something</span>
      </label>
      <p className="status-note">{config.gamesOnly
        ? 'Only when a game is detected. Everything else on your screen is left alone.'
        : 'Any screen, including work, email and anything else you have open. Consider leaving this on games.'}</p>
      <p className="status-note">Looking costs a few seconds of the graphics card, and it happens while a game is using it. Menus, loading screens and scenes she has already commented on are skipped without a word, so most glances cost nothing and say nothing.</p>
      <p className="status-note"><strong>The picture never leaves this machine.</strong> A frame of your screen taken on a timer, without you choosing the moment, is the last thing that should go to a company — so this always uses the local model, whatever the chat model is set to. Same rule as screenshots, and equally not a setting.</p>
    </>}
  </div>;
}

/**
 * Noticing screenshots. Sits next to the picture settings because it depends on
 * them — and says plainly that this one never leaves the machine, whatever the
 * chat model is set to.
 */
function ScreenshotField() {
  const [config, setConfig] = useState<ScreenshotConfig | null>(null);
  const [visionOn, setVisionOn] = useState(true);
  useEffect(() => {
    window.haru?.screenshots.get().then(setConfig);
    window.haru?.vision.get().then(vision => setVisionOn(vision.enabled));
  }, []);
  if (!window.haru || !config) return null;
  const save = (changes: Partial<ScreenshotConfig>) => window.haru!.screenshots.set({ ...config, ...changes }).then(setConfig);

  return <div className="field"><h2>When you take a screenshot</h2>
    <p>She notices new images landing in your screenshots folder, glances at one, and says something about it.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.enabled} disabled={!visionOn} onChange={event => void save({ enabled: event.target.checked })}/>
      <span>Let her react to screenshots</span>
    </label>
    {!visionOn && <p className="status-note">Needs “Showing her pictures” switched on above — that is what does the looking.</p>}
    {config.enabled && visionOn && <>
      <div className="form-grid">
        <label className="stack"><span>Leave between remarks</span>
          <input type="range" min={1} max={30} step={1} value={config.quietMinutes} onChange={event => void save({ quietMinutes: Number(event.target.value) })}/>
        </label>
        <span className="status-note">{config.quietMinutes} minutes. Take five in a row and she remarks once, on the last one.</span>
      </div>
      <p className="status-note">Watching {config.folder}. She also stays quiet while you are gaming or mid-conversation, same as everything else she says unprompted.</p>
      {/* Not a setting, and the panel should say why rather than leaving it to be
          discovered. */}
      <p className="status-note"><strong>Screenshots are always read on this machine</strong>, by the local model, even when the chat model is xAI or OpenAI. They are the pictures most likely to hold a password, a bank balance or somebody else’s message, and this fires without you picking the image first — so there is no option to send them away.</p>
    </>}
  </div>;
}

/**
 * Showing her pictures. Her own model cannot see, so this names a second one
 * that can — the seeing and the talking are different jobs and the panel says so
 * rather than pretending one model does both.
 */
function VisionField() {
  const [config, setConfig] = useState<VisionConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    window.haru?.vision.get().then(setConfig);
    window.haru?.ai.test('http://localhost:11434').then(setModels).catch(() => setModels([]));
  }, []);
  if (!window.haru || !config) return null;
  const save = (changes: Partial<VisionConfig>) => window.haru!.vision.set({ ...config, ...changes }).then(setConfig);

  return <div className="field"><h2>Showing her pictures</h2>
    <p>Puts a picture button next to the microphone. She looks at what you show her, says what she thinks, and keeps a copy.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.enabled} onChange={event => void save({ enabled: event.target.checked })}/>
      <span>Let her look at pictures</span>
    </label>
    {config.enabled && <>
      <div className="form-grid">
        <select value={config.model} onChange={event => void save({ model: event.target.value })}>
          {!models.includes(config.model) && <option value={config.model}>{config.model}</option>}
          {models.map(model => <option key={model} value={model}>{model}</option>)}
        </select>
        <span className="status-note">Needs a model that can see. <code>gemma4:12b</code> can; qwen and llama cannot.</span>
      </div>
      <p className="status-note">The seeing model only reports what is in the frame — she reacts to that in her own voice, so her personality does not change with whichever model is doing the looking.</p>
      <div className="row-actions">
        <button className="ghost" onClick={() => void window.haru?.vision.openFolder()}>Open the folder</button>
        <span className="status-note">Copies are kept in {config.folder || 'Pictures\\Haru'}. Anything worth remembering about you goes into her memory; jokes and screenshots do not.</span>
      </div>
    </>}
  </div>;
}

/**
 * What she does while you play. Two halves of the same problem — she competes
 * for the GPU, and she competes for your attention — and they are separate
 * switches because somebody might want her quiet without changing her model, or
 * a smaller model without her going silent.
 */
function GamingField() {
  const [config, setConfig] = useState<GamingConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    window.haru?.gaming.get().then(setConfig);
    // Whatever is actually pulled, so this cannot offer a model that is not there.
    window.haru?.ai.test('http://localhost:11434').then(setModels).catch(() => setModels([]));
  }, []);
  if (!window.haru || !config) return null;
  const save = (changes: Partial<GamingConfig>) => window.haru!.gaming.set({ ...config, ...changes }).then(setConfig);

  return <div className="field"><h2>While you are playing</h2>
    <p>She notices when a game is running. A 14B model holds about 10GB of a 16GB card, which is most of what a game at 4K wants for itself.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.enabled} onChange={event => void save({ enabled: event.target.checked })}/>
      <span>Drop to a smaller model while a game is open</span>
    </label>
    {config.enabled && <>
      <div className="form-grid">
        <select value={config.model} onChange={event => void save({ model: event.target.value })}>
          {!models.includes(config.model) && <option value={config.model}>{config.model}</option>}
          {models.map(model => <option key={model} value={model}>{model}</option>)}
        </select>
        <span className="status-note">Swaps back on its own when the game closes.</span>
      </div>
      <p className="status-note">The big model is pushed out of VRAM the moment a game starts, rather than left to time out — otherwise both sit there and the game is no better off. She will be less sharp on the smaller one; that is the trade.</p>
    </>}
    <label className="check-row">
      <input type="checkbox" checked={config.quiet} onChange={event => void save({ quiet: event.target.checked })}/>
      <span>Stop her volunteering things while you play</span>
    </label>
    <p className="status-note">{config.quiet
      ? 'She still answers when spoken to — she just will not start anything. Being talked at over a game is worse than most, since you cannot pause to reply and her voice lands on top of the one you are listening to.'
      : 'She will chip in while you play, same as any other time.'}</p>
  </div>;
}

/**
 * Anime and manga. Two separate things behind one switch: looking any series up,
 * which needs nothing, and knowing what you personally are part-way through,
 * which needs a username and a public list. The first works on its own, so the
 * username is optional rather than a barrier.
 */
function AniListField() {
  const [config, setConfig] = useState<AniListConfig | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.haru?.anilist.get().then(setConfig); }, []);

  if (!window.haru || !config) return null;
  const save = async (changes: Partial<AniListConfig>) => {
    setBusy(true); setMessage(null);
    try { setConfig(await window.haru!.anilist.set({ ...config, ...changes })); }
    finally { setBusy(false); }
  };

  async function check() {
    setBusy(true); setMessage(null);
    try {
      const count = await window.haru!.anilist.test();
      setMessage(count
        ? { text: `Found ${count} things you are part-way through or have stalled on.` }
        : { text: 'That profile reads fine, but nothing is in progress on it.' });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') : 'Could not read that profile.', error: true });
    } finally { setBusy(false); }
  }

  return <div className="field"><h2>Anime and manga</h2>
    <p>Gives her AniList, so she knows what a series actually is — how long it runs, who made it, whether it has finished — instead of guessing or reading it off a shop page.</p>
    <label className="check-row">
      <input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => save({ enabled: event.target.checked })}/>
      <span>Let her look things up on AniList</span>
    </label>
    {config.enabled && <>
      <p className="status-note">No key and no account needed for lookups — only the title she is checking leaves the machine.</p>
      <div className="form-grid">
        <input value={config.username} disabled={busy} placeholder="Your AniList username (optional)" onChange={event => setConfig({ ...config, username: event.target.value })} onBlur={() => save({})}/>
        <button className="ghost" disabled={busy || !config.username.trim()} onClick={() => void check()}>Check the profile</button>
      </div>
      <p className="status-note">{config.username.trim()
        ? 'She reads what you are watching and reading, and what you have stalled on, so she knows what you are in the middle of without being told. Read-only — she cannot change your list. Your profile has to be public: AniList refuses to show a private list to anything that is not signed in as you.'
        : 'Leave this blank and she can still look any series up; she just will not know what you are watching. Fill it in and she does.'}</p>
    </>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
  </div>;
}

/**
 * Coming up on her own, and the way back in when she does not. The two belong
 * on the same panel because the second is the answer to the first failing, and
 * somebody hunting for a manual launcher is already having the bad day.
 */
/**
 * Reaching her from a phone.
 *
 * The password is typed here and never read back — there is no getter for it in
 * the bridge, only a setter and a "does one exist". The device list is the part
 * that earns its place: a phone that is lost is the realistic way this goes
 * wrong, and it is no use knowing that unless the phone can be turned off from
 * the machine at home.
 */
/**
 * Reaching her from Discord.
 *
 * The one field that is not optional is the user ID. A bot is reachable by
 * anyone who finds it, so without knowing whose messages to answer she would
 * answer everyone's — and everything she knows is in those answers.
 */
function DiscordField() {
  const [status, setStatus] = useState<{ enabled: boolean; ownerId: string; pesterHours: number; hasToken: boolean; connected: boolean; botName: string; trouble: string; checkInChannel: string } | null>(null);
  const [token, setToken] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [hours, setHours] = useState(3);
  const [checkInChannel, setCheckInChannel] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () => window.haru?.discord.status().then(s => { setStatus(s); setOwnerId(s.ownerId); setHours(s.pesterHours); setCheckInChannel(s.checkInChannel); });
    read();
    // Polled while the panel is open: the interesting failures happen when a
    // message arrives, which is after anyone has stopped looking at a status.
    const timer = setInterval(read, 3000);
    return () => clearInterval(timer);
  }, []);

  if (!window.haru || !status) return null;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setMessage(null);
    try {
      await action();
      setStatus(await window.haru!.discord.status());
      setMessage({ text: done });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*':s*(Error:s*)?/, '') : String(error), error: true });
    } finally { setBusy(false); }
  }

  return <div className="field"><h2>Reaching her from Discord</h2>
    <p>She answers you in a direct message, and brings things up herself — which the web version cannot do, because a browser tab cannot make your phone buzz.</p>
    <p className="status-note">Make a bot at discord.com/developers, turn on the Message Content intent, and invite it to any server you are both in — Discord will not let it message you otherwise. Then paste its token here. Turn on Developer Mode in Discord to copy your own user ID.</p>
    <div className="form-grid">
      <input type="password" value={token} disabled={busy} placeholder={status.hasToken ? 'A token is saved — type a new one to replace it' : 'Bot token'} onChange={event => setToken(event.target.value)}/>
      <button className="ghost" disabled={busy || !token.trim()} onClick={() => void run(async () => { await window.haru!.discord.setToken(token); setToken(''); }, 'Token saved, encrypted by the system.')}>Save token</button>
    </div>
    <div className="form-grid">
      <input value={ownerId} disabled={busy} placeholder="Your Discord user ID — 18 digits, not your username" onChange={event => setOwnerId(event.target.value)}/>
      <label className="check">
        Pester every
        <input type="number" min={1} max={12} value={hours} disabled={busy} style={{ width: '4rem' }} onChange={event => setHours(Number(event.target.value))}/>
        hours
      </label>
    </div>
    <div className="form-grid">
      <input value={checkInChannel} disabled={busy} placeholder="Check-in channel id — optional" onChange={event => setCheckInChannel(event.target.value)}/>
      <span className="status-note">Anything you post there is written down as a check-in, without her having to work out that it was one. Leave it empty and she decides from what you say.</span>
    </div>
    <div className="row">
      <button className="ghost" disabled={busy} onClick={() => void run(() => window.haru!.discord.set({ ownerId: ownerId.trim(), pesterHours: hours, enabled: status.enabled, checkInChannel }), 'Saved.')}>Save</button>
      <label className="check">
        <input type="checkbox" checked={status.enabled} disabled={busy || !status.hasToken}
          onChange={event => void run(() => window.haru!.discord.set({ ownerId: ownerId.trim(), pesterHours: hours, enabled: event.target.checked, checkInChannel }), event.target.checked ? 'Connecting…' : 'Disconnected.')}/>
        Let her use Discord
      </label>
    </div>
    {status.enabled && <p className="status-note">{status.botName ? `Connected as ${status.botName}. Message her.` : status.connected ? 'Connecting…' : 'Switched on but not connected.'}</p>}
    {status.trouble && <p className="status-error">{status.trouble}</p>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
  </div>;
}

function WebField() {
  const [status, setStatus] = useState<WebStatus | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.haru?.web.status().then(state => { setStatus(state); setUsername(state.username); }); }, []);

  if (!window.haru || !status) return null;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setMessage(null);
    try {
      await action();
      setStatus(await window.haru!.web.status());
      setMessage({ text: done });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '') : String(error), error: true });
    } finally { setBusy(false); }
  }

  return <div className="field"><h2>Reaching her from a phone</h2>
    <p>A small web version of her — the conversation, the agenda, the journal and what she remembers. Not her screen, her voice, or anything that touches this machine.</p>
    <p className="status-note">She listens only to this computer, so a phone cannot reach her until you put a tunnel in front of it. That is deliberate: it means there is no setting here that can accidentally publish her to the local wifi in plain text.</p>
    <div className="form-grid">
      <input value={username} disabled={busy} placeholder="A name to sign in with" onChange={event => setUsername(event.target.value)}/>
      <input type="password" value={password} disabled={busy} placeholder={status.hasPassword ? 'A password is set — type a new one to replace it' : 'At least 12 characters'} onChange={event => setPassword(event.target.value)}/>
    </div>
    <div className="row">
      <button className="ghost" disabled={busy || !username.trim() || !password.trim()}
        onClick={() => void run(async () => { await window.haru!.web.setPassword(username.trim(), password); setPassword(''); }, 'Password set. Every remembered device has been signed out.')}>Set password</button>
      <label className="check">
        <input type="checkbox" checked={status.enabled} disabled={busy || !status.hasPassword}
          onChange={event => void run(() => window.haru!.web.setEnabled(event.target.checked), event.target.checked ? 'Open.' : 'Closed.')}/>
        Let her be reached
      </label>
    </div>
    {status.enabled && <p className="status-note">{status.running
      ? `Listening on 127.0.0.1:${status.port}. Point your tunnel at that.`
      : (status.trouble || 'Switched on, but the door did not open.')}</p>}
    {status.devices.length > 0 && <>
      <p className="status-note">Signed in and remembered:</p>
      {status.devices.map(device => <div key={device.id} className="row">
        <span className="grow">{device.name}<span className="status-note"> — last used {device.lastSeen ? new Date(device.lastSeen).toLocaleDateString() : 'never'}</span></span>
        <button className="ghost" disabled={busy} onClick={() => void run(() => window.haru!.web.forgetDevice(device.id), 'That device will have to sign in again.')}>Sign it out</button>
      </div>)}
    </>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
  </div>;
}

function StartupField() {
  const [state, setState] = useState<{ autoStart: boolean; shortcut: boolean; packaged: boolean } | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.haru?.startup.get().then(setState); }, []);

  if (!window.haru || !state) return null;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setMessage(null);
    try {
      await action();
      setState(await window.haru!.startup.get());
      setMessage({ text: done });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '') : String(error), error: true });
    } finally { setBusy(false); }
  }

  return <div className="field"><h2>Starting up</h2>
    <p>She can come up with Windows, as the character on your desktop and nothing else — no chat window in your face while you are trying to get at something. Open her from her own right-click menu when you want to talk.</p>
    <label className="check-row">
      <input type="checkbox" checked={state.autoStart} disabled={busy}
        onChange={event => run(() => window.haru!.startup.setAutoStart(event.target.checked), event.target.checked ? 'She will start with Windows.' : 'She will not start on her own.')}/>
      <span>Start Haru when I sign in</span>
    </label>
    <div className="memory-group"><h3>If she does not come up</h3>
      <p>{state.shortcut ? 'There is a Haru shortcut on your desktop. Write it again if it has stopped working, or after moving the app.' : 'Put a shortcut on your desktop to start her by hand. Worth having whether or not the above is switched on.'}</p>
      <div className="row-actions"><button className="ghost" disabled={busy} onClick={() => run(() => window.haru!.startup.createShortcut(), 'Haru is on your desktop.')}>{state.shortcut ? 'Write the shortcut again' : 'Put Haru on my desktop'}</button></div>
    </div>
    {!state.packaged && <p className="status-note">Running from source, so both of these point at this project folder and its dev Electron. Move or rebuild the app and they need writing again.</p>}
    {message && <p className={message.error ? 'status-error' : 'status-ok'}>{message.text}</p>}
  </div>;
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
          <p>{status.connected ? `Connected${status.email ? ` as ${status.email}` : ''}. Events and tasks Haru saves are added to your Google account.` : 'Credentials saved. Connect your account to start syncing.'}</p>
          {status.connected && !status.tasksGranted && <p className="status-error">Tasks permission was not granted, so only calendar events sync. Disconnect and connect again, ticking the Tasks checkbox, to sync your task list too.</p>}
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

export function CharacterModelRow({ model, importing, onImport, onRemove }: {
  model: { name: string; url: string } | null;
  importing: boolean; onImport(): void; onRemove(): void;
}) {
  return <>
    <div className="model-row" aria-label="Live2D character model">
      <Sparkles size={13}/>
      {model
        ? <><span className="model-name" title={model.name}>{model.name}</span><button className="remove-model" onClick={onRemove}><Trash2 size={12}/> Remove</button></>
        : <><span className="model-name muted">No Live2D model</span><button className="import-model" onClick={onImport} disabled={importing}><Import size={13}/>{importing ? 'Opening…' : 'Import Live2D'}</button></>}
    </div>
  </>;
}

/**
 * Everything she has been taught to mishear less.
 *
 * Worth showing rather than leaving as an invisible store, for one reason: a
 * substitution applied to every future transcript is exactly the kind of thing
 * that becomes wrong later and is impossible to find. The use count is the
 * useful column — a rule that has never fired is either unnecessary or written
 * against a mishearing that does not recur, and either way it is clutter.
 */
function Corrections() {
  const [rules, setRules] = useState<{ heard: string; meant: string; used: number }[] | null>(null);
  useEffect(() => { window.haru?.listen.corrections().then(setRules); }, []);
  if (!window.haru || !rules) return null;
  return <div className="stack">
    <span>What she has been taught {rules.length > 0 && `— ${rules.length}`}</span>
    {rules.length === 0
      ? <span className="status-note">Nothing yet. When she mishears you, hover the message and press <strong>No</strong> under it — say what you actually said and the substitution lands here, applied to everything she hears afterwards.</span>
      : <>
        <ul className="corrections">
          {rules.map(rule => <li key={rule.heard}>
            <span className="heard">{rule.heard}</span>
            <span className="arrow">→</span>
            <span className="meant">{rule.meant}</span>
            {/* Plain count rather than "never used", which reads as a scolding
                for a rule that simply has not come up yet. */}
            <span className="used">{rule.used === 0 ? 'not yet used' : `${rule.used}×`}</span>
            <button className="reaction" title="Forget this one"
              onClick={() => void window.haru!.listen.forgetCorrection(rule.heard).then(setRules)}><X size={12}/></button>
          </li>)}
        </ul>
        <span className="status-note">Applied after the speech server has finished, never fed to it as a hint — priming the model makes it return the hint itself when it hears near-silence, which then arrives as though you had said it. Whole words only, so a rule for one word cannot rewrite the middle of another.</span>
      </>}
  </div>;
}

/**
 * "Was that right?", under anything she heard rather than read.
 *
 * Only on spoken messages, and only once — a prompt under every line would be
 * noise, and the whole value is that it appears exactly where a mistake would
 * have been made. Correcting it teaches a substitution that is applied to every
 * future transcript; see hearing.ts.
 */
function HeardCheck({ heard }: { heard: string }) {
  const [state, setState] = useState<'asking' | 'fixing' | 'done' | 'hidden'>('asking');
  const [meant, setMeant] = useState('');
  if (!window.haru || state === 'hidden') return null;
  if (state === 'done') return <p className="heard-note">Noted — she will hear that right next time.</p>;
  if (state === 'fixing') {
    const teach = async () => {
      const said = meant.trim();
      if (!said || said === heard) { setState('hidden'); return; }
      await window.haru!.listen.correct(heard, said);
      setState('done');
    };
    return <div className="heard-fix">
      <input autoFocus value={meant} placeholder="What did you actually say?"
        onChange={event => setMeant(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void teach(); } if (event.key === 'Escape') setState('hidden'); }}/>
      <button className="ghost" onClick={() => void teach()} disabled={!meant.trim()}>Teach her</button>
      <button className="ghost" onClick={() => setState('hidden')}>Cancel</button>
    </div>;
  }
  return <div className="heard-check">
    <span>Heard that right?</span>
    <button className="reaction" onClick={() => setState('hidden')} title="It was right">Yes</button>
    {/* Seeded with what was heard so only the wrong word has to be changed. */}
    <button className="reaction" onClick={() => { setMeant(heard); setState('fixing'); }} title="Tell her what you actually said">No</button>
  </div>;
}

export function MessageBubble({ message, onReact, onReply }: { message: Message; onReact?(reaction: Reaction): void; onReply?(): void }) {
  // Only Haru's own replies can be rated or replied to, and the greeting is not
  // a real reply. Nothing to act on when she did not actually say anything.
  const actionable = message.role === 'assistant' && message.id !== 'greeting' && !message.ignored;
  return <article className={'bubble-row '+message.role}><div className="assistant-dot" aria-hidden="true"/><div className="bubble-stack">
    {/* Kept on the message itself, so which reply was meant stays readable long
        after the exchange rather than only while it is being written. */}
    {message.replyTo && <div className="reply-quote"><CornerDownRight size={11}/><span>{message.replyTo.excerpt}</span></div>}
    <div className={message.ignored ? 'bubble ignored' : 'bubble'}>{message.content}</div>
    {/* Only under what she heard, and only for the person who said it. */}
    {message.role === 'user' && message.heard && <HeardCheck heard={message.heard}/>}
    {actionable && onReact && <div className={message.reaction ? 'reactions rated' : 'reactions'}>
      <button className={message.reaction === 'up' ? 'reaction reacted' : 'reaction'} onClick={() => onReact('up')} aria-pressed={message.reaction === 'up'} title="Good response"><ThumbsUp size={13}/></button>
      <button className={message.reaction === 'down' ? 'reaction reacted' : 'reaction'} onClick={() => onReact('down')} aria-pressed={message.reaction === 'down'} title="Poor response"><ThumbsDown size={13}/></button>
      {onReply && <button className="reaction" onClick={onReply} title="Reply to this one — tells her exactly which reply you mean"><Reply size={13}/></button>}
    </div>}
  </div></article>;
}
// The draft lives in state, not a plain local: `sending` toggling re-renders the
// composer, which would reset a local and leave the (uncontrolled) input showing
// text that submit could no longer see.
/**
 * How tall the box may grow before it scrolls instead.
 *
 * About seven lines. Past that the message has stopped being a chat line, and a
 * composer that keeps growing eats the conversation it is part of.
 */
const COMPOSER_MAX_HEIGHT = 168;

export function Composer({ sending, replyingTo, onCancelReply, onSend, onShowPicture }: { sending: boolean; replyingTo?: { id: string; excerpt: string } | null; onCancelReply?(): void; onSend(text: string, heard?: string): void; onShowPicture?(reaction: string | null, saved: string): void }) {
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // Grows with what is in it, up to a ceiling.
  //
  // Measured from scrollHeight rather than counted in lines, because a wrapped
  // line takes the same room as a typed one and counting newlines misses it.
  // The reset to 'auto' first is what makes it shrink again — without it the
  // box only ever gets taller, since scrollHeight cannot report less than the
  // height already set.
  useEffect(() => {
    const field = box.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [draft]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    onSend(text);
  }
  // Dictation lands in the box rather than replacing it, so a half-typed
  // sentence finished out loud still works.
  function dictated(text: string, send: boolean) {
    if (send) {
      setDraft('');
      // Spoken, so her answer to it should hand the microphone back rather than
      // ending the exchange. Asked for before the send, since the reply — and
      // the speech that follows it — is what the window waits on.
      //
      // Unless they were saying goodbye. That still goes through and still lands
      // in the transcript — the conversation is kept, it is only the listening
      // that stops — but reopening the microphone after being thanked is exactly
      // the thing that makes her feel like she is hovering.
      if (!readsAsFarewell(text)) void window.haru?.chat.expectAnswer();
      // The transcript travels with the message so "was that right?" can teach a
      // correction against exactly what was misheard, rather than against
      // whatever the sentence was edited into afterwards.
      onSend(text, text);
      return;
    }
    setDraft(current => (current.trim() ? `${current.replace(/\s+$/, '')} ${text}` : text));
  }
  return <div className="compose-wrap">
    {replyingTo && <div className="replying-to"><CornerDownRight size={12}/><span>Replying to: {replyingTo.excerpt}</span><button onClick={onCancelReply} aria-label="Cancel reply"><X size={12}/></button></div>}
    <form className="compose" onSubmit={submit}>
      <MicButton sending={sending} onText={dictated}/>
      {/* The note travels with the picture and is cleared, because it has been
          asked. With nothing typed she looks and says nothing — showing someone
          a photograph is not the same as asking their opinion of it. */}
      <PictureButton note={draft} onShown={(reaction, saved) => { setDraft(''); onShowPicture?.(reaction, saved); }}/>
      {/* Anything that is not a picture. Same destination, wider picker. */}
      <AttachButton note={draft} onShown={(reaction, saved) => { setDraft(''); onShowPicture?.(reaction, saved); }}/>
      {/* Never disabled. Locking the box while she thinks means the sentence you
          had in your head has to survive her reply, and a reply can take five
          seconds — you lose the thought, not the time. Send is still gated, so
          nothing is sent twice; you can simply keep typing while she catches up. */}
      {/* A textarea rather than an input, because an input cannot hold a newline
          at all — shift+enter in one does nothing, whatever you bind to it.
          Enter still sends; shift+enter breaks the line. */}
      <textarea ref={box} rows={1} value={draft}
        placeholder={replyingTo ? 'What did she get wrong?' : sending ? 'Keep typing — she is still thinking…' : 'Say something to Haru…'}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          // Not while an IME is composing: enter is how you accept a candidate
          // in Japanese or Chinese input, and sending there would fire on every
          // word rather than at the end of the sentence.
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit(event);
        }}/>
      <button disabled={sending || !draft.trim()}>{sending ? 'Thinking…' : 'Send'}</button>
    </form>
  </div>;
}

/**
 * Press to start, press again to stop — not hold-to-talk. Holding a key is fine
 * for a word and miserable for a sentence, and the whole point of this is not
 * having to keep your hands on the keyboard.
 *
 * Absent entirely until speech to text is switched on, rather than sitting there
 * greyed out: a button that cannot work is worse than no button.
 */
function MicButton({ sending, onText }: { sending: boolean; onText(text: string, send: boolean): void }) {
  const [config, setConfig] = useState<ListenConfig | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'thinking'>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<Recorder | null>(null);

  useEffect(() => {
    if (!window.haru) return;
    // The saved level reaches the chime module here. Both readers do it: the
    // panel so "Hear it" plays what the slider says, and the mic button because
    // that is the component that actually rings it.
    const apply = (saved: ListenConfig) => { setConfig(saved); setChimeVolume(saved.chimeVolume); };
    window.haru.listen.get().then(apply);
    return window.haru.listen.onChange(apply);
  }, []);

  // Only while recording, and torn down the moment it stops.
  useEffect(() => {
    if (state !== 'recording') return;
    let frame = 0;
    const tick = () => { setLevel(recorder.current?.level() ?? 0); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  // Held as state rather than a ref, deliberately: the listening effects depend
  // on it, so flipping it re-runs them and their cleanup releases the device.
  // A ref would silence the handlers and leave the stream open, which is the
  // bug this replaced.
  const [muted, setMuted] = useState(false);

  // Answering to her name. Kept in a ref rather than state so the utterance
  // handler, which outlives any one render, always sees the current settings.
  const armed = useRef(false);
  const awake = useRef(false);
  const wakeConfig = useRef<ListenConfig | null>(null);
  /**
   * Whichever listener currently has the microphone, shared because the two
   * effects below both need to ask "are they still talking?" and only one of
   * them owns a listener at a time — with the wake word on, the reply window
   * opens nothing of its own and would otherwise have nothing to ask.
   */
  const openMic = useRef<Listener | null>(null);
  wakeConfig.current = config;
  const [heard, setHeard] = useState(false);

  useEffect(() => {
    if (!window.haru || !config || config.engine === 'off' || !config.wakeWord || muted) return;
    let listener: Listener | null = null;
    let cancelled = false;
    // A bare "Haru?" opens a window for the next thing said, and closes again if
    // nothing follows — otherwise one stray summons leaves her transcribing the
    // room until something happens to look like a sentence.
    let closeWindow: ReturnType<typeof setTimeout> | undefined;

    /**
     * The window ends when they have stopped talking, not when the clock says so.
     *
     * The microphone cuts a clip on silence, and a room that is never quiet does
     * not produce silence — so an answer begun inside the window could still be
     * mid-capture when it expired, and arrived to find the door shut. Waiting for
     * the utterance to finish costs nothing when nobody is speaking, and saves
     * the one case that matters.
     */
    // Bounded. Waiting for them to finish a sentence is right; waiting for ever
    // is not, and a room with a television in it can hold the detector in
    // "speech" indefinitely. Left unbounded the window never closes, `heard`
    // never returns to false, and the *next* window opens with no transition —
    // so no chime and no indicator, which looks like the feature being dead.
    let deferrals = 0;
    const shutIfNotMidSentence = () => {
      if (openMic.current?.speaking() && deferrals++ < MAX_CLOSE_DEFERRALS) {
        closeWindow = setTimeout(shutIfNotMidSentence, 1000);
        return;
      }
      deferrals = 0;
      awake.current = false;
      setHeard(false);
    };

    void (async () => {
      try {
        const started = await startListening(async clip => {
          if (cancelled) return;
          try {
            const text = await window.haru!.listen.transcribe(clip.bytes, clip.mime);
            if (!text) return;
            if (awake.current) {
              // Already summoned: take this as the message without needing the
              // name again.
              if (!isUsableFollowUp(text)) return;
              clearTimeout(closeWindow);
              awake.current = false;
              setHeard(false);
              onText(text, true);
              return;
            }
            // Said outside a window, so she was not being spoken to — a stray
            // "thanks" across the room is not a conversation to close.
            const match = matchWake(text);
            if (!match.woken) return;
            if (match.message) { onText(match.message, true); return; }
            awake.current = true;
            setHeard(true);
            clearTimeout(closeWindow);
            closeWindow = setTimeout(shutIfNotMidSentence, WAKE_WINDOW_MS);
          } catch { /* a failed transcription is not worth interrupting her for */ }
        });
        if (cancelled) { started.stop(); return; }
        listener = started;
        openMic.current = started;
        armed.current = true;
      } catch {
        setError('No microphone, or permission was refused.');
      }
    })();

    return () => {
      cancelled = true;
      armed.current = false;
      awake.current = false;
      clearTimeout(closeWindow);
      if (openMic.current === listener) openMic.current = null;
      listener?.stop();
    };
  }, [config?.engine, config?.wakeWord, config?.autoSend, muted]);

  // She spoke first and has stopped, so the next thing said is an answer.
  //
  // Two ways in, depending on what is already running. With the wake word on the
  // microphone is open regardless, so this only lifts the requirement to say her
  // name. Without it, the microphone is opened for the length of the window and
  // closed again — a few seconds at a moment she chose, rather than always.
  useEffect(() => {
    if (!window.haru || !config || config.engine === 'off' || !config.replyWindow || muted) return;
    let temporary: Listener | null = null;
    let shut: ReturnType<typeof setTimeout> | undefined;
    let gone = false;

    const close = () => {
      clearTimeout(shut);
      if (openMic.current === temporary) openMic.current = null;
      temporary?.stop();
      temporary = null;
      awake.current = false;
      setHeard(false);
    };

    /** As in the wake path: do not shut the window on someone mid-sentence. */
    // Bounded, for the reason given on the wake path: a window that never
    // closes never reopens, and takes the chime and the indicator with it.
    let deferrals = 0;
    const closeUnlessSpeaking = () => {
      if (openMic.current?.speaking() && deferrals++ < MAX_CLOSE_DEFERRALS) {
        shut = setTimeout(closeUnlessSpeaking, 1000);
        return;
      }
      deferrals = 0;
      close();
    };

    const unsubscribe = window.haru.chat.onExpectReply(() => {
      if (gone) return;
      awake.current = true;
      setHeard(true);
      clearTimeout(shut);
      shut = setTimeout(closeUnlessSpeaking, WAKE_WINDOW_MS);
      // Already listening for her name: nothing to open, the flag is enough.
      if (config.wakeWord || temporary) return;
      void (async () => {
        try {
          const started = await startListening(async clip => {
            if (gone || !awake.current) return;
            try {
              const text = await window.haru!.listen.transcribe(clip.bytes, clip.mime);
              if (!text || !isUsableFollowUp(text)) return;
              // Either way the window shuts and the message is sent; the
              // difference is that a sign-off does not get another one after
              // her reply, which Composer decides by reading the same rule.
              close();
              onText(text, true);
            } catch { /* nothing worth interrupting her for */ }
          });
          if (gone || !awake.current) { started.stop(); return; }
          temporary = started;
          openMic.current = started;
        } catch { /* no microphone; the button still says so */ }
      })();
    });

    return () => { gone = true; close(); unsubscribe?.(); };
  }, [config?.engine, config?.replyWindow, config?.wakeWord, config?.autoSend, muted]);

  // A sound for the microphone opening and closing.
  //
  // Driven off the state rather than added at each of the six places that set
  // it: they are spread across two effects and a button handler, and one of
  // them being missed is precisely how you end up not trusting the chime.
  // Transitions only, so a re-render is silent.
  const soundedAt = useRef(false);
  const openEar = state === 'recording' || heard;
  useEffect(() => {
    if (openEar === soundedAt.current) return;
    soundedAt.current = openEar;
    // Muting is a request not to be listened to; a chime announcing that would
    // be a strange thing to hear.
    if (muted) return;
    if (openEar) chimeListening(); else chimeStoppedListening();
  }, [openEar, muted]);

  if (!window.haru || !config || config.engine === 'off') return null;

  async function toggle() {
    setError(null);
    // Muted is a state you leave by pressing the same button that entered it.
    if (muted) { setMuted(false); return; }
    if (state === 'recording') {
      const active = recorder.current;
      recorder.current = null;
      setState('thinking');
      try {
        const clip = await active?.stop();
        if (!clip) { setState('idle'); return; }
        const text = await window.haru!.listen.transcribe(clip.bytes, clip.mime);
        if (text) onText(text, config!.autoSend && !sending);
      } catch (problem) {
        setError(problem instanceof Error ? problem.message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '') : String(problem));
      } finally {
        setState('idle');
        setLevel(0);
      }
      return;
    }
    try {
      recorder.current = await startRecording();
      setState('recording');
    } catch {
      setError('No microphone, or permission was refused.');
    }
  }

  const label = muted ? 'Muted — press to let her listen again'
    : state === 'recording' ? 'Stop and transcribe'
    : state === 'thinking' ? 'Transcribing…'
    : heard ? 'Listening — say what you want'
    : config.wakeWord ? 'Say "Hey Haru", or press to talk'
    : 'Press to talk';
  const shown = heard ? 'recording' : state;
  // Shutting her ears without touching the settings. The wake word and the
  // reply window both open the microphone on their own, so with a television in
  // the room there has to be a way to say "not now" that does not mean going
  // into Setup and turning a feature off you want back in ten minutes.
  /**
   * A real mute, not a pause.
   *
   * The first version cleared the wake window and stopped any recording, and the
   * microphone stayed on — because with the wake word enabled the open stream is
   * a separate long-lived listener that none of that touched. The light stayed
   * lit and the room was still being transcribed, which is the opposite of what
   * pressing stop is for.
   *
   * Muting sets a flag the listening effects depend on, so React tears the
   * stream down as part of its own cleanup and the device is genuinely released.
   */
  function hush() {
    setMuted(true);
    awake.current = false;
    setHeard(false);
    const active = recorder.current;
    recorder.current = null;
    void active?.stop().catch(() => undefined);
    setState('idle');
    setLevel(0);
    setError(null);
  }

  const listening = state === 'recording' || heard;
  return <>
    <button type="button" className={`mic mic-${shown}${config.wakeWord && !muted ? ' mic-armed' : ''}${muted ? ' mic-muted' : ''}`} onClick={toggle} disabled={state === 'thinking'} title={error ?? label} aria-label={label}>
      {state === 'thinking'
        ? <span className="mic-thinking"/>
        : muted
        ? <MicOff size={15}/>
        : <><Mic size={15}/>{listening && <span className="mic-level" style={{ transform: `scaleY(${0.25 + level * 0.75})` }}/>}</>}
    </button>
    {/* Only while there is something to stop, so it is never a dead control. */}
    {listening && <button type="button" className="mic-stop" onClick={hush} title="Stop listening — discards what she has heard so far" aria-label="Stop listening">
      <Square size={11}/>
    </button>}
    {error && <span className="mic-error" title={error}>!</span>}
  </>;
}

/**
 * Showing her something. Whatever is already in the box travels with the
 * picture as a note, so "look at this state of my desk" works as one action
 * rather than a message and then a file.
 *
 * Absent unless it is switched on, like the microphone — a button that opens a
 * file picker and then fails is worse than no button.
 */
function PictureButton({ note, onShown }: { note: string; onShown(reaction: string | null, saved: string): void }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { window.haru?.vision.get().then(config => setOn(config.enabled)); }, []);
  if (!window.haru || !on) return null;
  async function show() {
    setBusy(true); setError(null);
    try {
      const result = await window.haru!.vision.show(note, 'picture');
      // The path comes back whether or not she said anything, so the picture can
      // be recorded in the conversation even when she is holding her tongue.
      if (result) onShown(result.reaction, result.saved);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message.replace(/^Error invoking remote method .[^.]*.:s*(Error:s*)?/, '') : String(problem));
    } finally { setBusy(false); }
  }
  return <>
    <button type="button" className="mic" onClick={() => void show()} disabled={busy} title={error ?? 'Show her a picture'} aria-label="Show her a picture">
      {busy ? <span className="mic-thinking"/> : <ImagePlus size={15}/>}
    </button>
    {error && <span className="mic-error" title={error}>!</span>}
  </>;
}

/**
 * Anything else — sound, video, a document, a spreadsheet.
 *
 * A separate button from the picture one, and worth the extra control rather
 * than widening that filter. The machinery already accepted every kind of file,
 * but the only way in was a button captioned "Show her a picture", so there was
 * nothing to suggest you could hand her a voice note. A feature nobody can find
 * is not shipped.
 *
 * Both end at the same place. The split is only which files the dialog offers:
 * pictures are the common case and deserve a picker that is not cluttered with
 * every extension she can read.
 */
function AttachButton({ note, onShown }: { note: string; onShown(reaction: string | null, saved: string): void }) {
  const [ready, setReady] = useState<{ vision: boolean; ffmpeg: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!window.haru) return;
    void Promise.all([window.haru.vision.get(), window.haru.openai.status()])
      .then(([vision, openai]) => setReady({ vision: vision.enabled, ffmpeg: openai.ffmpeg }));
  }, []);
  if (!window.haru || !ready?.vision) return null;
  async function attach() {
    setBusy(true); setError(null);
    try {
      const result = await window.haru!.vision.show(note, 'any');
      if (result) onShown(result.reaction, result.saved);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message.replace(/^Error invoking remote method .[^.]*.:s*(Error:s*)?/, '') : String(problem));
    } finally { setBusy(false); }
  }
  // Said in the tooltip rather than discovered at the file dialog, since sound
  // and video are exactly the things someone would reach for first.
  const label = ready.ffmpeg
    ? 'Give her a file — sound, video, a PDF, text or data'
    : 'Give her a file — PDFs, text and data (sound and video need ffmpeg)';
  return <>
    <button type="button" className="mic" onClick={() => void attach()} disabled={busy} title={error ?? label} aria-label={label}>
      {busy ? <span className="mic-thinking"/> : <Paperclip size={15}/>}
    </button>
    {error && <span className="mic-error" title={error}>!</span>}
  </>;
}

/**
 * How many seconds past the window she will wait for someone to finish talking.
 *
 * Finite on purpose: the wait exists so a sentence begun inside the window is
 * not cut off, and a room that is never quiet would otherwise hold it open for
 * ever — which is worse than closing early, because a window that never closes
 * never reopens either.
 */
const MAX_CLOSE_DEFERRALS = 8;

/** How long a bare "Haru?" leaves her listening for what comes next. */
const WAKE_WINDOW_MS = 8000;

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const VIEWS: { view: CalendarView; label: string }[] = [
  { view: 'day', label: 'Day' },
  { view: 'week', label: 'Week' },
  { view: 'month', label: 'Month' },
  { view: 'year', label: 'Year' },
];

/**
 * The picker.
 *
 * The month arrows always worked — stepping August to September was never the
 * bug. What was wrong is that you could not see them: measured against the light
 * ground their border came out at 1.23:1, so the button had no visible edge and
 * there was nothing to aim at. They are proper controls now, and Today is its
 * own button rather than a secret hidden on the month label, which is where it
 * used to live and where nobody would ever find it.
 */
export function Calendar({ items, selected, view, onSelect, onView }: {
  items: KeptItem[]; selected: string; view: CalendarView;
  onSelect(date: string): void; onView(view: CalendarView): void;
}) {
  const grid = useMemo(() => {
    const [year, month] = selected.split('-').map(Number);
    return buildMonthGrid(year, month - 1);
  }, [selected]);
  const marks = useMemo(() => {
    const map = new Map<string, { task: boolean; event: boolean }>();
    for (const item of items) {
      const entry = map.get(item.date) ?? { task: false, event: false };
      entry[item.kind] = true;
      map.set(item.date, entry);
    }
    return map;
  }, [items]);
  const today = toISODate(new Date());
  const week = useMemo(() => weekOf(selected), [selected]);
  const [year, month] = selected.split('-').map(Number);

  /** One step back or forward, in whatever unit is on screen. */
  function step(delta: number) {
    if (view === 'day') return onSelect(shiftISODate(selected, delta));
    if (view === 'week') return onSelect(shiftISODate(selected, delta * 7));
    const d = new Date(year, month - 1 + (view === 'month' ? delta : delta * 12), 1);
    // Kept on the same day of the month where possible, so stepping through
    // months from the 15th does not silently walk to the 1st.
    const day = Math.min(Number(selected.slice(8)), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    onSelect(toISODate(new Date(d.getFullYear(), d.getMonth(), day)));
  }

  const dayCell = (date: string, label: number | string, outside: boolean) => {
    const mark = marks.get(date);
    const classes = ['cal-day'];
    if (outside) classes.push('outside');
    if (date === today) classes.push('today');
    if (date === selected) classes.push('selected');
    return <button key={date} className={classes.join(' ')} onClick={() => onSelect(date)}
      aria-label={dayLabel(date)} aria-current={date === selected ? 'date' : undefined}>
      <span>{label}</span>
      {mark && <i className="cal-dots">{mark.event && <em className="dot event"/>}{mark.task && <em className="dot task"/>}</i>}
    </button>;
  };

  return <div className="calendar">
    <div className="calendar-head">
      <button className="cal-nav" onClick={() => step(-1)} aria-label={`Previous ${view}`}><ChevronLeft size={14}/></button>
      <span className="cal-month">{rangeLabel(view, selected)}</span>
      <button className="cal-nav" onClick={() => step(1)} aria-label={`Next ${view}`}><ChevronRight size={14}/></button>
    </div>

    <div className="cal-controls">
      <div className="cal-views" role="group" aria-label="Calendar view">
        {VIEWS.map(option => <button key={option.view}
          className={view === option.view ? 'cal-view selected' : 'cal-view'}
          aria-pressed={view === option.view}
          onClick={() => onView(option.view)}>{option.label}</button>)}
      </div>
      <button className="cal-today" onClick={() => onSelect(today)} disabled={selected === today}>Today</button>
    </div>

    {view === 'month' && <>
      <div className="calendar-weekdays">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="calendar-grid">{grid.map(cell => dayCell(cell.date, cell.day, !cell.inMonth))}</div>
    </>}

    {view === 'week' && <>
      <div className="calendar-weekdays">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="calendar-grid week">{week.map(date => dayCell(date, Number(date.slice(8)), false))}</div>
    </>}

    {view === 'day' && <div className="cal-single">{dayCell(selected, Number(selected.slice(8)), false)}</div>}

    {view === 'year' && <div className="calendar-months">
      {Array.from({ length: 12 }, (_, index) => {
        const first = `${year}-${String(index + 1).padStart(2, '0')}-01`;
        const has = items.some(item => item.date.startsWith(first.slice(0, 7)));
        const classes = ['cal-monthcell'];
        if (index === month - 1) classes.push('selected');
        if (Number(today.slice(0, 4)) === year && Number(today.slice(5, 7)) === index + 1) classes.push('today');
        return <button key={index} className={classes.join(' ')}
          // Straight into that month, because picking a month in a year view and
          // staying in the year view is a dead end.
          onClick={() => { onSelect(first); onView('month'); }}>
          {new Date(year, index, 1).toLocaleDateString(undefined, { month: 'short' })}
          {has && <em className="dot"/>}
        </button>;
      })}
    </div>}
  </div>;
}

// Events and tasks are shown apart because they behave differently: an event
// happens whether or not you turn up, while a task is yours to tick off. Only
// the latter is clickable, so the affordance matches what is actually possible.
/**
 * When the day is not already obvious from the heading.
 *
 * A month view listed "Ammie's Birthday Party, 8:00 PM" with nothing saying
 * which of thirty-one evenings that was. In a day view the heading has already
 * said it and repeating it on every row is noise.
 */
function whenLabel(item: KeptItem, view: CalendarView): string {
  const parts: string[] = [];
  if (view !== 'day') {
    const [year, month, day] = item.date.split('-').map(Number);
    parts.push(new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      // The month only matters once the range can span more than one.
      ...(view === 'month' || view === 'year' ? { month: 'short' } : {}),
    }).format(new Date(year, month - 1, day)));
  }
  if (item.time) parts.push(item.time);
  return parts.join(' · ');
}

function AgendaSection({ label, items, checkable, view, onToggle, onJump }: { label: string; items: KeptItem[]; checkable: boolean; view: CalendarView; onToggle(id: string): void; onJump(date: string): void }) {
  if (!items.length) return null;
  // No heading inside the archive: the toggle above it already says what these
  // are, and a second label would be the same word twice.
  return <div className="agenda-section">{label && <h4>{checkable ? <SquareCheck size={10}/> : <CalendarDays size={10}/>} {label}</h4>}
    {items.map(item => {
      // Two controls, not one. Ticking and "show me that day" are both wanted on
      // the same row, and a single button cannot do both — so the shape ticks
      // and the words navigate. Separate <button>s rather than one with a click
      // target inside it, because a button inside a button is invalid and the
      // inner one stops being reachable by keyboard.
      const classes = `agenda-item ${checkable ? 'task' : 'event'}${item.done ? ' done' : ''}`;
      const when = whenLabel(item, view);
      // In a day view there is nowhere to jump to, so the words tick as well
      // rather than being a control that does nothing.
      const navigates = view !== 'day';
      return <div key={item.id} className={classes}>
        <button className="agenda-tick" onClick={() => onToggle(item.id)} aria-pressed={item.done}
          title={item.done ? 'Done — click to undo' : checkable ? 'Mark as done' : 'Mark as dealt with, so she stops asking'}>
          <i className={checkable ? 'tick' : 'dot'}>{item.done ? <Check size={11}/> : checkable ? null : <CircleDot size={11}/>}</i>
        </button>
        <button className="agenda-body" onClick={() => navigates ? onJump(item.date) : onToggle(item.id)}
          title={navigates ? 'Show that day' : item.done ? 'Done — click to undo' : 'Mark as done'}>
          <b>{item.title}</b>{when && <small>{when}</small>}
        </button>
      </div>;
    })}
  </div>;
}

export function Agenda({ items, selected, view, onToggle, onJump }: { items: KeptItem[]; selected: string; view: CalendarView; onToggle(id: string): void; onJump(date: string): void }) {
  // Shut by default. Finished work is worth being able to find and not worth
  // looking at — 15 of 16 items were done and every one of them was still in the
  // list, which leaves the two things actually outstanding buried in a column of
  // crossed-out text.
  const [showDone, setShowDone] = useState(false);
  const { tasks, events, done, passedEvents } = useMemo(() => {
    // Date first once the range is wider than a day, or a week's items arrive
    // shuffled by time of day with no sense of which day each belongs to.
    const byTime = (a: KeptItem, b: KeptItem) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');
    const inView = datesInView(view, selected);
    const day = items.filter(item => inView(item.date));
    const today = toISODate(new Date());
    // An event on a day that has been and gone. Split on the day rather than the
    // tick, because an event is never ticked — nobody marks a party finished —
    // so nothing ever moved it out of the way and a birthday from nine days ago
    // sat above the things actually coming up. Today is still today, though:
    // an event this evening stays in the list all evening, and after it too.
    const passed = (item: KeptItem) => item.kind === 'event' && item.date < today;
    return {
      tasks: day.filter(item => item.kind === 'task' && !item.done).sort(byTime),
      events: day.filter(item => item.kind === 'event' && !item.done && !passed(item)).sort(byTime),
      passedEvents: day.filter(item => !item.done && passed(item)).sort((a, b) => byTime(b, a)),
      // Newest first — what was just finished is the part anyone looks for, and
      // the reason to open this at all is usually to undo a mistaken tick.
      done: day.filter(item => item.done).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || byTime(b, a)),
    };
  }, [items, selected, view]);
  // Both belong behind the same fold: finished, or over. Newest first either way.
  const earlier = useMemo(
    () => [...done, ...passedEvents].sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '')),
    [done, passedEvents],
  );
  const nothingLeft = !tasks.length && !events.length;
  return <div className="agenda"><h3>{rangeLabel(view, selected)}</h3>
    {nothingLeft && !earlier.length
      ? <p className="nothing">{view === 'day' ? 'Nothing kept for this day.' : `Nothing kept for this ${view}.`}</p>
      : <>
        <AgendaSection label="Tasks" items={tasks} checkable view={view} onToggle={onToggle} onJump={onJump}/>
        <AgendaSection label="Events" items={events} checkable={false} view={view} onToggle={onToggle} onJump={onJump}/>
        {/* Said explicitly, because an empty list and a finished one look the
            same otherwise and one of them is worth feeling good about. */}
        {nothingLeft && earlier.length > 0 && <p className="nothing">All done{view === 'day' ? ' for today' : ''}.</p>}
        {earlier.length > 0 && <div className="agenda-archive">
          <button className="archive-toggle" onClick={() => setShowDone(current => !current)} aria-expanded={showDone}>
            {/* "Done" would be a lie about a party nobody ticked off. */}
            <ChevronDown size={11} className={showDone ? 'open' : ''}/> {passedEvents.length ? 'Earlier' : 'Done'} <span className="archive-count">{earlier.length}</span>
          </button>
          {showDone && <AgendaSection label="" items={earlier} checkable view={view} onToggle={onToggle} onJump={onJump}/>}
        </div>}
      </>}
  </div>;
}

export function Kept({ items, model, importing, onImport, onRemove, onToggle }: { items: KeptItem[]; model: { name: string; url: string } | null; importing: boolean; onImport(): void; onRemove(): void; onToggle(id: string): void }) {
  const [selected, setSelected] = useState(() => toISODate(new Date()));
  const [view, setView] = useState<CalendarView>('month');
  // Whether anything ticked here is actually reaching Google.
  //
  // The failure was silent from where it mattered: a revoked token was recorded
  // and shown in Setup, while ticking a task in this panel looked exactly like
  // success. Days of completions stayed on this machine and the phone never
  // heard about any of them. A sync that has stopped has to say so where the
  // ticking happens.
  const [syncError, setSyncError] = useState('');
  useEffect(() => {
    if (!window.haru) return;
    void window.haru.google.status().then(status => setSyncError(status.connected ? status.lastError ?? '' : ''));
    return window.haru.google.onChange(status => setSyncError(status.connected ? status.lastError ?? '' : ''));
  }, []);
  const pending = items.filter(item => !item.done).length;
  return <aside className="kept"><h2>Kept{pending > 0 && <span className="kept-count">{pending}</span>}</h2>
    {syncError && <p className="kept-sync-error" title={syncError}>Not reaching Google — ticking things here will not update your phone. Reconnect in Setup.</p>}
    <Calendar items={items} selected={selected} view={view} onSelect={setSelected} onView={setView}/><Agenda items={items} selected={selected} view={view} onToggle={onToggle} onJump={date => { setSelected(date); setView('day'); }}/><div className="stage-slot"><CharacterModelRow model={model} importing={importing} onImport={onImport} onRemove={onRemove}/></div></aside>;
}
export function Suggestion({ children, onClick }: { children: React.ReactNode; onClick(): void }) { return <button className="suggestion" onClick={onClick}>{children}</button>; }
