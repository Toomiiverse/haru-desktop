// Isolated UI smoke check with synthetic messages and an in-memory API.
// Run after npm test:
// DISPLAY=:99 node_modules/.bin/electron scripts/check-nudge-ui.cjs --no-sandbox
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { appPage } = require('../dist-test/electron/webpage');
const { rateNudge } = require('../dist-test/electron/nudge-learning');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'haru-nudge-ui-'));
fs.chmodSync(output, 0o700);
app.setPath('userData', path.join(output, 'browser'));
app.disableHardwareAcceleration();
const stamp = new Date().toISOString();
let asides = [{ id: 'synthetic-nudge', at: stamp, day: stamp.slice(0, 10), source: 'idle',
  text: 'Finished the mystery. Leaving that argument hanging worked better than explaining everything.',
  nudgeTopic: 'interest:synthetic book', nudgeKind: 'own', nudgeKeywords: ['synthetic', 'book'] }];
let learning = [], fail = false, server, window;
const writes = [];

async function waitFor(expression) {
  return window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const end=Date.now()+12000;
    const check=()=>{ if(${expression}) return resolve(true); if(Date.now()>end) return reject(new Error('UI condition timed out')); setTimeout(check,30); }; check();
  })`);
}

async function main() {
  await app.whenReady();
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const entry = path.join(output, 'desktop.tsx');
  fs.writeFileSync(entry, `import React from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
    import {createRoot} from ${JSON.stringify(path.join(root, 'node_modules/react-dom/client.js'))};
    import {AsidesPage} from ${JSON.stringify(path.join(root, 'src/components.tsx'))};
    const listeners=[];
    window.haru={chat:{getAsides:()=>fetch('/fixtures/asides').then(r=>r.json()),
      onAside:()=>()=>{},onAsidesCleared:()=>()=>{},onAsidesChanged:fn=>{listeners.push(fn);return()=>{};},
      clearAsides:async()=>[],nudgeFeedback:async(id,choice)=>{
        const r=await fetch('/api/chat/nudge-feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,choice})});
        if(!r.ok)throw Error('feedback failed');
        const list=await fetch('/fixtures/asides').then(r=>r.json());for(const fn of listeners)fn(list);return list.find(a=>a.id===id);
      }}};
    createRoot(document.getElementById('root')).render(<AsidesPage/>);`);
  const bundled = await build({ root, configFile: false, plugins: [react()], logLevel: 'silent',
    resolve: { alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, lib: { entry, name: 'NudgeUiCheck', formats: ['iife'] } } });
  const code = [bundled].flat()[0].output.find(file => file.type === 'chunk').code;
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8').replace(/^@import.*$/gm, '');
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/desktop') {
      res.setHeader('content-type', 'text/html'); return res.end(`<html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root" class="haru-app"></div><script src="/desktop.js"></script></body></html>`);
    }
    if (url.pathname === '/desktop.js') { res.setHeader('content-type', 'text/javascript'); return res.end(code); }
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(appPage()); }
    if (url.pathname === '/fixtures/asides') return json(asides);
    if (url.pathname === '/api/chat') return json({ messages: asides.map(a => ({ id: a.id, role: 'assistant', content: a.text, at: a.at, aside: a.source, nudge: true, nudgeFeedback: a.nudgeFeedback })) });
    if (url.pathname === '/api/chat/nudge-feedback') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { id, choice } = JSON.parse(body);
      if (fail) return json({ error: 'Synthetic failure' }, 400);
      const result = rateNudge(asides, learning, id, choice, Date.now());
      if (!result) return json({ error: 'Missing nudge' }, 404);
      asides = result.asides; learning = result.learning; writes.push(choice);
      return json({ ok: true, id, choice: result.aside.nudgeFeedback ?? null });
    }
    if (url.pathname === '/api/nudge') return json({ line: null });
    return json({});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true, sandbox: true } });
  // No outside requests, credentials, or live Haru endpoints in a UI test.
  window.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith(base) && !details.url.startsWith('data:') && !details.url.startsWith('blob:') }));
  const click = index => window.webContents.executeJavaScript(`document.querySelectorAll('.nudge-feedback button')[${index}].click()`);
  for (const surface of ['phone', 'desktop']) {
    window.setSize(surface === 'phone' ? 390 : 1000, 844);
    await window.loadURL(surface === 'phone' ? base : `${base}/desktop`);
    await waitFor(`document.querySelectorAll('.nudge-feedback button').length===3`);
    assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth<=window.innerWidth'), true, `${surface} must fit`);
    await click(0); await waitFor(`document.querySelector('.nudge-feedback button').getAttribute('aria-pressed')==='true'`);
    assert.equal(asides[0].nudgeFeedback, 'more');
    await click(0); await waitFor(`document.querySelector('.nudge-feedback button').getAttribute('aria-pressed')==='false'`);
    assert.equal(asides[0].nudgeFeedback, undefined);
    await click(2); await waitFor(`document.querySelectorAll('.nudge-feedback button')[2].getAttribute('aria-pressed')==='true'`);
    await window.loadURL(window.webContents.getURL()); await waitFor(`document.querySelectorAll('.nudge-feedback button')[2]?.getAttribute('aria-pressed')==='true'`);
    fs.writeFileSync(path.join(output, `${surface}.png`), (await window.webContents.capturePage()).toPNG());
    fail = true; await click(1); await waitFor(`document.querySelector('[role=alert]')?.textContent.includes('Could not save')`);
    assert.equal(asides[0].nudgeFeedback, 'discussed', 'a failed save preserves the previous vote');
    fail = false;
    console.log(`${surface}: vote, undo, persistence, layout and failed-save handling passed`);
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ writes, learning }, null, 2));
  console.log(`Screenshots and synthetic evidence: ${output}`);
}
main().then(() => { window?.destroy(); server?.close(); app.quit(); }, error => {
  console.error(error.stack); window?.destroy(); server?.close(); app.exit(1);
});
