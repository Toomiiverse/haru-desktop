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
// JS for this no-build page. One pink shape morphing through the full measured
// catalogue — idle, thinking, wink, wide, alert, notify, exclaim, sleep, egg,
// hexagon, play, orbit, burst, comet — with the eyes as holes punched in the
// body and the mood engine's twelve emotions mapped onto states and resting
// faces. No library, no clock state outside the block — sample(t) is a pure
// function of time, and every constant below is a measurement off the reference
// video, not a choice. The block builds and runs itself on #stage.
const BLOUB = `
(() => {
  const TAU = Math.PI * 2;
  const clamp = (v, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const r2 = (v) => Math.round(v * 100) / 100;
  const easings = {
    easeOutCubic: (t) => 1 - (1 - t) ** 3,
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
    easeOutQuint: (t) => 1 - (1 - t) ** 5
  };
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

  // Radial profiles, sampled at the same 64 angles everywhere so any two shapes
  // morph by interpolating radii.
  const N = 64;
  const COS = Array.from({ length: N }, (_, i) => Math.cos((i / N) * TAU));
  const SIN = Array.from({ length: N }, (_, i) => Math.sin((i / N) * TAU));
  const PROFILES = {
    egg: [0.8369,0.8424,0.8497,0.8585,0.8674,0.8775,0.8878,0.8983,0.9089,0.9185,0.9288,0.9374,0.9445,0.9504,0.9543,0.9559,0.9555,0.9519,0.9466,0.9389,0.9302,0.9193,0.9085,0.8969,0.8852,0.8734,0.8625,0.8513,0.8411,0.8325,0.8243,0.8179,0.8137,0.8112,0.8102,0.8128,0.8178,0.8262,0.8374,0.8518,0.8702,0.8922,0.9169,0.9446,0.9741,1.0023,1.0267,1.0433,1.0481,1.0393,1.0216,0.9970,0.9697,0.9418,0.9169,0.8949,0.8760,0.8604,0.8490,0.8394,0.8337,0.8314,0.8305,0.8326],
    hexagon: [0.9210,0.9282,0.9441,0.9706,0.9984,1.0059,0.9896,0.9562,0.9290,0.9124,0.9047,0.9058,0.9157,0.9349,0.9642,0.9873,0.9882,0.9665,0.9336,0.9105,0.8968,0.8918,0.8955,0.9080,0.9293,0.9611,0.9820,0.9812,0.9590,0.9282,0.9089,0.8978,0.8964,0.9026,0.9189,0.9439,0.9778,0.9990,0.9964,0.9713,0.9439,0.9274,0.9196,0.9206,0.9308,0.9502,0.9799,1.0121,1.0226,1.0071,0.9752,0.9510,0.9366,0.9316,0.9351,0.9485,0.9711,1.0026,1.0213,1.0155,0.9863,0.9547,0.9347,0.9232],
    triangle: [0.7819,0.8211,0.8747,0.9440,1.0223,1.0960,1.1401,1.1340,1.0808,1.0047,0.9265,0.8603,0.8104,0.7730,0.7450,0.7273,0.7151,0.7118,0.7148,0.7245,0.7427,0.7680,0.8037,0.8518,0.9148,0.9876,1.0583,1.1073,1.1109,1.0667,0.9940,0.9164,0.8482,0.7948,0.7555,0.7261,0.7056,0.6925,0.6859,0.6869,0.6938,0.7084,0.7305,0.7615,0.8040,0.8595,0.9311,1.0092,1.0791,1.1171,1.1054,1.0501,0.9779,0.9050,0.8450,0.7990,0.7656,0.7413,0.7258,0.7160,0.7146,0.7204,0.7330,0.7528]
  };
  function silhouette(name, pose) {
    return Object.assign({ radii: PROFILES[name].slice(), rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 }, pose || {});
  }
  function circle(radius, pose) {
    const radii = new Array(N); radii.fill(radius);
    return Object.assign({ radii: radii, rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 }, pose || {});
  }
  function blend(a, b, t) {
    const dst = { radii: new Array(N), rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 };
    for (let i = 0; i < N; i++) dst.radii[i] = lerp(a.radii[i] || 1, b.radii[i] || 1, t);
    let dRot = b.rot - a.rot;
    while (dRot > Math.PI) dRot -= TAU;
    while (dRot < -Math.PI) dRot += TAU;
    dst.rot = a.rot + dRot * t;
    dst.cx = lerp(a.cx, b.cx, t); dst.cy = lerp(a.cy, b.cy, t);
    dst.sx = lerp(a.sx, b.sx, t); dst.sy = lerp(a.sy, b.sy, t);
    return dst;
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
  function profileFromPolygon(poly, cx, cy) {
    const radii = new Array(N).fill(0);
    const n = poly.length;
    for (let k = 0; k < N; k++) {
      const dx = COS[k], dy = SIN[k];
      let best = 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const ex = b.x - a.x, ey = b.y - a.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const px = a.x - cx, py = a.y - cy;
        const t = (px * ey - py * ex) / den;
        const u = (px * dy - py * dx) / den;
        if (t > best && u >= 0 && u <= 1) best = t;
      }
      radii[k] = best;
    }
    return radii;
  }
  function hullOfCircles(x1, y1, r1, x2, y2, r2v, steps) {
    steps = steps === undefined ? 96 : steps;
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const base = Math.atan2(dy, dx);
    const spread = Math.acos(Math.max(-1, Math.min(1, (r1 - r2v) / dist)));
    const pts = [];
    for (let i = 0; i <= steps / 2; i++) {
      const a = base + spread + ((TAU - 2 * spread) * i) / (steps / 2);
      pts.push({ x: x1 + Math.cos(a) * r1, y: y1 + Math.sin(a) * r1 });
    }
    for (let i = 0; i <= steps / 2; i++) {
      const a = base - spread + ((2 * spread) * i) / (steps / 2);
      pts.push({ x: x2 + Math.cos(a) * r2v, y: y2 + Math.sin(a) * r2v });
    }
    return pts;
  }
  function polyPath(pts, scale) {
    scale = scale === undefined ? 1 : scale;
    if (pts.length < 3) return '';
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      d += (i === 0 ? 'M' : 'L') + r2(p.x * scale) + ' ' + r2(p.y * scale);
    }
    return d + 'Z';
  }

  // Decoration: arcs with hue-wheel gradients, particles, the notification pastille.
  function wheel(hue, s, l) {
    s = s === undefined ? 0.55 : s; l = l === undefined ? 0.62 : l;
    const h = ((hue % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return '#' + hex(rgb[0]) + hex(rgb[1]) + hex(rgb[2]);
  }
  function arcRender(seed, t, scale, id, opacity) {
    opacity = opacity === undefined ? 1 : opacity;
    const spin = seed.phase + t * seed.speed * TAU;
    const cu = Math.cos(seed.tilt), su = Math.sin(seed.tilt);
    const kz = Math.sqrt(Math.max(0, 1 - seed.k * seed.k));
    const span = seed.sweep * TAU;
    let front = '', back = '', prev = null;
    for (let i = 0; i <= 64; i++) {
      const th = spin + (i / 64) * span;
      const ct = Math.cos(th), st = Math.sin(th);
      const x = seed.a * (ct * cu + st * -su * seed.k) + seed.cx;
      const y = seed.a * (ct * su + st * cu * seed.k) + seed.cy;
      const z = seed.a * st * kz;
      const behind = z < 0;
      const sx = r2(x * scale), sy = r2(y * scale);
      const cmd = behind !== prev ? 'M' : 'L';
      if (behind) back += cmd + sx + ' ' + sy;
      else front += cmd + sx + ' ' + sy;
      prev = behind;
    }
    const gx = Math.cos(seed.tilt) * seed.a * scale;
    const gy = Math.sin(seed.tilt) * seed.a * scale;
    return {
      id: id,
      front: front,
      back: back,
      width: seed.width * scale,
      opacity: opacity,
      grad: {
        x1: r2(seed.cx * scale - gx), y1: r2(seed.cy * scale - gy),
        x2: r2(seed.cx * scale + gx), y2: r2(seed.cy * scale + gy),
        stops: [wheel(seed.hue), wheel(seed.hue + seed.hueSpan * 0.5), wheel(seed.hue + seed.hueSpan)]
      }
    };
  }
  const RING_RNG = createRng(0xa11ce);
  const RINGS = Array.from({ length: 6 }, (_, i) => ({
    a: 1.3 + RING_RNG() * 0.1,
    k: 0.05 + RING_RNG() * 0.4,
    tilt: (i / 6) * Math.PI + RING_RNG() * 0.5,
    speed: 3 + RING_RNG() * 0.7,
    phase: RING_RNG() * TAU,
    sweep: 0.6 + RING_RNG() * 0.25,
    hue: (i * 360) / 6 + RING_RNG() * 30,
    hueSpan: 60 + RING_RNG() * 60,
    width: 0.05 + RING_RNG() * 0.012,
    cx: 0,
    cy: 0.1
  }));
  const SWOOSH = Array.from({ length: 4 }, (_, i) => ({
    a: 0.78 + i * 0.2,
    k: 0.05 + i * 0.02,
    tilt: -0.62 + i * 0.05,
    speed: 0.3,
    phase: 0.06 * i,
    sweep: 0.4,
    hue: 95 + i * 62,
    hueSpan: 100,
    width: 0.05,
    cx: 0,
    cy: -0.12
  }));
  const DOT_X = [-0.557, -0.013, 0.532], DOT_R = 0.165, DOT_PEAK = 1.25;
  const P_RNG = createRng(0xbeef);
  const PARTICLES = Array.from({ length: 5 }, (_, i) => ({
    birth: i * 0.2,
    angle: P_RNG() * TAU,
    rho: 0.58 + P_RNG() * 0.18
  }));
  function particles(t, scale) {
    const out = [];
    for (const p of PARTICLES) {
      const u = t - p.birth;
      if (u < 0 || u > 0.62) continue;
      const rho = p.rho * Math.pow(0.75, u * 10);
      const a = p.angle + (u * 100 * Math.PI) / 180;
      out.push({
        x: Math.cos(a) * rho * scale,
        y: Math.sin(a) * rho * scale,
        r: (0.04 + 0.028 * clamp(u / 0.55)) * scale,
        depth: clamp(1 - rho / 0.8),
        opacity: clamp(u / 0.06) * clamp((0.62 - u) / 0.08)
      });
    }
    return out;
  }
  const COMET_RNG = createRng(0xc0e7);
  const COMET_RIBBONS = Array.from({ length: 4 }, (_, i) => {
    const d = i - 1.5;
    return {
      a: 0.85 * (1 + d * 0.03),
      k: (0.15 / 0.85) * (1 + d * 0.16),
      tilt: (34 * Math.PI) / 180 + d * 0.035,
      speed: 210 / 360,
      phase: -i * 0.045 + COMET_RNG() * 0.012,
      sweep: 0.34,
      hue: i * 85 + COMET_RNG() * 20,
      hueSpan: 80,
      width: 0.095,
      cx: 0,
      cy: 0
    };
  });
  const COMET_DOT = 0.129;
  const NOTIF_BLUE = '#2496e8', NOTIF_ANGLE = -42, NOTIF_DIST = 1.003, NOTIF_R = 0.15, NOTIF_POP = 1.14, NOTIF_MARGIN = 0.054;

  function mixHex(from, to, t) {
    const parse = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
    const a = parse(from), b = parse(to);
    const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
    return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Expressions: the resting face (only applied on baseFace states, i.e. idle).
  const eye = (w, h, tilt, open) => ({ w: w, h: h, tilt: tilt === undefined ? 0 : tilt, open: open === undefined ? 1 : open });
  const pair = (w, h, tilt, open) => [eye(w, h, tilt, open), eye(w, h, -tilt, open)];
  const EXPRESSIONS = [
    { id: 'neutre', gaze: { yaw: REST_GAZE.yaw, pitch: REST_GAZE.pitch, roll: REST_GAZE.roll }, split: EYE_SPLIT, eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)] },
    { id: 'attentif', gaze: { yaw: 4, pitch: 5, roll: -4 }, split: 16, eyes: pair(0.21, 0.44) },
    { id: 'surpris', gaze: { yaw: 3, pitch: -3, roll: 0 }, split: 19, eyes: pair(0.45, 0.47) },
    { id: 'excite', gaze: { yaw: 6, pitch: -14, roll: 0 }, split: 19.5, eyes: pair(0.4, 0.56, -10) },
    { id: 'heureux', gaze: { yaw: 5, pitch: 9, roll: 0 }, split: 17, eyes: pair(0.27, 0.17, 14) },
    { id: 'hilare', gaze: { yaw: 4, pitch: 14, roll: 0 }, split: 18, eyes: pair(0.34, 0.13, 20) },
    { id: 'colere', gaze: { yaw: 3, pitch: 7, roll: 0 }, split: 17, eyes: pair(0.34, 0.15, 30) },
    { id: 'triste', gaze: { yaw: 3, pitch: -13, roll: 0 }, split: 16, eyes: pair(0.22, 0.4, -28) },
    { id: 'effraye', gaze: { yaw: 2, pitch: -20, roll: 0 }, split: 20.5, eyes: pair(0.4, 0.6) },
    { id: 'mefiant', gaze: { yaw: 12, pitch: 6, roll: -6 }, split: 16, eyes: [eye(0.21, 0.4), eye(0.22, 0.15)] },
    { id: 'confus', gaze: { yaw: -14, pitch: 3, roll: 8 }, split: 16.5, eyes: [eye(0.2, 0.44, -18), eye(0.28, 0.17, 14)] },
    { id: 'curieux', gaze: { yaw: 16, pitch: -9, roll: -15 }, split: 16.5, eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)] },
    { id: 'fier', gaze: { yaw: 5, pitch: 17, roll: 0 }, split: 17, eyes: pair(0.3, 0.15, 18) },
    { id: 'timide', gaze: { yaw: -19, pitch: -14, roll: -7 }, split: 14, eyes: pair(0.17, 0.3) },
    { id: 'blase', gaze: { yaw: -22, pitch: 2, roll: 0 }, split: 16, eyes: pair(0.3, 0.12) },
    { id: 'somnolent', gaze: { yaw: 6, pitch: -9, roll: -3 }, split: 16, eyes: pair(0.2, 0.42, 0, 0.42) }
  ];
  const EXPRESSION_BY_ID = new Map(EXPRESSIONS.map((e) => [e.id, e]));
  function blendExpression(a, b, t) {
    const lEye = (x, y) => ({ w: lerp(x.w, y.w, t), h: lerp(x.h, y.h, t), tilt: lerp(x.tilt || 0, y.tilt || 0, t), open: lerp(x.open, y.open, t) });
    return {
      id: b.id,
      gaze: { yaw: lerp(a.gaze.yaw, b.gaze.yaw, t), pitch: lerp(a.gaze.pitch, b.gaze.pitch, t), roll: lerp(a.gaze.roll, b.gaze.roll, t) },
      split: lerp(a.split, b.split, t),
      eyes: [lEye(a.eyes[0], b.eyes[0]), lEye(a.eyes[1], b.eyes[1])]
    };
  }

  // The shapes idle may drift into. The morph is a pure function of time: each
// 9s beat picks a pseudo-random target (sometimes the same one, so change is a
// chance, not a rule), and the profile eases into it over the first part of the
// beat while the whole thing keeps rotating.
  const IDLE_SHAPES = [new Array(N).fill(1), PROFILES.egg, PROFILES.hexagon, PROFILES.triangle];

  // The states: each is a pose(t) plus the shape-change rules the video showed.
  function base(over) {
    return Object.assign({
      sil: circle(1), offX: 0, offY: 0,
      gaze: { yaw: REST_GAZE.yaw, pitch: REST_GAZE.pitch, roll: REST_GAZE.roll },
      split: EYE_SPLIT, eyes: pair(EYE_W, EYE_H), eyeAlpha: 1, bodyAlpha: 1,
      dots: [], arcs: [], notif: null, dotsBehind: false
    }, over || {});
  }
  const BAR_UPRIGHT_CY = -0.1875;
  const BAR_UPRIGHT = profileFromPolygon(hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075), 0, BAR_UPRIGHT_CY);
  const BAR_ITALIC = profileFromPolygon(hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0);
  const barUpright = (pose) => Object.assign({ radii: BAR_UPRIGHT.slice(), rot: 0, cx: 0, cy: BAR_UPRIGHT_CY, sx: 1, sy: 1 }, pose || {});
  const barItalic = (pose) => Object.assign({ radii: BAR_ITALIC.slice(), rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 }, pose || {});
  const TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012));
  const TRI_ORBIT = 0.213;
  function spinningTriangle(rot) {
    return silhouette('triangle', { rot: rot, cx: -TRI_ORBIT * Math.sin(rot), cy: TRI_ORBIT * Math.cos(rot) });
  }
  function dotPulse(t, index) {
    const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1;
    const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0;
    return clamp(k * 2);
  }
  const STATES = {
    idle: { id: 'idle', morph: 0.45, blinkIn: false, baseFace: true, baseBody: true, duration: 9, minDuration: undefined, pose: (t, now) => {
      // A living idle: she slowly rotates through a faint shape that itself
      // morphs into a different silhouette on a random-looking beat, on top of
      // the usual breathing and blinking. Everything is a pure function of the
      // absolute clock, so the motion never snaps when a rest block begins.
      const time = now === undefined ? t : now;
      const spin = (time * TAU) / 12;
      const PERIOD = 9;
      const MORPH_FRAC = 0.42;
      const epoch = Math.floor(time / PERIOD);
      const phase = (time - epoch * PERIOD) / PERIOD;
      const hashN = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
      const target = Math.floor(hashN(epoch) * IDLE_SHAPES.length);
      const prev = Math.floor(hashN(epoch - 1) * IDLE_SHAPES.length);
      const k = easings.easeInOutCubic(clamp(phase / MORPH_FRAC));
      const from = IDLE_SHAPES[prev], to = IDLE_SHAPES[target];
      const baseArr = new Array(N);
      for (let i = 0; i < N; i++) baseArr[i] = lerp(from[i], to[i], k);
      const radii = new Array(N);
      for (let i = 0; i < N; i++) radii[i] = radiusAtAngle(baseArr, (i / N) * TAU - spin);
      return base({ sil: { radii: radii, rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 } });
    } },
    thinking: { id: 'thinking', morph: 0.4, blinkIn: true, baseFace: false, baseBody: false, duration: 2.6, minDuration: undefined, pose: (t) => {
      const mid = dotPulse(t, 1);
      const emerge = 0.3 + 0.7 * easings.easeOutCubic(clamp(t / 0.3));
      return base({
        sil: circle(DOT_R * (1 + (DOT_PEAK - 1) * mid), { cx: DOT_X[1] }),
        eyeAlpha: 0,
        dots: [0, 2].map((i) => {
          const k = dotPulse(t, i);
          return { x: DOT_X[i] * emerge, y: 0, r: DOT_R * (1 + (DOT_PEAK - 1) * k), opacity: 0.55 + 0.45 * k };
        })
      });
    } },
    wink: { id: 'wink', morph: 0.3, blinkIn: true, baseFace: false, baseBody: true, duration: 1.6, minDuration: undefined, pose: () => base({ gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 }, split: 16.25, eyes: [{ w: 0.236, h: 0.464, open: 1 }, { w: 0.447, h: 0.089, open: 1 }] }) },
    wide: { id: 'wide', morph: 0.55, blinkIn: true, baseFace: false, baseBody: true, duration: 1.8, minDuration: undefined, pose: () => base({ gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 }, split: 18.43, eyes: pair(0.356, 0.875) }) },
    alert: { id: 'alert', morph: 0.45, blinkIn: false, baseFace: false, baseBody: false, duration: 2.4, minDuration: 2, pose: (t) => {
      const p = clamp(t / 1.5);
      const travel = easings.easeInOutCubic(p) * 0.82 - 0.087;
      const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0;
      const x = travel * (1 - back) + 0.1 * back;
      const buzz = Math.sin(t * 2.5 * TAU) * 0.005;
      const tilt = (17.7 * Math.PI) / 180;
      return base({
        sil: barItalic({ rot: tilt, cx: x, cy: -0.325 - buzz }),
        eyeAlpha: 0,
        dots: [{ x: x - Math.sin(tilt) * 0.58, y: -0.325 + Math.cos(tilt) * 0.58 + buzz * 2.8, r: 0.118, d: TEAR, rot: (tilt * 180) / Math.PI, opacity: 1 }]
      });
    } },
    notify: { id: 'notify', morph: 0.5, blinkIn: true, baseFace: false, baseBody: true, duration: 2.2, minDuration: undefined, pose: (t) => {
      const p = clamp(t / 0.45);
      const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35);
      const r = NOTIF_R * (p < 1 ? pop : 1);
      const a = (NOTIF_ANGLE * Math.PI) / 180;
      return base({ gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 }, split: 18.89, eyes: pair(0.505, 0.498), notif: { x: Math.cos(a) * NOTIF_DIST, y: Math.sin(a) * NOTIF_DIST, r: r, notch: r + NOTIF_MARGIN } });
    } },
    exclaim: { id: 'exclaim', morph: 0.45, blinkIn: false, baseFace: false, baseBody: false, duration: 2, minDuration: undefined, pose: () => base({ sil: barUpright(), eyeAlpha: 0, dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }] }) },
    sleep: { id: 'sleep', morph: 0.5, blinkIn: false, baseFace: false, baseBody: false, duration: 2.4, minDuration: undefined, pose: (t) => base({ sil: circle(0.1585, { cy: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19 }), eyeAlpha: 0 }) },
    egg: { id: 'egg', morph: 0.4, blinkIn: true, baseFace: false, baseBody: false, duration: 1.8, minDuration: undefined, pose: () => base({ sil: silhouette('egg'), gaze: { yaw: 19.97, pitch: 26.01, roll: -17.1 }, split: 11.07, eyes: pair(0.164, 0.385) }) },
    hexagon: { id: 'hexagon', morph: 0.4, blinkIn: true, baseFace: false, baseBody: false, duration: 1.6, minDuration: undefined, pose: () => base({ sil: silhouette('hexagon'), gaze: { yaw: 23.11, pitch: 24.42, roll: -13.3 }, split: 13.37, eyes: pair(0.177, 0.411) }) },
    play: { id: 'play', morph: 0.5, blinkIn: true, baseFace: false, baseBody: false, duration: 2, minDuration: undefined, pose: (t) => {
      const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5);
      return base({
        sil: spinningTriangle(0),
        gaze: { yaw: 12, pitch: -8, roll: -6 }, split: 15, eyes: pair(0.18, 0.34),
        arcs: SWOOSH.map((s, i) => ({ id: 'sw' + i, seed: { ...s, cx: 0.45 - t * 0.42 }, t: t, opacity: fade }))
      });
    } },
    orbit: { id: 'orbit', morph: 0.6, blinkIn: false, baseFace: false, baseBody: false, duration: 3.4, minDuration: 2.5, pose: (t) => {
      const ramp = easings.easeInOutCubic(clamp(t / 0.35));
      const rot = -TAU * 1.25 * t * ramp;
      const back = easings.easeInOutCubic(clamp((t - 1.6) / 0.9));
      const tri = spinningTriangle(rot);
      const ball = circle(1, { rot: rot });
      const mixed = tri.radii.map((r, i) => r + (ball.radii[i] - r) * back);
      // Baked into the radii rather than carried as sil.rot, the way idle does
      // it, and for the same reason: this rotation winds past a full turn, and
      // blend() normalises a rotation delta to the shortest arc. Left as a rot,
      // the moment that delta crossed π the blend reversed direction and the
      // whole body jumped ~130 units in a single frame. Sampled here, there is
      // no angle left for the blend to wrap.
      const radii = new Array(N);
      for (let i = 0; i < N; i++) radii[i] = radiusAtAngle(mixed, (i / N) * TAU - rot);
      const sil = {
        radii: radii,
        rot: 0,
        cx: tri.cx * (1 - back),
        cy: tri.cy * (1 - back),
        sx: 1,
        sy: 1
      };
      const fade = clamp(t / 0.8) * clamp((3.6 - t) / 0.9);
      return base({
        sil: sil,
        gaze: { yaw: REST_GAZE.yaw + Math.sin(t * 6.5) * 65 * (1 - back), pitch: -4 + back * 32, roll: -13 },
        eyes: pair(0.18, 0.34 + back * 0.07),
        arcs: RINGS.map((s, i) => ({ id: 'rg' + i, seed: s, t: t, opacity: fade * clamp((t - i * 0.13) / 0.3) }))
      });
    } },
    burst: { id: 'burst', morph: 0.4, blinkIn: false, baseFace: false, baseBody: false, duration: 2.6, minDuration: 2.4, pose: (t) => {
      const collapse = 1 - 0.834 * easings.easeOutQuint(clamp(t / 0.7));
      const regrow = easings.easeOutQuint(clamp((t - 1.7) / 0.7));
      return base({
        sil: circle(collapse + (1 - collapse) * regrow),
        eyeAlpha: clamp((t - 1.85) / 0.4),
        dots: particles(t, 1),
        dotsBehind: true
      });
    } },
    comet: { id: 'comet', morph: 0.45, blinkIn: false, baseFace: false, baseBody: false, duration: 2.4, minDuration: 2.4, pose: (t) => {
      const collapse = 1 - (1 - COMET_DOT) * easings.easeOutQuint(clamp(t / 0.55));
      const regrow = easings.easeOutQuint(clamp((t - 1.85) / 0.6));
      const fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3);
      return base({
        sil: circle(collapse + (1 - collapse) * regrow, { cy: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035 }),
        eyeAlpha: clamp((t - 2) / 0.35),
        arcs: COMET_RIBBONS.map((s, i) => ({ id: 'cm' + i, seed: s, t: t, opacity: fade }))
      });
    } }
  };
  // Resting is random and quiet, never the dramatic states: she picks among
  // idle / wink / wide at random, holds each for a long, fluid beat, and only
  // the mood engine or a message pulls her into a reaction state.

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
    this.expr = null;
    this.exprPrev = null;
    this.exprAt = -10;
    this.look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };
    this.lookPrev = this.look;
    this.lookAt = -10;
    this.lookMorph = 0.24;
  }
  const NO_LOOK = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 };
  const SHAPE_MORPH = 0.45;
  // Transitions run this many times longer than the measured morph, so the
  // motion stays fluid instead of snapping between states.
  const MORPH_SLOW = 2.4;
  // Blending one pose into another is eased in as well as out. easeOutQuint
  // arrives gently but leaves at five times the average rate, which at 60fps
  // put 7.5% of the whole transition into its first frame — the snap on every
  // state change. The gaze below keeps the quint on purpose: eyes really do
  // flick and settle. A body does not.
  const morphEase = easings.easeInOutCubic;
  BotEngine.prototype.lookAtTime = function (now) {
    const k = (now - this.lookAt) / this.lookMorph;
    if (k >= 1) return this.look;
    const t = easings.easeOutQuint(clamp(k));
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
  BotEngine.prototype.setExpression = function (expr, now) {
    if (expr === this.expr) return;
    this.exprPrev = this.expr;
    this.expr = expr;
    this.exprAt = now === undefined ? 0 : now;
  };
  BotEngine.prototype.exprAtTime = function (now) {
    const to = this.expr, from = this.exprPrev;
    if (!to || !from) return to;
    const k = (now - this.exprAt) / SHAPE_MORPH;
    if (k >= 1) return to;
    return blendExpression(from, to, morphEase(clamp(k)));
  };
  BotEngine.prototype.posed = function (def, t, now) {
    let pose = def.pose(t, now);
    if (def.baseFace && this.expr) {
      pose = Object.assign({}, pose, { gaze: this.expr.gaze, split: this.expr.split, eyes: this.expr.eyes });
    }
    return pose;
  };
  BotEngine.prototype.origine = function (now) {
    if (this.departFige) return this.departFige;
    if (!this.prev) return null;
    return this.posed(STATES[this.prev], Math.max(0, now - this.tPrev), now);
  };
  const lerpEye = (a, b, t) => ({ w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), open: lerp(a.open, b.open, t), tilt: lerp(a.tilt || 0, b.tilt || 0, t) });
  BotEngine.prototype.blendPose = function (a, b, t) {
    const out = 1 - t;
    const sil = blend(a.sil, b.sil, t);
    return {
      sil: sil,
      offX: lerp(a.offX, b.offX, t), offY: lerp(a.offY, b.offY, t),
      gaze: { yaw: lerp(a.gaze.yaw, b.gaze.yaw, t), pitch: lerp(a.gaze.pitch, b.gaze.pitch, t), roll: lerp(a.gaze.roll, b.gaze.roll, t) },
      split: lerp(a.split, b.split, t),
      eyes: [lerpEye(a.eyes[0], b.eyes[0], t), lerpEye(a.eyes[1], b.eyes[1], t)],
      eyeAlpha: lerp(a.eyeAlpha, b.eyeAlpha, t),
      bodyAlpha: lerp(a.bodyAlpha, b.bodyAlpha, t),
      dots: [
        ...a.dots.map((d) => Object.assign({}, d, { opacity: d.opacity * out })),
        ...b.dots.map((d) => Object.assign({}, d, { opacity: d.opacity * t }))
      ],
      arcs: [
        ...a.arcs.map((r) => Object.assign({}, r, { id: 'a' + r.id, opacity: r.opacity * out })),
        ...b.arcs.map((r) => Object.assign({}, r, { id: 'b' + r.id, opacity: r.opacity * t }))
      ],
      notif: t < 0.5 ? a.notif : b.notif,
      dotsBehind: t < 0.5 ? a.dotsBehind : b.dotsBehind
    };
  };
  BotEngine.prototype.reset = function (id, now) {
    this.cur = id;
    this.prev = null;
    this.departFige = null;
    this.tCur = now;
    this.tPrev = now;
    this.blinkAt = -10;
  };
  BotEngine.prototype.setState = function (id, now) {
    if (id === this.cur) return;
    const morph = STATES[this.cur].morph;
    const enPleinFondu = this.prev !== null && now - this.tCur < morph * MORPH_SLOW;
    this.departFige = enPleinFondu ? this.poseComposee(now) : null;
    this.prev = this.cur;
    this.tPrev = this.tCur;
    this.cur = id;
    this.tCur = now;
    if (STATES[id].blinkIn) this.blinkAt = now;
  };
  BotEngine.prototype.poseComposee = function (now) {
    const def = STATES[this.cur];
    const pose = this.posed(def, Math.max(0, now - this.tCur), now);
    const since = now - this.tCur;
    if (since >= def.morph * MORPH_SLOW) return pose;
    const origine = this.origine(now);
    if (!origine) return pose;
    return this.blendPose(origine, pose, morphEase(clamp(since / (def.morph * MORPH_SLOW))));
  };
  BotEngine.prototype.sample = function (now) {
    const R = this.scale;
    const def = STATES[this.cur];
    let pose = this.posed(def, Math.max(0, now - this.tCur), now);
    const since = now - this.tCur;
    const origine = since < def.morph * MORPH_SLOW ? this.origine(now) : null;
    if (origine) pose = this.blendPose(origine, pose, morphEase(clamp(since / (def.morph * MORPH_SLOW))));

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

    const dots = pose.dots.filter((p) => p.opacity > 0.01 && p.r > 0.0005).map((p) => Object.assign({}, p, { x: (p.x + offX) * R, y: (p.y + offY) * R, r: p.r * R }));
    const arcs = pose.arcs.filter((a) => a.opacity > 0.01).map((a) => arcRender(a.seed, a.t, R, a.id, a.opacity));

    const nFit = pose.notif ? bodyRadius(pose.notif.x, pose.notif.y) : 1;
    const nx = pose.notif ? (pose.notif.x * nFit + offX) * R : 0;
    const ny = pose.notif ? (pose.notif.y * nFit + offY) * R : 0;
    return {
      bodyPath: bodyPath,
      bodyAlpha: pose.bodyAlpha,
      eyes: eyes,
      dots: dots,
      dotsBehind: pose.dotsBehind,
      arcs: arcs,
      notif: pose.notif ? { x: nx, y: ny, r: pose.notif.r * R } : null,
      notch: pose.notif ? { x: nx, y: ny, r: pose.notif.notch * R } : null
    };
  };

  // ---- stage ----------------------------------------------------------
  const host = document.getElementById('stage');
  if (!host) return;
  host.innerHTML = '<svg id="bloub" viewBox="-158 -158 316 316" aria-hidden="true">' +
    '<defs>' +
    '<mask id="bm" maskUnits="userSpaceOnUse" x="-158" y="-158" width="316" height="316">' +
    '<path id="bmBody" fill="#fff"/><g id="bmEyes"></g><circle id="bmNotch" fill="#000" r="0" style="display:none"/>' +
    '</mask>' +
    '<g id="bGrads"></g>' +
    '</defs>' +
    '<g id="bArcsBack" fill="none" stroke-linecap="round"></g>' +
    '<g id="bDotsBack"></g>' +
    '<g id="bo"><path id="bBody" fill="#fff"/><g mask="url(#bm)"><rect x="-158" y="-158" width="316" height="316" fill="#e152b0"/></g></g>' +
    '<g id="bDotsFront"></g>' +
    '<circle id="bNotif" fill="#2496e8" r="0" style="display:none"/>' +
    '<g id="bArcsFront" fill="none" stroke-linecap="round"></g>' +
    '</svg>';
  const svg = document.getElementById('bloub');
  const bmBody = document.getElementById('bmBody');
  const bmEyes = document.getElementById('bmEyes');
  const bmNotch = document.getElementById('bmNotch');
  const bBody = document.getElementById('bBody');
  const bo = document.getElementById('bo');
  const bNotif = document.getElementById('bNotif');
  const bArcsBack = document.getElementById('bArcsBack');
  const bArcsFront = document.getElementById('bArcsFront');
  const bDotsBack = document.getElementById('bDotsBack');
  const bDotsFront = document.getElementById('bDotsFront');
  const bGrads = document.getElementById('bGrads');
  const INK = '#e152b0', PAPER = '#ffffff';

  const engine = new BotEngine();
  let nextAt = Infinity, clock = 0, last = 0, blockStart = 0;
  // A mood that arrived while a reaction was still playing, waiting its turn.
  let queued = null;
  const REST_STATES = ['idle', 'wink', 'wide'];
  // She rests in idle. A wink or a wide look is punctuation between long
  // stretches of it, not somewhere to sit: held for as long as the catalogue
  // says the gesture lasts and no longer, and always followed by idle.
  //
  // Holding them instead — 3 to 6 seconds each, either able to follow the
  // other — put her in a wink or a stare 51% of the time, and ran sequences
  // like wink, wide, wink, wide with no idle between. A wink is a gesture. At
  // four seconds, twice a minute, it stops reading as one.
  const IDLE_RANGE = [10, 25];
  const PUNCTUATION = ['wink', 'wide'];
  function restDuration(state) {
    const d = STATES[state];
    return Math.round(Math.max(d.duration, d.minDuration || 0) * 100) / 100;
  }
  function holdOf(state) {
    if (state !== 'idle') return restDuration(state);
    return Math.round((IDLE_RANGE[0] + Math.random() * (IDLE_RANGE[1] - IDLE_RANGE[0])) * 10) / 10;
  }
  // Idle and a gesture, alternating: every gesture is bracketed by stillness,
  // which is what makes it read as a gesture rather than a tic.
  function applyRest() {
    const state = engine.cur === 'idle'
      ? PUNCTUATION[Math.floor(Math.random() * PUNCTUATION.length)]
      : 'idle';
    blockStart = clock;
    engine.setState(state, clock);
    nextAt = blockStart + holdOf(state);
  }
  // A one-off reaction state: played once, then she settles back into rest.
  function playFor(state, hold) {
    blockStart = clock;
    engine.setState(state, clock);
    nextAt = blockStart + (hold === undefined ? holdOf(state) : hold);
  }
  function flashState(state) {
    if (state === 'idle') { applyRest(); return; }
    playFor(state);
  }
  // Haru's mood engine has twelve emotions; each drives a bloub state (her
  // animation for that mood) and a resting expression (the face idle carries
  // once the state has passed). The states are the measured bloub catalogue.
  const EMOTION_STATES = {
    neutral:      { state: 'idle',     expr: 'neutre' },
    happy:        { state: 'play',     expr: 'heureux' },
    curious:      { state: 'thinking', expr: 'curieux' },
    smug:         { state: 'wink',     expr: 'fier' },
    annoyed:      { state: 'alert',    expr: 'colere' },
    bored:        { state: 'idle',     expr: 'blase' },
    sleepy:       { state: 'sleep',    expr: 'somnolent' },
    surprised:    { state: 'wide',     expr: 'surpris' },
    affectionate: { state: 'idle',     expr: 'heureux' },
    embarrassed:  { state: 'idle',     expr: 'timide' },
    determined:   { state: 'orbit',    expr: 'fier' },
    worried:      { state: 'exclaim',  expr: 'effraye' }
  };
  window.bloub = {
    // Called when she is talking (a nudge or a spoken reply): the pastille pops
    // as a one-off reaction, then she settles back into rest.
    notify: () => flashState('notify'),
    // Called when the user sends a message: she drops into the thinking state
    // and stays there until the reply's mood lands (or a long timeout), so the
    // avatar reads as listening while she works on the answer.
    think: () => playFor('thinking', 20),
    // Map Haru's mood to a bloub state + resting face. The state plays once as
    // a reaction, then she settles back into the resting loop with that face.
    //
    // The mood for a line arrives a round trip after notify() has already
    // popped the pastille for that same line. Cutting notify off 250ms in to
    // start the mood made one event read as two — a stutter rather than a
    // reaction. So a reaction still playing is allowed to finish and the mood
    // follows it. Thinking is the exception: the answer is here, so stop
    // thinking about it.
    express: (emotion) => {
      const M = EMOTION_STATES[emotion] || EMOTION_STATES['neutral'];
      const expr = EXPRESSION_BY_ID.get(M.expr);
      engine.setExpression(expr, clock);
      if (M.state === 'idle') return;
      if (engine.cur === 'thinking' || REST_STATES.indexOf(engine.cur) >= 0) flashState(M.state);
      else queued = M.state;
    },
    // Read-only: what she is doing right now, for the page to know.
    state: () => ({ cur: engine.cur, expr: engine.expr ? engine.expr.id : 'neutre' })
  };
  function dotAttrs(dot) {
    const fill = dot.color || (dot.depth === undefined ? INK : mixHex(PAPER, INK, dot.depth));
    const common = 'fill="' + fill + '" opacity="' + dot.opacity + '"';
    if (dot.d) {
      return '<path ' + common + ' d="' + dot.d + '" transform="translate(' + dot.x + ' ' + dot.y + ') rotate(' + (dot.rot || 0) + ') scale(' + RAYON + ')"/>';
    }
    return '<circle ' + common + ' cx="' + r2(dot.x) + '" cy="' + r2(dot.y) + '" r="' + r2(dot.r) + '"/>';
  }
  function draw(frame) {
    bmBody.setAttribute('d', frame.bodyPath);
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
    // dots: a dot may be a path (the "!" drop) or a circle.
    let db = '', df = '';
    for (let i = 0; i < frame.dots.length; i++) (frame.dotsBehind ? (db += dotAttrs(frame.dots[i])) : (df += dotAttrs(frame.dots[i])));
    bDotsBack.innerHTML = db;
    bDotsFront.innerHTML = df;
    // arcs with their per-frame gradients.
    let grads = '', ab = '', af = '';
    for (let i = 0; i < frame.arcs.length; i++) {
      const a = frame.arcs[i];
      const g = 'g' + a.id;
      grads += '<linearGradient id="' + g + '" gradientUnits="userSpaceOnUse" x1="' + a.grad.x1 + '" y1="' + a.grad.y1 + '" x2="' + a.grad.x2 + '" y2="' + a.grad.y2 + '">' +
        '<stop offset="0" stop-color="' + a.grad.stops[0] + '"/><stop offset="0.5" stop-color="' + a.grad.stops[1] + '"/><stop offset="1" stop-color="' + a.grad.stops[2] + '"/>' +
        '</linearGradient>';
      const stroke = 'stroke="url(#' + g + ')" stroke-width="' + r2(a.width) + '" opacity="' + r2(a.opacity) + '"';
      ab += '<path ' + stroke + ' d="' + a.back + '"/>';
      af += '<path ' + stroke + ' d="' + a.front + '"/>';
    }
    bGrads.innerHTML = grads;
    bArcsBack.innerHTML = ab;
    bArcsFront.innerHTML = af;
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
    const tour = easings.easeOutQuint(clamp((clock - turnSince) / TURN_TIME));
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
      if (queued) { const q = queued; queued = null; playFor(q); }
      else applyRest();
    }
    if (finePointer) aim();
    draw(engine.sample(clock));
    requestAnimationFrame(tick);
  }
  applyRest();
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

  /* Installed on a phone the page draws under the status bar (viewport-fit=cover),
     so the bar pads itself past the clock the same way the compose box pads
     itself past the home indicator. Zero everywhere that has no notch. */
  .topbar { display:flex; align-items:center; gap:.6rem; padding:calc(.7rem + env(safe-area-inset-top)) 1rem .7rem; flex:0 0 auto; }
  .topbar .name { font-weight:700; letter-spacing:-.01em; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  #out { background:var(--glass); color:var(--ink-dim); border:1px solid var(--edge); padding:.4rem .9rem; font-size:.82rem; font-weight:500; backdrop-filter:blur(12px); }
  #bell { margin-left:auto; background:var(--glass); color:var(--ink); border:1px solid var(--edge); padding:.35rem .7rem; font-size:.95rem; line-height:1; backdrop-filter:blur(12px); }

  /* The bell's little card: what may buzz the phone, and when it must not. */
  #psheet { position:absolute; top:calc(3.6rem + env(safe-area-inset-top)); right:.9rem; z-index:5; width:min(21rem, calc(100vw - 1.8rem));
    background:var(--bg-lift); border:1px solid var(--edge); border-radius:var(--r-lg); padding:1rem;
    box-shadow:0 18px 40px rgba(0,0,0,.5); }
  #psheet p { margin:.35rem 0 0; color:var(--ink-dim); font-size:.9rem; }
  #psheet button { width:100%; margin-top:.6rem; }
  #psheet .off { background:var(--glass); color:var(--ink); border:1px solid var(--edge); }
  .prow { display:flex; align-items:center; gap:.5rem; margin:.4rem 0; font-size:.95rem; }
  .prow input[type=checkbox] { width:auto; accent-color:var(--accent); }
  .prow input[type=time] { width:auto; padding:.3rem .5rem; }

  #chat { flex:1; overflow-y:auto; padding:1rem .9rem 1.2rem; -webkit-overflow-scrolling:touch; }

  .msg { max-width:82%; padding:.7rem 1rem; border-radius:var(--r-lg); margin:0 0 .55rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .msg b { font-weight:700; }
  .msg code { font-family:ui-monospace,monospace; font-size:.88em; background:rgba(255,255,255,.08); border-radius:.3rem; padding:.05rem .3rem; }
  .them { background:var(--glass); border:1px solid var(--edge); border-bottom-left-radius:7px; backdrop-filter:blur(12px); }
  .me { background:var(--mine); border:1px solid var(--edge); margin-left:auto; border-bottom-right-radius:7px; }
  .sys { color:var(--ink-dim); font-size:.84rem; text-align:center; max-width:100%; background:none; border:0; }
  /* Under each of her bubbles: what they thought of it, and asking again. */
  .acts { display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; margin:-.2rem 0 .7rem .25rem; max-width:82%; }
  .acts button { background:none; border:1px solid var(--edge); color:var(--ink-dim); border-radius:999px; padding:.15rem .55rem; font-size:.85rem; line-height:1.4; font-weight:500; }
  .acts button.on { background:var(--accent); color:var(--accent-ink); border-color:var(--accent); }
  .acts input { flex:1 1 10rem; font-size:.82rem; padding:.3rem .7rem; border-radius:999px; }
  .acts .said { font-size:.8rem; color:var(--ink-dim); font-style:italic; overflow-wrap:anywhere; }

  form.compose { display:flex; gap:.5rem; padding:.6rem .9rem calc(.6rem + env(safe-area-inset-bottom)); align-items:flex-end; }
  form.compose textarea { resize:none; max-height:7rem; border-radius:var(--r-lg); }
  form.compose button { padding:.8rem 1.15rem; }
  form.compose .icon { background:var(--glass); border:1px solid var(--edge); padding:.7rem .85rem; font-size:1.05rem; line-height:1; backdrop-filter:blur(12px); }
  /* Held down, it should look held down. Recording with no sign of recording is
     how you end up sending thirty seconds of a room. */
  form.compose .icon.hot { background:var(--accent); border-color:var(--accent); animation:pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow:0 0 0 .55rem oklch(78% 0.13 var(--hue) / 0.18); } }

  .quiet { color:var(--ink-dim); text-align:center; padding:2rem 0; }

  /* Files waiting to ride the next message. Costing nothing until Send. */
  #chips { display:flex; flex-wrap:wrap; gap:.4rem; padding:0 .9rem .25rem; flex:0 0 auto; }
  #chips:empty { display:none; }
  .chip { display:flex; align-items:center; gap:.35rem; background:var(--glass); border:1px solid var(--edge);
    border-radius:999px; padding:.25rem .45rem .25rem .7rem; font-size:.82rem; backdrop-filter:blur(12px);
    max-width:14rem; }
  .chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chip button { background:none; border:0; color:var(--ink-dim); padding:0 .25rem; font-size:1rem; line-height:1; font-weight:400; }

  /* Her, on stage: a pink bloub (Grok-style blob) that rotates and morphs
     through the full bloub catalogue, and wears her mood. Pure SVG — no Live2D
     runtime on the phone, nothing fetched from anywhere. */
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
<div class=topbar><span class=dot></span><span class=name>Haru</span><button id=bell title="Notifications">🔔</button><button id=out>Sign out</button></div>
<div id=psheet hidden></div>
<section id=stage></section>
<section id=chat></section>
<div id=chips></div>
<form class=compose id=cf><button type=button id=att class=icon title="Attach a file">📎</button><button type=button id=mic class=icon title="Hold to talk">🎙</button><textarea id=ci rows=1 placeholder="Say something…"></textarea><button id=cb>Send</button></form>
<input type=file id=af multiple hidden>
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

// Installed on an iPhone, the reported viewport stops short of the screen: the
// page painted under the status bar but ended in a dead band above the home
// indicator — the background glow visibly seamed where the layout gave up.
// Only installed mode (navigator.standalone) lies like this, so only installed
// mode is corrected, and only in portrait — screen.height does not rotate on
// iOS, so landscape keeps the stylesheet's own 100dvh.
if(navigator.standalone){
  const fit=()=>{ document.body.style.height = window.innerWidth<window.innerHeight ? screen.height+'px' : ''; };
  fit(); addEventListener('resize',fit);
}

function bubbles(list){
  const last=[...list].reverse().find(m=>m.role==='assistant'&&m.id);
  $('chat').innerHTML = list.map(m=>{
    const cls = m.role==='user'?'me':m.role==='assistant'?'them':'sys';
    let html='<div class="msg '+cls+'">'+md(esc(m.content))+'</div>';
    if(m.role==='assistant'&&m.id) html+=acts(m,m===last);
    return html;
  }).join('') || '<p class=quiet>Nothing yet today.</p>';
  $('chat').scrollTop = $('chat').scrollHeight;
}
// What they thought of a reply, and asking again — the latter only under the
// last one, because only the last one can be done again. The id is the stored
// message's, handed out by the desk, so a rating names a reply rather than
// quoting it. A note already given is shown; otherwise there is a pen.
function acts(m,isLast){
  const on=r=>m.reaction===r?' class=on':'';
  return '<div class=acts data-id="'+esc(m.id)+'">'
    +'<button type=button data-act=up'+on('up')+' title="Good">👍</button>'
    +'<button type=button data-act=down'+on('down')+' title="Poor">👎</button>'
    +(m.note?'<span class=said>'+esc(m.note)+'</span>':'<button type=button data-act=note title="Tell her why">✎</button>')
    +(isLast?'<button type=button data-act=again title="Ask her again">↻</button>':'')
    +'</div>';
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
// One reader for both ways a reply arrives — a send and a retry. Words land
// through show() as the stream delivers them; a U+FFFD means the round was
// thrown away and the bubble goes back to waiting.
async function readStream(r,show){
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
  return {reply,ignored,error};
}

$('cf').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const text=ci.value.trim(); if(!text&&!staged.length)return;
  primeVoice();
  // Taken off the shelf now, so a file picked while she is answering belongs to
  // the next message, not this one. Put back if the send never got through.
  const sent=staged; staged=[]; drawChips();
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
  const mine=(text?esc(text):'')+(sent.length?(text?'\\n':'')+'📎 '+esc(sent.map(f=>f.name).join(', ')):'');
  $('chat').insertAdjacentHTML('beforeend','<div class="msg me">'+mine+'</div><div class="msg them" id='+id+'>…</div>');
  $('chat').scrollTop=$('chat').scrollHeight;
  // Your message drops her into the thinking state while she works on the answer.
  if(window.bloub) window.bloub.think();
  const stopWaiting=()=>{const bubble=document.getElementById(id); if(bubble) bubble.remove();};
  // The waiting bubble doubles as the reply bubble: words land in it as the
  // stream delivers them, and the final processed reply replaces them when the
  // stream ends. textContent rather than innerHTML — her words are text, not
  // markup, and the model is not a source we escape from, it is the source.
  const show=t=>{const bubble=document.getElementById(id); if(!bubble) return false; bubble.textContent=t; $('chat').scrollTop=$('chat').scrollHeight; return true;};
  try{
    const r=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sent.length?{text,attachments:sent}:{text})});
    if(!r.ok) throw r;
    const {reply,ignored,error}=await readStream(r,show);
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
        if(window.bloub){
          window.bloub.notify();
          // Her mood for that line drives the bloub's state and face.
          post('/api/expression',{text:reply}).then(r=>window.bloub.express(r.emotion)).catch(()=>{});
        }
        void speak(reply);
      }
    }
  }catch(r){
    stopWaiting();
    if(r&&r.status===401){location.reload();return;}
    // The files never left: back on the shelf so pressing Send again works.
    if(sent.length){ staged=sent.concat(staged); drawChips(); }
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">That did not get through.</div>');
  }finally{
    $('cb').disabled=false; $('chat').scrollTop=$('chat').scrollHeight;
    // The desk files the reply and hands it an id a moment later; re-read so
    // the bubble gets its row.
    setTimeout(load,1000);
  }
});
load();

// ---- Under her bubbles: thumbs, a note, and asking again --------------------
//
// A reply that got cut off, or that was not her, is asked for again: same
// message, her last answer left out, and the new one lands in the same bubble.
// The old words stay on screen until the new ones start arriving, and come
// back if nothing does.
async function askAgain(){
  const them=$('chat').querySelectorAll('.msg.them'); const last=them[them.length-1];
  if(!last||$('cb').disabled) return;
  const before=last.textContent;
  const id='wait'+(++waiting); last.id=id;
  $('cb').disabled=true;
  primeVoice();
  if(window.bloub) window.bloub.think();
  const show=t=>{const bubble=document.getElementById(id); if(!bubble) return false; bubble.textContent=t; $('chat').scrollTop=$('chat').scrollHeight; return true;};
  show('…');
  try{
    const r=await fetch('/api/chat/retry',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!r.ok) throw r;
    const {reply,ignored,error}=await readStream(r,show);
    if(error) throw new Error(error);
    if(ignored){
      const bubble=document.getElementById(id); if(bubble) bubble.remove();
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">She is not answering that.</div>');
    } else if(reply!==null){
      show(reply);
      if(reply){
        if(window.bloub){ window.bloub.notify(); post('/api/expression',{text:reply}).then(x=>window.bloub.express(x.emotion)).catch(()=>{}); }
        void speak(reply);
      }
    }
  }catch(r){
    if(r&&r.status===401){location.reload();return;}
    show(before);
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">That did not get through.</div>');
  }finally{
    $('cb').disabled=false; setTimeout(load,1000);
  }
}
// A thumb lands on the reply the same way the desk's does — into her prompt,
// onto her mood — and she answers back in kind; the comeback is a bubble of its
// own. A note is the thumb explained, and it is the part she can actually
// learn from, so the pen is always there.
$('chat').addEventListener('click',async ev=>{
  const b=ev.target.closest('button[data-act]'); if(!b) return;
  const row=b.closest('.acts'); const id=row.dataset.id; const act=b.dataset.act;
  if(act==='again') return askAgain();
  if(act==='note'){
    const input=document.createElement('input'); input.placeholder='Tell her why…'; input.maxLength=1000; input.enterKeyHint='send';
    b.replaceWith(input); input.focus();
    input.addEventListener('keydown',async e=>{
      if(e.key!=='Enter') return; e.preventDefault();
      const note=input.value.trim(); if(!note) return;
      input.disabled=true;
      try{ await post('/api/chat/rate',{id,note}); const said=document.createElement('span'); said.className='said'; said.textContent=note; input.replaceWith(said); }
      catch(r){ if(r&&r.status===401){location.reload();return;} input.disabled=false; }
    });
    return;
  }
  if(act==='up'||act==='down'){
    if(b.classList.contains('on')) return;
    for(const other of row.querySelectorAll('button[data-act=up],button[data-act=down]')) other.classList.remove('on');
    b.classList.add('on');
    try{
      const {line}=await post('/api/chat/rate',{id,reaction:act});
      if(line){
        $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(line)+'</div>');
        $('chat').scrollTop=$('chat').scrollHeight;
        if(window.bloub){ window.bloub.notify(); post('/api/expression',{text:line}).then(x=>window.bloub.express(x.emotion)).catch(()=>{}); }
        void speak(line);
        // Her comeback has an id of its own once the desk has filed it.
        setTimeout(load,1200);
      }
    }catch(r){ if(r&&r.status===401){location.reload();return;} b.classList.remove('on'); }
  }
});

// ---- Files that ride the next message --------------------------------------
//
// The paperclip stages, and staging costs a copy and nothing else — same as the
// desktop. The bytes go up once, land in her keeping, and what comes back is
// the record the send carries. Nothing is read and no model is called until
// Send, so a file can be picked before deciding what to ask about it.
let staged=[];
function drawChips(){
  $('chips').innerHTML=staged.map((f,i)=>'<span class=chip><span>'+esc(f.name)+'</span><button type=button data-i='+i+' title="Remove">&times;</button></span>').join('');
  for(const b of $('chips').querySelectorAll('button')) b.onclick=()=>{
    const f=staged.splice(Number(b.dataset.i),1)[0];
    post('/api/attach/discard',{attachment:f}).catch(()=>{});
    drawChips();
  };
}
$('att').onclick=()=>$('af').click();
// A phone photo is several megabytes going up a home tunnel, and her own cap on
// a picture's way to a model is 1536 pixels wide — anything above that is
// thrown away at the other end regardless. Shrunk here, the upload is a tenth
// the size and nothing the model would ever see is lost. It also turns a HEIC
// into a JPEG on the one machine guaranteed to know how to read a HEIC.
async function shrunk(file){
  if(!/^image\\//.test(file.type)||file.size<400*1024) return file;
  try{
    const url=URL.createObjectURL(file);
    const img=new Image();
    await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=url;});
    URL.revokeObjectURL(url);
    const scale=Math.min(1,1536/(img.naturalWidth||1536));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',0.85));
    if(!blob||blob.size>=file.size) return file;
    return new File([blob],file.name.replace(/\\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
  }catch{ return file; }
}
$('af').onchange=async()=>{
  const picked=[...$('af').files].slice(0,6-staged.length);
  $('af').value='';
  for(const original of picked){
    const file=await shrunk(original);
    try{
      const r=await fetch('/api/attach?name='+encodeURIComponent(file.name||'file'),{method:'POST',headers:{'content-type':file.type||'application/octet-stream'},body:file});
      const out=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(out.error||'she could not take it');
      staged.push(out.attachment);
      drawChips();
    }catch(e){
      if(e&&e.status===401){location.reload();return;}
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">'+esc(file.name)+' did not attach — '+esc((e&&e.message)||'it did not get through')+'</div>');
      $('chat').scrollTop=$('chat').scrollHeight;
    }
  }
};

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
    if(window.bloub){
      window.bloub.notify();
      post('/api/expression',{text:line}).then(r=>window.bloub.express(r.emotion)).catch(()=>{});
    }
    void speak(line);
  }catch(r){ if(r&&r.status===401) location.reload(); }
}
setTimeout(askIfSheHasSomethingToSay,1500);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) askIfSheHasSomethingToSay(); });
// Four minutes: she is being carried around, not watched. Anything faster reads
// as pestering, and the spacing on her side would refuse it anyway.
setInterval(askIfSheHasSomethingToSay,4*60_000);

// ---- Being told about her when nothing of hers is open ---------------------
//
// iOS only offers web push to a page installed from Share → Add to Home
// Screen, and only asks permission inside a tap. So the worker is registered on
// every load — it has to exist before anything can subscribe — and everything
// that needs a gesture waits behind the bell.
let sw=null;
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').then(async r=>{
    sw=r;
    // A subscription the server has forgotten — pruned as dead once, a restored
    // config — comes back on its own: re-posting the same one is a no-op.
    try{ const sub=await r.pushManager.getSubscription(); if(sub) await post('/api/push/subscribe',keysOf(sub)); }catch{}
  }).catch(()=>{});
}
function keysOf(sub){ const j=sub.toJSON(); return {endpoint:sub.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth}; }
function rawKey(s){ const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')); const bytes=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i); return bytes; }
const sheet=$('psheet');
$('bell').onclick=()=>{ if(sheet.hidden) void drawBell(); else sheet.hidden=true; };
async function drawBell(){
  sheet.hidden=false;
  if(!sw||!('PushManager' in window)){
    sheet.innerHTML='<p>Notifications need her installed first: open the Share menu, Add to Home Screen, then open her from there.</p>';
    return;
  }
  if(Notification.permission==='denied'){
    sheet.innerHTML='<p>Notifications for her are switched off in the phone settings.</p>';
    return;
  }
  let server;
  try{ server=await get('/api/push'); }
  catch(r){ if(r&&r.status===401){location.reload();return;} sheet.innerHTML='<p>Could not reach her.</p>'; return; }
  const sub=await sw.pushManager.getSubscription().catch(()=>null);
  if(!sub){
    sheet.innerHTML='<button id=pon>Let her reach this phone</button><p>She will only speak up when she has something: a reminder, or a thought of her own. Quiet overnight.</p>';
    $('pon').onclick=async()=>{
      try{
        if(await Notification.requestPermission()!=='granted'){ sheet.innerHTML='<p>She was not allowed to.</p>'; return; }
        const fresh=await sw.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:rawKey(server.key)});
        await post('/api/push/subscribe',keysOf(fresh));
        void drawBell();
      }catch(e){ console.warn('[push] '+(e&&e.message||e)); sheet.innerHTML='<p>That did not work.</p>'; }
    };
    return;
  }
  const p=server.prefs;
  const row=(id,label,on)=>'<label class=prow><input type=checkbox id='+id+(on?' checked':'')+'> '+label+'</label>';
  sheet.innerHTML=
    row('pr','Her own thoughts',p.random)+
    row('pe','Reminders and the journal',p.events)+
    row('ps','The machine she runs on',p.system)+
    '<div class=prow>Quiet from <input type=time id=pf value="'+p.quietFrom+'"> to <input type=time id=pt value="'+p.quietTo+'"></div>'+
    '<button id=ptry>Send a test</button>'+
    '<button id=poff class=off>Stop notifying this phone</button>';
  const save=()=>post('/api/push/prefs',{random:$('pr').checked,events:$('pe').checked,system:$('ps').checked,quietFrom:$('pf').value,quietTo:$('pt').value}).catch(()=>{});
  for(const id of ['pr','pe','ps','pf','pt']) $(id).onchange=save;
  $('ptry').onclick=async()=>{
    $('ptry').disabled=true;
    try{ const r=await post('/api/push/test'); $('ptry').textContent=r.delivered?'Sent — check the lock screen':'Nothing went out'; }
    catch{ $('ptry').textContent='That did not work'; }
  };
  $('poff').onclick=async()=>{
    try{ await post('/api/push/unsubscribe',{endpoint:sub.endpoint}); }catch{}
    try{ await sub.unsubscribe(); }catch{}
    void drawBell();
  };
}
${BLOUB}
</script>`;
}

/**
 * The worker behind her notifications — the one piece of the page that runs
 * with nothing open.
 *
 * Kept to the two events push needs. Every push puts up a notification: that is
 * the deal with iOS, and a worker that swallows one quietly loses the
 * permission. A tap brings the installed app to the front — there is exactly
 * one conversation, so the front page is the conversation — and any address the
 * payload names that is not one of ours falls back to '/'.
 */
export function serviceWorker(): string {
  return `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let m={}; try{ m=e.data?e.data.json():{}; }catch{}
  e.waitUntil(self.registration.showNotification(m.title||'Haru',{
    body:m.body||'',
    icon:'/portrait',
    data:{url:typeof m.url==='string'&&m.url.startsWith('/')&&!m.url.startsWith('//')?m.url:'/'}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(open=>{
    for(const client of open){ if('focus' in client){ client.focus(); return; } }
    return self.clients.openWindow(url);
  }));
});
`;
}
