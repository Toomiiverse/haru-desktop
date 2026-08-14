import { net, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type Store from 'electron-store';
import { formatTimeOfDay, parseTimeOfDay } from './dates';

// Desktop OAuth uses a loopback redirect: Google sends the code back to a
// throwaway server on 127.0.0.1 rather than to a hosted URL. PKCE is what stops
// another local process racing us to redeem that code — the installed-app client
// secret is not really secret, so it cannot carry that weight on its own.
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
// Tasks are a separate product with a separate API and scope — a calendar
// connection alone cannot see them, which is why they were missing entirely.
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
const SCOPES = [CALENDAR_SCOPE, TASKS_SCOPE, 'openid', 'email'];
const CONSENT_TIMEOUT_MS = 5 * 60_000;
// Refresh a little early so a token cannot expire mid-request.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export type GoogleStatus = { hasCredentials: boolean; connected: boolean; email?: string; lastSync?: string; lastError?: string; tasksGranted?: boolean };
export type CalendarEvent = { id: string; title: string; date: string; time?: string };
export type GoogleTask = { id: string; title: string; date: string; done: boolean; completedAt?: string };
type KeptForSync = { id: string; title: string; date: string; time?: string; kind: 'task' | 'event'; googleEventId?: string };

type StoreLike = Pick<Store<Record<string, unknown>>, 'get' | 'set' | 'delete'>;

let accessToken: { value: string; expiresAt: number } | null = null;

function html(body: string) {
  return `<!doctype html><meta charset="utf-8"><title>Haru</title><body style="font-family:system-ui;background:#0d0d12;color:#e8e8f0;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">${body}</h1><p style="color:#878cab">You can close this tab and go back to Haru.</p></div>`;
}

// safeStorage is backed by DPAPI on Windows and the login keychain elsewhere.
// Without it we would be writing a long-lived refresh token to disk in the clear,
// so connecting fails loudly instead.
function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure storage available, so Google credentials cannot be saved safely.');
}

function setSecret(store: StoreLike, key: string, value: string) {
  requireEncryption();
  store.set(key, safeStorage.encryptString(value).toString('base64'));
}

function getSecret(store: StoreLike, key: string): string | undefined {
  const saved = store.get(key) as string | undefined;
  if (!saved) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(saved, 'base64'));
  } catch {
    return undefined;
  }
}

function base64url(input: Buffer) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function saveCredentials(store: StoreLike, clientId: string, clientSecret: string) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) throw new Error('Both the client ID and client secret are required.');
  requireEncryption();
  store.set('google.clientId', id);
  setSecret(store, 'google.clientSecret', secret);
}

function credentials(store: StoreLike) {
  const clientId = store.get('google.clientId') as string | undefined;
  const clientSecret = getSecret(store, 'google.clientSecret');
  if (!clientId || !clientSecret) throw new Error('Add your Google client ID and secret in Setup first.');
  return { clientId, clientSecret };
}

export function googleStatus(store: StoreLike): GoogleStatus {
  return {
    hasCredentials: Boolean(store.get('google.clientId')),
    connected: Boolean(store.get('google.refreshToken')),
    email: store.get('google.email') as string | undefined,
    lastSync: store.get('google.lastSync') as string | undefined,
    lastError: store.get('google.lastError') as string | undefined,
    tasksGranted: Boolean(store.get('google.tasksGranted')),
  };
}

export function disconnectGoogle(store: StoreLike) {
  accessToken = null;
  for (const key of ['google.refreshToken', 'google.email', 'google.lastSync', 'google.lastError']) store.delete(key as never);
}

async function postForm(url: string, body: Record<string, string>) {
  const response = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google rejected the request: ${data.error_description ?? data.error ?? response.statusText}`);
  return data;
}

// Binds the loopback listener first, because the redirect URI (and so the
// consent URL) cannot be built until the OS has handed us a port.
export async function connectGoogle(store: StoreLike) {
  const { clientId, clientSecret } = credentials(store);
  requireEncryption();
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  server.close();

  const redirectUri = `http://127.0.0.1:${port}`;
  const waiting = new Promise<string>((resolve, reject) => {
    const callback = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const finish = (status: number, body: string) => {
        response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(html(body));
        setImmediate(() => callback.close());
      };
      if (error) { finish(400, 'Google sign-in was cancelled.'); reject(new Error(`Google returned "${error}".`)); return; }
      if (!code || returnedState !== state) { finish(400, 'That sign-in response was not recognised.'); reject(new Error('The sign-in response did not match this request.')); return; }
      finish(200, 'Haru is connected to Google Calendar.');
      resolve(code);
    });
    callback.on('error', reject);
    callback.listen(port, '127.0.0.1');
    const timer = setTimeout(() => { callback.close(); reject(new Error('Timed out waiting for Google sign-in.')); }, CONSENT_TIMEOUT_MS);
    callback.on('close', () => clearTimeout(timer));
  });

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256',
    // access_type=offline plus prompt=consent is what makes Google return a
    // refresh token; without them a reconnect yields only an access token.
    access_type: 'offline', prompt: 'consent', state,
  }).toString();
  await shell.openExternal(authUrl.toString());

  const code = await waiting;
  const tokens = await postForm(TOKEN_ENDPOINT, {
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
  });
  // Google's consent screen lets each permission be ticked separately, so a token
  // can come back valid but without calendar access. Checked here rather than
  // letting the first sync fail with an opaque 403 about insufficient scopes.
  const granted = typeof tokens.scope === 'string' ? tokens.scope.split(' ') : [];
  console.log(`[google] granted scopes: ${granted.join(', ') || '(none reported)'}`);
  if (!granted.includes(CALENDAR_SCOPE)) {
    disconnectGoogle(store);
    throw new Error('Calendar permission was not granted. Connect again and tick the checkbox asking Haru to see and edit events on your calendars.');
  }
  // Tasks are optional rather than fatal: the calendar half still works without
  // them, so this is recorded and surfaced rather than refusing the connection.
  store.set('google.tasksGranted', granted.includes(TASKS_SCOPE));
  const refreshToken = tokens.refresh_token as string | undefined;
  if (!refreshToken) throw new Error('Google did not return a refresh token. Revoke Haru under myaccount.google.com/permissions and connect again.');
  setSecret(store, 'google.refreshToken', refreshToken);
  accessToken = { value: tokens.access_token as string, expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 };
  if (typeof tokens.id_token === 'string') {
    try {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString('utf8')) as { email?: string };
      if (payload.email) store.set('google.email', payload.email);
    } catch { /* the address is cosmetic; a failure here is not worth surfacing */ }
  }
  store.delete('google.lastError' as never);
  return googleStatus(store);
}

