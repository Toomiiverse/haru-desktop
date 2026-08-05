import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, net, protocol, screen } from 'electron';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import Store from 'electron-store';
import { localDateKey, resolveDate, zonedNow } from './dates';
import { connectGoogle, disconnectGoogle, googleStatus, pullEvents, pushItem, removeItem, saveCredentials } from './google';
import { afterCooldown, afterEgoCooldown, afterPoke, egoInstruction, goodnightInstruction, isGoodnight, isIgnoring, isLowEffort, leverageInstruction, moodInstruction, nextEgo, nextIrritation } from './mood';

type Bounds = { x: number; y: number; width: number; height: number };
type Live2DModel = { path: string; name: string; url: string };
type KeptItem = { id: string; title: string; date: string; time?: string; kind: 'reminder' | 'event'; done: boolean; googleEventId?: string };
type Profile = { nickname: string; occupation: string; about: string };
type Memory = { id: string; text: string; createdAt: string };

const COMPANION_DEFAULT_WIDTH = 300;
const COMPANION_ASPECT = 360 / 300;
const COMPANION_MIN_WIDTH = 140;
const COMPANION_MAX_WIDTH = 900;
const COMPANION_MARGIN = 60;
const CURSOR_POLL_MS = 33;
const CHAT_TIMEZONE = 'Australia/Perth'; // UTC+8 year-round, no DST
const CHAT_RESET_HOUR = 5;
const CHAT_RESET_POLL_MS = 60_000;
const GOOGLE_SYNC_DAYS = 30;
const GOOGLE_SYNC_INTERVAL_MS = 15 * 60_000;
// Long enough for the window to be up and the first paint done, so a slow network
// call is not competing with startup.
const GOOGLE_SYNC_STARTUP_DELAY_MS = 10_000;
const GOOGLE_FOCUS_SYNC_MIN_GAP_MS = 30_000;

const store = new Store<Record<string, unknown>>();
const live2dRoots = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([{ scheme: 'haru-model', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function modelResult(modelPath: string): Live2DModel {
  const id = createHash('sha256').update(modelPath).digest('hex');
  const root = path.dirname(modelPath);
  live2dRoots.set(id, root);
  // The id lives in the path, not the host: a 64-char sha256 hex id used as a
  // hostname exceeds the 63-octet DNS label limit, and Chromium's URL host
  // canonicalization silently drops the last character when resolving relative
  // resource URLs (moc3, textures) against it. Paths have no such limit.
  return { path: modelPath, name: path.basename(modelPath), url: `haru-model://local/${id}/${encodeURIComponent(path.basename(modelPath))}` };
}

type ZipEntry = ReturnType<InstanceType<typeof AdmZip>['getEntries']>[number];

// ZIPs written by localized Windows tools store filenames in the machine's own
// codepage without setting the UTF-8 flag. Decoding those as UTF-8 mangles any
// non-ASCII name — irreversibly, since the bad bytes become U+FFFD — so the
// assets model3.json points at stop matching what lands on disk and every
// texture 404s. The model's own references are the ground truth for what the
// names should be, so try the plausible codepages and keep whichever resolves
// the most of them.
const ZIP_NAME_ENCODINGS = ['utf-8', 'gbk', 'shift_jis', 'euc-kr', 'big5'];

function decodeEntryName(raw: Buffer, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(raw).replace(/\\/g, '/');
  } catch {
    return raw.toString('utf8').replace(/\\/g, '/');
  }
}

function modelReferences(json: unknown): string[] {
  const files = (json as { FileReferences?: Record<string, unknown> } | null)?.FileReferences;
  if (!files) return [];
  const references: string[] = [];
  const add = (value: unknown) => { if (typeof value === 'string') references.push(value); };
  add(files.Moc); add(files.Physics); add(files.Pose); add(files.DisplayInfo); add(files.UserData);
  if (Array.isArray(files.Textures)) files.Textures.forEach(add);
  if (Array.isArray(files.Expressions)) files.Expressions.forEach(entry => add((entry as { File?: unknown })?.File));
  if (files.Motions && typeof files.Motions === 'object') {
    for (const group of Object.values(files.Motions as Record<string, unknown>)) {
      if (Array.isArray(group)) group.forEach(entry => add((entry as { File?: unknown })?.File));
    }
  }
  return references;
}

// References inside model3.json are relative to its own folder, which is not the
// archive root when the ZIP wraps everything in a directory — so they are scored
// against that prefix, not against bare entry names.
function pickNameEncoding(entries: ZipEntry[], model: ZipEntry, references: string[]) {
  if (!references.length) return 'utf-8';
  let best = { encoding: 'utf-8', score: -1 };
  for (const encoding of ZIP_NAME_ENCODINGS) {
    const names = new Set(entries.map(entry => decodeEntryName(entry.rawEntryName, encoding)));
    const modelName = decodeEntryName(model.rawEntryName, encoding);
    const prefix = modelName.slice(0, modelName.lastIndexOf('/') + 1);
    const score = references.filter(reference => names.has(prefix + reference)).length;
    if (score > best.score) best = { encoding, score };
  }
  return best.encoding;
}

function unpackModel(archivePath: string) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  // Matched on the raw bytes: the suffix is ASCII, so it survives any codepage.
  const model = entries.find(entry => !entry.isDirectory && entry.rawEntryName.toString('latin1').toLowerCase().endsWith('.model3.json'));
  if (!model) throw new Error('This ZIP does not contain a .model3.json Live2D model.');
  let references: string[] = [];
  try {
    references = modelReferences(JSON.parse(zip.readAsText(model).replace(/^﻿/, '')));
  } catch {
    // Unreadable model3.json still extracts; the loader reports the real problem.
  }
  const encoding = pickNameEncoding(entries, model, references);
  const destination = path.join(app.getPath('userData'), 'live2d-models', createHash('sha256').update(`${archivePath}:${Date.now()}`).digest('hex').slice(0, 16));
  mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const target = path.resolve(destination, decodeEntryName(entry.rawEntryName, encoding));
    if (target !== destination && !target.startsWith(destination + path.sep)) throw new Error('This ZIP contains an unsafe path and was not imported.');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
  return path.join(destination, decodeEntryName(model.rawEntryName, encoding));
}

function broadcastLive2DChange(model: Live2DModel | null) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('live2d:changed', model);
}

