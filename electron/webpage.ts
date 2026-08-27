// The two pages the phone ever sees.
//
// Written as plain HTML with no build step and no imports. The desktop app is
// React through Vite, and a second Vite target for one chat screen would mean a
// second build to keep working, a second set of assets to ship, and a packaging
// path to get wrong — for a page that is a stage, a list and a text box.
//
// Nothing is fetched from anywhere: no fonts, no icons, no framework. That is
// what lets the server send a content policy forbidding every outside origin,
// which in turn means a hostile string that reaches this page has nowhere to
// send anything it finds. Her portrait is served by us, from us.
//
// The look follows AIRI (airi.moeru.ai): the character is the page rather than
// an ornament on it, colour comes from one rotatable hue in OKLCH rather than a
// list of hex codes, and everything sits on soft, generously rounded glass. Two
// things are deliberately not copied — her palette stays pink rather than AIRI's
// green, because she is not that character, and the hue does not animate, which
// on a companion you glance at all day would be a fidget rather than a feature.

/** One number to move the whole palette. 350 is Haru's pink; 150 would be AIRI's green. */
const HUE = 350;

const SHELL = `
  :root {
    color-scheme: dark;
    --hue: ${HUE};
    /* OKLCH so lightness stays perceptually even as the hue turns — the reason
       the reference uses it, and the reason a hand-picked hex per shade is not
       needed. */
    --bg:      oklch(16% 0.035 var(--hue));
    --bg-lift: oklch(21% 0.045 var(--hue));
    --ink:     oklch(96% 0.012 var(--hue));
    --ink-dim: oklch(72% 0.030 var(--hue));
    --accent:  oklch(78% 0.130 var(--hue));
    --accent-ink: oklch(22% 0.070 var(--hue));
    --glass:   oklch(30% 0.045 var(--hue) / 0.55);
    --edge:    oklch(70% 0.060 var(--hue) / 0.16);
    --mine:    oklch(38% 0.075 var(--hue) / 0.85);
    --r-lg: 22px;
    --r-md: 16px;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink);
    font: 16px/1.55 ui-rounded, "SF Pro Rounded", "Segoe UI Variable", system-ui, -apple-system, sans-serif;
    /* The glow she sits in. Fixed, so it does not slide around under scrolling. */
    background-image:
      radial-gradient(120% 70% at 50% -10%, oklch(42% 0.12 var(--hue) / 0.55), transparent 60%),
      radial-gradient(90% 50% at 100% 100%, oklch(38% 0.10 calc(var(--hue) + 60) / 0.35), transparent 70%);
    background-attachment: fixed;
  }
  input, textarea, button { font: inherit; color: inherit; }
  input, textarea {
    background: var(--glass); border: 1px solid var(--edge); border-radius: var(--r-md);
    padding: .8rem 1rem; width: 100%; backdrop-filter: blur(12px);
  }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); }
  button {
    background: var(--accent); color: var(--accent-ink); border: 0;
    border-radius: 999px; padding: .75rem 1.3rem; font-weight: 650; letter-spacing: .01em;
  }
  button:disabled { opacity: .45; }
  .err { color: oklch(72% 0.16 25); min-height: 1.4em; font-size: .9rem; }
`;

