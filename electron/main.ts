import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, net, Notification, powerMonitor, protocol, screen } from 'electron';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import Store from 'electron-store';
import {
  clampCompanionPosition, clampCompanionWidth, clampCompanionWidthOnDisplay,
  combinedDisplayBounds, companionNeedsReclamp, cursorPollIntervalMs, defaultCompanionWidth,
  type Bounds,
} from './companion';
import { dueDateTime, localDateKey, resolveDate, zonedNow } from './dates';

type Live2DModel = { path: string; name: string; url: string };
type KeptItem = { id: string; title: string; date: string; time?: string; kind: 'reminder' | 'event'; done: boolean; notified?: boolean };

const COMPANION_DEFAULT_WIDTH = 300;
const COMPANION_ASPECT = 360 / 300;
const COMPANION_MIN_WIDTH = 140;
const COMPANION_MAX_WIDTH = 900;
const COMPANION_MARGIN = 60;
// A fresh companion is sized off the primary display's work area rather than
// always the flat default above, so a small laptop panel gets a corner companion
// instead of one that dominates the screen. See defaultCompanionWidth.
const COMPANION_DEFAULT_WIDTH_FRACTION = 0.22;
// Same idea for the scroll-wheel resize ceiling: 900px reads fine on a desktop
// monitor but can exceed a small laptop panel outright.
const COMPANION_MAX_WIDTH_FRACTION = 0.6;
const CURSOR_POLL_MS_AC = 33;
// Eye-follow at half rate on battery still reads as tracking the cursor, for
// roughly half the wakeups — see cursorPollIntervalMs.
const CURSOR_POLL_MS_BATTERY = 66;
const CHAT_TIMEZONE = 'Australia/Perth'; // UTC+8 year-round, no DST
const CHAT_RESET_HOUR = 5;
const CHAT_RESET_POLL_MS = 60_000;
const ALERT_POLL_MS = 20_000;
// All-day items have no time of their own, so they surface at a waking hour
// rather than at midnight, which is when their date technically begins.
const ALERT_ALL_DAY_HOUR = 9;
// A reminder that came due while Haru was closed is still worth showing; a
// fortnight of them arriving at once is not. Anything overdue by more than this
// is marked off silently instead, so launching never fires a backlog.
const ALERT_GRACE_MS = 15 * 60_000;

const store = new Store<Record<string, unknown>>();
const live2dRoots = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let cursorPollTimer: ReturnType<typeof setInterval> | undefined;
let lastCursorSend: { x: number; y: number } | undefined;

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
  return created;
}

function alertsEnabled() {
  return store.get('alerts.enabled', true) as boolean;
}

function showKeptNotification(item: KeptItem) {
  const notification = new Notification({
    title: item.kind === 'event' ? 'Haru · appointment' : 'Haru · reminder',
    body: item.time ? `${item.title} — ${item.time}` : item.title,
  });
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    mainWindow?.show();
    mainWindow?.focus();
  });
  notification.show();
}

// Polls the store rather than holding a timer per item: the chat tool can create
// an item at any moment and the store is the single source of truth, so
// re-reading it on a tick avoids keeping a parallel set of timers in sync with
// it. `notified` is persisted on the item itself so a restart does not re-fire
// everything that has already been shown.
function checkDueReminders() {
  const items = getKept();
  if (!items.length) return;
  const now = zonedNow(CHAT_TIMEZONE).getTime();
  const canNotify = alertsEnabled() && Notification.isSupported();
  let changed = false;
  const next = items.map(item => {
    if (item.notified || item.done) return item;
    const due = dueDateTime(item.date, item.time, ALERT_ALL_DAY_HOUR);
    if (!due || due.getTime() > now) return item;
    // Marked off even when alerts are muted or missed: re-enabling alerts should
    // start from now, not replay everything that came due while they were off.
    if (canNotify && now - due.getTime() <= ALERT_GRACE_MS) {
      console.log(`[alerts] notifying ${item.kind}: "${item.title}" due ${item.date}${item.time ? ` at ${item.time}` : ''}`);
      showKeptNotification(item);
    }
    changed = true;
    return { ...item, notified: true };
  });
  if (changed) setKept(next);
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
}];

// Listing what is saved directly in the prompt rather than behind a read tool:
// asked "anything tomorrow?", the model answered "nothing" outright instead of
// choosing to look, so the answer has to already be in front of it. Each entry
// carries its own relative label so no date arithmetic is needed to match
// "tomorrow" against a row.
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

