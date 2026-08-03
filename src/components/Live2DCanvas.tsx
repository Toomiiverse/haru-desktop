import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import type { Live2DModel as Live2DModelClass } from 'pixi-live2d-display/cubism4';

let corePromise: Promise<void> | undefined;
function loadCubismCore() {
  if (window.Live2DCubismCore) return Promise.resolve();
  if (corePromise) return corePromise;
  corePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the Live2D Cubism runtime. Check your internet connection.'));
    document.head.appendChild(script);
  });
  return corePromise;
}

export type Live2DModelHandle = Live2DModelClass;

export function Live2DCanvas({ source, onError, onReady }: { source: string; onError(message: string): void; onReady?(model: Live2DModelHandle | null): void }) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let app: PIXI.Application | undefined;
    let model: Live2DModelHandle | undefined;
    let baseWidth = 0;
    let baseHeight = 0;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;

    // Positions/scales the model against the renderer's logical (CSS-pixel) screen
    // size, not the device-pixel buffer size (renderer.width/height) — PIXI's stage
    // projection is defined in logical pixels, so using the buffer size would place
    // the model incorrectly on any display with devicePixelRatio !== 1.
    function fitModel() {
      if (!app || !model || !baseWidth || !baseHeight) return;
      const screen = app.renderer.screen;
      model.scale.set(Math.min(screen.width / baseWidth, screen.height / baseHeight) * .88);
      model.position.set(screen.width / 2, screen.height);
    }

    async function render() {
      try {
        // The Live2D plugin reads PIXI when its own module is loaded.
        (window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;
        // The cubism4 module checks for window.Live2DCubismCore at import time, so
        // the runtime script must be loaded before the module is imported.
        await loadCubismCore();
        const { Live2DModel } = await import('pixi-live2d-display/cubism4');
        if (!host.current || disposed) return;
        app = new PIXI.Application({ width: host.current.clientWidth, height: host.current.clientHeight, transparent: true, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
        host.current.appendChild(app.view);
        const loaded = await Live2DModel.from(source);
        if (disposed) { loaded.destroy(); return; }
        baseWidth = loaded.width;
        baseHeight = loaded.height;
        loaded.anchor.set(.5, 1);
        model = loaded;
        app.stage.addChild(loaded);
        fitModel();
        onReady?.(loaded);
        setLoading(false);

        resizeObserver = new ResizeObserver(() => {
          if (!app || !host.current) return;
          app.renderer.resize(host.current.clientWidth, host.current.clientHeight);
          fitModel();
        });
        resizeObserver.observe(host.current);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Haru could not load this Live2D model.');
      }
    }
    render();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      onReady?.(null);
      app?.destroy(true, { children: true, texture: true, baseTexture: true });
    };
  }, [source, onError, onReady]);
  return <div className="live2d-canvas-host" ref={host}>{loading && <small>Loading model…</small>}</div>;
}
