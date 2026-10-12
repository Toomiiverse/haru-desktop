// Run: electron scripts/check-svg-avatar.cjs <Haru-expression-studio.html> [screenshot.png]
// Exercises the actual SVG component in its standalone preview, without starting Haru.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const [preview, screenshot] = process.argv.slice(2);
if (!preview || !fs.existsSync(preview)) throw Error('Pass the built Haru-expression-studio.html path.');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'haru-svg-check-')));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1120, height: 900, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
  const run = js => win.webContents.executeJavaScript(js);
  await win.loadFile(path.resolve(preview));
  for (let i = 0; i < 40 && !(await run('!!window.haruPreview?.ready')); i++) await pause(50);
  assert.ok(await run('!!window.haruPreview?.ready'), 'preview mounted');
  let idleTwitch = false;
  for (let i = 0; i < 60 && !idleTwitch; i++) {
    idleTwitch = await run('Array.from(document.querySelectorAll(".face.on [data-part^=ear-]")).some(e => e.getAnimations().some(a => a.playState === "running"))');
    if (!idleTwitch) await pause(50);
  }
  assert.ok(idleTwitch, 'an ear flicks automatically without clicking');
  for (const name of ['neutral', 'unimpressed', 'skeptical', 'determined', 'wink', 'concerned', 'attentive', 'shy', 'content', 'playful', 'startled', 'disappointed', 'relieved', 'drowsy']) {
    await run(`window.haruPreview.choose(${JSON.stringify(name)})`); await pause(40);
    assert.equal(await run('document.querySelectorAll(".face.on [data-part^=eye-]").length'), 2, name + ' eyes');
    assert.equal(await run('document.querySelectorAll(".face.on .eye").length'), 2, name + ' animated eyes');
    assert.equal(await run('document.querySelectorAll(".face.on [data-part^=ear-]").length'), 2, name + ' ears');
    assert.equal(await run('document.querySelectorAll(".face.on [data-hair]").length'), 6, name + ' independent hair parts');
  }
  await run('window.haruPreview.choose("wink")'); await pause(40);
  assert.ok(await run('!!document.querySelector(".face.on [data-part=eye-right].closed-eye")'), 'wink keeps its closed eye');
  await run('window.haruPreview.choose("neutral")'); await pause(280);
  for (let i = 0; i < 2; i++) {
    await run('window.haruPreview.play("ear-twitch")');
    const ears = await run('Array.from(document.querySelectorAll(".face.on [data-part^=ear-]")).map(e => { const a = e.getAnimations()[0]; a.pause(); a.currentTime = a.effect.getTiming().delay + 94; return { delay:a.effect.getTiming().delay, transform:getComputedStyle(e).transform }; })');
    assert.equal(ears.length, 2);
    assert.ok(ears.every(e => e.transform !== 'none' && e.transform !== 'matrix(1, 0, 0, 1, 0, 0)'), 'both ears visibly rotate');
    assert.notEqual(ears[0].delay, ears[1].delay, 'ears are staggered');
  }
  await run('document.querySelectorAll(".face.on [data-part^=ear-]").forEach(e => e.getAnimations().forEach(a => a.finish()))');
  for (const [motion, selector] of [['ear-twitch', '.face.on [data-part=ear-left]'], ['tuft-bounce', '.face.on [data-part=tuft]'], ['head-tilt', '.avatar-gesture'], ['double-nod', '.avatar-gesture']]) {
    await run(`window.haruPreview.play(${JSON.stringify(motion)})`);
    const result = await run(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const a = el.getAnimations()[0]; if (!a) return null; a.pause(); a.currentTime = a.effect.getTiming().duration * .25; return { transform: getComputedStyle(el).transform, duration: a.effect.getTiming().duration }; })()`);
    assert.ok(result && result.transform !== 'none' && result.transform !== 'matrix(1, 0, 0, 1, 0, 0)', motion + ' visibly moves');
    await run(`document.querySelector(${JSON.stringify(selector)}).getAnimations().forEach(a => a.finish())`);
  }
  await run('window.haruPreview.play("head-tilt")'); await pause(300);
  const readHair = 'Array.from(document.querySelectorAll(".face.on [data-hair]"), e => ({part:e.dataset.hair, angle:parseFloat(e.style.transform.slice(7)), transform:e.style.transform}))';
  const movingHair = await run(readHair);
  assert.ok(movingHair.every(h => Number.isFinite(h.angle)), 'hair has finite transforms');
  assert.ok(movingHair.filter(h => Math.abs(h.angle) > .1).length >= 3, 'separate locks respond to head movement');
  assert.ok(new Set(movingHair.map(h => h.transform)).size >= 4, 'locks have independent follow-through');
  await run('document.querySelector("#avatar").getAnimations({subtree:true}).forEach(a => a.animationName ? a.pause() : a.cancel()); const stop = document.createElement("style"); stop.id = "hair-rest-check"; stop.textContent = "#avatar, #avatar-pose {transform:none!important;transition:none!important}"; document.head.appendChild(stop)');
  await pause(1800);
  const settledHair = await run(readHair);
  assert.ok(settledHair.every(h => Math.abs(h.angle) < .15), 'hair settles after head stops: ' + JSON.stringify(settledHair));
  await run('document.querySelector("#hair-rest-check").remove(); document.querySelector("#avatar").getAnimations({subtree:true}).filter(a => a.animationName && a.playState === "paused").forEach(a => a.play())');
  // Every old expression still mounts; rapid changes resolve to the newest face.
  const names = await run('Array.from(document.querySelectorAll("select option"), o => o.value)');
  assert.equal(names.length, 47);
  for (const name of names) {
    await run(`window.haruPreview.choose(${JSON.stringify(name)})`); await pause(25);
    assert.ok(await run('!!document.querySelector(".face.on svg")'), name + ' rendered');
  }
  await run('window.haruPreview.choose("excited")'); await pause(50);
  assert.ok(await run('!!document.querySelector(".face.on [data-part=tuft]")'), 'existing excited face supports tuft bounce');
  await run('window.haruPreview.choose("wink"); window.haruPreview.choose("concerned"); window.haruPreview.choose("skeptical")'); await pause(300);
  assert.equal(await run('document.querySelector("#avatar").getAttribute("aria-label")'), 'Haru feeling skeptical');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pause(300);
  await run('window.haruPreview.play("ear-twitch"); window.haruPreview.play("double-nod")');
  const running = await run('document.querySelector("#avatar").getAnimations({subtree:true}).filter(a => a.playState === "running").map(a => ({name:a.animationName, part:a.effect.target.outerHTML.slice(0,100), frames:a.effect.getKeyframes()}))');
  assert.equal(running.length, 0, 'reduced motion stops and prevents animation: ' + JSON.stringify(running));
  const reducedHair = await run('Array.from(document.querySelectorAll("#avatar [data-hair]"), e => e.style.transform)');
  assert.ok(reducedHair.every(transform => !transform), 'reduced motion resets hair springs: ' + JSON.stringify(reducedHair));
  if (screenshot) {
    await run('window.haruPreview.choose("neutral")'); await pause(80);
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.ok(await run('document.documentElement.scrollWidth <= innerWidth'), 'mobile preview has no horizontal overflow');
  console.log('PASS: 47 expressions, eyes/ears, wink, four base motions, independent hair bounce and settling, rapid switching, reduced motion, mobile layout.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