// Her on stage: the bloub (jeremy-prt/bloub, MIT) bot engine, ported to plain
// JS for this no-build page. One black shape morphing through idle / wink /
// wide / notify, the two eyes as holes punched in the body, gaze drift, breathing
// and blinking. No library, no clock state outside the block — sample(t) is a
// pure function of time, and every constant below is a measurement off the
// reference video, not a choice. The block builds and runs itself on #stage.
const BLOUB = `
(() => {
  const TAU = Math.PI * 2;
  const clamp = (v, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const r2 = (v) => Math.round(v * 100) / 100;
  const easeOutQuint = (t) => 1 - (1 - t) ** 5;
  const loopNoise = (t, period, seed = 0) => {
    const p = (t / period) * TAU;
    return 0.55 * Math.sin(p + seed) + 0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) + 0.15 * Math.sin(3 * p + seed * 2.3 + 2.4);
  };
  const createRng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // The measured frame: ball radius 100, viewBox half-side 158.
  const RAYON = 100, DEMI = 158, VB = 2 * DEMI;

  // Eyes live on a sphere, not flat. Measured, not chosen.
  const EYE_SPLIT = 15.46, EYE_W = 0.186, EYE_H = 0.412;
  const REST_GAZE = { yaw: 28.49, pitch: 28.62, roll: -13 };

  const deg = (d) => (d * Math.PI) / 180;
  const spin = (u, v, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [
      [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
      [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s]
    ];
  };
  function eyePoses(gaze, scale, split) {
    split = split === undefined ? EYE_SPLIT : split;
    let f = [0, 0, 1], right = [1, 0, 0], down = [0, 1, 0];
    let s = spin(f, right, deg(gaze.yaw)); f = s[0]; right = s[1];
    s = spin(down, f, deg(gaze.pitch)); down = s[0]; f = s[1];
    s = spin(right, down, deg(gaze.roll)); right = s[0]; down = s[1];
    const build = (side) => {
      s = spin(f, right, deg(split * side));
      const ef = s[0], er = s[1];
      return { x: ef[0] * scale, y: ef[1] * scale, a: er[0], b: er[1], c: down[0], d: down[1], depth: ef[2] };
    };
    return [build(-1), build(1)];
  }

  // Deterministic blink calendar: 1.9-4.6 s apart, the occasional double blink.
  const BLINK_RNG = createRng(0x5eed);
  const BLINKS = (() => {
    const out = []; let t = 1.4;
    while (t < 900) { out.push(t); t += 1.9 + BLINK_RNG() * 2.7; if (BLINK_RNG() < 0.18) { out.push(t); t += 0.24; } }
    return out;
  })();
  const BLINK_DUR = 0.18;
  function blinkLid(t) {
    for (let i = 0; i < BLINKS.length; i++) {
      const start = BLINKS[i];
      if (t < start) break;
      const k = (t - start) / BLINK_DUR;
      if (k >= 0 && k <= 1) return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55;
    }
    return 1;
  }
  function liveliness(t, opt) {
    opt = opt || {};
    const wander = opt.wander === undefined ? 1 : opt.wander;
    const blink = opt.blink === undefined ? true : opt.blink;
    const float = opt.float === undefined ? true : opt.float;
    return {
      dYaw: (loopNoise(t, 11.3, 0.4) * 5.5 + loopNoise(t, 3.7, 2.1) * 1.6) * wander,
      dPitch: (loopNoise(t, 9.1, 1.3) * 4.2 + loopNoise(t, 4.3, 0.7) * 1.3) * wander,
      dRoll: loopNoise(t, 13.7, 3.2) * 2.2 * wander,
      lid: blink ? blinkLid(t) : 1,
      driftX: float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
      driftY: float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
      breath: float ? 1 + Math.sin((t / 3.4) * Math.PI * 2) * 0.005 : 1
    };
  }
  const blinkScale = (lid) => 0.06 + 0.94 * clamp(lid);

  // The silhouette is a radial profile sampled at the same 64 angles everywhere,
  // so any two shapes morph by interpolating radii.
  const N = 64;
  const COS = Array.from({ length: N }, (_, i) => Math.cos((i / N) * TAU));
  const SIN = Array.from({ length: N }, (_, i) => Math.sin((i / N) * TAU));
  function circle(radius, pose) {
    const radii = new Array(N); radii.fill(radius);
    return Object.assign({ radii: radii, rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 }, pose || {});
  }
  function toPoints(s, scale, out) {
    out = out || [];
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    for (let i = 0; i < N; i++) {
      const r = s.radii[i] || 1;
      const x = r * COS[i], y = r * SIN[i];
      const rx = x * cr - y * sr, ry = x * sr + y * cr;
      const p = out[i] || { x: 0, y: 0 };
      p.x = (rx * s.sx + s.cx) * scale;
      p.y = (ry * s.sy + s.cy) * scale;
      out[i] = p;
    }
    out.length = N;
    return out;
  }
  function closedPath(pts, tension) {
    tension = tension === undefined ? 1 / 6 : tension;
    const n = pts.length;
    if (n < 3) return '';
    let d = 'M' + r2(pts[0].x) + ' ' + r2(pts[0].y);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1x = p1.x + (p2.x - p0.x) * tension, c1y = p1.y + (p2.y - p0.y) * tension;
      const c2x = p2.x - (p3.x - p1.x) * tension, c2y = p2.y - (p3.y - p1.y) * tension;
      d += 'C' + r2(c1x) + ' ' + r2(c1y) + ' ' + r2(c2x) + ' ' + r2(c2y) + ' ' + r2(p2.x) + ' ' + r2(p2.y);
    }
    return d + 'Z';
  }
  function radiusAtAngle(radii, angle) {
    const t = ((((angle / TAU) % 1) + 1) % 1) * N;
    const i = Math.floor(t);
    return lerp(radii[i % N] || 1, radii[(i + 1) % N] || 1, t - i);
  }
  function capsulePath(w, h) {
    const hw = Math.max(w, 0.01) / 2, hh = Math.max(h, 0.01) / 2, r = Math.min(hw, hh);
    return 'M' + r2(-hw) + ' ' + r2(-hh + r) + 'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 ' + r2(-hw + r) + ' ' + r2(-hh) + 'L' + r2(hw - r) + ' ' + r2(-hh) + 'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 ' + r2(hw) + ' ' + r2(-hh + r) + 'L' + r2(hw) + ' ' + r2(hh - r) + 'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 ' + r2(hw - r) + ' ' + r2(hh) + 'L' + r2(-hw + r) + ' ' + r2(hh) + 'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 ' + r2(-hw) + ' ' + r2(hh - r) + 'Z';
  }

  // Notification pastille, measured off the video: on the circumference at -42deg.
  const NOTIF_BLUE = '#2496e8', NOTIF_ANGLE = -42, NOTIF_DIST = 1.003, NOTIF_R = 0.15, NOTIF_POP = 1.14, NOTIF_MARGIN = 0.054;

  const pair = (w, h) => [{ w: w, h: h, open: 1 }, { w: w, h: h, open: 1 }];
  function base(over) {
    return Object.assign({
      sil: circle(1), offX: 0, offY: 0,
      gaze: { yaw: REST_GAZE.yaw, pitch: REST_GAZE.pitch, roll: REST_GAZE.roll },
      split: EYE_SPLIT, eyes: pair(EYE_W, EYE_H), eyeAlpha: 1, bodyAlpha: 1,
      dots: [], arcs: [], notif: null, dotsBehind: false
    }, over || {});
  }
  // The four core states. morph is the entry fade (measured exponential ease-out);
  // blinkIn masks a shape change with a blink, as in the reference.
  const STATES = {
    idle:   { id: 'idle',   morph: 0.45, blinkIn: false, duration: 2.4, pose: () => base() },
    wink:   { id: 'wink',   morph: 0.3,  blinkIn: true,  duration: 1.6, pose: () => base({ gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 }, split: 16.25, eyes: [{ w: 0.236, h: 0.464, open: 1 }, { w: 0.447, h: 0.089, open: 1 }] }) },
    wide:   { id: 'wide',   morph: 0.55, blinkIn: true,  duration: 1.8, pose: () => base({ gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 }, split: 18.43, eyes: pair(0.356, 0.875) }) },
    notify: { id: 'notify', morph: 0.5,  blinkIn: true,  duration: 2.2, pose: (t) => {
      const p = clamp(t / 0.45);
      const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35);
      const r = NOTIF_R * (p < 1 ? pop : 1);
      const a = (NOTIF_ANGLE * Math.PI) / 180;
      return base({ gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 }, split: 18.89, eyes: pair(0.505, 0.498), notif: { x: Math.cos(a) * NOTIF_DIST, y: Math.sin(a) * NOTIF_DIST, r: r, notch: r + NOTIF_MARGIN } });
    } }
  };
  const CYCLE = ['idle', 'wink', 'wide', 'notify'].map(s => ({ state: s, duration: STATES[s].duration }));

  // Clock-free engine: sample(t) is a pure function of time.
  function BotEngine() {
    this.scale = RAYON;
    this.cur = 'idle';
    this.prev = null;
    this.departFige = null;
    this.tCur = 0;
    this.tPrev = 0;
    this.blinkAt = -10;
    this.pts = [];
    this.look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };
    this.lookPrev = this.look;
    this.lookAt = -10;
    this.lookMorph = 0.24;
  }
  const NO_LOOK = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };
  BotEngine.prototype.lookAtTime = function (now) {
    const k = (now - this.lookAt) / this.lookMorph;
    if (k >= 1) return this.look;
    const t = easeOutQuint(clamp(k));
    const a = this.lookPrev, b = this.look;
    return { yaw: lerp(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t), mix: lerp(a.mix, b.mix, t), spin: lerp(a.spin, b.spin, t), wander: lerp(a.wander, b.wander, t) };
  };
  BotEngine.prototype.setLook = function (look, now, morph) {
    if (look && !Number.isFinite(look.yaw + look.pitch + look.mix + look.spin + look.wander)) return;
    this.lookPrev = this.lookAtTime(now);
    this.look = look || NO_LOOK;
    this.lookAt = now;
    this.lookMorph = morph === undefined ? 0.24 : morph;
  };
  BotEngine.prototype.posed = function (def, t) { return def.pose(t); };
  BotEngine.prototype.origine = function (now) {
    if (this.departFige) return this.departFige;
    if (!this.prev) return null;
    return this.posed(STATES[this.prev], Math.max(0, now - this.tPrev));
  };
  const lerpEye = (a, b, t) => ({ w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), open: lerp(a.open, b.open, t), tilt: lerp(a.tilt || 0, b.tilt || 0, t) });
  BotEngine.prototype.blendPose = function (a, b, t) {
    return {
      sil: {
        radii: a.sil.radii.map((r, i) => lerp(r, b.sil.radii[i], t)),
        rot: a.sil.rot + (b.sil.rot - a.sil.rot) * t,
        cx: lerp(a.sil.cx, b.sil.cx, t), cy: lerp(a.sil.cy, b.sil.cy, t),
        sx: lerp(a.sil.sx, b.sil.sx, t), sy: lerp(a.sil.sy, b.sil.sy, t)
      },
      offX: lerp(a.offX, b.offX, t), offY: lerp(a.offY, b.offY, t),
      gaze: { yaw: lerp(a.gaze.yaw, b.gaze.yaw, t), pitch: lerp(a.gaze.pitch, b.gaze.pitch, t), roll: lerp(a.gaze.roll, b.gaze.roll, t) },
      split: lerp(a.split, b.split, t),
      eyes: [lerpEye(a.eyes[0], b.eyes[0], t), lerpEye(a.eyes[1], b.eyes[1], t)],
      eyeAlpha: lerp(a.eyeAlpha, b.eyeAlpha, t),
      bodyAlpha: lerp(a.bodyAlpha, b.bodyAlpha, t),
      dots: b.dots, arcs: b.arcs,
      notif: t < 0.5 ? a.notif : b.notif,
      dotsBehind: t < 0.5 ? a.dotsBehind : b.dotsBehind
    };
  };
  BotEngine.prototype.setState = function (id, now) {
    if (id === this.cur) return;
    const morph = STATES[this.cur].morph;
    const enPleinFondu = this.prev !== null && now - this.tCur < morph;
    this.departFige = enPleinFondu ? this.poseComposee(now) : null;
    this.prev = this.cur;
    this.tPrev = this.tCur;
    this.cur = id;
    this.tCur = now;
    if (STATES[id].blinkIn) this.blinkAt = now;
  };
  BotEngine.prototype.poseComposee = function (now) {
    const def = STATES[this.cur];
    const pose = this.posed(def, Math.max(0, now - this.tCur));
    const since = now - this.tCur;
    if (since >= def.morph) return pose;
    const origine = this.origine(now);
    if (!origine) return pose;
    return this.blendPose(origine, pose, easeOutQuint(clamp(since / def.morph)));
  };
  BotEngine.prototype.sample = function (now) {
    const R = this.scale;
    const def = STATES[this.cur];
    let pose = this.posed(def, Math.max(0, now - this.tCur));
    const since = now - this.tCur;
    const origine = since < def.morph ? this.origine(now) : null;
    if (origine) pose = this.blendPose(origine, pose, easeOutQuint(clamp(since / def.morph)));

    const alive = pose.eyeAlpha > 0.01;
    const look = this.lookAtTime(now);
    const life = liveliness(now, { wander: alive ? look.wander : 0, blink: alive });
    const gaze = {
      yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
      pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
      roll: pose.gaze.roll + life.dRoll
    };
    const forced = clamp((now - this.blinkAt) / 0.2);
    const forcedLid = forced < 1 ? Math.abs(forced * 2 - 1) : 1;
    const lid = Math.min(life.lid, forcedLid);
    const offX = pose.offX + life.driftX;
    const offY = pose.offY + life.driftY;

    const sil = { radii: pose.sil.radii, rot: pose.sil.rot, cx: pose.sil.cx + offX, cy: pose.sil.cy + offY, sx: pose.sil.sx, sy: pose.sil.sy * life.breath };
    const bodyPath = closedPath(toPoints(sil, R, this.pts));

    const bodyRadius = (x, y) => radiusAtAngle(pose.sil.radii, Math.atan2(y, x) - pose.sil.rot);
    const eyes = [];
    if (pose.eyeAlpha > 0.01) {
      const poses = eyePoses(gaze, R, pose.split);
      for (let i = 0; i < 2; i++) {
        const e = poses[i];
        if (e.depth <= 0.02) continue;
        const cfg = pose.eyes[i];
        const fit = bodyRadius(e.x, e.y);
        const phi = ((cfg.tilt || 0) * Math.PI) / 180;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const ax = e.a * cp + e.c * sp, ay = e.b * cp + e.d * sp;
        const cx2 = -e.a * sp + e.c * cp, cy2 = -e.b * sp + e.d * cp;
        const k = blinkScale(Math.min(lid, cfg.open));
        eyes.push({
          d: capsulePath(cfg.w * R, cfg.h * R),
          matrix: 'matrix(' + r2(ax) + ',' + r2(ay * k) + ',' + r2(cx2) + ',' + r2(cy2 * k) + ',' + r2(e.x * fit + offX * R) + ',' + r2(e.y * fit + offY * R) + ')',
          alpha: pose.eyeAlpha * clamp(e.depth / 0.12)
        });
      }
    }

    const nFit = pose.notif ? bodyRadius(pose.notif.x, pose.notif.y) : 1;
    const nx = pose.notif ? (pose.notif.x * nFit + offX) * R : 0;
    const ny = pose.notif ? (pose.notif.y * nFit + offY) * R : 0;
    return {
      bodyPath: bodyPath,
      bodyAlpha: pose.bodyAlpha,
      eyes: eyes,
      notif: pose.notif ? { x: nx, y: ny, r: pose.notif.r * R } : null,
      notch: pose.notif ? { x: nx, y: ny, r: pose.notif.notch * R } : null
    };
  };

  // ---- stage ----------------------------------------------------------
  const host = document.getElementById('stage');
  if (!host) return;
  host.innerHTML = '<svg id="bloub" viewBox="-158 -158 316 316" aria-hidden="true">' +
    '<defs><mask id="bm" maskUnits="userSpaceOnUse" x="-158" y="-158" width="316" height="316">' +
    '<path id="bmBody" fill="#fff"/><g id="bmEyes"></g><circle id="bmNotch" fill="#000" r="0" style="display:none"/>' +
    '</mask></defs>' +
    '<g id="bo"><path id="bBody" fill="#fff"/><g mask="url(#bm)"><rect x="-158" y="-158" width="316" height="316" fill="#0a0a0c"/></g></g>' +
    '<circle id="bNotif" fill="#2496e8" r="0" style="display:none"/>' +
    '</svg>';
  const svg = document.getElementById('bloub');
  const bmBody = document.getElementById('bmBody');
  const bmEyes = document.getElementById('bmEyes');
  const bmNotch = document.getElementById('bmNotch');
  const bBody = document.getElementById('bBody');
  const bo = document.getElementById('bo');
  const bNotif = document.getElementById('bNotif');

  const engine = new BotEngine();
  let block = 0, nextAt = Infinity, clock = 0, last = 0, blockStart = 0;
  function apply(i) {
    const b = CYCLE[i];
    blockStart = clock;
    engine.setState(b.state, clock);
    nextAt = blockStart + b.duration;
  }
  // The page tells her when she is talking: jump the cycle to the notify block
  // so the pastille pops, then the sequence carries on from there.
  function flashNotify() {
    const i = CYCLE.findIndex((b) => b.state === 'notify');
    if (i < 0) return;
    block = i;
    apply(i);
  }
  window.bloub = { notify: flashNotify };
  function draw(frame) {
    bBody.setAttribute('d', frame.bodyPath);
    bo.setAttribute('opacity', frame.bodyAlpha);
    let s = '';
    for (let i = 0; i < frame.eyes.length; i++) {
      const e = frame.eyes[i];
      s += '<path d="' + e.d + '" transform="' + e.matrix + '" opacity="' + r2(e.alpha) + '" fill="#000"/>';
    }
    bmEyes.innerHTML = s;
    if (frame.notch) {
      bmNotch.setAttribute('cx', frame.notch.x);
      bmNotch.setAttribute('cy', frame.notch.y);
      bmNotch.setAttribute('r', frame.notch.r);
      bmNotch.style.display = '';
    } else bmNotch.style.display = 'none';
    if (frame.notif) {
      bNotif.setAttribute('cx', frame.notif.x);
      bNotif.setAttribute('cy', frame.notif.y);
      bNotif.setAttribute('r', frame.notif.r);
      bNotif.style.display = '';
    } else bNotif.style.display = 'none';
  }

  // Pointer follow, mouse only — a finger has no lingering cursor, so on touch
  // the bot just drifts. The target is measured against the window, not the
  // avatar, so the gaze saturates at the screen edge whatever her size.
  const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  let pointer = null, aiming = false, turnSince = 0;
  const TURN = 26, YAW_MAX = 16, PITCH_MAX = 13, PITCH = 10, SPIN = 360, TURN_TIME = 1.1;
  const lookTarget = (nx, ny, tour, hasPointer) => ({
    yaw: -TURN + nx * YAW_MAX,
    pitch: PITCH - ny * PITCH_MAX,
    mix: tour,
    spin: SPIN * (1 - tour),
    wander: hasPointer ? 0 : 1
  });
  function aim() {
    if (engine.cur !== 'idle') { release(); return; }
    const box = svg.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    if (!aiming) turnSince = clock;
    const hw = Math.max(1, window.innerWidth / 2);
    const hh = Math.max(1, window.innerHeight / 2);
    const nx = pointer ? clamp((pointer.x - (box.left + box.width / 2)) / hw, -1, 1) : 0;
    const ny = pointer ? clamp((pointer.y - (box.top + box.height / 2)) / hh, -1, 1) : 0;
    const tour = easeOutQuint(clamp((clock - turnSince) / TURN_TIME));
    engine.setLook(lookTarget(nx, ny, tour, pointer !== null), clock);
    aiming = true;
  }
  function release() {
    if (!aiming) return;
    engine.setLook(null, clock, TURN_TIME);
    aiming = false;
  }
  if (finePointer) {
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; pointer = { x: e.clientX, y: e.clientY }; });
    document.addEventListener('pointerleave', () => { pointer = null; });
  }

  function tick(ms) {
    const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0;
    last = ms;
    clock += dt;
    if (clock >= nextAt) {
      block = (block + 1) % CYCLE.length;
      apply(block);
    }
    if (finePointer) aim();
    draw(engine.sample(clock));
    requestAnimationFrame(tick);
  }
  apply(0);
  requestAnimationFrame(tick);
})();
`;