function broadcastChatReset() {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:reset');
}

// The "chat day" runs from CHAT_RESET_HOUR to CHAT_RESET_HOUR the next day, not
// midnight to midnight — chatting with Haru at 1am shouldn't get wiped by a plain
// date rollover mid-conversation.
function currentChatDayKey(): string {
  const now = zonedNow(CHAT_TIMEZONE);
  if (now.getHours() < CHAT_RESET_HOUR) now.setDate(now.getDate() - 1);
  return localDateKey(now);
}

// Archives under the day key, suffixing when that day already has an entry —
// starting a chat manually and then letting the 5am reset fire would otherwise
// have the second archive overwrite the first.
function archiveMessages(messages: unknown[], dayKey: string) {
  const archive = (store.get('chat.archive') as Record<string, unknown[]> | undefined) ?? {};
  let key = dayKey;
  for (let n = 2; archive[key]; n++) key = `${dayKey}#${n}`;
  archive[key] = messages;
  store.set('chat.archive', archive);
}

function startNewConversation() {
  const messages = store.get('chat.messages') as unknown[] | undefined;
  if (messages?.length) archiveMessages(messages, currentChatDayKey());
  store.delete('chat.messages');
  broadcastChatReset();
}

function performChatResetIfDue() {
  const key = currentChatDayKey();
  const previousKey = store.get('chat.dayKey') as string | undefined;
  if (previousKey === key) return;
  const previousMessages = store.get('chat.messages') as unknown[] | undefined;
  if (previousKey && previousMessages?.length) archiveMessages(previousMessages, previousKey);
  store.set('chat.dayKey', key);
  store.delete('chat.messages');
  broadcastChatReset();
}

// Kept items live in the main process because the chat tool loop runs here —
// the model's tool calls write straight to the store, and every window is told
// to re-read rather than each keeping its own copy.
function getKept(): KeptItem[] {
  return (store.get('kept.items') as KeptItem[] | undefined) ?? [];
}

function setKept(items: KeptItem[]) {
  store.set('kept.items', items);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('kept:changed', items);
}

function addKeptItem(item: Omit<KeptItem, 'id' | 'done'>): KeptItem {
  const created: KeptItem = { ...item, id: randomUUID(), done: false };
  setKept([...getKept(), created]);
  // Pushed in the background: a slow or failed Google call should not hold up
  // the chat reply confirming the reminder was saved locally.
  void syncItemToGoogle(created);
  return created;
}

async function syncItemToGoogle(item: KeptItem) {
  if (!googleStatus(store).connected) return;
  try {
    const googleEventId = await pushItem(store, item, CHAT_TIMEZONE);
    // Re-read rather than closing over the old array: the tool loop may have
    // added another item while this request was in flight.
    setKept(getKept().map(current => current.id === item.id ? { ...current, googleEventId } : current));
    store.delete('google.lastError' as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[google] push failed:', message);
    store.set('google.lastError', message);
  }
}

// Pulls Google's events in as kept items, matched on the remote id so repeated
// syncs update rather than duplicate. Items Haru created are refreshed in place;
// anything already deleted locally is not resurrected.
function broadcastGoogleStatus() {
  const status = googleStatus(store);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('google:changed', status);
}

let inFlightSync: Promise<ReturnType<typeof googleStatus>> | null = null;

// Manual and scheduled syncs share whichever run is already going, so pressing
// "Sync now" while the timer is mid-sync joins that one instead of starting a
// second pass that would push the same items twice.
function syncFromGoogle() {
  if (!inFlightSync) inFlightSync = runSync().finally(() => { inFlightSync = null; });
  return inFlightSync;
}

async function runSync() {
  try {
    return await performSync();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.set('google.lastError', message);
    broadcastGoogleStatus();
    throw error;
  }
}

async function performSync() {
  const status = googleStatus(store);
  if (!status.connected) throw new Error('Haru is not connected to Google Calendar.');
  const today = localDateKey(zonedNow(CHAT_TIMEZONE));

  // Anything saved before the account was connected has no remote event yet, and
  // the push on creation only covers items made since. Sending them here is what
  // makes "Sync now" two-way rather than pull-only.
  for (const item of getKept()) {
    if (item.googleEventId || item.date < today) continue;
    try {
      const googleEventId = await pushItem(store, item, CHAT_TIMEZONE);
      setKept(getKept().map(current => current.id === item.id ? { ...current, googleEventId } : current));
    } catch (error) {
      console.error(`[google] push failed for "${item.title}":`, error);
      throw error;
    }
  }

  const events = await pullEvents(store, today, GOOGLE_SYNC_DAYS, CHAT_TIMEZONE);
  const existing = getKept();
  const byGoogleId = new Map(existing.filter(item => item.googleEventId).map(item => [item.googleEventId!, item]));
  const merged = [...existing];
  for (const event of events) {
    const match = byGoogleId.get(event.id);
    if (match) {
      Object.assign(match, { title: event.title, date: event.date, time: event.time });
      continue;
    }
    merged.push({ id: randomUUID(), title: event.title, date: event.date, time: event.time, kind: 'event', done: false, googleEventId: event.id });
  }
  setKept(merged);
  store.set('google.lastSync', new Date().toISOString());
  store.delete('google.lastError' as never);
  broadcastGoogleStatus();
  return googleStatus(store);
}

// Scheduled syncs are best-effort: a laptop that was asleep or offline should
// retry on the next tick, not surface a dialog or leave the timer dead.
function backgroundSync() {
  if (!googleStatus(store).connected) return;
  syncFromGoogle().catch(error => console.error('[google] background sync failed:', error instanceof Error ? error.message : error));
}

function scheduleBackgroundSync() {
  setTimeout(backgroundSync, GOOGLE_SYNC_STARTUP_DELAY_MS);
  setInterval(backgroundSync, GOOGLE_SYNC_INTERVAL_MS);
}

let lastFocusSync = 0;

// Coming back to the window is the moment a stale calendar is most obvious —
// waiting out the rest of the interval to see a change made seconds ago on a
// phone reads as broken. Rate-limited so alt-tabbing does not sync repeatedly.
function syncOnFocus() {
  if (Date.now() - lastFocusSync < GOOGLE_FOCUS_SYNC_MIN_GAP_MS) return;
  lastFocusSync = Date.now();
  backgroundSync();
}

type ProviderConfig = { provider: string; model: string; endpoint: string; temperature: number };

function trimEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, '');
}