async function authorisedFetch(store: StoreLike, path: string, init: RequestInit = {}, base = CALENDAR_API) {
  if (!accessToken || accessToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS < Date.now()) {
    const { clientId, clientSecret } = credentials(store);
    const refreshToken = getSecret(store, 'google.refreshToken');
    if (!refreshToken) throw new Error('Haru is not connected to Google Calendar.');
    const tokens = await postForm(TOKEN_ENDPOINT, { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
    accessToken = { value: tokens.access_token as string, expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 };
  }
  const response = await net.fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${accessToken.value}`, 'Content-Type': 'application/json' },
  });
  if (response.status === 401) {
    // Force a refresh on the next call rather than retrying blindly here.
    accessToken = null;
    throw new Error('Google rejected the saved sign-in. Reconnect in Setup.');
  }
  const body = response.ok ? null : await response.text().catch(() => '');
  const service = base === TASKS_API ? 'Google Tasks' : 'Google Calendar';
  // A 403 naming scopes means the account connected without ticking the
  // permission; no amount of retrying fixes that, only reconnecting does.
  if (response.status === 403 && /scope|insufficient/i.test(body ?? '')) {
    throw new Error(`This Google connection has no ${service} permission. Disconnect, connect again, and tick the matching checkbox.`);
  }
  // A disabled API is a project setting, not anything the user did here. The
  // raw response is several hundred characters of JSON saying so; this is the
  // one line that matters, with the link to fix it.
  if (response.status === 403 && /SERVICE_DISABLED|accessNotConfigured/i.test(body ?? '')) {
    const activation = (body ?? '').match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^"\\\s]+/)?.[0];
    throw new Error(`The ${service} API is not enabled on your Google Cloud project.${activation ? ` Enable it at ${activation} and try again in a minute.` : ''}`);
  }
  if (!response.ok) throw new Error(`${service} returned ${response.status}: ${body || response.statusText}`);
  return response.status === 204 ? {} : await response.json() as Record<string, unknown>;
}

// Sending a floating dateTime with an explicit timeZone avoids computing UTC
// offsets here and keeps the event correct if the zone ever changes.
function eventTimes(item: KeptForSync, timeZone: string) {
  const parsed = item.time ? parseTimeOfDay(item.time) : null;
  if (!parsed) {
    const end = new Date(`${item.date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start: { date: item.date }, end: { date: end.toISOString().slice(0, 10) } };
  }
  const startClock = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
  const endHour = (parsed.hour + 1) % 24;
  // An hour-long block that would cross midnight is clamped to end of day.
  const endClock = parsed.hour === 23 ? '23:59' : `${String(endHour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
  return {
    start: { dateTime: `${item.date}T${startClock}:00`, timeZone },
    end: { dateTime: `${item.date}T${endClock}:00`, timeZone },
  };
}

export async function pushItem(store: StoreLike, item: KeptForSync, timeZone: string) {
  const body = { summary: item.title, description: 'Created in Haru', ...eventTimes(item, timeZone) };
  if (item.googleEventId) {
    await authorisedFetch(store, `/calendars/primary/events/${encodeURIComponent(item.googleEventId)}`, { method: 'PATCH', body: JSON.stringify(body) });
    return item.googleEventId;
  }
  const created = await authorisedFetch(store, '/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) });
  return created.id as string;
}

export async function removeItem(store: StoreLike, googleEventId: string) {
  try {
    await authorisedFetch(store, `/calendars/primary/events/${encodeURIComponent(googleEventId)}`, { method: 'DELETE' });
  } catch (error) {
    // Already gone from Google is the desired end state, not a failure.
    if (!/ 40[04]/.test(String(error))) throw error;
  }
}

export function eventToItem(event: Record<string, unknown>, timeZone: string): CalendarEvent | null {
  const id = typeof event.id === 'string' ? event.id : null;
  const start = event.start as { date?: string; dateTime?: string } | undefined;
  if (!id || !start) return null;
  const title = typeof event.summary === 'string' && event.summary.trim() ? event.summary.trim() : '(no title)';
  if (start.date) return { id, title, date: start.date };
  if (!start.dateTime) return null;
  const when = new Date(start.dateTime);
  if (Number.isNaN(when.getTime())) return null;
  // Google returns an offset-bearing instant. Rendering it in the configured zone
  // rather than the machine's keeps a pulled event on the same day and hour the
  // rest of the app would have written it.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(when);
  const part = (type: string) => parts.find(entry => entry.type === type)?.value ?? '';
  return {
    id, title,
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: formatTimeOfDay(Number(part('hour')) % 24, Number(part('minute'))),
  };
}

// --- tasks ------------------------------------------------------------------
// Google Tasks carry a due date but no time, and can be completed — which is the
// distinction that matters here. An event happens whether or not you turn up; a
// task is something you tick off.

export function taskToItem(task: Record<string, unknown>): GoogleTask | null {
  const id = typeof task.id === 'string' ? task.id : null;
  const title = typeof task.title === 'string' && task.title.trim() ? task.title.trim() : null;
  if (!id || !title) return null;
  // `due` is an RFC-3339 timestamp but Google only honours the date part, so the
  // day is taken straight off the string rather than through a Date, which would
  // shift it by the local offset.
  const due = typeof task.due === 'string' ? task.due.slice(0, 10) : null;
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const done = task.status === 'completed';
  // Unlike `due`, this one is a real instant and is kept whole. It is the only
  // way to know when something ticked off on a phone actually happened, rather
  // than dating it to whenever the sync got round to noticing.
  const completedAt = done && typeof task.completed === 'string' ? task.completed : undefined;
  return { id, title, date: due, done, completedAt };
}

export async function pullTasks(store: StoreLike, fromDate: string, days: number): Promise<GoogleTask[]> {
  const until = new Date(`${fromDate}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const query = new URLSearchParams({
    // Completed ones come back too, so a task ticked off in Google shows as done
    // here rather than reappearing as outstanding.
    showCompleted: 'true', showHidden: 'true', maxResults: '100',
    dueMax: until.toISOString(),
  });
  const data = await authorisedFetch(store, `/lists/@default/tasks?${query}`, {}, TASKS_API);
  const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];
  return items.map(taskToItem).filter((task): task is GoogleTask => task !== null && task.date >= fromDate);
}