export function loginPage(): string {
  return `<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name=theme-color content="#171029">
<link rel=manifest href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/portrait">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Haru">
<title>Haru</title><style>${SHELL}
  main { max-width: 25rem; margin: 0 auto; padding: 14vh 1.4rem 2rem; }
  h1 { font-size: 1.75rem; margin: 0 0 .25rem; text-align: center; letter-spacing: -.02em; }
  p.sub { color: var(--ink-dim); margin: 0 0 2rem; font-size: .95rem; text-align: center; }
  label { display: block; margin: 0 0 .85rem; }
  label span { display: block; font-size: .82rem; color: var(--ink-dim); margin: 0 0 .35rem .2rem; }
  .row { display: flex; align-items: center; gap: .6rem; margin: 1.1rem 0 1.4rem .2rem; color: var(--ink-dim); font-size: .9rem; }
  .row input { width: auto; accent-color: var(--accent); }
  #go { width: 100%; padding: .85rem; }
</style>
<main>
  <h1>Haru</h1>
  <p class=sub>She is at home. Sign in to reach her.</p>
  <form id=f>
    <label><span>Name</span><input name=username autocomplete=username autocapitalize=none required></label>
    <label><span>Password</span><input name=password type=password autocomplete=current-password required></label>
    <div class=row><input type=checkbox id=r name=remember checked><label for=r style="margin:0">Remember this device</label></div>
    <button id=go>Sign in</button>
    <p class=err id=e></p>
  </form>
</main>
<script>
const f=document.getElementById('f'),e=document.getElementById('e'),go=document.getElementById('go');
f.addEventListener('submit',async ev=>{
  ev.preventDefault(); e.textContent=''; go.disabled=true; go.textContent='…';
  const d=new FormData(f);
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({username:d.get('username'),password:d.get('password'),remember:d.get('remember')==='on',device:navigator.userAgent.slice(0,60)})});
    if(r.ok){location.reload();return;}
    e.textContent=(await r.json().catch(()=>({}))).error||'That did not work.';
  }catch{ e.textContent='Could not reach her.'; }
  go.disabled=false; go.textContent='Sign in';
});
</script>`;
}