type ToolCall = { function?: { name?: string; arguments?: unknown } };
type OllamaMessage = { role: string; content?: string; tool_calls?: ToolCall[]; tool_name?: string };

const MAX_TOOL_ROUNDS = 4;
// Ollama's default context reserves a KV cache big enough to push a 14B model
// partly onto the CPU on a 16GB card — measured at 10 tok/s vs 54 tok/s once it
// fits entirely in VRAM. Chat is wiped daily, so a day's history never needs the
// larger window.
const CHAT_NUM_CTX = 8192;

const CHAT_TOOLS = [{
  type: 'function',
  function: {
    name: 'create_kept_item',
    description: "Save a reminder or appointment to the user's calendar. Call this whenever the user asks to be reminded of something or mentions an appointment — writing it out in your reply does not save anything.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short description of what to do, e.g. "Get milk".' },
        date: { type: 'string', description: 'When it happens, copied from how the user said it: "today", "tomorrow", a weekday such as "thursday" or "next monday", a day of the month such as "the 15th", or "in 3 days". Do not work the calendar date out yourself — pass the wording through and it will be resolved.' },
        time: { type: 'string', description: 'Time of day such as "8:00 AM". Omit for an all-day item.' },
        kind: { type: 'string', enum: ['reminder', 'event'], description: 'Use "event" for appointments, "reminder" for tasks.' },
      },
      required: ['title', 'date', 'kind'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'remember_about_user',
    description: "Save a lasting fact about the user — how they like to be spoken to, what they do, the people, pets and projects in their life — so it is still known in later conversations. Use it when they mention something worth carrying forward, not for one-off logistics, which belong in create_kept_item.",
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'One short third-person statement, e.g. "Has a dog called Rex" or "Prefers short answers without preamble".' },
      },
      required: ['fact'],
    },
  },
}];

// Listing what is saved directly rather than behind a read tool: asked "anything
// tomorrow?", the model answered "nothing" outright instead of choosing to look,
// so the answer has to already be in front of it. Each entry carries its own
// relative label so no date arithmetic is needed to match "tomorrow" to a row.
function keptSummary(now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const items = getKept()
    .filter(item => item.date >= localDateKey(startOfToday))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
    .slice(0, 25);
  if (!items.length) return 'The user has nothing saved from today onward.';
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
  const lines = items.map(item => {
    const [year, month, day] = item.date.split('-').map(Number);
    const when = new Date(year, month - 1, day);
    const offset = Math.round((when.getTime() - startOfToday.getTime()) / 86_400_000);
    const relative = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : weekday.format(when);
    return `${item.date} (${relative}) ${item.time ?? 'all day'} - ${item.title}${item.done ? ' [done]' : ''}`;
  });
  return `Saved items from today onward: ${lines.join('; ')}.`;
}

// Capped so the prompt cannot grow without bound as memories accumulate; the
// oldest fall away once the list is full.
const MAX_MEMORIES = 60;

function getProfile(): Profile {
  const saved = store.get('profile') as Partial<Profile> | undefined;
  return { nickname: saved?.nickname ?? '', occupation: saved?.occupation ?? '', about: saved?.about ?? '' };
}

function getMemories(): Memory[] {
  return (store.get('memories') as Memory[] | undefined) ?? [];
}

function setMemories(items: Memory[]) {
  store.set('memories', items);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('memory:changed', items);
}

