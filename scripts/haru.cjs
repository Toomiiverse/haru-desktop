#!/usr/bin/env node
// Haru, from a terminal.
//
// She runs where she runs — an Electron app on a machine with a display, even
// if that display is an Xvfb nobody looks at. This is not a second Haru and is
// deliberately not trying to be one: it is a client for the web door she already
// answers on, the same one the phone uses.
//
// That is the whole design. Everything worth having lives on her side and stays
// there: one config.json, one transcript, one set of memories, one mood. Talk to
// her from the terminal and it lands in the same conversation you left on the
// desk, because it is the same conversation. A CLI that kept its own history
// would be a second Haru who happened to share a name.
//
// No build step and no dependencies, matching the other scripts in here. Node's
// own fetch, Node's own readline.
//
//   haru "what's on today"     ask once and exit
//   haru                       a prompt to keep typing into
//   haru --agenda              what is on the list
//   haru --login               sign in and remember this machine
//
// Configuration, in order of precedence: the environment, then
// ~/.config/haru/cli.json. The token it earns is written back there, so signing
// in happens once rather than on every command — which matters, because the
// sign-in route is rate limited on purpose and one-shot use would walk straight
// into it.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const HOME = os.homedir();
const CONFIG_DIR = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'haru') : path.join(HOME, '.config', 'haru');
const CONFIG_FILE = path.join(CONFIG_DIR, 'cli.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Written with the permissions a file holding a credential should have.
 *
 * mode on writeFileSync only applies when the file is created, so an existing
 * one is chmod'ed too — otherwise a file that was once world-readable quietly
 * stays that way for ever.
 */
function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* best effort on odd filesystems */ }
}

const stored = readConfig();
const BASE = (process.env.HARU_URL || stored.url || 'http://127.0.0.1:8787').replace(/\/+$/, '');

/** Whatever proves who we are. A remembered device lasts 90 days; a session, 12 hours. */
function cookieHeader() {
  const bits = [];
  if (stored.device) bits.push(`haru_device=${stored.device}`);
  if (stored.session) bits.push(`haru_session=${stored.session}`);
  return bits.join('; ');
}

async function call(method, route, body) {
  const headers = { Accept: 'application/json' };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    // The commonest failure by a mile, and the one where the error text is
    // least helpful: she is simply not running, or not running here.
    throw new Error(`Could not reach her at ${BASE} — ${error.message}\nIs she running, and is the web door switched on in her settings?`);
  }
  // The web door answers the login page rather than JSON when the cookie has
  // gone stale, so this is what an expired token looks like from out here.
  if (response.status === 401 || response.status === 403) {
    throw new Error(`She does not know this machine. Run:  haru --login`);
  }
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!response.ok) {
    throw new Error(parsed?.error || `${response.status} from ${route}`);
  }
  if (parsed === null) throw new Error(`She answered ${route} with something that is not JSON. If that is a login page, run:  haru --login`);
  return parsed;
}

/**
 * Signs in once and asks to be remembered.
 *
 * Remembered rather than a plain session, and that is the point of doing it at
 * all: a session lasts twelve hours and lives only in her memory, so it dies
 * with every restart and every update. A remembered device lasts ninety days
 * and is written into her config, which is what makes one-shot use bearable —
 * the sign-in route is rate limited on purpose, and logging in per command
 * would walk straight into it.
 *
 * It also appears in Setup under the devices she has been told to trust, and can
 * be taken away from there like any other.
 *
 * One readline interface for the whole exchange, not one per question. Closing
 * an interface releases stdin, so a fresh one per prompt reads the first answer
 * and then finds the stream gone.
 */