function chatSystemPrompt() {
  const now = zonedNow(CHAT_TIMEZONE);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  return [
    'You are Haru, an ambitious desktop companion: playful, direct and energetic. Skip flattery and generic assistant language.',
    `Today is ${weekday}, ${localDateKey(now)}, in the user's timezone (${CHAT_TIMEZONE}).`,
    keptSummary(now),
    'Answer questions about what is coming up from that list, and never say nothing is saved without checking it first.',
    'When the user wants to be reminded of something or mentions an appointment, call create_kept_item so it is actually saved. Once saved, confirm it in a sentence or two rather than repeating it back as a formatted block.',
  ].join(' ');
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
  if (name !== 'create_kept_item') return JSON.stringify({ error: `Unknown tool "${name}".` });
  const args = toolArguments(call);
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

async function ollamaPost(conversation: OllamaMessage[], config: ProviderConfig) {
  const response = await net.fetch(`${trimEndpoint(config.endpoint)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, messages: conversation, tools: CHAT_TOOLS, stream: false, options: { temperature: config.temperature, num_ctx: CHAT_NUM_CTX } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text().catch(() => '')) || response.statusText}`);
  const data = await response.json() as { message?: OllamaMessage; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.message) throw new Error('Ollama response did not include a message.');
  return data.message;
}

async function ollamaChat(messages: { role: string; content: string }[], config: ProviderConfig) {
  console.log(`[ai] chat request: model=${config.model} endpoint=${config.endpoint} messages=${messages.length}`);
  const started = Date.now();
  const conversation: OllamaMessage[] = [{ role: 'system', content: chatSystemPrompt() }, ...messages];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await ollamaPost(conversation, config);
    if (message.tool_calls?.length) {
      conversation.push(message);
      for (const call of message.tool_calls) conversation.push({ role: 'tool', tool_name: call.function?.name, content: runChatTool(call) });
      continue;
    }
    if (!message.content) throw new Error('Ollama response did not include any message content.');
    console.log(`[ai] chat reply in ${Date.now() - started}ms, ${message.content.length} chars`);
    return message.content;
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

// The clamping/sizing math itself lives in ./companion, free of electron imports
// so it can be exercised in plain Node the same way dates.ts is. These wrappers
// just supply the live display list electron/screen holds.
function allDisplayBounds() {
  return screen.getAllDisplays().map(d => d.bounds);
}

function getCompanionBounds(): Bounds {
  const saved = store.get('companion.bounds') as Bounds | undefined;
  if (saved) {
    const width = clampCompanionWidth(saved.width || COMPANION_DEFAULT_WIDTH, COMPANION_MIN_WIDTH, COMPANION_MAX_WIDTH);
    const height = Math.round(width * COMPANION_ASPECT);
    const { minX, minY, maxX, maxY } = combinedDisplayBounds(allDisplayBounds());
    const onScreen = saved.x + width > minX && saved.x < maxX && saved.y + height > minY && saved.y < maxY;
    if (onScreen) return { x: saved.x, y: saved.y, width, height };
  }
  // No saved bounds, or the saved ones are no longer on any display: size fresh,
  // relative to whichever display is primary right now.
  const primary = screen.getPrimaryDisplay();
  const width = defaultCompanionWidth(primary.workArea.width, COMPANION_DEFAULT_WIDTH, COMPANION_DEFAULT_WIDTH_FRACTION, COMPANION_MIN_WIDTH, COMPANION_MAX_WIDTH);
  const height = Math.round(width * COMPANION_ASPECT);
  const work = primary.workArea;
  return { x: work.x + work.width - width - 24, y: work.y + work.height - height - 24, width, height };
}

// Re-clamps the companion after the display arrangement changes at runtime —
// e.g. a laptop undocked from an external monitor without quitting Haru.
// companionNeedsReclamp guards this: display-metrics-changed also fires for
// DPI/scale/rotation changes anywhere, including on a display the companion
// isn't on, so this must be a no-op unless clamping would actually move or
// shrink the window.
function reclampCompanionWindow() {
  if (!companionWindow) return;
  const bounds = companionWindow.getBounds();
  const displays = allDisplayBounds();
  if (!companionNeedsReclamp(bounds, displays, COMPANION_MARGIN, COMPANION_MIN_WIDTH, COMPANION_MAX_WIDTH, COMPANION_ASPECT)) return;
  const width = clampCompanionWidth(bounds.width, COMPANION_MIN_WIDTH, COMPANION_MAX_WIDTH);
  const height = Math.round(width * COMPANION_ASPECT);
  const { x, y } = clampCompanionPosition(bounds.x, bounds.y, width, height, displays, COMPANION_MARGIN);
  companionWindow.setBounds({ x, y, width, height });
  store.set('companion.bounds', companionWindow.getBounds());
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1240, height: 800, minWidth: 980, minHeight: 640, titleBarStyle: 'hiddenInset', backgroundColor: '#0d0d12', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl); else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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
}

// Sends only on an actual change in cursor position relative to the window,
// which is most ticks once the cursor stops moving.
function pollCursor() {
  if (!companionWindow || !companionWindow.isVisible()) return;
  const point = screen.getCursorScreenPoint();
  const bounds = companionWindow.getBounds();
  const next = { x: point.x - bounds.x, y: point.y - bounds.y };
  if (lastCursorSend && lastCursorSend.x === next.x && lastCursorSend.y === next.y) return;
  lastCursorSend = next;
  companionWindow.webContents.send('companion:cursor', next);
}

// Restarted rather than adjusted in place — setInterval has no reschedule API —
// whenever the power source changes, so eye-follow runs at a battery-friendly
// rate on battery and back at the original rate on AC.
function startCursorPoll() {
  clearInterval(cursorPollTimer);
  const ms = cursorPollIntervalMs(powerMonitor.isOnBatteryPower(), CURSOR_POLL_MS_AC, CURSOR_POLL_MS_BATTERY);
  cursorPollTimer = setInterval(pollCursor, ms);
}

app.whenReady().then(() => {
  // Windows routes toasts by AppUserModelID; without one matching the shortcut
  // electron-builder installs, notifications are attributed to the bare Electron
  // host — or dropped outright.
  app.setAppUserModelId('com.haru.desktop');
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
  ipcMain.handle('kept:get', () => getKept());
  ipcMain.handle('kept:toggle', (_e, id: string) => { setKept(getKept().map(item => item.id === id ? { ...item, done: !item.done } : item)); });
  ipcMain.handle('kept:remove', (_e, id: string) => { setKept(getKept().filter(item => item.id !== id)); });
  ipcMain.handle('alerts:get', () => alertsEnabled());
  ipcMain.handle('alerts:set', (_e, enabled: boolean) => {
    store.set('alerts.enabled', !!enabled);
    // Catches up immediately so turning alerts off silences anything already due
    // this tick, rather than letting it fire up to ALERT_POLL_MS later.
    checkDueReminders();
    return alertsEnabled();
  });
  ipcMain.handle('ai:send', (_e, messages: { role: string; content: string }[], config: ProviderConfig) => ollamaChat(messages, config));
  ipcMain.handle('ai:test', (_e, endpoint: string) => ollamaTags(endpoint));
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
    const { x, y } = clampCompanionPosition(bounds.x + dx, bounds.y + dy, bounds.width, bounds.height, allDisplayBounds(), COMPANION_MARGIN);
    companionWindow.setBounds({ ...bounds, x: Math.round(x), y: Math.round(y) });
  });
  ipcMain.handle('companion:resizeBy', (_e, factor: number) => {
    if (!companionWindow) return;
    const bounds = companionWindow.getBounds();
    // Capped to the screen she's actually on (getDisplayMatching), not just the
    // flat ceiling: growing via scroll-wheel shouldn't be able to exceed a small
    // laptop panel just because 900px is fine on a desktop monitor.
    const display = screen.getDisplayMatching(bounds);
    const width = clampCompanionWidthOnDisplay(bounds.width * factor, COMPANION_MIN_WIDTH, COMPANION_MAX_WIDTH, display.workArea.width, COMPANION_MAX_WIDTH_FRACTION);
    const height = Math.round(width * COMPANION_ASPECT);
    // Anchor the resize at bottom-center, matching the model's own anchor point,
    // so growing/shrinking feels like the character scaling in place.
    const centerX = bounds.x + bounds.width / 2;
    const bottom = bounds.y + bounds.height;
    const { x, y } = clampCompanionPosition(Math.round(centerX - width / 2), Math.round(bottom - height), width, height, allDisplayBounds(), COMPANION_MARGIN);
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
  startCursorPoll();
  // Eye-follow rate follows whichever power source is current; see startCursorPoll.
  powerMonitor.on('on-battery', startCursorPoll);
  powerMonitor.on('on-ac', startCursorPoll);
  screen.on('display-removed', reclampCompanionWindow);
  screen.on('display-metrics-changed', reclampCompanionWindow);
  performChatResetIfDue();
  setInterval(performChatResetIfDue, CHAT_RESET_POLL_MS);
  checkDueReminders();
  setInterval(checkDueReminders, ALERT_POLL_MS);
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