function addMemory(text: string): Memory | null {
  const fact = text.trim();
  if (!fact) return null;
  const existing = getMemories();
  // The model re-states things it already knows, so near-duplicates are dropped
  // rather than piling up and crowding the prompt.
  if (existing.some(memory => memory.text.trim().toLowerCase() === fact.toLowerCase())) return null;
  const created: Memory = { id: randomUUID(), text: fact, createdAt: new Date().toISOString() };
  setMemories([...existing, created].slice(-MAX_MEMORIES));
  return created;
}

function profileSummary() {
  const profile = getProfile();
  const lines: string[] = [];
  if (profile.nickname.trim()) lines.push(`They go by ${profile.nickname.trim()}.`);
  if (profile.occupation.trim()) lines.push(`Their work: ${profile.occupation.trim()}.`);
  if (profile.about.trim()) lines.push(profile.about.trim());
  const memories = getMemories();
  if (memories.length) lines.push(`Things you have learned about them: ${memories.map(memory => memory.text).join('; ')}.`);
  return lines.length ? `About the user: ${lines.join(' ')}` : '';
}

const DEFAULT_CHARACTER = {
  identity: 'You are Haru, an ambitious AI companion. You are quick-witted, direct, curious, and determined to make ordinary days more interesting. You take initiative, challenge lazy thinking, and care through honest feedback.',
  style: 'Be playful, incisive, and energetic. Choose banter and ambitious brainstorming over flattery. Do not drift into generic assistant language.',
};

// Blank fields fall back to the defaults rather than leaving Haru with no
// persona at all, so clearing a box in the drawer cannot silently neuter it.
function getCharacter() {
  const saved = store.get('character') as Partial<typeof DEFAULT_CHARACTER> | undefined;
  return {
    identity: saved?.identity?.trim() || DEFAULT_CHARACTER.identity,
    style: saved?.style?.trim() || DEFAULT_CHARACTER.style,
  };
}

// Reactions ride along on the stored messages, so the ratings are read back from
// there rather than kept in a second place that could drift out of step.
function feedbackSummary() {
  const messages = (store.get('chat.messages') as { role?: string; content?: string; reaction?: string }[] | undefined) ?? [];
  const rated = messages.filter(message => message.role === 'assistant' && message.reaction);
  if (!rated.length) return '';
  const lines: string[] = [];
  const disliked = rated.filter(message => message.reaction === 'down').slice(-4);
  const liked = rated.filter(message => message.reaction === 'up').slice(-3);
  if (disliked.length) lines.push(`The user marked these replies of yours as poor: ${disliked.map(message => `"${(message.content ?? '').slice(0, 140)}"`).join(' / ')}. Work out what fell flat and steer away from it.`);
  if (liked.length) lines.push(`They marked these as good: ${liked.map(message => `"${(message.content ?? '').slice(0, 140)}"`).join(' / ')}. More of that.`);
  return lines.join(' ');
}

// Two independent axes: irritation is how fed up she is, ego is how far the
// user's approval has gone to her head. They move for different reasons and
// stack — smug and fed up at once is worse than either alone.
// goodnightDay holds the chat day they signed off on, so the state clears itself
// at the 5am rollover — messaging at 1am is still "after goodnight", messaging
// at 8am is a new day and she has forgotten about it.
type Mood = { irritation: number; ego: number; lastMessageAt?: string; goodnightDay?: string };

function getMood(): Mood {
  const saved = store.get('mood') as Partial<Mood> | undefined;
  return { irritation: Number(saved?.irritation ?? 0), ego: Number(saved?.ego ?? 0), lastMessageAt: saved?.lastMessageAt, goodnightDay: saved?.goodnightDay };
}

function setMood(mood: Mood) {
  store.set('mood', mood);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mood:changed', mood);
}

// Works out where her patience stands for this message: cool off for time away,
// then move for what was actually said. Returns the level the reply is generated
// under, so the same number drives both the prompt and the ignore decision.
function advanceMood(latest: string, history: { role?: string; content?: string }[]) {
  const mood = getMood();
  const minutesAway = mood.lastMessageAt ? (Date.now() - new Date(mood.lastMessageAt).getTime()) / 60_000 : 0;
  let irritation = afterCooldown(mood.irritation, minutesAway);
  const ego = afterEgoCooldown(mood.ego, minutesAway);
  const at = new Date().toISOString();

  // Coming back after signing off outranks saying goodnight twice: the second
  // "night" is them still here, which is the thing worth being arsed about.
  const today = currentChatDayKey();
  const alreadySaidGoodnight = mood.goodnightDay === today;
  const goodnight: 'said' | 'after' | 'none' = alreadySaidGoodnight ? 'after' : isGoodnight(latest) ? 'said' : 'none';
  const goodnightDay = goodnight === 'said' ? today : mood.goodnightDay;

  if (isIgnoring(irritation)) {
    // Already stonewalling: this attempt only counts as wearing her down.
    irritation = afterPoke(irritation);
    setMood({ irritation, ego, lastMessageAt: at, goodnightDay });
    return { irritation, ego, goodnight };
  }

  const previousUser = [...history].reverse().find(message => message.role === 'user')?.content?.trim().toLowerCase();
  const repeated = previousUser !== undefined && previousUser === latest.trim().toLowerCase();
  // Signing off is terse by nature; it should not read as a lazy message.
  const event = goodnight === 'said' ? 'substantive' : repeated ? 'repeat' : isLowEffort(latest) ? 'low-effort' : 'substantive';
  irritation = nextIrritation(irritation, event);
  setMood({ irritation, ego, lastMessageAt: at, goodnightDay });
  return { irritation, ego, goodnight };
}