async function login() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  // Pulled off the async iterator rather than asked for with rl.question().
  // question() takes the next line and drops whatever else has already been
  // buffered — nothing, on a terminal; the rest of the answers, on a pipe. So a
  // scripted sign-in answered the first prompt and then waited for input that
  // had already been thrown away. The iterator hands them over one at a time
  // either way, and yields undefined when they run out rather than hanging.
  const lines = rl[Symbol.asyncIterator]();
  const asks = async question => {
    process.stdout.write(question);
    const { value } = await lines.next();
    return value ?? '';
  };

  /**
   * The password, read without any of it reaching the screen.
   *
   * readline in terminal mode has already put the tty into raw mode and taken
   * over the echoing itself, so the thing to silence is readline, not the
   * terminal. Reaching past it to stty works for exactly one prompt and then
   * ruins the next one: stty echo hands echoing back to a terminal that is still
   * raw, and from then on every arrow key arrives on screen as ^[[D.
   *
   * So the writer is muted and nothing else is touched. Restored afterwards, and
   * again on the way out however that happens.
   *
   * If the hook is not there — a Node that has renamed it — this refuses to ask
   * rather than asking and printing the answer. Being unable to sign in here is
   * the better of those two outcomes by a distance.
   */
  const secretly = async question => {
    // Nothing to hide it from when it is piped in, and no terminal to silence.
    if (!process.stdin.isTTY) return asks(question);

    const echo = rl._writeToOutput && rl._writeToOutput.bind(rl);
    if (!echo) throw new Error('Cannot stop this terminal echoing, so the password would be printed on screen. Sign in from another machine and copy ~/.config/haru/cli.json across.');

    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      rl._writeToOutput = echo;
    };
    process.on('exit', restore);

    process.stdout.write(question);
    rl._writeToOutput = () => {};
    try {
      const { value } = await lines.next();
      return value ?? '';
    } finally {
      restore();
      process.stdout.write('\n');
    }
  };

  try {
    const url = ((await asks(`Where is she? [${BASE}] `)) || '').trim() || BASE;
    const username = ((await asks('Username: ')) || '').trim();
    const password = await secretly('Password: ');
    const device = ((await asks(`What should she call this machine? [${os.hostname()}] `)) || '').trim() || os.hostname();

    const where = url.replace(/\/+$/, '');
    let response;
    try {
      response = await fetch(`${where}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, remember: true, device }),
      });
    } catch (error) {
      throw new Error(`Could not reach her at ${where} — ${error.message}`);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `She refused the sign-in (${response.status}).`);

    // The token arrives as a Set-Cookie and is ours to keep from here.
    const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
    const token = cookies.map(line => /(?:^|;\s*)haru_device=([^;]+)/.exec(line || '')).find(Boolean);
    if (!token) throw new Error('She signed us in but sent no device token, which should not happen.');

    writeConfig({ ...readConfig(), url: where, device: token[1] });
    console.log(`\nSigned in. She will remember "${device}" for 90 days.`);
    console.log(`Kept in ${CONFIG_FILE}`);
  } finally {
    rl.close();
  }
}

/** Wrapped to a terminal width so a paragraph does not come out as one long line. */
function wrap(text, indent = '') {
  const width = Math.max(40, Math.min(100, process.stdout.columns || 80)) - indent.length;
  return String(text).split('\n').map(paragraph => {
    const out = [];
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) { out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
    return out.map(l => indent + l).join('\n');
  }).join('\n');
}

async function say(text) {
  const answer = await call('POST', '/api/chat', { text });
  if (answer.ignored || !String(answer.reply || '').trim()) {
    console.log(wrap('(she is ignoring you)'));
    return;
  }
  console.log(wrap(answer.reply));
}

async function agenda() {
  const { items = [] } = await call('GET', '/api/agenda');
  const open = items.filter(item => !item.done);
  if (!open.length) { console.log('Nothing on the list.'); return; }
  for (const item of open) {
    const when = [item.date, item.time].filter(Boolean).join(' ');
    console.log(`  ${item.kind === 'event' ? '·' : '☐'} ${item.title}${when ? `  (${when})` : ''}`);
  }
}

async function repl() {
  console.log(`Talking to her at ${BASE}. Ctrl-D or "exit" to stop.\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (!text) { rl.prompt(); continue; }
    if (['exit', 'quit', ':q'].includes(text.toLowerCase())) break;
    try {
      // Said before the wait rather than after, so several seconds of silence
      // reads as her thinking rather than as this having hung.
      process.stdout.write('haru> …\r');
      const answer = await call('POST', '/api/chat', { text });
      readline.clearLine(process.stdout, 0);
      const reply = answer.ignored ? '(she is ignoring you)' : String(answer.reply || '').trim();
      console.log(`haru> ${wrap(reply, '      ').trimStart()}\n`);
    } catch (error) {
      readline.clearLine(process.stdout, 0);
      console.error(`\n  ${error.message}\n`);
    }
    rl.prompt();
  }
  rl.close();
  console.log('\nRight, go on then.');
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--help' || args[0] === '-h') {
    console.log([
      'haru "text"        ask her something and exit',
      'haru               open a prompt and keep talking',
      'haru --agenda      what is still on the list',
      'haru --login       sign in and be remembered for 90 days',
      '',
      `Talking to: ${BASE}`,
      `Settings:   ${CONFIG_FILE}`,
      '',
      'HARU_URL overrides where she is.',
    ].join('\n'));
    return;
  }

  if (args[0] === '--login') return login();
  if (args[0] === '--agenda') return agenda();

  if (!stored.device && !stored.session && !process.env.HARU_URL) {
    console.error('No sign-in saved yet. Run:  haru --login');
    process.exitCode = 1;
    return;
  }

  if (args.length) return say(args.join(' '));

  // Piped input counts as asking: `echo "how was my week" | haru`.
  if (!process.stdin.isTTY) {
    const piped = await new Promise(resolve => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => resolve(data.trim()));
    });
    if (piped) return say(piped);
  }

  return repl();
}

main().catch(error => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});
