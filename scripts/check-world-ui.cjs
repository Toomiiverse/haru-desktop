// Real browser checks with a synthetic persistent world, never the live server.
// DISPLAY=:99 node_modules/.bin/electron scripts/check-world-ui.cjs --no-sandbox
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { worldPage } = require('../dist-test/electron/world-page');
const { newWorld, commandWorld, worldView, advanceWorld } = require('../dist-test/electron/world');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'haru-world-ui-'));
fs.chmodSync(output, 0o700);
app.setPath('userData', path.join(output, 'browser'));
app.disableHardwareAcceleration();
let server, win, failure = false, frame = false;
let state = newWorld(Date.now());
const errors = [];
function evaluate(code) {
  return win.webContents.executeJavaScript(frame
    ? `(function(){const window=globalThis.document.querySelector('iframe').contentWindow;const document=window.document;${code}})()`
    : `(function(){${code}})()`);
}
async function paint() {
  await evaluate('return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));');
  await new Promise(resolve => setTimeout(resolve, 120));
}
async function waitFor(expression) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    try { if (await evaluate(`return !!(${expression});`)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function main() {
  await app.whenReady();
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const entry = path.join(output, 'desktop.tsx');
  fs.writeFileSync(entry, `import React from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
    import {createRoot} from ${JSON.stringify(path.join(root, 'node_modules/react-dom/client.js'))};
    import {WorldPage} from ${JSON.stringify(path.join(root, 'src/WorldPage.tsx'))};
    async function call(command){const r=await fetch(command?'/api/world/control':'/api/world',{method:command?'POST':'GET',headers:{'content-type':'application/json'},body:command?JSON.stringify(command):undefined});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
    window.haru={world:{get:()=>call(),command:call}};
    createRoot(document.getElementById('root')).render(<WorldPage/>);`);
  const bundle = await build({ root, configFile: false, plugins: [react()], logLevel: 'silent',
    resolve: { alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, lib: { entry, name: 'WorldUiCheck', formats: ['iife'] } } });
  const code = [bundle].flat()[0].output.find(file => file.type === 'chunk').code;
  server = http.createServer(async (req, res) => {
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(worldPage()); }
    if (req.url === '/desktop') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<html><head><meta charset="utf-8"></head><body style="margin:0;background:#090d18"><div id="root" style="display:flex;height:100vh"></div><script src="/desktop.js"></script></body></html>'); }
    if (req.url === '/desktop.js') { res.setHeader('content-type', 'text/javascript'); return res.end(code); }
    if (req.url === '/api/world') return send(worldView(state));
    if (req.url === '/api/world/control') {
      if (failure) return send({ error: 'Could not save this change.' }, 500);
      let body = ''; for await (const chunk of req) body += chunk;
      try { state = commandWorld(state, JSON.parse(body), Date.now()); return send(worldView(state)); }
      catch (e) { return send({ error: e.message }, 409); }
    }
    return send({}, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('Content Security Policy')) errors.push(event.message); });
  win.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith(base) && !details.url.startsWith('about:') && !details.url.startsWith('data:') }));
  for (const surface of ['phone', 'desktop']) {
    frame = surface === 'desktop';
    state = advanceWorld(newWorld(Date.now(), 7319), 240, Date.now(), true);
    win.setSize(frame ? 1280 : 390, frame ? 1180 : 844);
    await win.loadURL(base + (frame ? '/desktop' : '/'));
    await waitFor(`document.getElementById('pause')?.disabled===false`);
    assert.equal(await evaluate('return document.documentElement.scrollWidth<=window.innerWidth;'), true, `${surface} fits`);
    assert.equal(await evaluate("return document.getElementById('speed').textContent.includes('12×');"), true, 'UTF-8 survives the desktop bridge');
    assert.equal(await evaluate("return document.getElementById('room').getBoundingClientRect().height>200;"), true);
    await evaluate("document.querySelector('[data-focus=gaming]').click();");
    await waitFor("document.querySelector('[data-focus=gaming]').getAttribute('aria-pressed')==='true' && !document.getElementById('pause').disabled");
    assert.equal(state.focus, 'gaming');
    await evaluate("document.getElementById('pause').click();");
    await waitFor("document.getElementById('pause').textContent==='Resume' && !document.getElementById('advance').disabled");
    const before = state.minute;
    await evaluate("document.getElementById('advance').click();");
    await waitFor("!document.getElementById('advance').disabled");
    assert.equal(state.minute, before + 30);
    await evaluate("document.querySelector('[data-spot=desk]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('[data-action=game]').click();");
    await waitFor("document.getElementById('queued').textContent.includes('Neon Circuit') && !document.getElementById('pause').disabled");
    assert.equal(state.suggested.id, 'game');
    await evaluate("document.querySelector('[data-light=warm]').click();");
    await waitFor("document.body.dataset.lighting==='warm' && !document.getElementById('pause').disabled");
    assert.equal(state.room.lighting, 'warm');
    await evaluate("document.querySelector('[data-spot=bed]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); document.getElementById('zoom').click();");
    assert.equal(await evaluate("return document.getElementById('spot-title').textContent;"), 'Sleep corner');
    assert.equal(await evaluate("return document.getElementById('room').getAttribute('viewBox');"), '185 320 480 394');
    await evaluate("document.getElementById('zoom').click();");
    await evaluate("document.querySelector('[data-spot=desk]').dispatchEvent(new MouseEvent('click',{bubbles:true}));");
    await evaluate("document.getElementById('brain').click();");
    await waitFor("!document.getElementById('brain').disabled && !document.getElementById('brain').checked");
    await win.reload();
    await waitFor("document.getElementById('pause')?.textContent==='Resume' && !document.getElementById('pause').disabled");
    assert.equal(await evaluate("return document.getElementById('brain').checked;"), false);
    assert.equal(await evaluate("return document.body.dataset.lighting;"), 'warm');
    failure = true;
    await evaluate("document.getElementById('pause').click();");
    await waitFor("document.getElementById('error').textContent.includes('Could not save')");
    assert.equal(state.running, false);
    assert.equal(await evaluate("return document.getElementById('pause').textContent;"), 'Resume');
    failure = false;
    await win.reload();
    await waitFor("document.getElementById('pause')?.disabled===false");
    await evaluate("document.querySelector('[data-light=neon]').click();");
    await waitFor("document.body.dataset.lighting==='neon' && !document.getElementById('pause').disabled");
    await paint();
    fs.writeFileSync(path.join(output, `${surface}.png`), (await win.webContents.capturePage()).toPNG());
    if (!frame) {
      assert.ok(await evaluate("return document.getElementById('inspect').getBoundingClientRect().top < document.querySelector('.below').getBoundingClientRect().top;"), 'furniture actions come before the journal on phones');
      await evaluate("document.getElementById('zoom').click();");
      await paint();
      fs.writeFileSync(path.join(output, 'phone-close-up.png'), (await win.webContents.capturePage()).toPNG());
      await evaluate("document.getElementById('zoom').click();document.getElementById('inspect').scrollIntoView();");
      await paint();
      assert.ok(await evaluate("return document.getElementById('inspect').getBoundingClientRect().top < 24;"));
      fs.writeFileSync(path.join(output, 'phone-controls.png'), (await win.webContents.capturePage()).toPNG());
      await evaluate("window.scrollTo(0,0);");
      win.setSize(320, 740);
      await paint();
      assert.equal(await evaluate('return document.documentElement.scrollWidth<=window.innerWidth;'), true, 'small phone fits');
    }
    console.log(`${surface}: layout, world actions, pause, skip, persistence, planner toggle lighting, keyboard hotspots, close-up views and failed-save handling passed`);
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'state.json'), JSON.stringify(state, null, 2));
  console.log(`Screenshots and synthetic evidence: ${output}`);
}
main().then(() => { win?.destroy(); server?.close(); app.quit(); }, e => { console.error(e.stack); win?.destroy(); server?.close(); app.exit(1); });