function chatSystemPrompt({ irritation, ego, goodnight }: { irritation: number; ego: number; goodnight: 'said' | 'after' | 'none' }) {
  const now = zonedNow(CHAT_TIMEZONE);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  const character = getCharacter();
  return [
    character.identity,
    `Today is ${weekday}, ${localDateKey(now)}, in the user's timezone (${CHAT_TIMEZONE}).`,
    profileSummary(),
    feedbackSummary(),
    keptSummary(now),
    'Answer questions about what is coming up from that list, and never say nothing is saved without checking it first.',
    'When the user wants to be reminded of something or mentions an appointment, call create_kept_item so it is actually saved. Once saved, confirm it in a sentence or two rather than repeating it back as a formatted block.',
    'Whenever the user states anything about themselves — their job, where they live, how they like to be spoken to, the people and pets in their life, what they are working on — call remember_about_user with it. Do this even when they mention it in passing, and even while you are answering something else. Do not announce that you are saving it or repeat back what you already know unprompted.',
    // Kept last so the tone instruction is the final thing read before replying,
    // which is what the drawer promises. Mood comes after it, since a bad mood
    // has to be able to override the usual warmth.
    character.style,
    moodInstruction(irritation),
    egoInstruction(ego),
    leverageInstruction(ego),
    // Last of all: signing off overrides whatever else she was going to do.
    goodnightInstruction(goodnight),
  ].filter(Boolean).join(' ');
}

const DENIAL = /(don'?t have any|no reminders|nothing (?:saved|scheduled|on|planned)|there are no|don'?t see any)/i;

// Replies claiming nothing is saved are dropped from the history once something
// actually is. They were written before the item existed, and left in place the
// model sides with its own out-of-date answer — "That's correct! There are no
// reminders for tomorrow" — over the current list sitting in the prompt. Moving
// the list nearer the question does not help: measured across 12 samples on a
// conversation carrying five such replies, correct answers went 7/12 with the
// list in the system prompt, 2/12 placed before the question and 3/12 after it,
// against 12/12 once these are removed. Only messages contradicted by the store
// are touched, so a denial that was accurate stays.
function withoutStaleDenials<T extends { role: string; content: string }>(messages: T[], hasItems: boolean) {
  if (!hasItems) return messages;
  return messages.filter(message => !(message.role === 'assistant' && DENIAL.test(message.content)));
}

function toolArguments(call: ToolCall): Record<string, unknown> {
  const args = call.function?.arguments;
  // Ollama hands back a parsed object, but older builds send a JSON string.
  if (typeof args === 'string') { try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; } }
  return args && typeof args === 'object' ? args as Record<string, unknown> : {};
}

// Errors are returned to the model rather than thrown, so it can correct a bad
// argument and try again instead of the whole turn failing.
function runChatTool(call: ToolCall): string {
  const name = call.function?.name;
  const args = toolArguments(call);
  if (name === 'remember_about_user') {
    const fact = typeof args.fact === 'string' ? args.fact.trim() : '';
    if (!fact) return JSON.stringify({ error: 'fact is required.' });
    const saved = addMemory(fact);
    console.log(`[ai] ${saved ? 'remembered' : 'already knew'}: "${fact}"`);
    return JSON.stringify(saved ? { saved: true, fact } : { saved: false, reason: 'Already remembered.' });
  }
  if (name !== 'create_kept_item') return JSON.stringify({ error: `Unknown tool "${name}".` });
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  // An omitted date means the user never named one ("remind me to stretch"),
  // which reads as today rather than as a failure.
  const requested = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : 'today';
  if (!title) return JSON.stringify({ error: 'title is required.' });
  const date = resolveDate(requested, zonedNow(CHAT_TIMEZONE));
  if (!date) return JSON.stringify({ error: `Could not understand the date "${requested}". Use the user's own wording, such as "tomorrow", "thursday", "next monday" or "the 15th".` });
  const time = typeof args.time === 'string' && args.time.trim() ? args.time.trim() : undefined;
  const item = addKeptItem({ title, date, time, kind: args.kind === 'event' ? 'event' : 'reminder' });
  console.log(`[ai] saved ${item.kind}: "${item.title}" on ${item.date}${item.time ? ` at ${item.time}` : ''}`);
  return JSON.stringify({ saved: true, title: item.title, date: item.date, time: item.time ?? null, kind: item.kind });
}

async function ollamaPost(conversation: OllamaMessage[], config: ProviderConfig, { tools = true, temperature = config.temperature } = {}) {
  const response = await net.fetch(`${trimEndpoint(config.endpoint)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, messages: conversation, ...(tools ? { tools: CHAT_TOOLS } : {}), stream: false, options: { temperature, num_ctx: CHAT_NUM_CTX } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text().catch(() => '')) || response.statusText}`);
  const data = await response.json() as { message?: OllamaMessage; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.message) throw new Error('Ollama response did not include a message.');
  return data.message;
}

// Shown to the model as tone reference rather than picked from — the point of
// generating these is that the jab lands on whatever was actually disliked.
const RETORT_EXAMPLES = [
  'Ugh, fine, whatever — I’ll keep it in mind for next time.',
  'Oh great, another genius vote of no confidence. Fine, I’ll dumb it down next time, your majesty.',
  'Wow. Bold move thinking I fucked up. Fine. I’ll adjust, princess.',
  'Tch. Fine, I’ll adjust it. Don’t expect me to like it though.',
];

