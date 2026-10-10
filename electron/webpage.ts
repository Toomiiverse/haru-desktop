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

import { DEFAULT_TRANSITION_MS, EASE_OUT_CSS, emotionConfig, HARU_EMOTIONS, MOOD_TO_EMOTION } from './emotions';
import { WAKE_PATTERN } from './wake';
import { AVATAR_CLIENT_VERSION } from './avatarClient';

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

// Her on stage: the supplied Haru artwork, one SVG per emotion, served by her
// own server from /emotions/ and crossfaded on the page. Two parts, on the
// bloub's pattern of a clock-free engine under a thin renderer — the pattern is
// kept; the geometry is not, because these files do not share a path topology
// and are not ours to redraw.
//
// The engine decides WHAT is shown and where she is looking. It is pure and
// clock-free: sample(t) is the frame for a time — which face, which face is
// leaving, how far along, the opacity of each; idle(t) how she floats wearing
// it; gaze(t) where her eyes rest, a wander of short looks and long rests on
// a beat hashed from the time, so it never repeats on a schedule and never
// depends on a clock. All three can be tested with numbers.
//
// The renderer decides HOW. Each face is the SVG itself, fetched once and put
// into the page as markup, because the files ship a black square behind her
// and only inline can that one element be hidden without touching the file —
// and because only inline are her eyes reachable. They are found by geometry
// at mount (the files carry no ids): a mirrored pair of small shapes in the
// band where her eyes are — by shape alone, because in this artwork her eyes
// are the same pink as her mouth. Those two paths get
// a class and a CSS transform, and her attention — the wander, or them typing,
// or her talking, or a pointer — becomes two variables the transform reads.
// The float lives on the outer element and never restarts; how she holds
// herself — a cock of the head, a small roam from home, on the engine's
// pose(t) — on a wrapper inside it; the settle on a change of face, and the
// pop when she talks, on a body inside that, so nothing about a change of
// face moves her from where the float and the pose had her. A reduced-motion
// setting stops all of it.
// What this phone keeps for itself, and whether she can be reached from it.
// Clock-free and DOM-free, like the avatar engine, so a test can run it in a
// bare window.
const PHONE = `
(() => {
  // ---- What this phone keeps for itself -------------------------------------
  //
  // A draft, today's chat, the sharing switch: small things that make the page
  // come back as it was left. localStorage can be missing (a private tab), full,
  // or throwing (a preview), so every touch is guarded and a miss is a default.
  const PREFIX = 'haru.';
  const keep = {
    get(key, fallback) {
      try { const raw = window.localStorage.getItem(PREFIX + key); return raw === null ? fallback : JSON.parse(raw); }
      catch { return fallback; }
    },
    set(key, value) {
      try {
        if (value === undefined || value === null) window.localStorage.removeItem(PREFIX + key);
        else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch { return false; }
    },
    drop(key) { return keep.set(key, null); },
  };

  // ---- Whether she can be reached -------------------------------------------
  //
  // Three states, not two: the phone can say it is offline ('off'), and it can
  // believe it is online while nothing gets through ('lost') — a lift, a dead
  // spot, her machine down. Requests report back, so the page's word is only
  // ever as old as its last request.
  const listeners = new Set();
  const phoneOffline = () => !!window.navigator && window.navigator.onLine === false;
  let state = phoneOffline() ? 'off' : 'on';
  function become(next) { if (next === state) return; state = next; for (const fn of listeners) fn(state); }
  const net = {
    state: () => state,
    online: () => state === 'on',
    onChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    reached() { become('on'); },
    lost() { become(phoneOffline() ? 'off' : 'lost'); },
    // What the phone is on, as far as a browser will say. iOS says nothing, and
    // 'unknown' is the honest word for that.
    kind() {
      const c = window.navigator && (window.navigator.connection || window.navigator.mozConnection || window.navigator.webkitConnection);
      const t = c && c.type;
      if (t === 'wifi' || t === 'cellular' || t === 'ethernet') return t;
      if (t === 'wimax') return 'wifi';
      return 'unknown';
    },
    // fetch, with the state kept honest: any answer at all means she was
    // reached; no answer means she was not. Same promise as fetch.
    fetch(url, init) { return window.fetch(url, init).then(r => { become('on'); return r; }, e => { net.lost(); throw e; }); },
  };
  window.addEventListener('online', () => become('on'));
  window.addEventListener('offline', () => become('off'));
  window.haruKeep = keep;
  window.haruNet = net;
})();
`;

// Her ears kept open: voice activity, the shape of a spoken conversation, and
// the wave file each utterance becomes. Clock-free and DOM-free like the avatar
// engine, so a test can drive it with numbers.
const VOICE = `
(() => {
  // ---- Voice activity -------------------------------------------------------
  //
  // Energy against a floor that follows the room. Speech is a level well above
  // the floor held for a beat; it ends after a stretch of quiet; the floor only
  // learns while nobody is speaking, drops quickly and climbs slowly. The
  // caller can raise the ratio while she is talking, so her own voice through
  // the speaker is not taken for theirs.
  function Vad(opts) {
    const o = Object.assign({ startAfterMs: 90, endAfterMs: 700, minMs: 350, maxMs: 15000, prerollMs: 300, ratio: 3.5, floorMin: 0.004, floorStart: 0.01 }, opts || {});
    let floor = o.floorStart, state = 'quiet', since = 0, startedAt = 0, lastLoud = 0;
    const threshold = ratio => Math.max(o.floorMin, floor * (ratio || o.ratio));
    return {
      feed(level, t, ratio) {
        const loud = level > threshold(ratio);
        if (state === 'quiet') {
          floor = level < floor ? floor * 0.7 + level * 0.3 : floor + (level - floor) * 0.02;
          if (loud) { state = 'maybe'; since = t; }
          return null;
        }
        if (state === 'maybe') {
          if (!loud) { state = 'quiet'; return null; }
          if (t - since >= o.startAfterMs) { state = 'speech'; startedAt = since; lastLoud = t; return { type: 'start', t: Math.max(0, since - o.prerollMs) }; }
          return null;
        }
        if (loud) lastLoud = t;
        const over = t - startedAt >= o.maxMs;
        if ((!loud && t - lastLoud >= o.endAfterMs) || over) {
          state = 'quiet';
          const to = over ? t : lastLoud;
          if (to - startedAt < o.minMs) return { type: 'drop' };
          return { type: 'end', from: Math.max(0, startedAt - o.prerollMs), to: to + 100, ms: to - startedAt };
        }
        return null;
      },
      speaking: () => state === 'speech',
      floor: () => floor,
      threshold,
      reset() { state = 'quiet'; },
    };
  }

  // ---- The conversation -----------------------------------------------------
  //
  // off → asleep (her name wakes her) → awake (whatever is said is for her) →
  // thinking → speaking → awake again for a while → asleep. Speaking over her
  // cuts her off and counts as awake; what is said in the same breath as her
  // name is the message. Everything here is a list of things for the page to
  // do, and the page does them.
  function Talk(opts) {
    const o = Object.assign({ awakeMs: 25000, speakingMaxMs: 90000, wake: null }, opts || {});
    let state = 'off', until = 0, interrupted = false;
    const go = (next, t, ms) => { state = next; until = ms ? t + ms : 0; };
    const wake = said => (o.wake ? o.wake(said) : { woke: false, rest: said });
    return {
      state: () => state,
      awakeUntil: () => until,
      // Awake from the start when they opened the ear themselves: a tap is
      // already her name.
      start(t, awake) { interrupted = false; if (awake) { go('awake', t, o.awakeMs); return [{ type: 'awake' }]; } go('asleep', t); return [{ type: 'asleep' }]; },
      stop() { go('off', 0); interrupted = false; return [{ type: 'off' }]; },
      heard(text, t) {
        const said = (text || '').trim();
        if (!said || state === 'off' || state === 'thinking') return [];
        const w = wake(said);
        if (state === 'asleep') {
          if (!w.woke) return [];
          if (w.rest) { go('thinking', t); return [{ type: 'say', text: w.rest, interrupted: false }]; }
          go('speaking', t, o.speakingMaxMs);
          return [{ type: 'ack' }];
        }
        const message = w.woke ? w.rest : said;
        if (!message) { go('awake', t, o.awakeMs); return []; }
        const was = interrupted; interrupted = false;
        go('thinking', t);
        return [{ type: 'say', text: message, interrupted: was }];
      },
      voiceStarted(t) {
        if (state !== 'speaking') return [];
        interrupted = true; go('awake', t, o.awakeMs);
        return [{ type: 'interrupt' }];
      },
      replied(t, willSpeak) {
        if (state !== 'thinking') return [];
        if (willSpeak) { go('speaking', t, o.speakingMaxMs); return [{ type: 'speaking' }]; }
        go('awake', t, o.awakeMs); return [{ type: 'awake' }];
      },
      spokeEnd(t) { if (state !== 'speaking') return []; go('awake', t, o.awakeMs); return [{ type: 'awake' }]; },
      tick(t) {
        if ((state === 'awake' || state === 'speaking') && until && t >= until) { go('asleep', t); interrupted = false; return [{ type: 'asleep' }]; }
        return [];
      },
    };
  }

  const WAKE = new RegExp(${JSON.stringify(WAKE_PATTERN.source)}, 'i');
  function wakePhraseIn(text) {
    const said = (text || '').trim();
    const m = said.match(WAKE);
    return m ? { woke: true, rest: (m[1] || '').trim() } : { woke: false, rest: said };
  }

  // ---- The wave file --------------------------------------------------------
  //
  // Frames of float samples at the microphone's rate, boxed down to 16 kHz
  // (averaging, so the higher frequencies fold into hiss rather than words)
  // and written as 16-bit PCM with a 44-byte header. Whisper wants nothing more.
  function toWav(frames, fromRate, toRate) {
    let n = 0; for (const f of frames) n += f.length;
    const all = new Float32Array(n); let at = 0; for (const f of frames) { all.set(f, at); at += f.length; }
    const ratio = fromRate / toRate, outN = Math.floor(all.length / ratio);
    const out = new Int16Array(outN);
    for (let i = 0; i < outN; i++) {
      const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
      let sum = 0; for (let k = a; k < b && k < all.length; k++) sum += all[k];
      const v = sum / (Math.min(b, all.length) - a);
      out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    const buf = new ArrayBuffer(44 + out.length * 2), dv = new DataView(buf);
    const str = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + out.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, toRate, true);
    dv.setUint32(28, toRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, out.length * 2, true);
    new Int16Array(buf, 44).set(out);
    return buf;
  }

  window.HaruVad = Vad;
  window.HaruTalk = Talk;
  window.haruWake = wakePhraseIn;
  window.haruWav = toWav;
})();
`;

