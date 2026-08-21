import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { StageFailureBoundary } from './components';
import type { Live2DModelHandle } from './components/Live2DCanvas';
import { ACTION_SHAPES, emotionHoldMs, expressionForEmotion, gazeForAction, GESTURE_DURATION_MS, resolveGaze, type ActionShape, type Gaze, type Gesture } from './companion/behaviour';
import { POSES, POSE_TIMING, poseStrength } from './companion/pose';
import { attachParameterLayer } from './companion/parameters';
import { createVoicePlayer, type MouthReading, type VoicePlayer } from './companion/mouth';
import { idleMotion } from './companion/idle';
import type { Emotion, Vitals, VoiceConfig } from './types';

// Only used until the first life tick arrives, a few seconds after launch.
const RESTING_VITALS: Vitals = { energy: 0.6, happiness: 0.6, curiosity: 0.5, affection: 0.4, sleepiness: 0.2, stress: 0.2, focus: 0.5 };
// Read before the player exists, and between replies. Weight 0 leaves the mouth
// entirely to the pose layer.
const SILENT: MouthReading = { open: 0, weight: 0 };

// Looked up by id rather than enumerated: this build of the Cubism model has
// getParameterCount but no getParameterId, so walking every index cannot recover
// the names. Asking for the handful of ids the wardrobe cares about needs only
// getParameterIndex, which has to exist for setParameterValueById to work at all.
type RangeReader = {
  getParameterIndex(id: string): number;
  getParameterMinimumValue(index: number): number;
  getParameterMaximumValue(index: number): number;
};

/**
 * Tells main what every parameter's real bounds are. Only the loaded model knows
 * them, and guessing them from the expression files got hair length wrong: it
 * runs -1..1, so a wardrobe built on the assumption that options count upward
 * from 1 offered two buttons that both resolved to the same value.
 */
/**
 * The expression names this model actually offers. Read from several places
 * because the runtime exposes them differently depending on how the model was
 * loaded — the manager's own list when it has parsed them, the settings the
 * manifest was built from otherwise. One path returning undefined is not a model
 * without expressions, it is the wrong property.
 */
function readExpressionNames(handle: Live2DModelHandle): string[] {
  const internal = (handle as unknown as {
    internalModel?: {
      motionManager?: { expressionManager?: { definitions?: { Name?: string }[] } };
      settings?: { expressions?: { Name?: string }[]; FileReferences?: { Expressions?: { Name?: string }[] } };
    };
  }).internalModel;
  const candidates = [
    internal?.motionManager?.expressionManager?.definitions,
    internal?.settings?.expressions,
    internal?.settings?.FileReferences?.Expressions,
  ];
  for (const list of candidates) {
    if (!Array.isArray(list) || !list.length) continue;
    const names = list.map(entry => entry?.Name).filter((name): name is string => typeof name === 'string' && name.length > 0);
    if (names.length) return names;
  }
  return [];
}

async function reportParameterRanges(handle: Live2DModelHandle) {
  const core = (handle as unknown as { internalModel?: { coreModel?: RangeReader } }).internalModel?.coreModel;
  // Reported rather than returned silently: this failing is invisible otherwise,
  // and the wardrobe simply keeps using guessed ranges that are wrong.
  if (!core) { console.warn('[wardrobe] no coreModel on the loaded model'); return; }
  if (typeof core.getParameterIndex !== 'function' || typeof core.getParameterMinimumValue !== 'function') {
    console.warn('[wardrobe] coreModel cannot report ranges; parameter methods here:', Object.getOwnPropertyNames(Object.getPrototypeOf(core)).filter(key => /param/i.test(key)).join(', '));
    return;
  }
  // Main knows which parameters the wardrobe is built from; only this window
  // knows what they are bounded by. Neither can answer alone.
  const { controls } = (await window.haru?.wardrobe.get()) ?? { controls: [] };
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const control of controls) {
    try {
      const index = core.getParameterIndex(control.id);
      if (typeof index !== 'number' || index < 0) { console.warn(`[wardrobe] ${control.id} is not a parameter on this model`); continue; }
      ranges[control.id] = { min: core.getParameterMinimumValue(index), max: core.getParameterMaximumValue(index) };
    } catch (error) {
      console.warn(`[wardrobe] could not read the range of ${control.id}:`, error);
    }
  }
  if (!Object.keys(ranges).length) return;
  console.log('[wardrobe] ranges:', Object.entries(ranges).map(([id, range]) => `${id} ${range.min}..${range.max}`).join(', '));
  void window.haru?.wardrobe.reportRanges(ranges);
}