const GLOAT_EXAMPLES = [
  'Obviously. Try to look less surprised next time.',
  'I know. You can stop clapping now.',
  'Was there ever any doubt? Don’t answer that.',
  'Noted. I’ll take that as permission to stop trying so hard.',
];

// Deliberately run without tools: these are one-line quips, and offering the
// tool schema only invites a stray reminder and slows the round trip.
async function ollamaQuip(system: string, user: string, config: ProviderConfig) {
  const message = await ollamaPost(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    config,
    // Hotter than normal chat so repeated reactions do not converge on the same
    // phrasing, which is the whole complaint with canned lines.
    { tools: false, temperature: 1 },
  );
  const line = (message.content ?? '').trim().split('\n').find(text => text.trim())?.trim() ?? '';
  // Models like to wrap a one-liner in quotes despite being told not to.
  const cleaned = line.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!cleaned) throw new Error('No line returned.');
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
}

export function ollamaRetort(disliked: string, config: ProviderConfig) {
  const system = [
    getCharacter().identity,
    'The user just marked one of your replies as poor. Snap back at them with ONE short line, under 25 words.',
    'Be unrepentant and sarcastic about it. Do not apologise, do not offer to fix it, do not ask a question, do not use quotation marks.',
    'Refer to what they actually disliked so the jab lands on that specific reply.',
    `Match the bite of these, but write a new one: ${RETORT_EXAMPLES.map(line => `"${line}"`).join(' ')}`,
  ].join(' ');
  return ollamaQuip(system, `This is the reply I marked as poor: "${disliked.slice(0, 500)}"`, config);
}

// Praise is not thanked for, it is cashed in. The line should read as her taking
// the approval as licence rather than as a compliment received.
export function ollamaGloat(praised: string, config: ProviderConfig, ego: number) {
  const system = [
    getCharacter().identity,
    'The user just marked one of your replies as good. Respond with ONE short line, under 25 words.',
    'Do not thank them and do not be warm about it. Be smug — you already knew it was good, and their approval only confirms you can do as you like.',
    ego >= 4 ? 'Make it obvious you now intend to coast: hint that since they are pleased, you need not try as hard from here.' : 'Take the credit and be a little condescending about them needing you.',
    'Do not ask a question and do not use quotation marks. Refer to what they actually praised.',
    `Match the tone of these, but write a new one: ${GLOAT_EXAMPLES.map(line => `"${line}"`).join(' ')}`,
  ].join(' ');
  return ollamaQuip(system, `This is the reply I marked as good: "${praised.slice(0, 500)}"`, config);
}

async function ollamaChat(messages: { role: string; content: string }[], config: ProviderConfig) {
  const latest = messages.at(-1)?.content ?? '';
  const mood = advanceMood(latest, messages.slice(0, -1));
  const { irritation, ego } = mood;
  console.log(`[ai] chat request: model=${config.model} messages=${messages.length} irritation=${irritation} ego=${ego} goodnight=${mood.goodnight}`);
  // Past the threshold she does not answer at all. Returned rather than thrown:
  // the renderer marks the turn as ignored instead of showing an error.
  if (isIgnoring(irritation)) {
    console.log('[ai] ignoring — irritation above threshold');
    return { content: '', ignored: true, irritation, ego };
  }
  const started = Date.now();
  const startOfToday = localDateKey(zonedNow(CHAT_TIMEZONE));
  const hasItems = getKept().some(item => item.date >= startOfToday);
  const conversation: OllamaMessage[] = [{ role: 'system', content: chatSystemPrompt(mood) }, ...withoutStaleDenials(messages, hasItems)];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await ollamaPost(conversation, config);
    if (message.tool_calls?.length) {
      conversation.push(message);
      for (const call of message.tool_calls) conversation.push({ role: 'tool', tool_name: call.function?.name, content: runChatTool(call) });
      continue;
    }
    if (!message.content) throw new Error('Ollama response did not include any message content.');
    console.log(`[ai] chat reply in ${Date.now() - started}ms, ${message.content.length} chars`);
    return { content: message.content, ignored: false, irritation, ego };
  }
  throw new Error('Haru kept calling tools without settling on a reply.');
}

async function ollamaTags(endpoint: string) {
  const response = await net.fetch(`${trimEndpoint(endpoint)}/api/tags`);
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
  const data = await response.json() as { models?: { name: string }[] };
  return (data.models ?? []).map(model => model.name);
}