const AVATAR = `
(() => {
  const EMOTIONS = ${JSON.stringify(HARU_EMOTIONS)};
  const LABELS = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].label])))};
  const TRANSITIONS = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].transition])))};
  const IDLE = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].idle])))};
  const GAZE = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].gaze])))};
  const BLINKS = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].blink])))};
  const POSES = ${JSON.stringify(Object.fromEntries(HARU_EMOTIONS.map(name => [name, emotionConfig[name].pose])))};
  const ADAPT = ${JSON.stringify(MOOD_TO_EMOTION)};
  const EASE_CSS = ${JSON.stringify(EASE_OUT_CSS)};
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // Cubic ease-out: deterministic, no overshoot, the same curve as EASE_CSS.
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  // A number in [0,1) for an integer, the same every time: the beat of the wander.
  const hashN = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  // ---- the engine: pure, clock-free ------------------------------------
  function createEmotionEngine(options) {
    const duration = () => (options && typeof options.duration === 'function' ? options.duration() : ${DEFAULT_TRANSITION_MS});
    let emotion = 'neutral', previous = null, startedAt = -Infinity, leavingFrom = 0, arrivingFrom = 1;
    const progress = (t) => {
      const d = previous === null ? 0 : (TRANSITIONS[emotion] === 'cut' ? 0 : duration());
      return d <= 0 ? 1 : clamp((t - startedAt) / d, 0, 1);
    };
    const engine = {
      sample(t) {
        const p = easeOut(progress(t));
        const opacity = arrivingFrom + (1 - arrivingFrom) * p;
        const previousOpacity = previous === null ? 0 : leavingFrom * (1 - p);
        return { emotion: emotion, previousEmotion: previous, transitionProgress: p, opacity: opacity, previousOpacity: previousOpacity, transitioning: p < 1 };
      },
      idle(t) {
        const m = IDLE[emotion] || IDLE.neutral;
        const phase = (t / m.periodMs) * TAU;
        return { bob: Math.sin(phase) * m.bobPx, sway: Math.sin(phase * 0.5 + 1.3) * m.swayDeg, breath: 1 + (1 - Math.cos(phase)) / 2 * m.breath, periodMs: m.periodMs };
      },
      // Where her eyes rest at t, in [-1,1] each way, before anyone claims her
      // attention. Beats of about three seconds; on most beats she looks back
      // to centre and rests, on the others she looks somewhere and holds it,
      // with a little drift throughout so a rest is never a freeze.
      gaze(t) {
        const beat = Math.floor(t / 2400);
        const r = hashN(beat), a = hashN(beat + 1000) * TAU, d = 0.35 + hashN(beat + 2000) * 0.65;
        const looking = r > 0.45;
        const x = (looking ? Math.cos(a) * d : 0) + Math.sin(t / 2300) * 0.06;
        const y = (looking ? Math.sin(a) * d * 0.6 : 0) + Math.sin(t / 3100 + 1) * 0.04;
        return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), looking: looking, beat: beat };
      },
      // A blink calendar, the same every time: gaps of 1.9 to 4.6 seconds,
      // now and then a second blink a quarter-second after the first. Walked
      // from the start rather than solved, because the gaps are irregular;
      // it is a few thousand additions at most, once per blink.
      nextBlink(t) {
        let at = 1400, k = 0;
        while (k < 100000) {
          if (at >= t) return at;
          const double = hashN(k + 5000) < 0.18;
          if (double && at + 240 >= t) return at + 240;
          at += 1900 + hashN(k) * 2700 + (double ? 240 : 0); k++;
        }
        return at;
      },
      // How open her eyes are at t: 1 open, down to 0.1 at the bottom of a
      // blink, closing faster than they open, as eyes do.
      blink(t) {
        if (!BLINKS[emotion]) return 1;
        let at = 1400, k = 0;
        while (k < 100000 && at + 400 < t) { const double = hashN(k + 5000) < 0.18; at += 1900 + hashN(k) * 2700 + (double ? 240 : 0); k++; }
        const lid = (start) => { const u = t - start; if (u < 0 || u > 180) return 1; return u < 70 ? 1 - (u / 70) * 0.9 : 0.1 + ((u - 70) / 110) * 0.9; };
        const second = hashN(k + 5000) < 0.18 ? lid(at + 240) : 1;
        return Math.min(lid(at), second);
      },
      blinks: () => !!BLINKS[emotion],
      // How she holds herself at t: a cock of the head and a spot near home,
      // on beats of five seconds or so — held for the first part of the beat,
      // released for the rest, so a tilt is a gesture and not a lean — scaled
      // by the face, with the face's own lean carried throughout.
      pose(t) {
        const m = POSES[emotion] || POSES.neutral;
        const beat = Math.floor(t / 5200), phase = (t - beat * 5200) / 5200;
        const r = hashN(beat + 3000), posed = r > 0.4 && phase < 0.62;
        const sign = hashN(beat + 4000) < 0.5 ? -1 : 1, amount = 0.4 + hashN(beat + 5000) * 0.6;
        const a = hashN(beat + 6000) * TAU, d = hashN(beat + 7000);
        return {
          tilt: m.leanDeg + (posed ? sign * amount * m.tiltDeg : 0),
          dx: posed ? Math.cos(a) * d * m.roam : 0,
          dy: posed ? Math.sin(a) * d * m.roam * 0.6 : 0,
          posed: posed, beat: beat
        };
      },
      set(next, t) {
        if (EMOTIONS.indexOf(next) < 0) next = 'neutral';
        if (next === emotion) return false;
        const now = engine.sample(t);
        previous = emotion; emotion = next; startedAt = t;
        leavingFrom = now.opacity; arrivingFrom = 0;
        return true;
      },
      emotion: () => emotion,
      duration: duration
    };
    return engine;
  }
  window.HaruEmotionEngine = createEmotionEngine;

  // ---- finding her eyes in a file that names nothing -------------------
  // The bounding box of a path, walking its commands, relative ones included.
  function pathBox(d) {
    const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\\d*\\.?\\d+(?:e-?\\d+)?/g) || [];
    let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    const mark = (px, py) => { if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py; n++; };
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
      const t = tokens[i];
      if (/[A-Za-z]/.test(t)) { cmd = t; i++; continue; }
      if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      if (C === 'M') { const px = num(), py = num(); x = rel ? x + px : px; y = rel ? y + py : py; sx = x; sy = y; mark(x, y); cmd = rel ? 'l' : 'L'; }
      else if (C === 'L') { const px = num(), py = num(); x = rel ? x + px : px; y = rel ? y + py : py; mark(x, y); }
      else if (C === 'H') { const px = num(); x = rel ? x + px : px; mark(x, y); }
      else if (C === 'V') { const py = num(); y = rel ? y + py : py; mark(x, y); }
      else if (C === 'C') { const ox = rel ? x : 0, oy = rel ? y : 0; mark(ox + num(), oy + num()); mark(ox + num(), oy + num()); x = ox + num(); y = oy + num(); mark(x, y); }
      else if (C === 'S' || C === 'Q') { const ox = rel ? x : 0, oy = rel ? y : 0; mark(ox + num(), oy + num()); x = ox + num(); y = oy + num(); mark(x, y); }
      else if (C === 'T') { const ox = rel ? x : 0, oy = rel ? y : 0; x = ox + num(); y = oy + num(); mark(x, y); }
      else if (C === 'A') { const ox = rel ? x : 0, oy = rel ? y : 0; i += 5; x = ox + num(); y = oy + num(); mark(x, y); }
      else if (C === 'Z') { x = sx; y = sy; }
      else { i++; }
    }
    return n ? { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 } : null;
  }
  // A path or rect that covers the whole canvas is a backdrop, not her.
  function coversCanvas(el, box, x, y, w, h) {
    if (el.nodeName.toLowerCase() === 'rect') return Number(el.getAttribute('x') || 0) <= x && Number(el.getAttribute('y') || 0) <= y && Number(el.getAttribute('width')) >= w && Number(el.getAttribute('height')) >= h;
    return !!box && box.x0 <= x + 1 && box.y0 <= y + 1 && box.x1 >= x + w - 1 && box.y1 >= y + h - 1 && (el.getAttribute('d') || '').length < 200;
  }
  // Her eyes: two small shapes, one each side of the middle, level with each
  // other, in the band where her eyes are. By shape alone — in this artwork
  // her face is the dark silhouette and her eyes are the pink, the same pink
  // as her mouth, so colour says nothing. Sizes may differ — confused has one
  // eye wide and one narrow — but not wildly. The mouth is one shape in the
  // middle and cannot pair; the blush beneath the eyes pairs, but the largest
  // pair wins, and the eyes are larger.
  function findEyes(paths, W, H) {
    const band = paths.filter((p) => p.box && p.box.w < W * 0.16 && p.box.h < H * 0.16 && p.box.cy > H * 0.58 && p.box.cy < H * 0.74);
    const left = band.filter((p) => p.box.cx > W * 0.32 && p.box.cx < W * 0.46), right = band.filter((p) => p.box.cx > W * 0.54 && p.box.cx < W * 0.68);
    let best = null, score = 0;
    for (const a of left) for (const b of right) {
      if (Math.abs(a.box.cy - b.box.cy) > H * 0.04 || Math.abs(a.box.w - b.box.w) > W * 0.06 || Math.abs(a.box.h - b.box.h) > H * 0.06) continue;
      const area = a.box.w * a.box.h + b.box.w * b.box.h;
      if (area > score) { score = area; best = [a.el, b.el]; }
    }
    return best;
  }

  // ---- the renderer ------------------------------------------------------
  const host = document.getElementById('stage');
  if (!host) return;
  const data = host.dataset || {};
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const finePointer = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
  let fade = Number(data.transition) || ${DEFAULT_TRANSITION_MS};
  if (data.size) host.style.setProperty('--avatar-size', data.size + 'px');
  host.innerHTML = '<div id=avatar role=img aria-label="' + LABELS.neutral + '"><div id=avatar-pose><div id=avatar-body><div class=face></div><div class=face></div></div></div></div>';
  const box = document.getElementById('avatar');
  const body = document.getElementById('avatar-body');
  const poseEl = document.getElementById('avatar-pose');
  const faces = box.querySelectorAll('.face');
  const engine = createEmotionEngine({ duration: () => (reduced ? 0 : fade) });
  const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let front = 0, resting = 'neutral', timer = null, frozenAt = null, request = 0, eyes = null;
  // Whether a face has ever reached the stage. Until one has, a "change" to
  // the emotion she is already at (neutral, at startup) must still load and
  // mount it — otherwise the first paint is a no-op and she stays blank, the
  // way she does asleep, when the only expression that ever comes maps back
  // to a face the engine thinks is already showing.
  let mounted = false;
  const cache = {};

  function load(name) {
    if (cache[name]) return Promise.resolve(cache[name]);
    return fetch('/emotions/' + name + '.svg').then((r) => { if (!r.ok) throw new Error('face ' + r.status); return r.text(); }).then((text) => { cache[name] = text; return text; });
  }
  // The SVG into a layer, as itself: its own viewBox, scaled to the box, never
  // stretched; the backdrop marked so the page can hide it; the eyes marked
  // so the page can move them.
  function mount(layer, text) {
    const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('not a face');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
    let found = null;
    if (vb.length === 4) {
      const paths = [];
      for (const el of svg.querySelectorAll('path, rect')) {
        const box = el.nodeName.toLowerCase() === 'path' ? pathBox(el.getAttribute('d') || '') : null;
        if (coversCanvas(el, box, vb[0], vb[1], vb[2], vb[3])) { el.setAttribute('class', 'backdrop'); continue; }
        paths.push({ el: el, box: box });
      }
      found = findEyes(paths, vb[2], vb[3]);
      if (found) for (const eye of found) eye.setAttribute('class', 'eye');
    }
    layer.replaceChildren(document.adoptNode ? document.adoptNode(svg) : svg);
    return found;
  }
  // How she moves while wearing this face, handed to the CSS that moves her.
  // The period is the engine's; the float's own period stays put, because a
  // running animation given a new duration jumps.
  function idleFor(name) {
    const m = IDLE[name] || IDLE.neutral;
    box.style.setProperty('--idle-bob', m.bobPx + 'px'); box.style.setProperty('--idle-sway', m.swayDeg + 'deg'); box.style.setProperty('--idle-breath', String(1 + m.breath));
  }
  function paint(frame, animate) {
    const fore = faces[front], back = faces[1 - front];
    const ease = animate && !reduced && engine.duration() > 0 ? 'opacity ' + engine.duration() + 'ms ' + EASE_CSS : 'none';
    fore.style.transition = ease; back.style.transition = ease;
    fore.style.opacity = animate ? '1' : String(frame.opacity);
    back.style.opacity = animate ? '0' : String(frame.previousOpacity);
    fore.classList.add('on'); back.classList.remove('on');
  }
  function replay(el, cls) { el.classList.remove(cls); if (typeof el.offsetWidth === 'number') void el.offsetWidth; el.classList.add(cls); }
  function show(name, t) {
    const changed = engine.set(name, t);
    if (!changed && mounted) return;
    const frame = engine.sample(t);
    const mine = ++request;
    box.setAttribute('aria-label', LABELS[frame.emotion] || ('Haru feeling ' + frame.emotion));
    const incoming = faces[1 - front];
    load(frame.emotion).then((text) => {
      if (mine !== request) return;
      incoming.classList.remove('missing');
      eyes = mount(incoming, text);
      front = 1 - front;
      mounted = true;
      idleFor(frame.emotion);
      paint(frozenAt === null ? frame : engine.sample(frozenAt), frozenAt === null);
      if (!reduced && frozenAt === null) replay(body, 'changed');
      look(); scheduleBlink();
    }).catch(() => { if (mine === request) { incoming.replaceChildren(); incoming.classList.add('missing'); } });
  }
  function settleBack(ms) { clearTimeout(timer); timer = setTimeout(() => show(resting, clock()), ms); }
  const POKES = { exclaim: ['angry', 2000], burst: ['surprised', 1600], orbit: ['excited', 1600], comet: ['surprised', 1600], play: ['happy', 1600] };

  // ---- attention: where the eyes go, and why ----------------------------
  // The wander is the engine's. Over it, in order: a pointer she can see, them
  // typing (down, at the box), her talking (at them), her thinking (up and
  // away). Each claim expires, so silence hands her back to the wander.
  // In the artwork's own units: her eyes are sixty to a hundred and forty wide,
  // and at the phone's size a unit is a tenth of a pixel, so a glance has to
  // be a real distance to be one.
  const RANGE_X = 34, RANGE_Y = 18;
  let claim = null, claimUntil = 0, pointer = null, pointerAt = 0;
  function target(t) {
    const strength = GAZE[engine.emotion()] === undefined ? 1 : GAZE[engine.emotion()];
    if (!strength) return { x: 0, y: 0, why: 'fixed' };
    if (pointer && t - pointerAt < 4000) return { x: pointer.x, y: pointer.y, why: 'pointer' };
    if (claim && t < claimUntil) return claim.why === 'typing' ? { x: 0.15, y: 0.9, why: 'typing' } : claim.why === 'talking' ? { x: 0, y: 0.15, why: 'talking' } : { x: 0, y: 0, why: claim.why };
    if (engine.emotion() === 'thinking') return { x: -0.7, y: -0.8, why: 'thinking' };
    const g = engine.gaze(t);
    return { x: g.x * strength, y: g.y * strength, why: g.looking ? 'looking' : 'resting' };
  }
  function look() {
    if (frozenAt !== null || reduced) {
      box.style.setProperty('--gaze-x', '0px'); box.style.setProperty('--gaze-y', '0px');
      const still = frozenAt === null ? { tilt: 0, dx: 0, dy: 0 } : engine.pose(frozenAt);
      poseEl.style.setProperty('--tilt', still.tilt.toFixed(2) + 'deg'); poseEl.style.setProperty('--drift-x', still.dx.toFixed(3)); poseEl.style.setProperty('--drift-y', still.dy.toFixed(3));
      return;
    }
    const t = clock(), at = target(t), p = engine.pose(t);
    box.style.setProperty('--gaze-x', (at.x * RANGE_X).toFixed(1) + 'px');
    box.style.setProperty('--gaze-y', (at.y * RANGE_Y).toFixed(1) + 'px');
    // The pose too: a target now and then, and the CSS carries her there.
    poseEl.style.setProperty('--tilt', p.tilt.toFixed(2) + 'deg');
    poseEl.style.setProperty('--drift-x', p.dx.toFixed(3)); poseEl.style.setProperty('--drift-y', p.dy.toFixed(3));
  }
  // Sampled, not animated: the CSS transition on the eyes carries each new
  // target smoothly, so four looks a second is plenty and costs nothing.
  const gazeTimer = setInterval(look, 250);
  // Blinks are scheduled to the engine's calendar, one timer at a time: the
  // lid closes, a beat, it opens, the next is booked. Nothing between blinks.
  let blinkTimer = null;
  function blinkNow() {
    box.style.setProperty('--lid', '0.1');
    blinkTimer = setTimeout(() => { box.style.setProperty('--lid', '1'); scheduleBlink(); }, 90);
  }
  function scheduleBlink() {
    clearTimeout(blinkTimer); blinkTimer = null;
    if (reduced || frozenAt !== null || !engine.blinks()) { box.style.setProperty('--lid', '1'); return; }
    const now = clock();
    blinkTimer = setTimeout(blinkNow, Math.max(50, engine.nextBlink(now + 50) - now));
  }
  if (finePointer) {
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = box.getBoundingClientRect ? box.getBoundingClientRect() : null; if (!r || !r.width) return;
      const hw = Math.max(1, window.innerWidth / 2), hh = Math.max(1, window.innerHeight / 2);
      pointer = { x: clamp((e.clientX - (r.left + r.width / 2)) / hw, -1, 1), y: clamp((e.clientY - (r.top + r.height / 2)) / hh, -1, 1) }; pointerAt = clock();
    });
    document.addEventListener('pointerleave', () => { pointer = null; });
  }

  window.haruAvatar = {
    express: (emotion) => { resting = ADAPT[emotion] || (EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral'); clearTimeout(timer); show(resting, clock()); },
    think: () => { clearTimeout(timer); show('thinking', clock()); settleBack(20000); },
    // She is starting to talk: the thinking is over, whatever the reply's
    // mood turns out to be — that is a second round trip, and it lands after
    // the words and the voice have begun. So she goes back to her resting face
    // now, looks at them, and the mood crossfades in when it arrives. A small
    // pop marks the start, when motion is allowed.
    notify: () => {
      if (engine.emotion() === 'thinking') { clearTimeout(timer); show(resting, clock()); }
      if (frozenAt !== null || reduced) return;
      replay(body, 'pop'); window.haruAvatar.attend('talking', 2500);
    },
    poke: (what) => { const hit = POKES[what]; if (!hit) return; clearTimeout(timer); show(hit[0], clock()); settleBack(hit[1]); },
    // Something has her attention for a while: 'typing', 'talking', or 'here'
    // (at them). Nothing, or a spent claim, and the wander has her back.
    attend: (why, ms) => { claim = why ? { why: why } : null; claimUntil = clock() + (ms === undefined ? 1500 : ms); look(); },
    sample: (t) => engine.sample(t === undefined ? clock() : t),
    idle: (t) => engine.idle(t === undefined ? clock() : t),
    gaze: (t) => target(t === undefined ? clock() : t),
    eyes: () => (eyes ? eyes.length : 0),
    freeze: (t) => { frozenAt = t === undefined ? clock() : t; box.classList.add('frozen'); paint(engine.sample(frozenAt), false); look(); scheduleBlink(); box.style.setProperty('--lid', String(engine.blink(frozenAt))); },
    play: () => { frozenAt = null; box.classList.remove('frozen'); paint(engine.sample(clock()), false); look(); scheduleBlink(); },
    blink: (t) => engine.blink(t === undefined ? clock() : t),
    pose: (t) => engine.pose(t === undefined ? clock() : t),
    nextBlink: (t) => engine.nextBlink(t === undefined ? clock() : t),
    state: () => { const f = engine.sample(frozenAt === null ? clock() : frozenAt); return { emotion: f.emotion, previousEmotion: f.previousEmotion, transitionProgress: f.transitionProgress, resting: resting, frozen: frozenAt !== null }; },
    setSize: (px) => host.style.setProperty('--avatar-size', px + 'px'),
    setTransition: (ms) => { fade = Math.max(0, Number(ms) || 0); },
    stop: () => { clearInterval(gazeTimer); clearTimeout(blinkTimer); }
  };
  idleFor('neutral');
  show('neutral', clock());
  scheduleBlink();
  if (data.frozenAt !== undefined) window.haruAvatar.freeze(Number(data.frozenAt) || 0);
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
  .topbar.off .dot { background:var(--ink-dim); box-shadow:none; }
  #talk { font-size:.72rem; padding:.1rem .55rem; border-radius:1rem; background:var(--glass); border:1px solid var(--accent); color:var(--ink); }
  #net { font-size:.72rem; padding:.1rem .55rem; border-radius:1rem; background:var(--glass); border:1px solid var(--edge); color:var(--ink-dim); }
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
  #psheet .prow input:not([type=checkbox]) { flex:1; min-width:0; }
  #psheet .prow button { width:auto; margin-top:0; flex:0 0 auto; }
  #psheet hr { border:0; border-top:1px solid var(--edge); margin:.7rem 0 .4rem; }
  .prow input[type=time] { width:auto; padding:.3rem .5rem; }

  #chat { flex:1; overflow-y:auto; padding:1rem .9rem 1.2rem; -webkit-overflow-scrolling:touch; }
  #credit-status { margin:0 .9rem .4rem; padding:.65rem .75rem; border:1px solid var(--ink-dim); border-radius:.5rem; color:var(--ink); font-size:.85rem; line-height:1.4; }
  #credit-status[hidden] { display:none; }

  /* Two views, one column. The face sits above the switch and belongs to both:
     it is the whole point of the second tab, and moving it on every switch
     would restart the float animation. */
  .tabs { display:flex; gap:.3rem; padding:0 .9rem .4rem; flex:0 0 auto; }
  .tabs button { flex:1; background:var(--glass); border:1px solid var(--edge); color:var(--ink-dim);
    padding:.4rem .6rem; border-radius:1rem; font-size:.85rem; font-weight:600; backdrop-filter:blur(12px); }
  .tabs button[aria-selected=true] { border-color:var(--accent); color:var(--ink); background:var(--mine); }
  #status { flex:1; overflow-y:auto; padding:.4rem .9rem 1.4rem; -webkit-overflow-scrolling:touch; }
  #status h2 { margin:0 0 .1rem; font-size:1.15rem; letter-spacing:-.01em; }
  #status .said { color:var(--ink-dim); font-size:.9rem; margin:0 0 .9rem; }
  .card { background:var(--glass); border:1px solid var(--edge); border-radius:var(--r-md);
    padding:.8rem .9rem; margin:0 0 .7rem; backdrop-filter:blur(12px); }
  .card h3 { margin:0 0 .5rem; font-size:.78rem; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-dim); font-weight:700; }
  .bond .title { font-size:1.25rem; font-weight:700; }
  .bond .rank { float:right; color:var(--ink-dim); font-size:.85rem; font-weight:600; }
  .bond .note { color:var(--ink-dim); font-size:.88rem; margin:.15rem 0 .6rem; }
  /* The meter is a div rather than <progress> so the fill can carry a colour
     that means something — see tone() — which no browser lets you set on one. */
  .meter { margin:0 0 .55rem; }
  .meter:last-child { margin-bottom:0; }
  .meter .top { display:flex; justify-content:space-between; align-items:baseline; gap:.5rem; font-size:.9rem; }
  .meter .top b { font-weight:600; }
  .meter .top span { color:var(--ink-dim); font-variant-numeric:tabular-nums; font-size:.85rem; }
  .bar { height:7px; border-radius:4px; background:rgba(255,255,255,.09); overflow:hidden; margin-top:.28rem; }
  .bar i { display:block; height:100%; border-radius:4px; background:var(--accent); transition:width .5s cubic-bezier(0.33, 1, 0.68, 1); }
  .bar.warm i { background:oklch(78% 0.140 25); }
  .bar.cool i { background:oklch(76% 0.090 var(--hue)); }
  .meter .why { color:var(--ink-dim); font-size:.8rem; margin:.2rem 0 0; }
  .todo { list-style:none; margin:.1rem 0 0; padding:0; }
  .todo li { display:flex; align-items:baseline; gap:.6rem; padding:.3rem 0; border-top:1px solid var(--edge); }
  .todo li:first-child { border-top:0; }
  .todo .what { flex:1; min-width:0; }
  .todo .when { display:block; color:var(--ink-dim); font-size:.78rem; }
  .todo li.late .when { color:oklch(78% 0.130 25); }
  /* A tick, not a checkbox: this is the only place on the phone the list can be
     cleared, and it wants to look like a button you meant to press. */
  .todo .tick { flex:0 0 auto; background:var(--glass); border:1px solid var(--edge); color:var(--ink);
    border-radius:1rem; padding:.2rem .6rem; font-size:.85rem; line-height:1.2; }
  .todo .tick:disabled { opacity:.4; }
  /* Her diary reads like one: a page of dated entries, generous line height,
     no cards fighting for attention. */
  #diary { flex:1; overflow-y:auto; padding:.4rem 1.1rem 1.6rem; -webkit-overflow-scrolling:touch; }
  #diary h2 { margin:0 0 .6rem; font-size:1.15rem; letter-spacing:-.01em; }
  /* Each entry is a tab: the date and her title on the bar, the entry under
     it on a tap. Native <details>, so it works with nothing but the browser. */
  #diary .entry { margin:0 0 .6rem; background:var(--glass); border:1px solid var(--edge); border-radius:var(--r-md); backdrop-filter:blur(12px); }
  #diary .entry summary { list-style:none; cursor:pointer; padding:.7rem .9rem; display:flex; flex-direction:column; gap:.15rem; }
  #diary .entry summary::-webkit-details-marker { display:none; }
  #diary .entry summary .when { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-dim); font-weight:700; }
  #diary .entry summary .title { font-weight:600; line-height:1.3; padding-right:1.4rem; position:relative; }
  #diary .entry summary .title::after { content:'›'; position:absolute; right:0; top:0; color:var(--ink-dim); transform:rotate(90deg); transition:transform .2s; }
  #diary .entry[open] summary .title::after { transform:rotate(-90deg); }
  #diary .entry p { margin:0; padding:0 .9rem .9rem; line-height:1.65; white-space:pre-wrap; }
  #diary .none { color:var(--ink-dim); }
  /* Her own things, on the same tab, under the standing. Folding rows so a
     long night's note does not push the meters off the screen. */
  .fold { border-top:1px solid var(--edge); }
  .fold:first-of-type { border-top:0; }
  .fold summary { list-style:none; cursor:pointer; padding:.45rem 0; display:flex; flex-direction:column; gap:.1rem; }
  .fold summary::-webkit-details-marker { display:none; }
  .fold summary .k { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-dim); font-weight:700; }
  .fold summary .t { font-weight:600; line-height:1.3; padding-right:1.2rem; position:relative; }
  .fold summary .t::after { content:'›'; position:absolute; right:0; top:0; color:var(--ink-dim); transform:rotate(90deg); transition:transform .2s; }
  .fold[open] summary .t::after { transform:rotate(-90deg); }
  .fold .body { padding:0 0 .6rem; line-height:1.55; color:var(--ink); }
  .fold .body p { margin:.2rem 0; }
  .fold .body .dim { color:var(--ink-dim); font-size:.85rem; }
  .fold .body a { color:var(--accent); word-break:break-all; font-size:.82rem; }
  .pills { display:flex; flex-wrap:wrap; gap:.35rem; }
  .pill { background:var(--glass); border:1px solid var(--edge); border-radius:1rem; padding:.2rem .6rem; font-size:.85rem; }
  .pill .of { color:var(--ink-dim); }
  .card.stale h3 { color:var(--ink-dim); }
  .card.stale .lead { color:var(--ink-dim); font-size:.82rem; margin:0 0 .35rem; }
  #status .facts { display:flex; flex-wrap:wrap; gap:.35rem .9rem; color:var(--ink-dim); font-size:.86rem; }
  #status .facts b { color:var(--ink); font-weight:600; font-variant-numeric:tabular-nums; }
  @media (prefers-reduced-motion: reduce) { .bar i { transition:none; } }

  .msg { max-width:82%; padding:.7rem 1rem; border-radius:var(--r-lg); margin:0 0 .55rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .msg b { font-weight:700; }
  .msg code { font-family:ui-monospace,monospace; font-size:.88em; background:rgba(255,255,255,.08); border-radius:.3rem; padding:.05rem .3rem; }
  .them { background:var(--glass); border:1px solid var(--edge); border-bottom-left-radius:7px; backdrop-filter:blur(12px); }
  .them.aside { border-left:3px solid var(--accent); }
  .me { background:var(--mine); border:1px solid var(--edge); margin-left:auto; border-bottom-right-radius:7px; }
  .sys { color:var(--ink-dim); font-size:.84rem; text-align:center; max-width:100%; background:none; border:0; }
  .msg a.maps { display:inline-block; margin-top:.5rem; padding:.5rem .85rem; border-radius:.9rem; background:var(--glass); border:1px solid var(--accent); color:var(--ink); text-decoration:none; font-weight:600; }
  /* Under each of her bubbles: a small arrow, and behind it what they thought
     of the reply and asking again. Folded by default — a row of buttons under
     every message was a dock, not a conversation. */
  .acts { display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; margin:-.3rem 0 .6rem .25rem; max-width:82%; }
  .nudge-feedback { max-width:100%; }
  .nudge-feedback button { font-size:.72rem; min-height:36px; padding:.3rem .55rem; }
  .nudge-feedback button[aria-pressed="true"] { border-color:var(--accent); color:var(--accent); }
  .nudge-feedback .feedback-error { flex-basis:100%; font-size:.75rem; color:var(--ink-dim); }
  .acts .dock { display:contents; }
  .acts .dock[hidden] { display:none; }
  .acts .more { padding:.05rem .5rem; font-size:.8rem; opacity:.7; }
  .acts .more.open { opacity:1; }
  .acts button { background:none; border:1px solid var(--edge); color:var(--ink-dim); border-radius:999px; padding:.15rem .55rem; font-size:.85rem; line-height:1.4; font-weight:500; }
  .acts button.on { background:var(--accent); color:var(--accent-ink); border-color:var(--accent); }
  .acts input { flex:1 1 10rem; font-size:.82rem; padding:.3rem .7rem; border-radius:999px; }
  .acts .tune { display:contents; }
  .acts .said { font-size:.8rem; color:var(--ink-dim); font-style:italic; overflow-wrap:anywhere; }
  .acts .reacted { font-size:.95rem; line-height:1.4; }
  .acts .reacted { border:1px solid var(--edge); border-radius:999px; padding:.05rem .45rem; }

  form.compose { display:flex; gap:.5rem; padding:.6rem .9rem calc(.6rem + env(safe-area-inset-bottom)); align-items:flex-end; }
  form.compose textarea { resize:none; max-height:7rem; border-radius:var(--r-lg); }
  form.compose button { padding:.8rem 1.15rem; }
  form.compose .icon { background:var(--glass); border:1px solid var(--edge); padding:.7rem .85rem; font-size:1.05rem; line-height:1; backdrop-filter:blur(12px); }
  /* Held down, it should look held down. Recording with no sign of recording is
     how you end up sending thirty seconds of a room. */
  form.compose .icon.on { box-shadow:0 0 0 2px var(--accent) inset; }
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

  /* Her, on stage: the supplied Haru artwork, one SVG per emotion, put into the
     page as itself and crossfaded. Square, sized by --avatar-size, never
     stretched; the black square the files ship behind her is hidden here, so
     she sits on whatever the page is, light or dark. The float lives on the
     outer element and never restarts; the settle on a change of face and the
     pop when she talks live on the body inside it. Her eyes carry a transform
     that two variables move, eased, wherever her attention is. */
  @property --idle-bob { syntax:'<length>'; inherits:false; initial-value:4px; }
  @property --idle-sway { syntax:'<angle>'; inherits:false; initial-value:1.2deg; }
  @property --idle-breath { syntax:'<number>'; inherits:false; initial-value:1.015; }
  @property --gaze-x { syntax:'<length>'; inherits:true; initial-value:0px; }
  @property --gaze-y { syntax:'<length>'; inherits:true; initial-value:0px; }
  @property --lid { syntax:'<number>'; inherits:true; initial-value:1; }
  @property --tilt { syntax:'<angle>'; inherits:false; initial-value:0deg; }
  @property --drift-x { syntax:'<number>'; inherits:false; initial-value:0; }
  @property --drift-y { syntax:'<number>'; inherits:false; initial-value:0; }
  #stage { flex:0 0 auto; display:flex; justify-content:center; align-items:center; padding:.35rem 1rem 0; cursor:pointer; --avatar-size:min(31vw, 136px); }
  #avatar { position:relative; width:var(--avatar-size); height:var(--avatar-size); transform-origin:50% 62%;
    --idle-bob:4px; --idle-sway:1.2deg; --idle-breath:1.015; --gaze-x:0px; --gaze-y:0px; --lid:1;
    transition:--idle-bob .8s ease, --idle-sway .8s ease, --idle-breath .8s ease, --gaze-x .38s cubic-bezier(0.33, 1, 0.68, 1), --gaze-y .38s cubic-bezier(0.33, 1, 0.68, 1), --lid 70ms ease-in;
    animation:float 3800ms ease-in-out infinite; }
  /* How she holds herself: a cock of the head and a small roam from home,
     eased over a second and a half so a new pose is a movement, not a jump.
     The roam is a fraction of her own size, so it scales with her. */
  #avatar-pose { position:absolute; inset:0; transform-origin:50% 68%; --tilt:0deg; --drift-x:0; --drift-y:0;
    transform:translate(calc(var(--avatar-size) * var(--drift-x)), calc(var(--avatar-size) * var(--drift-y))) rotate(var(--tilt));
    transition:--tilt 1.5s cubic-bezier(0.4, 0, 0.2, 1), --drift-x 1.8s cubic-bezier(0.4, 0, 0.2, 1), --drift-y 1.8s cubic-bezier(0.4, 0, 0.2, 1); }
  #avatar-body { position:absolute; inset:0; transform-origin:50% 60%; }
  #avatar .face { position:absolute; inset:0; opacity:0; }
  #avatar .face svg { display:block; width:100%; height:100%; }
  #avatar .face .backdrop { display:none; }
  /* A glance is a translation; a blink is a squash toward the eye's own middle,
     because the art has no lids to close. */
  #avatar .face .eye { transform:translate(var(--gaze-x), var(--gaze-y)) scaleY(var(--lid)); transform-box:fill-box; transform-origin:center; }
  #avatar .face.missing { visibility:hidden; }
  #avatar-body.changed { animation:settle .45s cubic-bezier(0.33, 1, 0.68, 1); }
  #avatar-body.pop { animation:pop .5s cubic-bezier(0.33, 1, 0.68, 1); }
  #avatar.frozen, #avatar.frozen #avatar-body { animation-play-state:paused; }
  @keyframes float {
    0%, 100% { transform:translateY(calc(var(--idle-bob) * -1)) rotate(calc(var(--idle-sway) * -1)) scale(1); }
    50% { transform:translateY(var(--idle-bob)) rotate(var(--idle-sway)) scale(var(--idle-breath)); }
  }
  @keyframes settle { 0% { scale:.94; } 55% { scale:1.04; } 100% { scale:1; } }
  @keyframes pop { 30% { scale:1.06; } }
  @media (prefers-reduced-motion: reduce) { #avatar, #avatar-pose, #avatar-body { animation:none !important; transition:none !important; } #avatar .face { transition:none !important; } }

  /* A wide window is not a big phone. Stretched across a desktop browser the
     bubbles ran the full 1700px and the text became unreadable at about six
     words a line, so the column is capped at a comfortable measure and centred. */
  @media (min-width: 900px) {
    body { max-width:44rem; margin:0 auto; }
    #out { position:fixed; top:1rem; right:1.5rem; z-index:3; }
    .msg { max-width:min(82%, 46rem); }
  }
</style>
<div class=topbar><span class=dot></span><span class=name>Haru</span><span id=net hidden>Offline</span><span id=talk hidden></span><button id=bell title="Notifications">🔔</button><button id=out>Sign out</button></div>
<div id=psheet hidden><div id=pushpart></div><div id=wherepart></div></div>
<section id=stage></section>
<nav aria-label="Conversation mode" style="display:flex;gap:12px;padding:8px 16px"><span aria-current="page">Haru</span><button id="refresh-chat" type="button" aria-label="Refresh chat">Refresh chat</button><a href="/gmail" style="color:inherit">Gmail</a><a href="/mail" style="color:inherit">Mail</a><a href="/characters" style="color:inherit">Character</a><a href="/voice-identity" style="color:inherit">My voice</a><a href="/emotion-settings" style="color:inherit">Feelings</a></nav><div class=tabs role=tablist><button id=tab-chat role=tab aria-selected=true aria-controls=chat>Chat</button><button id=tab-her role=tab aria-selected=false aria-controls=status>Her</button><button id=tab-diary role=tab aria-selected=false aria-controls=diary>Diary</button><a href="/world" style="align-self:center;padding:8px 14px;color:inherit;text-decoration:none;font-size:13px">World ↗</a></div>
<div id=credit-status role=status aria-live=polite hidden></div>
<section id=chat></section>
<section id=status hidden aria-labelledby=tab-her></section>
<section id=diary hidden aria-labelledby=tab-diary></section>
<div id=chips></div>
<form class=compose id=cf><button type=button id=att class=icon title="Attach a file">📎</button><button type=button id=mic class=icon title="Tap to talk with her; tap again to stop">🎙</button><textarea id=ci rows=1 placeholder="Say something…"></textarea><button id=cb>Send</button></form>
<input type=file id=af multiple hidden>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The same handful of marks she writes on the desktop, applied to text that has
// already been escaped — so the only tags that can ever reach the page are the
// three put there here.
// A directions link she attached (directions.ts) becomes a button that opens
// the phone's own maps: the link is Apple Maps, which an iPhone opens as the
// app; anything else is sent to Google Maps with the same destination. Only
// those two hosts are ever made clickable — her words are text, not markup.
function mapsHref(u){
  const raw=u.replace(/&amp;/g,'&');
  const m=raw.match(/^https:\\/\\/maps\\.apple\\.com\\/\\?daddr=(-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?)/);
  const href=m&&!/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)?'https://www.google.com/maps/dir/?api=1&destination='+m[1]+','+m[2]:raw;
  return href.replace(/&/g,'&amp;');
}
const md=s=>s.replace(/\\[([^\\]\\n]+)\\]\\((https:\\/\\/(?:maps\\.apple\\.com|www\\.google\\.com\\/maps)\\/[^)\\s]*)\\)/g,(m,t,u)=>'<a class=maps href="'+mapsHref(u)+'" target=_blank rel="noopener">🗺️ '+t+'</a>').replace(/\\*\\*\\s*([^*]+?)\\s*\\*\\*/g,'<b>$1</b>').replace(/\`([^\`\\n]+?)\`/g,'<code>$1</code>').replace(/\\*([^*\\s][^*\\n]*?)\\*/g,'<i>$1</i>');
${PHONE}
${VOICE}
const get=u=>window.haruNet.fetch(u).then(r=>r.ok?r.json():Promise.reject(r));
const post=(u,b)=>window.haruNet.fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.ok?r.json():Promise.reject(r));
// Render Core's status without deriving a threshold or selecting a model here.
async function refreshCreditStatus(){
  try{
    const status=await get('/api/funding'), el=$('credit-status');
    if(typeof status.notice!=='string'||status.notice.length>2048) return;
    el.textContent=status.notice; el.hidden=!status.notice;
  }catch{ /* Keep the last observed status through a temporary transport loss. */ }
}
void refreshCreditStatus();
setInterval(refreshCreditStatus,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshCreditStatus();});

// ---- Shadow input evidence -------------------------------------------------
// Report only actual page input, never opening, visibility or a timer. Native
// fetch deliberately bypasses the network helper's retry path: stale input
// must not be queued and delivered as fresh evidence after reconnecting.
(()=>{
  let last=-Infinity, busy=false;
  if(typeof crypto==='undefined'||!crypto.getRandomValues) return;
  const client=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  let sequence=0;
  const report=async event=>{
    if(event.isTrusted!==true||document.visibilityState!=='visible'||busy) return;
    const now=performance.now();
    if(now-last<30_000) return;
    last=now; busy=true;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),5000);
    try{
      await fetch('/api/attention/input',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({kind:'input',client,sequence:++sequence}),signal:controller.signal});
    }catch{}finally{ clearTimeout(timeout); busy=false; }
  };
  for(const type of ['pointerdown','keydown','input','wheel']) document.addEventListener(type,report,{passive:true});
})();
// ---- End shadow input evidence ---------------------------------------------

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
  const last=[...list].reverse().find(m=>m.role==='assistant'&&m.id&&!m.aside);
  $('chat').innerHTML = list.map(m=>{
    const cls = m.role==='user'?'me':m.role==='assistant'?(m.aside?'them aside':'them'):'sys';
    // Her replies come as the messages she sent them as — one bubble a paragraph.
    const parts=(m.role==='assistant'&&!m.aside)?String(m.content).split('\\n\\n').map(p=>p.trim()).filter(Boolean):[];
    let html=(parts.length?parts:[m.content]).map(p=>'<div class="msg '+cls+'">'+md(esc(p))+'</div>').join('');
    // A line she said on her own is not a reply: nothing to rate or ask again.
    if(m.role==='assistant'&&m.id&&!m.aside) html+=acts(m,m===last);
    if(m.role==='assistant'&&m.id&&m.aside&&(m.nudge||['idle','thought','hanging'].includes(m.aside))) html+=nudgeFeedbackButtons(m);
    return html;
  }).join('') || '<p class=quiet>Nothing yet today.</p>';
  if(pendingSend){
    $('chat').insertAdjacentHTML('beforeend','<div class="msg me">'+esc(pendingSend.text||'📎 Attachment')+'</div><div class="msg sys" id="delivery-status">Checking the message already sent…</div>');
  }else if(deliveryNotice) deliveryStatus(deliveryNotice);
  $('chat').scrollTop = $('chat').scrollHeight;
}
// What they thought of a reply, and asking again — the latter only under the
// last one, because only the last one can be done again. The id is the stored
// message's, handed out by the desk, so a rating names a reply rather than
// quoting it. A note already given is shown; otherwise there is a pen.
function nudgeFeedbackButtons(m){
  return '<div class="acts nudge-feedback" role="group" aria-label="Feedback on this nudge" data-id="'+esc(m.id)+'">'
    +[['more','More like this'],['less','Less like this'],['discussed','Already discussed']].map(([choice,label])=>
      '<button type="button" data-act="nudge-'+choice+'" aria-pressed="'+(m.nudgeFeedback===choice)+'">'+label+'</button>').join('')+'</div>';
}
function acts(m,isLast){
  const on=r=>m.reaction===r?' class=on':'';
  // What is already on the reply stays in view beside the arrow — a thumb, an
  // emoji — so the state is not hidden with the buttons.
  const worn=(m.reaction==='up'?'<span class=reacted title="Marked good">👍</span>':m.reaction==='down'?'<span class=reacted title="Marked poor">👎</span>':'');
  return '<div class=acts data-id="'+esc(m.id)+'">'
    +'<button type=button class=more data-act=more title="Rate, react, ask again">▾</button>'+worn
    +'<span class=dock hidden>'
    +'<button type=button data-act=up'+on('up')+' title="Good">👍</button>'
    +'<button type=button data-act=down'+on('down')+' title="Poor">👎</button>'
    +(m.note?'<span class=said>'+esc(m.note)+'</span>':'<button type=button data-act=note title="Tell her why">✎</button>')
    +(isLast?'<button type=button data-act=again title="Ask her again">↻</button>':'')
    // Not shown as given, the way a note is: a tuning note is never put on the
    // message, so the page has nothing to show back and the pen stays out.
    +'<button type=button data-act=tune title="Log what was wrong — she never sees it">✍</button>'
    +'</span></div>';
}

async function load(poll){
  try{
    const {messages}=await get(poll?'/api/chat?poll=1':'/api/chat');
    if(activeDelivery&&!activeDelivery.settled) return;
    bubbles(messages); showingSaved=false;
    // Today, as last seen: painted at once next time, and read when she is out of reach.
    window.haruKeep.set('today',{savedAt:Date.now(),messages});
    return messages;
  }catch(r){
    if(r&&r.status===401){ location.reload(); return; }
    // Nothing live on screen yet: the saved day, with a note saying so. What is
    // already on screen is newer than anything saved and stays.
    if(showingSaved||!$('chat').querySelector('.msg')) showSaved(true);
  }
}
// The day as this phone last saw it. Returns whether there was one to show.
let showingSaved=false;
function showSaved(note){
  const saved=window.haruKeep.get('today',null);
  if(!saved||!Array.isArray(saved.messages)||!saved.messages.length) return false;
  bubbles(saved.messages); showingSaved=true;
  if(note){
    const when=new Date(saved.savedAt), today=new Date().toDateString()===when.toDateString();
    const stamp=today?when.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):when.toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">As saved on this phone, '+stamp+'. She is out of reach.</div>');
    $('chat').scrollTop=$('chat').scrollHeight;
  }
  return true;
}

const ci=$('ci');
// Whatever was being typed when the page went away is there when it comes back.
ci.value=window.haruKeep.get('draft','')||'';
if(ci.value){ ci.style.height='auto'; ci.style.height=Math.min(ci.scrollHeight,112)+'px'; }

// The dot dims and a pill says so when she cannot be reached; when she can be
// again, the day is re-read so nothing sent from elsewhere is missed.
let wasOut=false;
window.haruNet.onChange(s=>{
  $('net').hidden=s==='on';
  $('net').textContent=s==='off'?'Offline':'Out of reach';
  document.querySelector('.topbar').classList.toggle('off',s!=='on');
  if(s==='on'&&wasOut) void load(true);
  wasOut=s!=='on';
});

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
// Counts the lines she has been asked to say, so a tap on her can drop one that
// is still being fetched as well as stop one already playing.
let speaking=0;
function primeVoice(){ player.play().catch(()=>{}); player.pause(); }
// With the mood the line was said in, when known: the voice side picks the
// clip for it. Resolves to whether she actually started to say it.
// Sentence-sized, so the first one can be spoken while the rest is still being
// made. The server renders about a fifth of realtime, which for a four-sentence
// reply is five seconds of silence before a word — asked for a sentence at a
// time it is closer to one, and she is talking while the rest arrives.
function sayable(text){
  const out=[];
  for(const para of String(text||'').split(/\\n\\s*\\n/)){
    const parts=[]; let current='';
    for(const sentence of para.split(/(?<=[.!?\u2026])\\s+/)){
      if(!sentence.trim()) continue;
      if(!current) current=sentence;
      else if(current.length+sentence.length+1<=180) current+=' '+sentence;
      else { parts.push(current); current=sentence; }
    }
    if(current) parts.push(current);
    // A breath between sentences and a longer one where she changed the
    // subject: run together they were a person reading, not talking.
    // Where she changed the subject she may sigh first — one of her own recorded
    // breaths, played in the gap — and now and then before she starts at all.
    if(out.length&&parts.length&&Math.random()<0.55) out.push({ sigh:true, pause: 140 });
    else if(!out.length&&parts.length>1&&Math.random()<0.12) out.push({ sigh:true, pause: 120 });
    parts.forEach((part,i)=>{ if(/[\\p{Letter}\\p{Number}]/u.test(part)) out.push({ text: part, pause: i===parts.length-1 ? 520 : 260 }); });
  }
  if(out.length) out[out.length-1].pause=0;
  return out;
}
function fetchClip(part,emotion,prefetch){
  // A sigh is asked for by name and fetched whole.
  if(part.sigh) return fetch('/api/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sigh:true,emotion:emotion||null})})
    .then(r=>r.ok?r.blob():null)
    .catch(()=>null);
  const q='/api/speak?text='+encodeURIComponent(part.text)+(emotion?'&emotion='+encodeURIComponent(emotion):'');
  // Asked for while the sentence before it plays, the clip is pulled whole
  // now, so Hume renders it under her previous sentence and the seam is a
  // beat rather than the first-byte wait again. Handing back a URL here did
  // nothing until the player was pointed at it, which was only ever after the
  // last sentence had ended — every break paid the whole wait.
  if(prefetch) return fetch(q).then(r=>r.ok?r.blob():null).catch(()=>null);
  // Asked for on the spot, it streams: a GET the <audio> element plays
  // progressively, so the first sound is the first bytes Hume sends.
  return Promise.resolve({stream:q});
}
// A clip to point the player at: a stream URL plays as it arrives, a blob gets
// an object URL that must be revoked when done.
function clipUrl(clip){
  if(!clip) return null;
  if(clip.stream) return { url: clip.stream, blob: false };
  return { url: URL.createObjectURL(clip), blob: true };
}
async function speak(text,emotion){
  const mine=++speaking;
  try{
    player.pause();
    const parts=sayable(text);
    if(!parts.length) return false;
    // The next one is asked for the moment this one starts playing, so the gap
    // between sentences is the render that was already happening.
    let pending=fetchClip(parts[0],emotion);
    let started=false;
    for(let i=0;i<parts.length;i++){
      const clip=await pending;
      if(mine!==speaking) return started;
      // One sentence failing is not a reason to swallow the rest of what she
      // said: it used to return here, so a single hiccup halfway through left
      // her cut off mid-thought with no sign anything had gone wrong.
      pending=i+1<parts.length?fetchClip(parts[i+1],emotion,true):null;
      const made=clipUrl(clip);
      if(!made){ if(!parts[i].sigh) console.warn('[voice] no audio for one sentence — carrying on'); continue; }
      const done=new Promise(resolve=>{ player.onended=player.onerror=()=>{ if(made.blob) URL.revokeObjectURL(made.url); resolve(); }; });
      try{
        player.src=made.url;
        await player.play();
        started=true;
        await done;
      }catch(e){ if(made.blob) URL.revokeObjectURL(made.url); console.warn('[voice] a sentence would not play — carrying on'); }
      if(mine!==speaking) return true;
      if(parts[i].pause) await new Promise(r=>setTimeout(r,parts[i].pause));
      if(mine!==speaking) return true;
    }
    return started;
  }catch(e){ console.warn('[voice] '+(e&&e.message||e)); return false; }
}
// Her voice, sentence by sentence as the stream delivers them — the reply is
// spoken while it is still being written instead of after it lands. One drain
// loop plays the queue in order, asking for each clip while the one before it
// is still playing, so the gap between sentences is the synthesis already
// underway rather than a wait for it. stopVoice() abandons the queue — a
// round that was thrown away, a final reply that rewrote the stream, a hand
// over her mouth — by bumping the same counter speak() checks.
let voiceQueue=[], voiceEmotion=null, voiceDraining=false;
function stopVoice(){ speaking++; voiceQueue=[]; player.pause(); }
function voiceFeed(sentence,emotion){
  if(!sentence||!sentence.trim()) return;
  cancelBreath();
  if(emotion) voiceEmotion=emotion;
  voiceQueue.push({text:sentence});
  drainVoice();
}
async function drainVoice(){
  if(voiceDraining) return;
  voiceDraining=true;
  let started=false;
  try{
    if(!voiceQueue.length) return;
    // What is in flight, and which sentence it is for. A sentence that
    // arrived while the one before it was playing has nothing in flight —
    // it used to be played as nothing at all, "no audio for a streamed
    // sentence", and dropped — so it is asked for on the spot, streaming.
    let pending=null, pendingFor=null;
    const ask=(part,prefetch)=>{ pendingFor=part; pending=fetchClip(part,voiceEmotion,prefetch); };
    ask(voiceQueue[0],false);
    while(voiceQueue.length){
      const part=voiceQueue.shift();
      const mine=speaking;
      if(pendingFor!==part) ask(part,false);
      const clip=await pending;
      if(mine!==speaking) return;
      if(voiceQueue.length) ask(voiceQueue[0],true); else { pending=null; pendingFor=null; }
      const made=clipUrl(clip);
      if(!made){ console.warn('[voice] no audio for a streamed sentence — carrying on'); continue; }
      const done=new Promise(resolve=>{ player.onended=player.onerror=()=>{ if(made.blob) URL.revokeObjectURL(made.url); resolve(); }; });
      try{
        player.src=made.url;
        await player.play();
        started=true;
        await done;
      }catch(e){ if(made.blob) URL.revokeObjectURL(made.url); console.warn('[voice] a streamed sentence would not play — carrying on'); }
      if(mine!==speaking) return;
    }
  } finally { voiceDraining=false; }
  // Nothing of hers was ever heard — close the ear that was opened for her.
  if(!started&&talk) act(talk.spokeEnd(now()));
}
// A breath of hers for the gap before she answers: the message has been sent,
// the bubble is up, and the model is thinking in silence. One of her recorded
// sighs, played once and cut short the moment a real sentence arrives — a
// quick-hit reply lands inside half a second and never hears it, a full reply
// gets the beat. Fetched from /api/speak like any other clip, so a phone with
// her voice off hears nothing at all.
let breathPending=false, breathTimer=null;
function cancelBreath(){ breathPending=false; if(breathTimer){ clearTimeout(breathTimer); breathTimer=null; } }
function breath(){
  fetch('/api/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sigh:true,emotion:null})})
    .then(r=>r.ok?r.blob():null).catch(()=>null)
    .then(blob=>{
      if(!blob) return;
      const url=URL.createObjectURL(blob);
      const done=new Promise(resolve=>{ player.onended=player.onerror=()=>{ URL.revokeObjectURL(url); resolve(); }; });
      try{ player.src=url; player.play().catch(()=>URL.revokeObjectURL(url)); }catch(e){ URL.revokeObjectURL(url); }
      void done;
    });
}
// The breath is armed on send and fired only if no sentence has arrived by
// the time it is due — see deliver().
function armBreath(){
  cancelBreath();
  breathPending=true;
  breathTimer=setTimeout(()=>{ breathPending=false; breathTimer=null; breath(); }, 600);
}
// A tap on her. Mid-sentence it is a hand over her mouth: whatever she is
// saying stops, whatever she was about to say is dropped, and she pulls the
// "!" — cut off, and not happy about it. Otherwise it is a poke, and she
// bursts or spins, whichever the tap lands on.
function hush(){
  const talking=!player.paused&&!player.ended;
  speaking++;
  player.pause();
  if(talking&&talk) act(talk.spokeEnd(now()));
  if(!window.haruAvatar) return;
  if(talking) window.haruAvatar.poke('exclaim');
  else window.haruAvatar.poke(Math.random()<0.5?'burst':'orbit');
}
$('stage').addEventListener('click',hush);


ci.addEventListener('input',()=>{ci.style.height='auto';ci.style.height=Math.min(ci.scrollHeight,112)+'px'; window.haruKeep.set('draft',ci.value||null); if(window.haruAvatar) window.haruAvatar.attend('typing',1800);});
// A finger in the box is her cue as much as a word in it.
ci.addEventListener('focus',()=>{ if(window.haruAvatar) window.haruAvatar.attend('typing',1800); });
// Counts sends, only so each waiting bubble can be told from the last one.
let waiting=0;
let activeDelivery=null, recoveryBusy=false, deliveryNotice='';
let pendingSend=window.haruKeep.get('pendingSend',null);
if(pendingSend&&(!/^[a-zA-Z0-9-]{16,80}$/.test(pendingSend.id)||typeof pendingSend.text!=='string'||!Array.isArray(pendingSend.files))){
  pendingSend=null; window.haruKeep.drop('pendingSend');
}
function deliveryStatus(text){
  deliveryNotice=text;
  let el=$('delivery-status');
  if(!el){ el=document.createElement('div'); el.id='delivery-status'; el.className='msg sys'; $('chat').appendChild(el); }
  el.textContent=text;
}
// Status reads never re-send the message or repeat its tools. Kept across an
// iOS tab suspension/reload, independently of the original streaming socket.
async function recoverPending(){
  if(!pendingSend||recoveryBusy||document.hidden) return;
  const pending=pendingSend;
  recoveryBusy=true;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await window.haruNet.fetch('/api/chat/receipt?id='+encodeURIComponent(pending.id),{signal:controller.signal});
    if(response.status===401){ location.reload(); return; }
    if(!response.ok&&response.status!==404) throw new Error('receipt unavailable');
    const receipt=await response.json();
    if(pendingSend!==pending) return;
    if(receipt.state==='pending'){
      $('cb').disabled=true;
      deliveryStatus('She received your message and is still replying.');
      return;
    }
    const recovering=activeDelivery&&activeDelivery.id===pending.id?activeDelivery:null;
    if(activeDelivery&&activeDelivery.id===pending.id){ activeDelivery.settled=true; activeDelivery.controller.abort(); }
    stopVoice(); cancelBreath();
    pendingSend=null; deliveryNotice=''; window.haruKeep.drop('pendingSend'); $('cb').disabled=false;
    const messages=await load(true);
    if(pendingSend) return; // a new turn started while history was loading
    if(receipt.state==='done'){
      if(receipt.ignored) deliveryStatus('She is not answering that.');
      else if(receipt.reply&&(!messages||!messages.some(m=>m.role==='assistant'&&m.content===receipt.reply))){
        $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(receipt.reply)+'</div>');
      }
      if(recovering){if(receipt.ignored) recovering.observe('ignored'); else recovering.rendered(receipt.reply);}
    }else{
      if(recovering) recovering.observe('failed');
      // A restart or expired receipt cannot prove a send failed. Do not retry
      // automatically; preserve the words and make the uncertainty explicit.
      window.haruKeep.set('unconfirmedSend',pending);
      if(!ci.value&&pending.text){ ci.value=pending.text; window.haruKeep.set('draft',pending.text); }
      if(pending.files&&pending.files.length){ staged=pending.files.concat(staged); drawChips(); }
      deliveryStatus(receipt.state==='error'?'Her reply failed. Check the conversation before sending again.':'Delivery could not be confirmed. Check the conversation before sending again; your message has been kept.');
    }
  }catch{
    if(pendingSend===pending) deliveryStatus('Connection interrupted. Your message is kept; checking its delivery when reachable.');
  }finally{ clearTimeout(timer); recoveryBusy=false; }
}
setInterval(()=>{ if(pendingSend) void recoverPending(); },5000);
// One reader for both ways a reply arrives — a send and a retry. Words land
// through show() as the stream delivers them; a U+FFFD means the round was
// thrown away and the bubble goes back to waiting.
// Paragraphs are messages. A rant used to land as one wall; now it lands as
// the two or three bubbles she would actually have sent, the first in the
// waiting bubble and the rest after it as the stream reaches each blank line.
function paint(id,t){
  const first=document.getElementById(id); if(!first) return false;
  let parts=String(t).split('\\n\\n').map(p=>p.trim()).filter(Boolean);
  if(!parts.length) parts=[String(t)];
  first.textContent=parts[0];
  let prev=first;
  parts.slice(1).forEach((p,n)=>{
    let el=document.getElementById(id+'-'+(n+1));
    if(!el){ el=document.createElement('div'); el.className='msg them'; el.id=id+'-'+(n+1); prev.insertAdjacentElement('afterend',el); }
    el.textContent=p; prev=el;
  });
  let extra=parts.length, stale;
  while((stale=document.getElementById(id+'-'+extra))){ stale.remove(); extra++; }
  $('chat').scrollTop=$('chat').scrollHeight; return true;
}
async function readStream(r,show){
  const reader=r.body.getReader(); const dec=new TextDecoder();
  let buf='',said='',reply=null,ignored=false,error=null,completed=false;
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
      else if(ev.text==='\uFFFD'){ said=''; show('…'); stopVoice(); cancelBreath(); }
      else if(ev.sentence){ voiceFeed(ev.sentence,ev.emotion); }
      else if(ev.text){ said+=ev.text; show(said); }
      else if(ev.done){ reply=ev.reply; ignored=Boolean(ev.ignored); completed=true; }
    }
    if(completed||error){ void reader.cancel().catch(()=>{}); break; }
  }
  if(!completed&&!error) throw new Error('The reply stream was interrupted before completion.');
  return {reply,ignored,error,said};
}

// What a message becomes once it is sent, whether typed or spoken: the
// bubbles, the stream, her face, her voice, and the conversation told where
// things stand. "interrupted" says they spoke over her to say it.
async function deliver(text,sent,{interrupted=false}={}){
  if(pendingSend){
    if(text&&!ci.value){ ci.value=text; window.haruKeep.set('draft',text); }
    if(sent.length){ staged=sent.concat(staged); drawChips(); }
    deliveryStatus('Still checking the previous message; your next message is kept in the box.'); return;
  }
  const requestId=crypto.randomUUID();
  const submittedAt=performance.now();
  let firstTextMs=null,foreground=!document.hidden,observed=false;
  const visibility=()=>{if(document.hidden) foreground=false;};
  document.addEventListener('visibilitychange',visibility);
  const observe=(outcome,chars=0,frames=0)=>{
    if(observed) return; observed=true;
    document.removeEventListener('visibilitychange',visibility);
    const elapsedMs=performance.now()-submittedAt;
    post('/api/chat/observe',{requestId,observation:{surface:'web',outcome,elapsedMs,firstTextMs,
      completeRenderMs:outcome==='rendered'?elapsedMs:null,foreground,renderedChars:chars,frames}}).catch(()=>{});
  };
  const rendered=reply=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const children=Array.from($('chat').children),lastMe=children.map(e=>e.classList.contains('me')).lastIndexOf(true);
    const shown=children.slice(lastMe+1).filter(e=>e.classList.contains('them')).map(e=>e.textContent).join(' ');
    const normal=t=>String(t||'').replace(/\\s+/g,' ').trim();
    observe(normal(shown)===normal(reply)&&normal(reply)?'rendered':'failed',String(reply||'').length,2);
  }));
  deliveryNotice='';
  const operation={id:requestId,controller:new AbortController(),settled:false,observe,rendered};
  activeDelivery=operation;
  pendingSend={id:requestId,text,files:sent,at:Date.now()};
  window.haruKeep.set('pendingSend',pendingSend);
  const streamTimer=setTimeout(()=>operation.controller.abort(),120000);
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
  if(window.haruAvatar) window.haruAvatar.think();
  // A breath of hers, if the answer does not arrive quickly — armed now, fired
  // only if no sentence has streamed in by the time it is due, so a quick-hit
  // reply never hears it over itself.
  armBreath();
  const stopWaiting=()=>{const bubble=document.getElementById(id); if(bubble) bubble.remove(); document.querySelectorAll('[id^="'+id+'-"]').forEach(e=>e.remove());};
  // The waiting bubble doubles as the reply bubble: words land in it as the
  // stream delivers them, and the final processed reply replaces them when the
  // stream ends. textContent rather than innerHTML — her words are text, not
  // markup, and the model is not a source we escape from, it is the source.
  const show=t=>{paint(id,t);if(t&&firstTextMs===null) requestAnimationFrame(()=>{if(firstTextMs===null) firstTextMs=performance.now()-submittedAt;});};
  try{
    const r=await window.haruNet.fetch('/api/chat/stream',{method:'POST',signal:operation.controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign(sent.length?{text,attachments:sent}:{text},{requestId},interrupted?{interrupted:true}:{}))});
    if(!r.ok) throw r;
    const {reply,ignored,error,said}=await readStream(r,show);
    if(operation.settled) return;
    if(error) throw new Error(error);
    operation.settled=true;
    pendingSend=null; deliveryNotice=''; window.haruKeep.drop('pendingSend');
    if(ignored){
      observe('ignored');
      // Whatever she was about to say does not exist: the bubble goes, the note
      // takes its place, and nothing is spoken.
      stopVoice();
      cancelBreath();
      stopWaiting();
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">She is not answering that.</div>');
      if(talk) act(talk.replied(now(),false));
    } else {
      // The processed reply is the one that counts — the stream can carry words
      // she later trims as repetition — so it replaces what was shown.
      if(reply!==null) show(reply);
      rendered(reply);
      if(reply){
        // Her voice started with the stream, sentence by sentence; only the
        // face waits for a classifier now, and the words are already on screen.
        if(window.haruAvatar) window.haruAvatar.notify();
        if(talk) act(talk.replied(now(),true));
        const mood=post('/api/expression',{text:reply}).then(r=>{ if(window.haruAvatar) window.haruAvatar.express(r.emotion); return r.emotion; }).catch(()=>null);
        // The voice has been speaking the streamed words. When the processed
        // reply differs from what streamed — a filter trimmed it — the streamed
        // words are cut off and the reply that counts is said instead.
        if(reply.trim()!==said.trim()){
          stopVoice();
          mood.then(emotion=>speak(reply,emotion||voiceEmotion)).then(started=>{ if(!started&&talk) act(talk.spokeEnd(now())); });
        }
      }
    }
  }catch(r){
    if(operation.settled) return;
    observe(operation.controller.signal.aborted?'cancelled':'failed');
    stopVoice();
    cancelBreath();
    stopWaiting();
    if(talk) act(talk.replied(now(),false));
    if(r&&r.status===401){location.reload();return;}
    deliveryStatus('The reply connection stopped. Checking whether she received your message…');
    await recoverPending();
  }finally{
    clearTimeout(streamTimer);
    if(activeDelivery===operation) activeDelivery=null;
    $('cb').disabled=Boolean(pendingSend); $('chat').scrollTop=$('chat').scrollHeight;
    // The desk files the reply and hands it an id a moment later; re-read so
    // the bubble gets its row.
    setTimeout(load,1000);
    // She may have more to say a minute or two after a reply of hers — a
    // second thought, sent on its own — and the four-minute poll is too slow
    // to hear it. A few looks in the minutes after, only while the page is
    // up and she is not mid-answer.
    [25,60,120,180].forEach(sec=>setTimeout(()=>{ if(!document.hidden) refreshIfIdle(); },sec*1000));
  }
}

$('cf').addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(pendingSend||$('cb').disabled) return;
  const text=ci.value.trim(); if(!text&&!staged.length)return;
  // Nothing leaves an offline phone; the words stay in the box (and in the
  // draft) rather than turning into a bubble that then fails.
  if(!window.haruNet.online()){
    $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">You are '+(window.haruNet.state()==='off'?'offline':'out of her reach')+'. It is kept in the box until you are back.</div>');
    $('chat').scrollTop=$('chat').scrollHeight; return;
  }
  primeVoice();
  // Taken off the shelf now, so a file picked while she is answering belongs to
  // the next message, not this one. Put back if the send never got through.
  const sent=staged; staged=[]; drawChips();
  ci.value=''; ci.style.height='auto'; $('cb').disabled=true; window.haruKeep.drop('draft');
  await deliver(text,sent,{});
});
// The saved day first, so the page is never blank while the real one loads.
showSaved(false);
load();
if(pendingSend){ $('cb').disabled=true; void recoverPending(); }

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
  if(window.haruAvatar) window.haruAvatar.think();
  const show=t=>paint(id,t);
  show('…');
  armBreath();
  try{
    const r=await fetch('/api/chat/retry',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!r.ok) throw r;
    const {reply,ignored,error,said}=await readStream(r,show);
    if(error) throw new Error(error);
    if(ignored){
      stopVoice();
      cancelBreath();
      const bubble=document.getElementById(id); if(bubble) bubble.remove();
      $('chat').insertAdjacentHTML('beforeend','<div class="msg sys">She is not answering that.</div>');
    } else if(reply!==null){
      show(reply);
      if(reply){
        if(window.haruAvatar){ window.haruAvatar.notify(); post('/api/expression',{text:reply}).then(x=>window.haruAvatar.express(x.emotion)).catch(()=>{}); }
        // The voice streamed with the reply; only a rewritten final is said
        // again, the same way deliver does it.
        if(reply.trim()!==said.trim()){ stopVoice(); void speak(reply); }
      }
    }
  }catch(r){
    stopVoice();
    cancelBreath();
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
  if(act.startsWith('nudge-')){
    const choice=b.getAttribute('aria-pressed')==='true'?null:act.slice(6);
    const buttons=[...row.querySelectorAll('button')];
    for(const button of buttons) button.disabled=true;
    row.querySelector('.feedback-error')?.remove();
    try{
      const result=await post('/api/chat/nudge-feedback',{id,choice});
      for(const button of buttons) button.setAttribute('aria-pressed',String(button.dataset.act==='nudge-'+result.choice));
    }catch(error){
      if(error&&error.status===401){location.reload();return;}
      const note=document.createElement('span'); note.className='feedback-error'; note.setAttribute('role','alert');
      note.textContent='Could not save feedback. Try again.'; row.appendChild(note);
    }finally{ for(const button of buttons) button.disabled=false; }
    return;
  }
  if(act==='more'){
    // One open at a time: the arrow is a drawer, not a setting.
    const dock=row.querySelector('.dock'); const opening=dock.hidden;
    for(const other of $('chat').querySelectorAll('.acts')){ const d=other.querySelector('.dock'); if(d){ d.hidden=true; } const a=other.querySelector('.more'); if(a){ a.classList.remove('open'); a.textContent='▾'; } }
    if(opening){ dock.hidden=false; b.classList.add('open'); b.textContent='▴'; }
    return;
  }
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
  // What was wrong with it, and what it should have been. This one is not for
  // her — it goes to the tuning log on the desk and nothing else — so it says
  // so on the tin and she never answers it.
  if(act==='tune'){
    const box=document.createElement('span'); box.className='tune';
    const wrong=document.createElement('input'); wrong.placeholder='What was wrong…'; wrong.maxLength=1000;
    const rather=document.createElement('input'); rather.placeholder='What she should have said (optional)…'; rather.maxLength=4000;
    const save=document.createElement('button'); save.type='button'; save.textContent='log';
    box.append(wrong,rather,save);
    b.replaceWith(box); wrong.focus();
    const log=async()=>{
      const w=wrong.value.trim(), r=rather.value.trim();
      if(!w&&!r) return;
      box.querySelector('.tuning-error')?.remove();
      save.disabled=wrong.disabled=rather.disabled=true;
      try{
        await post('/api/chat/tune',{id,wrong:w,rather:r});
        const said=document.createElement('span'); said.className='said'; said.textContent='logged'+(w?': '+w:'')+(r?' (+ a rewrite)':'');
        box.replaceWith(said);
      }catch(r2){
        if(r2&&r2.status===401){location.reload();return;}
        save.disabled=wrong.disabled=rather.disabled=false;
        const error=document.createElement('span'); error.className='tuning-error'; error.setAttribute('role','alert');
        error.textContent='Could not confirm the save. Your text is still here. Check saved notes before trying again.'; box.appendChild(error);
      }
    };
    save.addEventListener('click',log);
    for(const field of [wrong,rather]) field.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); void log(); } });
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
        if(window.haruAvatar){ window.haruAvatar.notify(); post('/api/expression',{text:line}).then(x=>window.haruAvatar.express(x.emotion)).catch(()=>{}); }
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
    if(window.haruAvatar){
      window.haruAvatar.notify();
      post('/api/expression',{text:line}).then(r=>window.haruAvatar.express(r.emotion)).catch(()=>{});
    }
    void speak(line);
  }catch(r){ if(r&&r.status===401) location.reload(); }
}
setTimeout(askIfSheHasSomethingToSay,1500);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ refreshIfIdle(true); askIfSheHasSomethingToSay(); } });
window.addEventListener('pageshow',e=>{ if(e.persisted) refreshIfIdle(true); });
// Re-read the day unless she is mid-answer, when the stream on screen is newer
// than anything the server would hand back.
// opened: the page came back in front of them; anything else is the page checking on its own.
$('refresh-chat').onclick=async()=>{
  const button=$('refresh-chat');button.disabled=true;button.textContent='Refreshing…';
  try{await recoverPending();await load(true);}
  finally{button.disabled=false;button.textContent='Refresh chat';}
};
function refreshIfIdle(opened){ if($('cb').disabled){ void recoverPending(); return; } void load(!opened); }
// Four minutes: she is being carried around, not watched. Anything faster reads
// as pestering, and the spacing on her side would refuse it anyway.
setInterval(askIfSheHasSomethingToSay,4*60_000);

// ---- Being told about her when nothing of hers is open ---------------------
// ---- The second tab: where you stand with her ------------------------------
//
// Everything on this screen is state she already had and nobody could see —
// the vitals that drift on their own, the patience the conversation burns, the
// grudge counted each evening. Read-only on purpose: it is a window on her, not
// a set of dials, and a slider that set her affection would make the number
// mean nothing.
const STATUS_EVERY=45000;
let statusTimer=null;

// Two of these read backwards: a full stress bar is bad news, and so is a full
// ego. Colour says which, because a bar that is only ever accent-coloured makes
// "wound up" look like an achievement.
function tone(key,value){
  if(key==='stress'||key==='sleepiness'||key==='ego') return value>=60?'warm':'cool';
  return '';
}
function meterRow(m){
  return '<div class=meter><div class=top><b>'+esc(m.label)+'</b><span>'+m.value+'%</span></div>'
    +'<div class="bar '+tone(m.key,m.value)+'"><i style="width:'+m.value+'%"></i></div>'
    +'<p class=why>'+esc(m.note)+'</p></div>';
}
function agoWords(mins){
  if(mins===null||mins===undefined) return 'not yet';
  if(mins<1) return 'just now';
  if(mins<60) return mins+' min ago';
  // Floored, not rounded: ninety minutes ago is an hour and a half ago, and
  // "2 hours ago" for something that has not been two hours reads as wrong.
  const h=Math.floor(mins/60);
  if(h<24) return h+(h===1?' hour ago':' hours ago');
  const d=Math.floor(h/24);
  return d+(d===1?' day ago':' days ago');
}
function drawStatus(s){
  const facts=[];
  facts.push('Known you <b>'+s.knownDays+'</b> day'+(s.knownDays===1?'':'s'));
  facts.push('Spoken on <b>'+s.daysTalked+'</b> of them');
  facts.push('Last word <b>'+agoWords(s.minutesSinceSpoke)+'</b>');
  let html='<h2>'+esc(s.emotion.charAt(0).toUpperCase()+s.emotion.slice(1))+'</h2>'
    +'<p class=said>'+esc(s.mood)+'</p>'
    +'<div class="card bond"><span class=rank>'+s.bond.level+' / '+s.bond.of+'</span>'
      +'<div class=title>'+esc(s.bond.title)+'</div>'
      +'<p class=note>'+esc(s.bond.note)+'</p>'
      +'<div class=bar><i style="width:'+s.bond.value+'%"></i></div>'
      +'<p class=why>'+(s.bond.toNext>0?esc(s.bond.toNext+' to go before she thaws further.'):'As far as this goes.')+'</p></div>'
    +'<div class=card><h3>Right now</h3>'+meterRow(s.patience)+meterRow(s.grudgeMeter)+'</div>'
    +'<div class=card><h3>How she is</h3>'+s.meters.map(meterRow).join('')+'</div>';
  if(s.waiting.length){
    html+='<div class=card><h3>Waiting on you</h3>'+todoList(s.waiting)+'</div>';
  }
  // Kept apart rather than dropped. She has stopped asking about these — the
  // same window she uses to decide whether to chase — so listing them beside
  // the live ones said she was still waiting when she was not, and hiding them
  // outright is how three finished chores sat in the store for a week.
  if(s.stale.length){
    html+='<div class="card stale"><h3>She has stopped asking</h3>'
      +'<p class=lead>Too long ago for her to bring up. Clear them out.</p>'+todoList(s.stale)+'</div>';
  }
  html+='<div class=card><h3>The two of you</h3><p class=facts>'+facts.join('<span></span>')+'</p></div>';
  html+='<div id=her></div>';
  $('status').innerHTML=html;
  void loadHer();
  if(window.haruAvatar) window.haruAvatar.express(s.emotion);
}
// Delegated, because the list is redrawn on every refresh and per-row handlers
// would go with it.
function tickOff(e){
  const button=e.target&&e.target.closest?e.target.closest('.tick'):null;
  if(!button) return;
  button.disabled=true;
  post('/api/agenda/done',{id:button.getAttribute('data-id')})
    .then(()=>loadStatus())
    .catch(()=>{ button.disabled=false; });
}
function todoList(items){
  return '<ul class=todo>'+items.map(t=>'<li'+(t.late?' class=late':'')+'><span class=what>'+esc(t.title)
    +'<span class=when>'+esc(t.when)+'</span></span>'
    +'<button class=tick data-id="'+esc(t.id)+'">Done</button></li>').join('')+'</ul>';
}
// Her own things: read off her records, not composed — see her.ts.
function drawHer(h){
  const day=d=>{ const [y,m,dd]=String(d||'').split('-').map(Number); return y?new Date(Date.UTC(y,m-1,dd)).toLocaleDateString(undefined,{day:'numeric',month:'short',timeZone:'UTC'}):''; };
  let out='';
  if(h.things.length){
    out+='<div class=card><h3>Her things</h3>'+h.things.map(t=>'<details class=fold><summary><span class=k>'+esc(t.kind)+' \u00b7 '+t.nights+' night'+(t.nights===1?'':'s')+' \u00b7 since '+esc(day(t.since))+'</span><span class=t>'+esc(t.name)+'</span></summary><div class=body>'
      +(t.stance?'<p>'+esc(t.stance)+'</p>':'<p class=dim>No settled view yet.</p>')
      +(t.because?'<p class=dim>Why she took it up: '+esc(t.because)+'</p>':'')
      +(t.favourite?'<p>Rates: '+esc(t.favourite)+'</p>':'')+(t.wants?'<p>Wants: '+esc(t.wants)+'</p>':'')+'</div></details>').join('')+'</div>';
  } else out+='<div class=card><h3>Her things</h3><p class=dim>Nothing of her own yet. She takes things up in the small hours.</p></div>';
  if(h.likes.length||h.wants.length){
    out+='<div class=card>'+(h.likes.length?'<h3>What she rates</h3><div class=pills>'+h.likes.map(l=>'<span class=pill>'+esc(l.name)+' <span class=of>\u00b7 '+esc(l.of)+'</span></span>').join('')+'</div>':'')
      +(h.wants.length?'<h3 style="margin-top:.7rem">What she wants</h3><div class=pills>'+h.wants.map(w=>'<span class=pill>'+esc(w.wish)+' <span class=of>\u00b7 '+esc(w.of)+'</span></span>').join('')+'</div>':'')+'</div>';
  }
  if(h.adventures.length){
    out+='<div class=card><h3>Her nights \u00b7 '+h.nightsOut.count+'</h3>'+h.adventures.slice(0,12).map(a=>'<details class=fold><summary><span class=k>'+esc(day(a.day))+' \u00b7 '+esc(a.why)+'</span><span class=t>'+esc(a.about)+'</span></summary><div class=body><p>'+esc(a.note)+'</p>'
      +(a.sources.length?'<p class=dim>'+a.sources.map(s=>'<a href="'+esc(s)+'" target=_blank rel=noopener>'+esc(s.replace(/^https?:\\/\\//,'').slice(0,48))+'</a>').join('<br>')+'</p>':'')+'</div></details>').join('')+'</div>';
  }
  out+='<div class=card><h3>Her diary</h3><p class=facts>'+(h.diary.entries?'<b>'+h.diary.entries+'</b> entr'+(h.diary.entries===1?'y':'ies')+(h.diary.since?' since <b>'+esc(day(h.diary.since))+'</b>':'')+(h.diary.latest?'<span></span>Latest: <b>'+esc(h.diary.latest.title)+'</b>':''):'Nothing written yet.')+'</p></div>';
  const el=$('her'); if(el) el.innerHTML=out;
}
function loadHer(){
  return get('/api/her').then(drawHer).catch(()=>{});
}
function loadStatus(){
  return get('/api/status').then(s=>{
    // The grudge arrives as a count out of its own maximum rather than a
    // percentage, so it is turned into a row here rather than in the model.
    s.grudgeMeter={key:'grudge',label:'Held against you',value:Math.round(Math.min(1,s.grudge.value/s.grudge.of)*100),note:s.grudge.note};
    drawStatus(s);
  }).catch(()=>{
    if(!$('status').innerHTML) $('status').innerHTML='<p class=said>Could not reach her just now.</p>';
  });
}
function drawDiary(entries){
  if(!entries.length){ $('diary').innerHTML='<h2>Haru\u2019s Diary</h2><p class=none>Nothing written yet. She writes one entry a night, just before the quiet hours end.</p>'; return; }
  const day=d=>{ const [y,m,dd]=d.split('-').map(Number); return new Date(Date.UTC(y,m-1,dd)).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}); };
  $('diary').innerHTML='<h2>Haru\u2019s Diary</h2>'+entries.map((e,i)=>'<details class=entry'+(i===0?' open':'')+'><summary><span class=when>'+esc(day(e.day))+'</span><span class=title>'+esc(e.title||'')+'</span></summary><p>'+esc(e.text)+'</p></details>').join('');
}
function loadDiary(){
  return get('/api/diary').then(r=>drawDiary(r.entries||[])).catch(()=>{ if(!$('diary').innerHTML) $('diary').innerHTML='<p class=none>Could not reach her just now.</p>'; });
}
function showTab(which){
  const her=which==='her', diary=which==='diary', chat=!her&&!diary;
  $('tab-chat').setAttribute('aria-selected',chat?'true':'false');
  $('tab-her').setAttribute('aria-selected',her?'true':'false');
  $('tab-diary').setAttribute('aria-selected',diary?'true':'false');
  $('chat').hidden=!chat; $('status').hidden=!her; $('diary').hidden=!diary;
  // The composer goes with the chat: there is nothing to say to a status
  // screen or a diary, and leaving it up invites a message on the wrong view.
  $('cf').hidden=!chat; $('chips').hidden=!chat;
  if(statusTimer){ clearInterval(statusTimer); statusTimer=null; }
  if(her){ void loadStatus(); statusTimer=setInterval(()=>{ if(!document.hidden) void loadStatus(); },STATUS_EVERY); }
  if(diary) void loadDiary();
}
// Delegated on the section, because the list is redrawn on every refresh.
$('status').addEventListener('click',tickOff);
$('tab-chat').onclick=()=>showTab('chat');
$('tab-her').onclick=()=>showTab('her');
$('tab-diary').onclick=()=>showTab('diary');
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&!$('status').hidden) void loadStatus(); });

//
// iOS only offers web push to a page installed from Share → Add to Home
// Screen, and only asks permission inside a tap. So the worker is registered on
// every load — it has to exist before anything can subscribe — and everything
// that needs a gesture waits behind the bell.
let sw=null;
if('serviceWorker' in navigator){
  // The worker says when something arrived — a push while the page was open
  // in the background, or the tap on a notification that brought it forward.
  // Either way the day is re-read, so the line the notification carried is
  // on screen and not only in the notification.
  navigator.serviceWorker.addEventListener('message',e=>{ if(e.data&&(e.data.type==='said'||e.data.type==='opened')) refreshIfIdle(); });
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
  void drawWhere();
  if(!sw||!('PushManager' in window)){
    $('pushpart').innerHTML='<p>Notifications need her installed first: open the Share menu, Add to Home Screen, then open her from there.</p>';
    return;
  }
  if(Notification.permission==='denied'){
    $('pushpart').innerHTML='<p>Notifications for her are switched off in the phone settings.</p>';
    return;
  }
  let server;
  try{ server=await get('/api/push'); }
  catch(r){ if(r&&r.status===401){location.reload();return;} $('pushpart').innerHTML='<p>Could not reach her.</p>'; return; }
  const sub=await sw.pushManager.getSubscription().catch(()=>null);
  if(!sub){
    $('pushpart').innerHTML='<button id=pon>Let her reach this phone</button><p>She will only speak up when she has something: a reminder, or a thought of her own. Quiet overnight.</p>';
    $('pon').onclick=async()=>{
      try{
        if(await Notification.requestPermission()!=='granted'){ $('pushpart').innerHTML='<p>She was not allowed to.</p>'; return; }
        const fresh=await sw.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:rawKey(server.key)});
        await post('/api/push/subscribe',keysOf(fresh));
        void drawBell();
      }catch(e){ console.warn('[push] '+(e&&e.message||e)); $('pushpart').innerHTML='<p>That did not work.</p>'; }
    };
    return;
  }
  const p=server.prefs;
  const row=(id,label,on)=>'<label class=prow><input type=checkbox id='+id+(on?' checked':'')+'> '+label+'</label>';
  $('pushpart').innerHTML=
    row('pr','Her own thoughts',p.random)+
    row('pe','Reminders and the journal',p.events)+
    row('ps','The machine she runs on',p.system)+
    row('pw','The weather where you are',p.weather)+
    '<div class=prow>Quiet from <input type=time id=pf value="'+p.quietFrom+'"> to <input type=time id=pt value="'+p.quietTo+'"></div>'+
    '<div class=prow title="After the quiet ends she waits for a sign you are up — a message, this page, your PC. Failing those, she assumes you are by this time.">Up by <input type=time id=pu value="'+(p.upBy||'')+'"></div>'+
    '<button id=ptry>Send a test</button>'+
    '<button id=poff class=off>Stop notifying this phone</button>';
  const save=()=>post('/api/push/prefs',{random:$('pr').checked,events:$('pe').checked,system:$('ps').checked,weather:$('pw').checked,quietFrom:$('pf').value,quietTo:$('pt').value,upBy:$('pu').value}).catch(()=>{});
  for(const id of ['pr','pe','ps','pw','pf','pt']) $(id).onchange=save;
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

// ---- Her ears ---------------------------------------------------------------
//
// One tap on the microphone opens it and keeps it open: raw samples in, a
// level per frame to the voice detector, each utterance boxed into a wave file
// and sent to be heard, and what was heard sent to her as a message. It starts
// awake — they tapped, so they mean to talk — and stays awake for a while after
// each thing she says, so they can answer her back; after that only her name
// gets through, until the next tap closes it. Speaking over her cuts her off.
// The pill in the top bar says which. Opened inside the tap, as iOS insists
// for both microphone and audio.
const mic=$('mic'), talkPill=$('talk');
let speakerGuard=false;
let vad=null, talk=null, ctx=null, earStream=null, earNode=null, ring=[], ringMs=0, ticker=null;
const now=()=>performance.now();
function showTalk(){
  const s=talk?talk.state():'off';
  talkPill.hidden=s==='off'; mic.classList.toggle('on',s!=='off'); mic.classList.toggle('hot',s==='awake');
  talkPill.textContent=s==='asleep'?'Say “Hey Haru”':s==='awake'?'Listening…':s==='thinking'?'Thinking…':s==='speaking'?'Speaking…':'';
}
async function openEar(){
  const identity=await window.haruNet.fetch('/api/speaker/status');if(!identity.ok)throw Error('Voice recognition is unavailable.');speakerGuard=(await identity.json()).deferVoiceStart===true;
  earStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  await ctx.resume();
  const src=ctx.createMediaStreamSource(earStream);
  earNode=ctx.createScriptProcessor(2048,1,1);
  // The processor only runs when it leads somewhere; a silent gain keeps the
  // microphone out of the speaker.
  const mute=ctx.createGain(); mute.gain.value=0;
  earNode.onaudioprocess=e=>{
    const d=e.inputBuffer.getChannelData(0), t=now();
    let sum=0; for(let i=0;i<d.length;i++) sum+=d[i]*d[i];
    const level=Math.sqrt(sum/d.length), ms=d.length/ctx.sampleRate*1000;
    ring.push({t,data:Float32Array.from(d)}); ringMs+=ms;
    while(ringMs>20000&&ring.length){ ringMs-=ring[0].data.length/ctx.sampleRate*1000; ring.shift(); }
    const herTurn=!player.paused&&!player.ended;
    onVad(vad.feed(level,t,herTurn?7:undefined),t);
  };
  src.connect(earNode); earNode.connect(mute); mute.connect(ctx.destination);
}
function closeEar(){
  if(earNode){ earNode.disconnect(); earNode.onaudioprocess=null; earNode=null; }
  if(earStream){ earStream.getTracks().forEach(t=>t.stop()); earStream=null; }
  if(ctx){ ctx.close().catch(()=>{}); ctx=null; }
  ring=[]; ringMs=0;
}
function onVad(ev,t){
  if(!ev||!talk) return;
  if(ev.type==='start'){
    if(!speakerGuard)act(talk.voiceStarted(t));
    if(window.haruAvatar&&talk.state()!=='asleep') window.haruAvatar.attend('typing',1500);
  } else if(ev.type==='end'){
    void hearFrames(ring.filter(f=>f.t>=ev.from&&f.t<=ev.to).map(f=>f.data));
  }
}
async function hearFrames(frames){
  if(!frames.length||!ctx||!talk) return;
  const wav=window.haruWav(frames,ctx.sampleRate,16000);
  try{
    const r=await window.haruNet.fetch('/api/listen',{method:'POST',headers:{'content-type':'audio/wav','x-haru-speaking':String(!player.paused&&!player.ended)},body:wav});
    if(!r.ok) return;
    const {text,notice}=await r.json();
    if(notice){await speak(notice,'neutral');}
    if(text&&talk){if(speakerGuard)act(talk.voiceStarted(now()));act(talk.heard(text,now()));}
  }catch(e){ console.warn('[ears] '+(e&&e.message||e)); }
}
function act(actions){
  for(const a of actions){
    if(a.type==='say') void deliver(a.text,[],{interrupted:a.interrupted});
    else if(a.type==='ack') void acknowledge();
    else if(a.type==='interrupt'){ speaking++; player.pause(); if(window.haruAvatar) window.haruAvatar.poke('exclaim'); }
  }
  showTalk();
}
// Her name and nothing else: a word from her, in a mood, and an open ear.
async function acknowledge(){
  try{
    const {line,emotion}=await post('/api/wake');
    // Nothing to say — she has no sign they are up, or said hello not long ago.
    if(!line){ if(talk) act(talk.spokeEnd(now())); return; }
    $('chat').insertAdjacentHTML('beforeend','<div class="msg them">'+esc(line)+'</div>'); $('chat').scrollTop=$('chat').scrollHeight;
    if(window.haruAvatar){ window.haruAvatar.express(emotion); window.haruAvatar.notify(); }
    const started=await speak(line,emotion);
    if(!started&&talk) act(talk.spokeEnd(now()));
  }catch{ if(talk) act(talk.spokeEnd(now())); }
}
mic.onclick=async()=>{
  if(talk){ act(talk.stop()); talk=null; vad=null; closeEar(); clearInterval(ticker); return; }
  if(!navigator.mediaDevices||!(window.AudioContext||window.webkitAudioContext)){ mic.title='This phone cannot listen.'; return; }
  try{
    primeVoice();
    vad=window.HaruVad(); talk=window.HaruTalk({wake:window.haruWake});
    await openEar();
    act(talk.start(now(),true));
    ticker=setInterval(()=>{ if(talk) act(talk.tick(now())); },1000);
  }catch(e){
    console.warn('[ears] '+(e&&e.message||e));
    talk=null; vad=null; closeEar(); mic.title='No microphone: '+(e&&e.message||e); showTalk();
  }
};
player.addEventListener('ended',()=>{ if(talk) act(talk.spokeEnd(now())); });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'&&talk){ act(talk.stop()); talk=null; vad=null; closeEar(); clearInterval(ticker); } });

// ---- Where they are ---------------------------------------------------------
//
// Off until they say otherwise. Once on, the phone watches its own position and
// sends her machine a fix now and then; the names are theirs — stand somewhere
// and call it "home" — and she is told the name, never the numbers. Switching
// it off stops the watching here and forgets the last fix there. The phone's
// own permission prompt comes from the switch, inside the tap, as iOS insists.
const wpart=$('wherepart');
let watching=null, lastSent=null;
function whereOn(){ return window.haruKeep.get('where',false)===true; }
async function sendFix(pos){
  const c=pos.coords;
  const fix={lat:c.latitude,lon:c.longitude,accuracy:Math.round(c.accuracy||500),net:window.haruNet.kind()};
  // A phone at rest reports every few seconds. Her machine hears of a move of
  // any real size or a change of network at once, and otherwise every five minutes.
  if(lastSent&&Date.now()-lastSent.at<300000&&Math.abs(fix.lat-lastSent.lat)<0.0003&&Math.abs(fix.lon-lastSent.lon)<0.0003&&fix.net===lastSent.net) return;
  try{ const w=await post('/api/where',fix); lastSent={...fix,at:Date.now()}; paintAt(w); }
  catch(r){ if(r&&r.status===409){ window.haruKeep.set('where',false); stopWhere(); } }
}
function startWhere(){
  if(watching!==null||!('geolocation' in navigator)) return;
  watching=navigator.geolocation.watchPosition(sendFix,err=>{
    // Refused at the phone: the switch goes back off, so the sheet tells the truth.
    if(err&&err.code===1){ window.haruKeep.set('where',false); stopWhere(); post('/api/where/prefs',{enabled:false}).catch(()=>{}); if(!sheet.hidden) void drawWhere(); }
  },{enableHighAccuracy:false,maximumAge:120000,timeout:30000});
}
function stopWhere(){ if(watching!==null){ navigator.geolocation.clearWatch(watching); watching=null; } lastSent=null; }
function paintAt(w){ const el=$('wat'); if(!el) return; el.textContent=w.at?'At '+w.at+'.':w.fresh?'Somewhere she has no name for.':'Waiting for the phone…'; }
async function drawWhere(){
  if(!('geolocation' in navigator)){ wpart.innerHTML='<hr><p>This phone cannot say where it is.</p>'; return; }
  let w; try{ w=await get('/api/where'); }catch{ wpart.innerHTML=''; return; }
  window.haruKeep.set('where',w.enabled);
  const row=(id,label,on)=>'<label class=prow><input type=checkbox id='+id+(on?' checked':'')+'> '+label+'</label>';
  wpart.innerHTML='<hr>'+row('wl','Let her know where you are',w.enabled)+(w.enabled
    ? '<p id=wat></p>'+
      '<div class=prow><input id=wn placeholder="Call this place…" maxlength=40 autocapitalize=none><button id=wsave>Keep</button></div>'+
      (w.places.length?'<p>Places she knows: '+w.places.map(esc).join(', ')+'.</p>':'<p>She knows no places yet. Stand somewhere and name it; "home" lets her tell how far you have wandered.</p>')+
      '<button id=wlook class=off>Ask what this place is called</button>'+
      '<p>Stays on her machine. Asking what a place is called sends a blurred spot to OpenStreetMap, once.</p>'
    : '<p>Off. Her machine keeps nothing about where you are until you switch this on.</p>');
  if(w.enabled){ paintAt(w); startWhere(); } else stopWhere();
  $('wl').onchange=async()=>{
    const on=$('wl').checked;
    try{ await post('/api/where/prefs',{enabled:on}); }catch{}
    window.haruKeep.set('where',on);
    if(on){ lastSent=null; startWhere(); } else stopWhere();
    void drawWhere();
  };
  if(!w.enabled) return;
  $('wsave').onclick=async()=>{
    const name=$('wn').value.trim(); if(!name) return;
    try{ await post('/api/where/name',{name}); lastSent=null; void drawWhere(); }
    catch(r){ $('wat').textContent=r&&r.status===409?'The phone has not said where it is yet.':'That did not work.'; }
  };
  $('wlook').onclick=async()=>{
    $('wlook').disabled=true;
    try{ const r=await post('/api/where/lookup'); $('wn').value=r.name; $('wlook').textContent='Keep it if that is right'; }
    catch{ $('wlook').textContent='No answer from the map'; }
  };
}
if(whereOn()) startWhere();
// Back on screen after a while away: the next fix goes through whatever it says.
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&whereOn()) lastSent=null; });
${AVATAR}
const avatarClient = document.createElement('script');
avatarClient.src = '/lib/haru-avatar.js?v=${AVATAR_CLIENT_VERSION}';
document.head.appendChild(avatarClient);
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
  e.waitUntil(Promise.all([
    self.registration.showNotification(m.title||'Haru',{
      body:m.body||'',
      icon:'/portrait',
      data:{url:typeof m.url==='string'&&m.url.startsWith('/')&&!m.url.startsWith('//')?m.url:'/'}
    }),
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(open=>{ for(const c of open) c.postMessage({type:'said'}); })
  ]));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(open=>{
    for(const client of open){ if('focus' in client){ client.postMessage({type:'opened'}); return client.focus(); } }
    return self.clients.openWindow(url);
  }));
});
`;
}