const Live2DCanvas = lazy(() => import('./components/Live2DCanvas').then(module => ({ default: module.Live2DCanvas })));

export function CompanionWindow() {
  const [model, setModel] = useState<Live2DModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);
  const modelHandle = useRef<Live2DModelHandle | null>(null);

  const handleReady = useCallback((handle: Live2DModelHandle | null) => {
    modelHandle.current = handle;
    if (handle) attachParameterLayer(handle, gesture, () => activePoses(), () => voice.current?.read() ?? SILENT, () => life.current.vitals, () => wardrobe.current);
    if (handle) void reportParameterRanges(handle);
    // Expression names vary per model, so they are read off the loaded model
    // rather than assumed; behaviour matches against whatever is actually here.
    expressions.current = handle ? readExpressionNames(handle) : [];
    // An empty list is not a harmless nothing — it means every emotional beat
    // silently finds no face to pull, which looks exactly like the classifier
    // being broken. Worth saying out loud.
    // console.warn rather than log: the dev server forwards warnings to the
    // terminal but drops logs, and a diagnostic nobody can see is not one.
    if (handle) console.warn(expressions.current.length
      ? `[expressions] ${expressions.current.length} available: ${expressions.current.slice(0, 8).join(', ')}${expressions.current.length > 8 ? '…' : ''}`
      : '[expressions] none found on the loaded model — emotional beats will not change her face');
  }, []);

  useEffect(() => {
    window.haru?.live2d.get().then(m => { if (m) setModel(m); });
    return window.haru?.live2d.onChange(setModel);
  }, []);

  // Cleared on a model swap so a failure from the previous one does not sit on
  // screen over a model that loaded perfectly well.
  useEffect(() => { setError(null); }, [model?.url]);

  useEffect(() => window.haru?.companion.onSetExpression(name => { modelHandle.current?.expression(name); }), []);

  // Held in a ref and read per frame rather than applied on change: expressions
  // rewrite these same parameters every frame, so a one-off write would be undone
  // the first time she pulled a face.
  const wardrobe = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!window.haru) return;
    void window.haru.wardrobe.get().then(({ values }) => { wardrobe.current = values; });
    return window.haru.wardrobe.onChange(values => { wardrobe.current = values; });
  }, []);

  // Speech is owned by this window rather than the chat window so the mouth can
  // be driven from the audio itself. Built in an effect, not lazily during
  // render, so StrictMode's double pass cannot leave a second AudioContext open.
  const voice = useRef<VoicePlayer | null>(null);
  useEffect(() => {
    const player = createVoicePlayer();
    voice.current = player;
    // The Windows voices read speed and voice choice off the settings; the audio
    // engines have already applied both by the time the samples arrive.
    const apply = (config: VoiceConfig) => player.configure({ volume: config.volume, speed: config.speed, systemVoice: config.engine === 'windows' ? config.voice : '' });
    void window.haru?.voice.get().then(apply);
    const stopListening = [
      window.haru?.voice.onClip(clip => player.play(clip)),
      window.haru?.voice.onStop(() => player.stop()),
      window.haru?.voice.onChange(apply),
      window.haru?.voice.onDuck(factor => player.setDuck(factor)),
      window.haru?.voice.onInsistence(factor => player.setInsistence(factor)),
    ];
    return () => {
      for (const off of stopListening) off?.();
      player.dispose();
      voice.current = null;
    };
  }, []);

  // Cursor position is kept in a ref and read by the animation loop rather than
  // applied straight to the model: the loop blends it with whatever else is
  // pulling her gaze, instead of the cursor always winning.
  // What she is saying, shown above her. Driven from main rather than from the
  // speech clips so it still appears with the voice switched off.
  const [caption, setCaption] = useState<string | null>(null);
  const [typed, setTyped] = useState(0);
  // The bubble only shows three lines, so it has to follow the words being typed
  // rather than sitting at the top showing the opening of a reply that has long
  // since moved on. Scrolling to scrollHeight would not do it: the untyped
  // remainder is still in the box holding its width open, so the bottom of the
  // content is the end of text that has not been said yet. This tracks a marker
  // sitting exactly at the typing position instead.
  const caret = useRef<HTMLBRElement>(null);
  useEffect(() => {
    caret.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [typed]);
  useEffect(() => window.haru?.companion.onSay(line => { setCaption(line); setTyped(0); }), []);

  // Typed out rather than dropped in whole. Paced at roughly her speaking rate so
  // the words arrive about when she says them; a fixed interval is enough for
  // that without trying to track the audio, which would stall the text every
  // time a chunk was still being synthesised.
  useEffect(() => {
    if (!caption) return;
    // A character every 50ms, or twenty a second. Speech runs at roughly that
    // rate, so the words land about when she says them — fast enough to keep up
    // and not so fast that the line is finished while she is still on the first
    // sentence, which is the thing that makes a typewriter effect feel fake.
    const timer = setInterval(() => {
      setTyped(current => {
        if (current >= caption.length) { clearInterval(timer); return current; }
        return current + 1;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [caption]);

  useEffect(() => {
    if (!caption) return;
    // Held until she has stopped talking, but never for less than it takes to
    // read: a short line spoken in two seconds would otherwise be gone before it
    // had been looked at, and with the voice off there is nothing to wait for.
    const readMs = 2200 + caption.split(/\s+/).length * 300;
    const shownAt = performance.now();
    const timer = setInterval(() => {
      const talking = voice.current?.speaking() ?? false;
      // Never clears mid-sentence: a line that is still being typed has not been
      // read yet no matter how long it has been on screen.
      if (!talking && typed >= caption.length && performance.now() - shownAt > readMs) setCaption(null);
    }, 250);
    return () => clearInterval(timer);
  }, [caption, typed]);

  // Which way main is currently carrying the window, so the legs match the
  // actual movement rather than guessing at it from the window position.
  const walking = useRef(0);
  useEffect(() => window.haru?.companion.onWalking(({ facing }) => { walking.current = facing; }), []);

  const cursor = useRef({ x: 0, y: 0 });
  // Where the screen is while something plays fullscreen on it. Held in a ref and
  // read by the loop for the same reason the cursor is: the blend should reflect
  // the exact moment it is drawn.
  const watching = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => window.haru?.companion.onWatching(gaze => { watching.current = gaze; }), []);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => window.haru?.companion.onCursor(({ x, y }) => {
    const bounds = stage.current?.getBoundingClientRect();
    const width = bounds?.width || window.innerWidth;
    const height = bounds?.height || window.innerHeight;
    // Into the model's -1..1 focus space, clamped so a cursor far off-window
    // does not peg her eyes at the extreme.
    cursor.current = {
      x: Math.max(-1, Math.min(1, (x / width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, -((y / height) * 2 - 1))),
    };
  }), []);

  // The life loop only says what she is doing and how she feels; turning that
  // into movement happens here.
  const life = useRef<{ vitals: Vitals; idleSeconds: number }>({ vitals: RESTING_VITALS, idleSeconds: 0 });
  const action = useRef<{ shape: ActionShape; gaze: Gaze | null; startedAt: number } | null>(null);
  const expressions = useRef<string[]>([]);

  // A reading applies immediately, then fades, so an emotional beat colours the
  // next few seconds rather than latching until the next message.
  const emotion = useRef<{ value: Emotion; until: number; holdMs: number } | null>(null);
  const gesture = useRef<{ name: Gesture; startedAt: number } | null>(null);
  useEffect(() => window.haru?.life.onEmotion(({ emotion: value, gesture: name }) => {
    const holdMs = emotionHoldMs(value);
    emotion.current = { value, until: performance.now() + holdMs, holdMs };
    if (name) gesture.current = { name, startedAt: performance.now() };
    const expression = expressionForEmotion(value, expressions.current);
    if (expression) modelHandle.current?.expression(expression);
  }), []);

  // Without this she keeps whichever face she last pulled — one happy reply and
  // she sat on heart eyes indefinitely. Expressions are a beat, not a state.
  const clearExpression = useCallback(() => {
    const manager = (modelHandle.current as unknown as { internalModel?: { motionManager?: { expressionManager?: { resetExpression?(): void } } } })?.internalModel?.motionManager?.expressionManager;
    manager?.resetExpression?.();
  }, []);

  // Poses are held in a ref and read per frame by the parameter layer, rather
  // than pushed, so blending always reflects the exact moment it is drawn.
  const poses = useRef<{ name: string; startedAt: number }[]>([]);
  const activePoses = useCallback(() => {
    const now = performance.now();
    poses.current = poses.current.filter(entry => now - entry.startedAt < (POSE_TIMING[entry.name]?.durationMs ?? 0));
    return poses.current.flatMap(entry => {
      const timing = POSE_TIMING[entry.name];
      const pose = POSES[entry.name];
      if (!timing || !pose) return [];
      return [{ pose, weight: poseStrength((now - entry.startedAt) / timing.durationMs, timing.attack) }];
    });
  }, []);

  const playPose = useCallback((name: string) => {
    if (!POSES[name]) return;
    // Restarting the same pose rather than stacking it, so a repeat reads as one
    // longer beat instead of doubling in strength.
    poses.current = [...poses.current.filter(entry => entry.name !== name), { name, startedAt: performance.now() }];
  }, []);

  // Poses pushed from main rather than chosen by the life loop — a flinch when
  // she is clicked on. Separate from the tick because the whole value of it is
  // landing on the same frame as the click.
  useEffect(() => window.haru?.companion.onPose(playPose), [playPose]);

  useEffect(() => window.haru?.life.onTick(({ vitals, action: name }) => {
    life.current = { ...life.current, vitals };
    if (name) playPose(name);
    const shape = name ? ACTION_SHAPES[name] : undefined;
    if (shape) action.current = { shape, gaze: gazeForAction(shape), startedAt: performance.now() };
  }), [playPose]);

  // How far the sprite has already been nudged, so each frame applies only the
  // change. Absolute positioning here would clobber the fit-to-window logic.
  const drift = useRef({ x: 0, y: 0 });
  /** 0 idling, 1 speaking. Eased in the frame loop — see idleMotion. */
  const settle = useRef(0);
  const wasTalking = useRef(false);
  useEffect(() => {
    let frame = 0;
    const smoothed = { x: 0, y: 0 };
    function tick() {
      frame = requestAnimationFrame(tick);
      const handle = modelHandle.current;
      const current = action.current;
      const progress = current ? (performance.now() - current.startedAt) / current.shape.durationMs : 1;
      if (current && progress >= 1) action.current = null;
      // Linear fade over the back half of the hold, so the reading loosens its
      // grip instead of dropping off a cliff.
      const feeling = emotion.current;
      const remaining = feeling ? feeling.until - performance.now() : 0;
      // The face outlasts its timer for as long as she is still talking. An
      // annoyed line takes longer to say than the hold allows, and dropping back
      // to a resting face halfway through one is exactly the mismatch between
      // tone and expression that makes her look disconnected from her own voice.
      const stillTalking = voice.current?.speaking() ?? false;
      // Told to main only on the change, so the rest of the machine can drop out
      // of the way while she talks. Sent from here because this is the only place
      // that knows a clip has finished playing rather than merely been handed over.
      if (stillTalking !== wasTalking.current) {
        wasTalking.current = stillTalking;
        void window.haru?.voice.setSpeaking(stillTalking);
      }
      if (feeling && remaining <= 0 && !stillTalking) { emotion.current = null; clearExpression(); }
      const emotionStrength = !feeling ? 0
        : stillTalking ? 1
        : Math.max(0, Math.min(1, remaining / (feeling.holdMs * 0.5)));

      const playing = gesture.current;
      if (playing && performance.now() - playing.startedAt >= GESTURE_DURATION_MS[playing.name]) gesture.current = null;

      const target = resolveGaze({
        cursor: cursor.current,
        wander: current?.gaze ?? null,
        actionProgress: progress,
        vitals: life.current.vitals,
        idleSeconds: life.current.idleSeconds,
        emotion: feeling?.value ?? null,
        emotionStrength,
        // Last frame's value, which is a sixteenth of a second stale and not
        // worth reordering the loop for.
        speaking: settle.current,
        gesture: gesture.current?.name ?? null,
        watching: watching.current,
      });
      // Eased toward rather than set: the model's own focus controller adds its
      // own smoothing, and stacking a little here keeps fast cursor moves from
      // looking twitchy.
      smoothed.x += (target.x - smoothed.x) * 0.08;
      smoothed.y += (target.y - smoothed.y) * 0.08;

      if (!handle) return;

      // focus() wants stage pixels, so the normalised gaze is mapped back out.
      // Y is flipped: gaze is positive-up, screen space is positive-down.
      const bounds = stage.current?.getBoundingClientRect();
      const width = bounds?.width || window.innerWidth;
      const height = bounds?.height || window.innerHeight;
      handle.focus(((smoothed.x + 1) / 2) * width, ((1 - smoothed.y) / 2) * height);

      // Moving her, as opposed to rotating her. Applied to the sprite because the
      // rig has no parameter for it, and as a delta against what was applied last
      // frame so it composes with the layout code that positions her on resize
      // rather than fighting it for ownership of position.
      // Eased rather than switched. Cutting the sway the instant a clip starts
      // is a visible jolt — she snaps to attention — and restoring it the
      // instant one ends is the same jolt backwards, several times a sentence
      // as chunks play. A third of a second in, a little slower out, so she
      // gathers herself and then loosens.
      const talkingNow = voice.current?.speaking() ?? false;
      const towards = talkingNow ? 1 : 0;
      settle.current += (towards - settle.current) * (talkingNow ? 0.08 : 0.04);
      const idle = idleMotion(performance.now(), life.current.vitals, settle.current);
      const wantX = idle.driftX * width;
      const wantY = -idle.bounceY * height;
      handle.position.x += wantX - drift.current.x;
      handle.position.y += wantY - drift.current.y;
      drift.current = { x: wantX, y: wantY };
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Where the press began, so a click can be told from a drag on release. She is
  // dragged by her body, so every poke is also the start of a potential drag —
  // only a press that goes nowhere counts as having prodded her.
  const press = useRef<{ x: number; y: number; at: number } | null>(null);

  // The box at her feet. Open means she is waiting to be typed into; asking
  // means the question has gone and the answer has not come back yet, which on
  // a local model is two to six seconds and needs to look like something.
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const box = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(false);
  openRef.current = asking;

  const closeBox = useCallback(() => {
    setAsking(false);
    setDraft('');
    setWaiting(false);
    void window.haru?.companion.close();
  }, []);

  // Clicking away puts it away. Without this the box sits open behind whatever
  // they turned to instead, and she keeps standing still waiting for it.
  useEffect(() => {
    const onBlur = () => { if (openRef.current) closeBox(); };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [closeBox]);

  async function send() {
    const said = draft.trim();
    if (!said || waiting) return;
    setDraft('');
    setWaiting(true);
    try {
      // The reply arrives through the caption on its own — ollamaChat speaks it
      // and pushes it there — so there is nothing to do with the result here
      // beyond stopping the waiting state.
      await window.haru?.companion.ask(said);
    } catch {
      // Reported through her caption rather than in the box: an error message
      // in a text field she is standing next to reads as the app breaking,
      // where a line from her reads as her saying she cannot.
    } finally {
      setWaiting(false);
      box.current?.focus();
    }
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    dragging.current = true;
    press.current = { x: event.screenX, y: event.screenY, at: performance.now() };
    (event.target as Element).setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent) {
    if (!dragging.current) return;
    window.haru?.companion.moveBy(event.movementX, event.movementY);
  }
  function onPointerUp(event: React.PointerEvent) {
    dragging.current = false;
    (event.target as Element).releasePointerCapture(event.pointerId);
    const started = press.current;
    press.current = null;
    if (!started) return;
    // Generous on distance and time: dragging a small window by hand always
    // wobbles a few pixels, and treating that as a poke would have her complain
    // every time she was moved.
    const moved = Math.hypot(event.screenX - started.x, event.screenY - started.y);
    if (moved < 5 && performance.now() - started.at < 500) {
      // A click on her is a summons now, not a prod. Prodding is what clicking
      // her while the box is already open means — which keeps the flinching and
      // the escalation without asking anyone to learn a second gesture.
      if (asking) void window.haru?.companion.poke('poke');
      else void window.haru?.companion.open().then(() => { setAsking(true); setTimeout(() => box.current?.focus(), 0); });
    }
  }
  function onContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    // She reacts and the menu still opens: the menu is the only way to reach
    // "Open Haru" and the pin toggle from here, so it is not hers to veto.
    void window.haru?.companion.poke('right-click');
    window.haru?.companion.showMenu();
  }
  function onWheel(event: React.WheelEvent) {
    window.haru?.companion.resizeBy(event.deltaY < 0 ? 1.06 : 0.94);
  }

  if (!model) return null;
  return (
    <div className="companion-stage">
      <StageFailureBoundary onError={setError}>
        <Suspense fallback={null}>
          <Live2DCanvas source={model.url} onError={setError} onReady={handleReady} />
        </Suspense>
      </StageFailureBoundary>
      {/* Everything that reacts to a pointer lives on this, not on the stage, so
          the transparent margin around her no longer drags or pokes her. Note
          that those clicks are inert rather than passed through: the window still
          swallows them at the OS level, and letting them reach the desktop behind
          would need setIgnoreMouseEvents on the window itself. */}
      <div className="companion-hitbox" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onContextMenu={onContextMenu} onWheel={onWheel}/>
      {/* The full line is rendered underneath at zero opacity so the bubble is
          already its final size on the first character — without it the box
          grows line by line as she types and shoves itself around the screen. */}
      {caption && <div className="companion-caption"><span><i className="typed">{caption.slice(0, typed)}</i><i ref={caret} className="caret"/><i className="untyped">{caption.slice(typed)}</i></span></div>}
      {/* Outside the hitbox above, deliberately: inside it, every keystroke would
          be a drag on her and typing would walk her across the desktop. */}
      {asking && <div className="companion-ask">
        <input
          ref={box}
          value={draft}
          disabled={waiting}
          placeholder={waiting ? 'thinking…' : 'say something'}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); void send(); }
            // Escape closes without sending, which is the way out for a box
            // opened by a stray click on her.
            if (event.key === 'Escape') { event.preventDefault(); closeBox(); }
          }}
        />
      </div>}
      {error && <div className="companion-error">{error}</div>}
    </div>
  );
}