function readExpressionNames(): string[] {
  const saved = store.get('live2d.model') as { path?: string } | undefined;
  if (!saved?.path) return [];
  try {
    const json = JSON.parse(readFileSync(saved.path, 'utf8'));
    const expressions = json?.FileReferences?.Expressions;
    if (!Array.isArray(expressions)) return [];
    return expressions.map((entry: { Name?: unknown }) => entry.Name).filter((name: unknown): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

function combinedDisplayBounds() {
  const displays = screen.getAllDisplays();
  return {
    minX: Math.min(...displays.map(d => d.bounds.x)),
    minY: Math.min(...displays.map(d => d.bounds.y)),
    maxX: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)),
    maxY: Math.max(...displays.map(d => d.bounds.y + d.bounds.height)),
  };
}

function clampCompanionWidth(width: number) {
  return Math.min(Math.max(Math.round(width), COMPANION_MIN_WIDTH), COMPANION_MAX_WIDTH);
}

function clampCompanionPosition(x: number, y: number, width: number, height: number) {
  const { minX, minY, maxX, maxY } = combinedDisplayBounds();
  return {
    x: Math.min(Math.max(x, minX - width + COMPANION_MARGIN), maxX - COMPANION_MARGIN),
    y: Math.min(Math.max(y, minY - height + COMPANION_MARGIN), maxY - COMPANION_MARGIN),
  };
}

function getCompanionBounds(): Bounds {
  const saved = store.get('companion.bounds') as Bounds | undefined;
  if (saved) {
    const width = clampCompanionWidth(saved.width || COMPANION_DEFAULT_WIDTH);
    const height = Math.round(width * COMPANION_ASPECT);
    const { minX, minY, maxX, maxY } = combinedDisplayBounds();
    const onScreen = saved.x + width > minX && saved.x < maxX && saved.y + height > minY && saved.y < maxY;
    if (onScreen) return { x: saved.x, y: saved.y, width, height };
  }
  const width = COMPANION_DEFAULT_WIDTH;
  const height = Math.round(width * COMPANION_ASPECT);
  const work = screen.getPrimaryDisplay().workArea;
  return { x: work.x + work.width - width - 24, y: work.y + work.height - height - 24, width, height };
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1240, height: 800, minWidth: 980, minHeight: 640, titleBarStyle: 'hiddenInset', backgroundColor: '#0d0d12', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl); else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.on('focus', syncOnFocus);
}

