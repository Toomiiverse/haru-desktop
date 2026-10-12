// Borrowed eyes: a frame from OBS, when it is running.
//
// The thumbnail path through desktopCapturer tops out at 1280 wide, which is
// where small HUD text dies, and some exclusive-fullscreen games hand it black
// frames. OBS's capture has neither problem, and its websocket will hand over
// a PNG of the program scene on request. So when OBS is up, the glance asks it
// first, and the screen thumbnail is the fallback rather than the only eye.
//
// Zero configuration on our side, on purpose: the server's port and password
// are read from OBS's own config file, so the one switch that matters —
// whether the websocket server is enabled — lives in OBS where the user set
// it. The frame is as local as the screen was: OBS is this machine, and the
// picture goes to the same local vision model as before.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type ObsServer = { enabled: boolean; port: number; password: string };

/** OBS's own record of its websocket server. Null when OBS was never set up. */
export function readObsServer(appData: string): ObsServer | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(appData, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json'), 'utf8')) as Record<string, unknown>;
    return {
      enabled: raw.server_enabled === true,
      port: Number(raw.server_port) || 4455,
      password: typeof raw.server_password === 'string' ? raw.server_password : '',
    };
  } catch {
    return null;
  }
}

/** obs-websocket v5 auth: sha256 twice, base64 both times. */
export function authToken(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(secret + challenge).digest('base64');
}

/** The base64 under a data: URI, which is what the vision model wants. */
export function imageBase64(dataUri: string): string {
  return dataUri.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * A scene whose sources are dead renders as a blank canvas, not an error —
 * measured, a 1920-wide all-white frame is 8KB of PNG against two and a half
 * megabytes for a real one. A blank must read as "no frame" or it would
 * swallow the fallback to the screen thumbnail, and she would describe a
 * white rectangle every five minutes.
 */
export const MIN_FRAME_BYTES = 16_384;

export function looksBlank(base64: string): boolean {
  // Base64 is 4/3 the byte count; close enough for a threshold.
  return base64.length * 0.75 < MIN_FRAME_BYTES;
}

/**
 * One frame of the program scene, or null.
 *
 * Null on every failure — OBS closed, wrong password, no scene — because the
 * caller has the screen thumbnail to fall back on and a glance must never be
 * lost to the better camera being off. Connects per shot: at a glance every
 * few minutes, holding a socket open buys nothing.
 */
export function obsScreenshot(server: ObsServer, timeoutMs = 5000): Promise<string | null> {
  return new Promise(resolve => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => done(null), timeoutMs);
    function done(result: string | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(result);
    }
    const send = (op: number, d: unknown) => socket.send(JSON.stringify({ op, d }));
    socket.onerror = () => done(null);
    socket.onclose = () => done(null);
    socket.onmessage = event => {
      try {
        const { op, d } = JSON.parse(String(event.data)) as { op: number; d: Record<string, any> };
        if (op === 0) {
          // Hello. Identify, with the auth answer when one is demanded.
          send(1, { rpcVersion: 1, ...(d.authentication ? { authentication: authToken(server.password, d.authentication.salt, d.authentication.challenge) } : {}) });
        } else if (op === 2) {
          // Identified. The program scene is whatever OBS is showing.
          send(6, { requestType: 'GetCurrentProgramScene', requestId: 'scene', requestData: {} });
        } else if (op === 7 && d.requestId === 'scene') {
          const scene = d.responseData?.currentProgramSceneName ?? d.responseData?.sceneName;
          if (!scene) return done(null);
          // 1920 wide: enough for HUD text, and sized so the vision model's
          // window (see look's num_ctx) still holds the image and an answer.
          send(6, { requestType: 'GetSourceScreenshot', requestId: 'shot', requestData: { sourceName: scene, imageFormat: 'png', imageWidth: 1920 } });
        } else if (op === 7 && d.requestId === 'shot') {
          const data = d.responseData?.imageData;
          const image = typeof data === 'string' && data.includes('base64,') ? imageBase64(data) : null;
          done(image && !looksBlank(image) ? image : null);
        }
      } catch {
        done(null);
      }
    };
  });
}
