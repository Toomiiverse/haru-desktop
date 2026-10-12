// Her own browser, driven against a scripted Playwright MCP: the process is a
// pair of pipes, the proxy a number, and every answer is one the real server
// gave on 2026-10-12.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { McpChild } from '../electron/mcpclient';
import { ACTION_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, playwrightArgs, playwrightBrowser } from '../electron/playwright';

const SHOP = `### Page
- Page URL: https://shop.example/
- Page Title: Demo shop
### Snapshot
\`\`\`yaml
- generic [ref=e1]:
  - main [ref=e7]:
    - heading "Welcome to the shop" [level=1] [ref=e8]
    - paragraph [ref=e9]:
      - text: Blue shoes are £40 today.
      - link "Read about us" [ref=e10] [cursor=pointer]:
        - /url: /about
    - textbox "Search" [ref=e13]
    - button "Go" [ref=e14]
\`\`\``;

const ABOUT = `### Page
- Page URL: https://shop.example/about
- Page Title: About us
### Snapshot
\`\`\`yaml
- main [ref=e1]:
  - heading "About" [level=1] [ref=e2]
  - paragraph [ref=e3]: We make things.
\`\`\``;

type Script = (name: string, args: Record<string, unknown>) => { text?: string; image?: string; isError?: boolean };

/** A Playwright MCP that answers from `script`, and a count of the processes started. */
function fakeMcp(script: Script) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let started = 0;
  let killed = 0;
  let proxies = 0;
  let closedProxies = 0;
  const spawn = () => {
    started += 1;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const events = new EventEmitter();
    let buffer = '';
    stdin.on('data', chunk => {
      buffer += String(chunk);
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        const message = JSON.parse(line) as { id?: number; method: string; params: { name: string; arguments: Record<string, unknown> } };
        if (message.id === undefined) continue;
        let result: unknown;
        if (message.method === 'initialize') result = { serverInfo: { name: 'Playwright', version: 'test' } };
        else {
          calls.push({ name: message.params.name, args: message.params.arguments ?? {} });
          const answer = script(message.params.name, message.params.arguments ?? {});
          result = { content: [...(answer.text !== undefined ? [{ type: 'text', text: answer.text }] : []), ...(answer.image ? [{ type: 'image', data: answer.image, mimeType: 'image/jpeg' }] : [])], isError: answer.isError === true };
        }
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
      }
    });
    return Object.assign(events, { stdin, stdout, pid: 7, kill: () => { killed += 1; events.emit('exit', null, 'SIGTERM'); return true; } }) as unknown as McpChild;
  };
  const startProxy = async () => { proxies += 1; return { port: 40000 + proxies, close: async () => { closedProxies += 1; } }; };
  return { calls, spawn, startProxy, counts: () => ({ started, killed, proxies, closedProxies }) };
}

const resolvePublic = async () => ['93.184.216.34'];

test('playwrightArgs pins the flags that make the browser hers and guarded', () => {
  const args = playwrightArgs('/app/node_modules/@playwright/mcp/cli.js', { executablePath: '' }, 41234, '/data/browser-shots');
  assert.equal(args[0], '/app/node_modules/@playwright/mcp/cli.js');
  for (const flag of ['--headless', '--isolated', '--block-service-workers']) assert.ok(args.includes(flag), flag);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(value('--browser'), 'chromium');
  assert.equal(value('--proxy-server'), 'http://127.0.0.1:41234');
  assert.equal(value('--proxy-bypass'), '<-loopback>', 'loopback goes through the guard too, where it is refused');
  assert.equal(value('--output-dir'), '/data/browser-shots');
  assert.equal(value('--image-responses'), 'allow');
  assert.equal(value('--timeout-navigation'), String(NAVIGATION_TIMEOUT_MS));
  assert.equal(value('--timeout-action'), String(ACTION_TIMEOUT_MS));
  assert.ok(!args.includes('--executable-path'));
  assert.equal(playwrightArgs('cli', { executablePath: '/usr/bin/chromium' }, 1, '/x').at(-1), '/usr/bin/chromium');
  assert.ok(!args.some(arg => /user-data-dir|storage-state|caps/.test(arg)), 'nothing persistent, nothing extra');
});