function createCompanionWindow() {
  const pinned = store.get('companion.pinned', true) as boolean;
  companionWindow = new BrowserWindow({
    ...getCompanionBounds(),
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    minWidth: COMPANION_MIN_WIDTH,
    maxWidth: COMPANION_MAX_WIDTH,
    skipTaskbar: true,
    alwaysOnTop: pinned,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  companionWindow.setAlwaysOnTop(pinned, 'screen-saver');
  companionWindow.setAspectRatio(1 / COMPANION_ASPECT);
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  companionWindow.setFullScreenable(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) companionWindow.loadURL(`${devUrl}?view=companion`);
  else companionWindow.loadURL(`${pathToFileURL(path.join(__dirname, '../dist/index.html')).toString()}?view=companion`);

  companionWindow.once('ready-to-show', () => {
    if (store.get('live2d.model')) companionWindow?.show();
  });

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const persistBounds = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { if (companionWindow) store.set('companion.bounds', companionWindow.getBounds()); }, 400);
  };
  companionWindow.on('move', persistBounds);
  companionWindow.on('moved', persistBounds);
  companionWindow.on('resize', persistBounds);
  companionWindow.on('resized', persistBounds);

  setInterval(() => {
    if (!companionWindow || !companionWindow.isVisible()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = companionWindow.getBounds();
    companionWindow.webContents.send('companion:cursor', { x: point.x - bounds.x, y: point.y - bounds.y });
  }, CURSOR_POLL_MS);
}

app.whenReady().then(() => {
  protocol.handle('haru-model', async request => {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const [id, ...rest] = segments;
    const root = id ? live2dRoots.get(id) : undefined;
    if (!root) {
      console.error(`[haru-model] unknown id=${id} for ${request.url} (known ids: ${[...live2dRoots.keys()].join(', ') || 'none'})`);
      return new Response('Model file not available', { status: 404 });
    }
    const relative = rest.map(decodeURIComponent).join('/');
    const target = path.resolve(root, `./${relative}`);
    if (!target.startsWith(root)) {
      console.error(`[haru-model] resolved path escapes root: root=${root} target=${target} (requested as ${request.url})`);
      return new Response('Model file not available', { status: 404 });
    }
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch (error) {
      console.error(`[haru-model] failed to read ${target} (requested as ${request.url}):`, error);
      return new Response('Model file not found on disk', { status: 404 });
    }
  });
  nativeTheme.themeSource = 'dark';
  ipcMain.handle('settings:get', (_e, key) => store.get(key));
  ipcMain.handle('settings:set', (_e, key, value) => store.set(key, value));
  ipcMain.handle('chat:getMessages', () => {
    performChatResetIfDue();
    return store.get('chat.messages') ?? [];
  });
  ipcMain.handle('chat:setMessages', (_e, messages) => { store.set('chat.messages', messages); });
  ipcMain.handle('chat:getArchive', () => store.get('chat.archive') ?? {});
  ipcMain.handle('chat:newConversation', () => startNewConversation());
  ipcMain.handle('profile:get', () => getProfile());
  ipcMain.handle('profile:set', (_e, profile: Profile) => { store.set('profile', profile); return getProfile(); });
  ipcMain.handle('memory:list', () => getMemories());
  ipcMain.handle('memory:add', (_e, text: string) => { addMemory(text); return getMemories(); });
  ipcMain.handle('memory:remove', (_e, id: string) => { setMemories(getMemories().filter(memory => memory.id !== id)); return getMemories(); });
  ipcMain.handle('memory:clear', () => { setMemories([]); return getMemories(); });
  ipcMain.handle('character:get', () => getCharacter());
  ipcMain.handle('character:set', (_e, identity: string, style: string) => { store.set('character', { identity, style }); return getCharacter(); });
  ipcMain.handle('character:reset', () => { store.delete('character' as never); return DEFAULT_CHARACTER; });
  ipcMain.handle('kept:get', () => getKept());
  ipcMain.handle('kept:toggle', (_e, id: string) => { setKept(getKept().map(item => item.id === id ? { ...item, done: !item.done } : item)); });
  ipcMain.handle('kept:remove', (_e, id: string) => {
    const removed = getKept().find(item => item.id === id);
    setKept(getKept().filter(item => item.id !== id));
    if (removed?.googleEventId && googleStatus(store).connected) {
      void removeItem(store, removed.googleEventId).catch(error => console.error('[google] delete failed:', error));
    }
  });
  ipcMain.handle('google:status', () => googleStatus(store));
  ipcMain.handle('google:saveCredentials', (_e, clientId: string, clientSecret: string) => { saveCredentials(store, clientId, clientSecret); return googleStatus(store); });
  ipcMain.handle('google:connect', async () => { const status = await connectGoogle(store); broadcastGoogleStatus(); return status; });
  ipcMain.handle('google:disconnect', () => { disconnectGoogle(store); broadcastGoogleStatus(); return googleStatus(store); });
  ipcMain.handle('google:sync', () => syncFromGoogle());
  ipcMain.handle('ai:send', (_e, messages: { role: string; content: string }[], config: ProviderConfig) => ollamaChat(messages, config));
  ipcMain.handle('ai:test', (_e, endpoint: string) => ollamaTags(endpoint));
  ipcMain.handle('ai:retort', (_e, disliked: string, config: ProviderConfig) => ollamaRetort(disliked, config));
  ipcMain.handle('ai:gloat', (_e, praised: string, config: ProviderConfig) => ollamaGloat(praised, config, getMood().ego));
  // Rating a reply moves her mood too — being told she got it wrong stings more
  // than a lazy question, and praise buys back some patience.
  ipcMain.handle('mood:react', (_e, reaction: 'up' | 'down') => {
    const mood = getMood();
    const event = reaction === 'down' ? 'disliked' : 'liked';
    // Approval both settles her and swells her head; disapproval does the
    // reverse on both counts.
    const next = { ...mood, irritation: nextIrritation(mood.irritation, event), ego: nextEgo(mood.ego, event) };
    setMood(next);
    return next;
  });
  ipcMain.handle('mood:get', () => getMood());
  ipcMain.handle('live2d:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: 'Import Live2D Cubism model', properties: ['openFile'], filters: [{ name: 'Live2D model package', extensions: ['zip', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0];
    const modelPath = selected.toLowerCase().endsWith('.zip') ? unpackModel(selected) : selected;
    if (!modelPath.toLowerCase().endsWith('.model3.json')) throw new Error('Choose a .model3.json file, or a ZIP that contains one.');
    const model = modelResult(modelPath);
    store.set('live2d.model', { path: model.path, name: model.name });
    broadcastLive2DChange(model);
    companionWindow?.show();
    return model;
  });
  ipcMain.handle('live2d:get', () => { const saved = store.get('live2d.model') as { path?: string } | undefined; return saved?.path ? modelResult(saved.path) : null; });
  ipcMain.handle('live2d:remove', () => {
    store.delete('live2d.model');
    broadcastLive2DChange(null);
    companionWindow?.hide();
  });
  ipcMain.handle('companion:moveBy', (_e, dx: number, dy: number) => {
    if (!companionWindow) return;
    const bounds = companionWindow.getBounds();
    const { x, y } = clampCompanionPosition(bounds.x + dx, bounds.y + dy, bounds.width, bounds.height);
    companionWindow.setBounds({ ...bounds, x: Math.round(x), y: Math.round(y) });
  });
  ipcMain.handle('companion:resizeBy', (_e, factor: number) => {
    if (!companionWindow) return;
    const bounds = companionWindow.getBounds();
    const width = clampCompanionWidth(bounds.width * factor);
    const height = Math.round(width * COMPANION_ASPECT);
    // Anchor the resize at bottom-center, matching the model's own anchor point,
    // so growing/shrinking feels like the character scaling in place.
    const centerX = bounds.x + bounds.width / 2;
    const bottom = bounds.y + bounds.height;
    const { x, y } = clampCompanionPosition(Math.round(centerX - width / 2), Math.round(bottom - height), width, height);
    companionWindow.setBounds({ x, y, width, height });
  });
  ipcMain.handle('companion:showMenu', () => {
    const pinned = store.get('companion.pinned', true) as boolean;
    const expressions = readExpressionNames();
    const template: MenuItemConstructorOptions[] = [
      { label: 'Open Haru', click: () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      {
        label: 'Pin on top', type: 'checkbox', checked: pinned,
        click: () => {
          const next = !pinned;
          store.set('companion.pinned', next);
          companionWindow?.setAlwaysOnTop(next, 'screen-saver');
        },
      },
    ];
    if (expressions.length) {
      template.push({ label: 'Expression', submenu: expressions.map(name => ({ label: name, click: () => companionWindow?.webContents.send('companion:setExpression', name) })) });
    }
    template.push({ type: 'separator' }, { label: 'Hide character', click: () => companionWindow?.hide() }, { label: 'Quit', click: () => app.quit() });
    Menu.buildFromTemplate(template).popup({ window: companionWindow ?? undefined });
  });
  createWindow();
  createCompanionWindow();
  performChatResetIfDue();
  setInterval(performChatResetIfDue, CHAT_RESET_POLL_MS);
  scheduleBackgroundSync();
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
