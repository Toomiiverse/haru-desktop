// Software integration test of the generated phone renderer, in an isolated hidden Electron window.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'haru-floating-test-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
const faces = Object.fromEntries(fs.readdirSync(path.join(root, 'build/emotions')).filter(f => f.endsWith('.svg')).map(f => [f, fs.readFileSync(path.join(root, 'build/emotions', f), 'utf8')]));
const html = '<style>body{margin:0}#stage{position:absolute;inset:0}</style><div id="stage"></div><script>window.haruNative={mouth:0,peek:false};const faces=' + JSON.stringify(faces).replace(/<\//g, '<\\/') + ';window.fetch=async url=>new Response(faces[String(url).split("/").pop().split("?")[0]],{status:200});</script><script>' + fs.readFileSync(path.join(root, 'build/lib/haru-avatar.js'), 'utf8') + '</script>';
fs.writeFileSync(path.join(temp, 'preview.html'), html);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 380, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
  const run = js => win.webContents.executeJavaScript(js);
  await win.loadFile(path.join(temp, 'preview.html'));
  for (let i = 0; i < 80 && !await run('!!window.haruAvatar'); i++) await pause(50);
  assert.ok(await run('!!window.haruAvatar'), 'renderer starts');
  for (const [face, kind, shape] of [['thinking','dot','circle'],['curious','ray','rect'],['surprised','ray','rect']]) {
    await run('window.haruAvatar.express(' + JSON.stringify(face) + ')'); await pause(950);
    const result = await run(`(() => {
      const f=[...document.querySelectorAll('.floating-face')].find(e=>e.style.opacity==='1');
      const marks=[...f.querySelectorAll('[data-reaction-mark="${kind}"]')];
      return {count:marks.length, attached:document.querySelectorAll('#avatar [data-reaction-mark]').length,
        nested:!!f.closest('#avatar'), running:marks.every(m=>m.getAnimations().some(a=>a.playState==='running')),
        placed:marks.every(m=>{const r=m.getBoundingClientRect();return r.width>0&&r.left>150&&r.top>-50;}),
        transforms:marks.map(m=>m.querySelector('${shape}').getAttribute('transform'))};
    })()`);
    assert.equal(result.count,3,face); assert.equal(result.attached,0); assert.equal(result.nested,false);
    assert.ok(result.running,face+' marks animate'); assert.ok(result.placed,face+' retains artwork coordinates');
    if (shape==='rect') result.transforms.forEach(t=>assert.match(t,/translate\(1[01]\d\d/));
  }
  await run('window.haruAvatar.express("confused")'); await pause(950);
  assert.equal(await run('document.querySelector(".floating-face[style*=\\"opacity: 1\\"] [data-reaction-mark=question]").querySelectorAll("path,circle").length'),2,'question stroke and punctuation dot stay together');
  await run('window.haruAvatar.express("neutral")'); await pause(650);
  await run('window.haruAvatar.symbol("hearts")'); await pause(100);
  assert.ok(await run('!!document.querySelector(".avatar-floating > .avatar-symbol-layer [data-symbol-part]")'));
  assert.equal(await run('document.querySelectorAll(".floating-face [data-reaction-mark]").length'),1,'old authored marks persist only in the fading buffer');
  await run('window.haruAvatar.symbol("sparkle-eyes")');
  assert.equal(await run('document.querySelectorAll("#avatar .avatar-symbol-layer [data-symbol-part]").length'),2);
  assert.equal(await run('document.querySelectorAll(".avatar-floating > .avatar-symbol-layer [data-symbol-part]").length'),1);
  await run('window.haruAvatar.express("sleepy")'); await pause(1100);
  assert.equal(await run('document.querySelectorAll(".avatar-floating > .avatar-sleep-layer [data-symbol-part]").length'),3);
  assert.equal(await run('document.querySelectorAll("#avatar .avatar-sleep-layer").length'),0);
  await run('document.querySelector(".avatar-floating").classList.add("frozen")');
  assert.ok(await run('[...document.querySelectorAll(".avatar-floating .avatar-sleep-layer [data-symbol-part]")].every(m=>m.getAnimations().every(a=>a.playState==="paused"))'));
  win.destroy(); console.log('Floating artwork, independent animation, coordinates, eye alignment and sleep layer checks passed'); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
