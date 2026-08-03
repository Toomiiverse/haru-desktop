import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, net, protocol, screen } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import Store from 'electron-store';

type Bounds = { x: number; y: number; width: number; height: number };
type Live2DModel = { path: string; name: string; url: string };

const COMPANION_DEFAULT_WIDTH = 300;
const COMPANION_ASPECT = 360 / 300;
const COMPANION_MIN_WIDTH = 140;
const COMPANION_MAX_WIDTH = 900;
const COMPANION_MARGIN = 60;
const CURSOR_POLL_MS = 33;
const CHAT_TIMEZONE = 'Australia/Perth'; // UTC+8 year-round, no DST
const CHAT_RESET_HOUR = 5;
const CHAT_RESET_POLL_MS = 60_000;

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

function unpackModel(archivePath: string) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const model = entries.find(entry => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.model3.json'));
  if (!model) throw new Error('This ZIP does not contain a .model3.json Live2D model.');
  if (entries.some(entry => entry.entryName.split('/').includes('..') || path.isAbsolute(entry.entryName))) throw new Error('This ZIP contains an unsafe path and was not imported.');
  const destination = path.join(app.getPath('userData'), 'live2d-models', createHash('sha256').update(`${archivePath}:${Date.now()}`).digest('hex').slice(0, 16));
  mkdirSync(destination, { recursive: true });
  zip.extractAllTo(destination, true);
  return path.join(destination, model.entryName);
}

function broadcastLive2DChange(model: Live2DModel | null) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('live2d:changed', model);
}

function broadcastChatReset() {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:reset');
}

// Reads the wall-clock date/time in `timeZone` as local Date fields, so day-boundary
// math (getDate/getHours/etc.) reflects that zone regardless of the OS's own timezone.
function zonedNow(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return new Date(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

function localDateKey(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// The "chat day" runs from CHAT_RESET_HOUR to CHAT_RESET_HOUR the next day, not
// midnight to midnight — chatting with Haru at 1am shouldn't get wiped by a plain
// date rollover mid-conversation.
function currentChatDayKey(): string {
  const now = zonedNow(CHAT_TIMEZONE);
  if (now.getHours() < CHAT_RESET_HOUR) now.setDate(now.getDate() - 1);
  return localDateKey(now);
}

function performChatResetIfDue() {
  const key = currentChatDayKey();
  const previousKey = store.get('chat.dayKey') as string | undefined;
  if (previousKey === key) return;
  const previousMessages = store.get('chat.messages') as unknown[] | undefined;
  if (previousKey && previousMessages?.length) {
    const archive = (store.get('chat.archive') as Record<string, unknown[]> | undefined) ?? {};
    archive[previousKey] = previousMessages;
    store.set('chat.archive', archive);
  }
  store.set('chat.dayKey', key);
  store.delete('chat.messages');
  broadcastChatReset();
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
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
