import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { StageFailureBoundary } from './components';
import type { Live2DModelHandle } from './components/Live2DCanvas';

const Live2DCanvas = lazy(() => import('./components/Live2DCanvas').then(module => ({ default: module.Live2DCanvas })));

export function CompanionWindow() {
  const [model, setModel] = useState<Live2DModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);
  const modelHandle = useRef<Live2DModelHandle | null>(null);

  const handleReady = useCallback((handle: Live2DModelHandle | null) => { modelHandle.current = handle; }, []);

  useEffect(() => {
    window.haru?.live2d.get().then(m => { if (m) setModel(m); });
    return window.haru?.live2d.onChange(setModel);
  }, []);

  useEffect(() => window.haru?.companion.onCursor(({ x, y }) => { modelHandle.current?.focus(x, y); }), []);
  useEffect(() => window.haru?.companion.onSetExpression(name => { modelHandle.current?.expression(name); }), []);

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