export async function pushTask(store: StoreLike, task: { title: string; date: string; done: boolean; googleTaskId?: string }) {
  const body = {
    title: task.title,
    // Google stores the due date at UTC midnight and ignores any time of day.
    due: `${task.date}T00:00:00.000Z`,
    status: task.done ? 'completed' : 'needsAction',
    // Clearing this matters when un-ticking: a task left with a completion
    // timestamp stays completed in Google whatever the status says.
    ...(task.done ? {} : { completed: null }),
  };
  if (task.googleTaskId) {
    await authorisedFetch(store, `/lists/@default/tasks/${encodeURIComponent(task.googleTaskId)}`, { method: 'PATCH', body: JSON.stringify(body) }, TASKS_API);
    return task.googleTaskId;
  }
  const created = await authorisedFetch(store, '/lists/@default/tasks', { method: 'POST', body: JSON.stringify(body) }, TASKS_API);
  return created.id as string;
}

export async function removeTask(store: StoreLike, googleTaskId: string) {
  try {
    await authorisedFetch(store, `/lists/@default/tasks/${encodeURIComponent(googleTaskId)}`, { method: 'DELETE' }, TASKS_API);
  } catch (error) {
    // Already gone is the desired end state, not a failure.
    if (!/ 40[04]/.test(String(error))) throw error;
  }
}

export async function pullEvents(store: StoreLike, fromDate: string, days: number, timeZone: string): Promise<CalendarEvent[]> {
  // The window is padded by a day at each end and the results trimmed by their
  // rendered date below. Building the bounds from a bare date string would parse
  // them in the machine's zone, which need not be `timeZone`, clipping events
  // near either edge.
  const timeMin = new Date(`${fromDate}T00:00:00Z`);
  timeMin.setUTCDate(timeMin.getUTCDate() - 1);
  const timeMax = new Date(`${fromDate}T00:00:00Z`);
  timeMax.setUTCDate(timeMax.getUTCDate() + days + 1);
  const query = new URLSearchParams({
    timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
    // Expands recurring events into individual occurrences so each one lands on
    // its own day in the panel.
    singleEvents: 'true', orderBy: 'startTime', maxResults: '50',
  });
  const data = await authorisedFetch(store, `/calendars/primary/events?${query}`);
  const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];
  return items
    .map(item => eventToItem(item, timeZone))
    .filter((event): event is CalendarEvent => event !== null && event.date >= fromDate);
}