test('her browser: open reads the page by snapshot, follow and click go by number, type goes to the ref, and it all stops when idle', async () => {
  let page = SHOP;
  const mcp = fakeMcp((name, args) => {
    if (name === 'browser_navigate') { page = String(args.url).includes('about') ? ABOUT : SHOP; return { text: `### Ran Playwright code\n### Page\n- Page URL: ${args.url}\n- Page Title: x\n### Snapshot\n- [Snapshot](out/page.yml)` }; }
    if (name === 'browser_snapshot') return { text: page };
    if (name === 'browser_click') { if (args.target === 'e10') page = ABOUT; return { text: '### Ran Playwright code' }; }
    if (name === 'browser_navigate_back') { page = SHOP; return { text: '### Ran Playwright code' }; }
    if (name === 'browser_type') return { text: '### Ran Playwright code' };
    if (name === 'browser_press_key') return { text: '### Ran Playwright code' };
    if (name === 'browser_take_screenshot') return { text: '### Result\n- [Screenshot of viewport](out/page.jpeg)', image: 'QUJD' };
    return { text: '### Error\nError: no such tool', isError: true };
  });
  const browser = playwrightBrowser({ ...mcp, resolve: resolvePublic, idleMs: 30 });
  assert.equal(browser.running(), false);
  const opened = await browser.open('shop.example');
  assert.equal(browser.running(), true);
  assert.equal(opened.title, 'Demo shop');
  assert.match(opened.text, /Blue shoes/);
  assert.deepEqual(mcp.calls.map(call => call.name), ['browser_navigate', 'browser_snapshot']);
  assert.deepEqual(mcp.calls[0].args, { url: 'https://shop.example' });
  assert.equal(browser.where(), 'shop.example');

  const about = await browser.follow(1);
  assert.equal(about.title, 'About us');
  assert.deepEqual(mcp.calls.at(-2), { name: 'browser_click', args: { target: 'e10', element: 'link "Read about us"' } });
  await assert.rejects(browser.follow(5), /no links to pick from/, 'numbers are the last reading\'s, and the about page has none');

  const back = await browser.back();
  assert.equal(back.title, 'Demo shop');
  await browser.type(1, 'blue shoes', true);
  assert.deepEqual(mcp.calls.at(-2), { name: 'browser_type', args: { target: 'e13', element: 'textbox (type) "Search"', text: 'blue shoes', submit: true } });
  await browser.click(2);
  assert.deepEqual(mcp.calls.at(-2), { name: 'browser_click', args: { target: 'e14', element: 'button (click) "Go"' } });
  await browser.scroll('down');
  assert.deepEqual(mcp.calls.at(-2), { name: 'browser_press_key', args: { key: 'PageDown' } });

  const picture = await browser.screenshot(false);
  assert.deepEqual(picture, { image: 'QUJD', mimeType: 'image/jpeg', caption: 'shop.example' });
  assert.deepEqual(mcp.calls.at(-1)?.args, { type: 'jpeg', scale: 'css', fullPage: false });

  assert.equal(mcp.counts().started, 1, 'one process for the whole run');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(browser.running(), false, 'idle, so gone');
  assert.deepEqual(mcp.counts(), { started: 1, killed: 1, proxies: 1, closedProxies: 1 });
  // And back for the next ask, on a fresh process.
  await browser.open('https://shop.example/');
  assert.equal(mcp.counts().started, 2);
  await browser.stop();
  assert.equal(browser.running(), false);
});

test('her browser refuses private addresses before the browser sees them, and turns the server\'s errors into plain ones', async () => {
  const mcp = fakeMcp((name, args) => {
    if (name === 'browser_navigate' && String(args.url).includes('slow')) return { text: '### Error\nError: browserBackend.callTool: page.goto: Timeout 15000ms exceeded.\nCall log:\n  - navigating', isError: true };
    if (name === 'browser_navigate') return { text: '### Error\nError: browserBackend.callTool: net::ERR_TUNNEL_CONNECTION_FAILED at https://gone.example/\nCall log:', isError: true };
    if (name === 'browser_click') return { text: '### Error\nError: Ref e9 not found in the current page snapshot. Try capturing new snapshot.', isError: true };
    if (name === 'browser_snapshot') return { text: SHOP };
    return { text: '' };
  });
  const browser = playwrightBrowser({ ...mcp, resolve: async host => host === 'inside.example' ? ['192.168.0.2'] : ['93.184.216.34'], idleMs: 60_000 });
  await assert.rejects(browser.open('http://127.0.0.1:8787/'), /not one you reach.*this machine/);
  await assert.rejects(browser.open('inside.example'), /private address \(192\.168\.0\.2\)/);
  await assert.rejects(browser.open('file:///etc/passwd'), /Only http and https/);
  assert.equal(mcp.calls.length, 0, 'none of that reached the browser');
  await assert.rejects(browser.open('https://gone.example/'), /could not be reached, or is not one you are allowed to reach/);
  await assert.rejects(browser.open('https://slow.example/'), /took too long to load/);
  await browser.read();
  await assert.rejects(browser.click(2), /page changed under you/);
  await browser.stop();
});