export function appPage(): string {
  return `<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name=theme-color content="#171029">
<link rel=manifest href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/portrait">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Haru">
<title>Haru</title><style>${SHELL}
  body { display:flex; flex-direction:column; height:100dvh; overflow:hidden; }

  .topbar { display:flex; align-items:center; gap:.6rem; padding:.7rem 1rem; flex:0 0 auto; }
  .topbar .name { font-weight:700; letter-spacing:-.01em; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  #out { margin-left:auto; background:var(--glass); color:var(--ink-dim); border:1px solid var(--edge); padding:.4rem .9rem; font-size:.82rem; font-weight:500; backdrop-filter:blur(12px); }

  #chat { flex:1; overflow-y:auto; padding:1rem .9rem 1.2rem; -webkit-overflow-scrolling:touch; }

  .msg { max-width:82%; padding:.7rem 1rem; border-radius:var(--r-lg); margin:0 0 .55rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .msg b { font-weight:700; }
  .msg code { font-family:ui-monospace,monospace; font-size:.88em; background:rgba(255,255,255,.08); border-radius:.3rem; padding:.05rem .3rem; }
  .them { background:var(--glass); border:1px solid var(--edge); border-bottom-left-radius:7px; backdrop-filter:blur(12px); }
  .me { background:var(--mine); border:1px solid var(--edge); margin-left:auto; border-bottom-right-radius:7px; }
  .sys { color:var(--ink-dim); font-size:.84rem; text-align:center; max-width:100%; background:none; border:0; }

  form.compose { display:flex; gap:.5rem; padding:.6rem .9rem calc(.6rem + env(safe-area-inset-bottom)); align-items:flex-end; }
  form.compose textarea { resize:none; max-height:7rem; border-radius:var(--r-lg); }
  form.compose button { padding:.8rem 1.15rem; }
  form.compose .icon { background:var(--glass); border:1px solid var(--edge); padding:.7rem .85rem; font-size:1.05rem; line-height:1; backdrop-filter:blur(12px); }
  /* Held down, it should look held down. Recording with no sign of recording is
     how you end up sending thirty seconds of a room. */
  form.compose .icon.hot { background:var(--accent); border-color:var(--accent); animation:pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow:0 0 0 .55rem oklch(78% 0.13 var(--hue) / 0.18); } }

  .quiet { color:var(--ink-dim); text-align:center; padding:2rem 0; }

  /* Her, on stage: a bloub (Grok-style blob) that breathes, blinks and drifts.
     Pure SVG — no Live2D runtime on the phone, nothing fetched from anywhere. */
  #stage { flex:0 0 auto; display:flex; justify-content:center; align-items:center; padding:.35rem 1rem 0; }
  #bloub { width:min(31vw, 136px); height:min(31vw, 136px); display:block;
    filter:drop-shadow(0 12px 26px rgba(0,0,0,.45)); }

  /* A wide window is not a big phone. Stretched across a desktop browser the
     bubbles ran the full 1700px and the text became unreadable at about six
     words a line, so the column is capped at a comfortable measure and centred. */
  @media (min-width: 900px) {
    body { max-width:44rem; margin:0 auto; }
    #out { position:fixed; top:1rem; right:1.5rem; z-index:3; }
    .msg { max-width:min(82%, 46rem); }
  }
</style>
<div class=topbar><span class=dot></span><span class=name>Haru</span><button id=out>Sign out</button></div>
<section id=stage></section>
<section id=chat></section>
<form class=compose id=cf><button type=button id=mic class=icon title="Hold to talk">🎙</button><textarea id=ci rows=1 placeholder="Say something…"></textarea><button id=cb>Send</button></form>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The same handful of marks she writes on the desktop, applied to text that has
// already been escaped — so the only tags that can ever reach the page are the
// three put there here.
const md=s=>s.replace(/\\*\\*\\s*([^*]+?)\\s*\\*\\*/g,'<b>$1</b>').replace(/\`([^\`\\n]+?)\`/g,'<code>$1</code>').replace(/\\*([^*\\s][^*\\n]*?)\\*/g,'<i>$1</i>');
const get=u=>fetch(u).then(r=>r.ok?r.json():Promise.reject(r));
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.ok?r.json():Promise.reject(r));

$('out').onclick=()=>post('/api/logout').then(()=>location.reload());

function bubbles(list){
  $('chat').innerHTML = list.map(m=>{
    const cls = m.role==='user'?'me':m.role==='assistant'?'them':'sys';
    return '<div class="msg '+cls+'">'+md(esc(m.content))+'</div>';
  }).join('') || '<p class=quiet>Nothing yet today.</p>';
  $('chat').scrollTop = $('chat').scrollHeight;
}

async function load(){
  try{
    bubbles((await get('/api/chat')).messages);
  }catch(r){ if(r&&r.status===401) location.reload(); }
}

const ci=$('ci');

// ---- Her voice ------------------------------------------------------------
//
// Asked for after the words are already on screen, never before: a reply that
// waits for its own recording arrives late and reads as her being slow, when she
// was not. If she has no voice set up the request 503s and nothing happens,
// which is the correct amount of fuss.
//
// One Audio element, reused for every line, rather than a fresh one per reply.
// iOS Safari only allows programmatic play() on an element that has already
// played inside a user gesture — and the gesture here is the send tap, which is
// long gone by the time an 8-17s reply comes back. A fresh Audio element made at
// that point is unprivileged and play() is silently rejected: nothing plays,
// nothing throws, and it looks exactly like a broken voice. Priming this element
// inside the tap (see the submit handler below) carries that privilege forward
// to the later play() on the same element, which Safari does allow.
const player=new Audio();
function primeVoice(){ player.play().catch(()=>{}); player.pause(); }
async function speak(text){
  try{
    player.pause();
    const r=await fetch('/api/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
    if(!r.ok) return;
    const url=URL.createObjectURL(await r.blob());
    const previous=player.src;
    player.src=url;
    player.onended=player.onerror=()=>{ URL.revokeObjectURL(url); if(previous) URL.revokeObjectURL(previous); };
    await player.play();
  }catch(e){ console.warn('[voice] '+(e&&e.message||e)); }
}

// ---- Her ears -------------------------------------------------------------
//
// Held rather than toggled. A toggle leaves a microphone open in a pocket, and
// on a phone that is the difference between a feature and a liability.
const mic=$('mic');
let recorder=null,chunks=[];
async function startHearing(){
  if(recorder) return;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    recorder=new MediaRecorder(stream);
    chunks=[];
    recorder.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
      recorder=null; mic.classList.remove('hot');
      if(blob.size<1200) return;
      mic.disabled=true;
      try{
        const r=await fetch('/api/listen',{method:'POST',headers:{'content-type':blob.type.split(';')[0]},body:blob});
        const {text}=await r.json();
        // Put into the box rather than sent: a transcript is a guess, and one
        // you cannot see before it is sent is one you cannot correct.
        if(text){ ci.value=(ci.value?ci.value+' ':'')+text; ci.focus(); ci.dispatchEvent(new Event('input')); }
      }catch(e){ console.warn('[ears] '+(e&&e.message||e)); }
      mic.disabled=false;
    };
    recorder.start();
    mic.classList.add('hot');
  }catch(e){
    console.warn('[ears] '+(e&&e.message||e));
    mic.title='No microphone: '+(e&&e.message||e);
  }
}
function stopHearing(){ if(recorder&&recorder.state!=='inactive') recorder.stop(); }
mic.addEventListener('pointerdown',e=>{e.preventDefault();startHearing();});
for(const done of ['pointerup','pointerleave','pointercancel']) mic.addEventListener(done,stopHearing);

ci.addEventListener('input',()=>{ci.style.height='auto';ci.style.height=Math.min(ci.scrollHeight,112)+'px';});
// Counts sends, only so each waiting bubble can be told from the last one.
let waiting=0;
$('cf').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const text=ci.value.trim(); if(!text)return;
  primeVoice();
  ci.value=''; ci.style.height='auto'; $('cb').disabled=true;
  // The waiting bubble used to be id="wait", a fixed string, and was taken back
  // out with a bare document.getElementById('wait').remove().
  //
  // Two things went wrong with that. bubbles() rebuilds the list with innerHTML,
  // so any tab switch or nudge arriving mid-send destroyed the element — and the
  // lookup then returned null and .remove() threw. Because the identical call
  // sat in the catch as well as the try, the throw escaped the handler
  // altogether, which meant the line re-enabling the send button never ran: her
  // reply was thrown away and the composer stayed dead until a reload. The fixed
  // id also collided whenever two sends overlapped, so one bubble was orphaned
  // on screen for good.
  //
  // So: an id of its own, removal that tolerates the node having gone, and the
  // button re-enabled from a finally where nothing can step over it.
  const id='wait'+(++waiting);
  $('chat').insertAdjacentHTML('beforeend','<div class="msg me">'+esc(text)+'</div><div class="msg them" id='+id+'>…</div>');
  $('chat').scrollTop=$('chat').scrollHeight;
  const stopWaiting=()=>{const bubble=document.getElementById(id); if(bubble) bubble.remove();};
  // The waiting bubble doubles as the reply bubble: words land in it as the
  // stream delivers them, and the final processed reply replaces them when the
  // stream ends. textContent rather than innerHTML — her words are text, not
  // markup, and the model is not a source we escape from, it is the source.
  const show=t=>{const bubble=document.getElementById(id); if(!bubble) return false; bubble.textContent=t; $('chat').scrollTop=$('chat').scrollHeight; return true;};
  try{
    const r=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
    if(!r.ok) throw r;
    const reader=r.body.getReader(); const dec=new TextDecoder();
    let buf='',said='',reply=null,ignored=false,error=null;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      let at;
      while((at=buf.indexOf('\\n'))>=0){
        const line=buf.slice(0,at).trim(); buf=buf.slice(at+1);
        if(!line.startsWith('data:'))continue;
        let ev; try{ev=JSON.parse(line.slice(5));}catch{continue;}
        if(ev.error) error=ev.error;
        else if(ev.text==='\uFFFD'){ said=''; show('…'); }
        else if(ev.text){ said+=ev.text; show(said); }
        else if(ev.done){ reply=ev.reply; ignored=Boolean(ev.ignored); }
      }
    }
    if(error) throw new Error(error);
    if(ignored){
      // Whatever she was about to say does not exist: the bubble goes, the note
      // takes its place, and nothing is spoken.
      stopWaiting();
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">She is not answering that.</div>');
    } else {
      // The processed reply is the one that counts — the stream can carry words
      // she later trims as repetition — so it replaces what was shown.
      if(reply!==null) show(reply);
      if(reply){
        // Started here and not waited on: the words are already on screen, and
        // her voice can catch up in its own time.
        if(window.bloub) window.bloub.notify();
        void speak(reply);
      }
    }
  }catch(r){
    stopWaiting();
    if(r&&r.status===401){location.reload();return;}
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">That did not get through.</div>');
  }finally{
    $('cb').disabled=false; $('chat').scrollTop=$('chat').scrollHeight;
  }
});
load();

// ---- Her, speaking first ---------------------------------------------------
//
// The point of carrying her about is that she mentions the thing you have not
// done, rather than waiting to be asked. There are no notifications here, so the
// moment to do it is while the page is open — which is also the only moment she
// has anyone's attention.
//
// Asked on opening, again when the page comes back to the front, and slowly
// while it sits there. The deciding is all on her side: most of these return
// nothing, because most of the time there is nothing worth saying.
async function askIfSheHasSomethingToSay(){
  if(document.hidden) return;
  try{
    const {line}=await get('/api/nudge');
    if(!line) return;
    $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(line)+'</div>');
    $('chat').scrollTop=$('chat').scrollHeight;
    if(window.bloub) window.bloub.notify();
    void speak(line);
  }catch(r){ if(r&&r.status===401) location.reload(); }
}
setTimeout(askIfSheHasSomethingToSay,1500);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) askIfSheHasSomethingToSay(); });
// Four minutes: she is being carried around, not watched. Anything faster reads
// as pestering, and the spacing on her side would refuse it anyway.
setInterval(askIfSheHasSomethingToSay,4*60_000);
${BLOUB}
</script>`;
}
