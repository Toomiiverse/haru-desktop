import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { StageFailureBoundary } from './components';
import type { Live2DModelHandle } from './components/Live2DCanvas';
import { ACTION_SHAPES, gazeForAction, pickExpression, resolveGaze, type ActionShape, type Gaze } from './companion/behaviour';
import type { Vitals } from './types';

// Only used until the first life tick arrives, a few seconds after launch.
const RESTING_VITALS: Vitals = { energy: 0.6, happiness: 0.6, curiosity: 0.5, affection: 0.4, sleepiness: 0.2, stress: 0.2, focus: 0.5 };

const Live2DCanvas = lazy(() => import('./components/Live2DCanvas').then(module => ({ default: module.Live2DCanvas })));

export function CompanionWindow() {
  const [model, setModel] = useState<Live2DModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);
  const modelHandle = useRef<Live2DModelHandle | null>(null);

  const handleReady = useCallback((handle: Live2DModelHandle | null) => {
    modelHandle.current = handle;
    // Expression names vary per model, so they are read off the loaded model
    // rather than assumed; behaviour matches against whatever is actually here.
    const definitions = (handle as unknown as { internalModel?: { motionManager?: { expressionManager?: { definitions?: { Name?: string }[] } } } })?.internalModel?.motionManager?.expressionManager?.definitions;
    expressions.current = Array.isArray(definitions) ? definitions.map(entry => entry?.Name).filter((name): name is string => typeof name === 'string') : [];
  }, []);

  useEffect(() => {
    window.haru?.live2d.get().then(m => { if (m) setModel(m); });
    return window.haru?.live2d.onChange(setModel);
  }, []);

  useEffect(() => window.haru?.companion.onSetExpression(name => { modelHandle.current?.expression(name); }), []);

  // Cursor position is kept in a ref and read by the animation loop rather than
  // applied straight to the model: the loop blends it with whatever else is
  // pulling her gaze, instead of the cursor always winning.
  const cursor = useRef({ x: 0, y: 0 });
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

  useEffect(() => window.haru?.life.onTick(({ vitals, action: name }) => {
    life.current = { ...life.current, vitals };
    const shape = name ? ACTION_SHAPES[name] : undefined;
    if (shape) action.current = { shape, gaze: gazeForAction(shape), startedAt: performance.now() };
    const expression = shape ? pickExpression(shape.expressionMood, expressions.current) : null;
    if (expression) modelHandle.current?.expression(expression);
  }), []);

  useEffect(() => {
    let frame = 0;
    const smoothed = { x: 0, y: 0 };
    function tick() {
      frame = requestAnimationFrame(tick);
      const handle = modelHandle.current;
      if (!handle) return;
      const current = action.current;
      const progress = current ? (performance.now() - current.startedAt) / current.shape.durationMs : 1;
      if (current && progress >= 1) action.current = null;
      const target = resolveGaze({
        cursor: cursor.current,
        wander: current?.gaze ?? null,
        actionProgress: progress,
        vitals: life.current.vitals,
        idleSeconds: life.current.idleSeconds,
      });
      // Eased toward rather than set: the model's own focus controller adds its
      // own smoothing, and stacking a little here keeps fast cursor moves from
      // looking twitchy.
      smoothed.x += (target.x - smoothed.x) * 0.08;
      smoothed.y += (target.y - smoothed.y) * 0.08;
      // focus() wants stage pixels, so the normalised gaze is mapped back out.
      // Y is flipped: gaze is positive-up, screen space is positive-down.
      const bounds = stage.current?.getBoundingClientRect();
      const width = bounds?.width || window.innerWidth;
      const height = bounds?.height || window.innerHeight;
      handle.focus(((smoothed.x + 1) / 2) * width, ((1 - smoothed.y) / 2) * height);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    dragging.current = true;
    (event.target as Element).setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent) {
    if (!dragging.current) return;
    window.haru?.companion.moveBy(event.movementX, event.movementY);
  }
  function onPointerUp(event: React.PointerEvent) {
    dragging.current = false;
    (event.target as Element).releasePointerCapture(event.pointerId);
  }
  function onContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    window.haru?.companion.showMenu();
  }
  function onWheel(event: React.WheelEvent) {
    window.haru?.companion.resizeBy(event.deltaY < 0 ? 1.06 : 0.94);
  }

  if (!model) return null;
  return (
    <div className="companion-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onContextMenu={onContextMenu} onWheel={onWheel}>
      <StageFailureBoundary onError={setError}>
        <Suspense fallback={null}>
          <Live2DCanvas source={model.url} onError={setError} onReady={handleReady} />
        </Suspense>
      </StageFailureBoundary>
      {error && <div className="companion-error">{error}</div>}
    </div>
  );
}
