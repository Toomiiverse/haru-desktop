/**
 * Her hair, moving: one WebGL quad that redraws the picture's hair as rigid
 * locks over a plate with the hair painted out. Nothing is warped: each lock
 * turns as a whole about its own root.
 *
 * Every output pixel asks each lock where it would have come from (the pixel
 * turned back about that lock's pivot) and keeps it if that source pixel is
 * hair belonging to that lock. Locks are separated by lines that run through
 * the skin gaps between their tips, so no lock is ever split. Under the locks a
 * still copy of the hair's interior fills the slivers that open between
 * neighbours near the crown.
 *
 * Her head turns (yaw) and nods (pitch) the way a Live2D model's does: the
 * picture is warped as if painted on a rounded head, so what is at the front
 * of it (nose, eyes, mouth, fringe) slides furthest and her outline and what
 * is beyond it stay put. The plate under everything is drawn by its own layer
 * here with the same warp, so the face and the hair turn as one.
 */
export type Lock = {
  /** Where the lock hangs from, in texture px; usually above the picture. */
  pivot: [number, number];
  /** Its source area: x between the two boundaries, y from top to bottom. A boundary is x = a + b*max(y, kink): straight up above `kink`, so neighbours never cross. */
  left: [number, number]; right: [number, number]; top: number; bottom: number;
};
export type HairAssets = {
  /** The whole picture; colour comes from here. */
  image: string;
  /** The picture's size: red = hair that moves, green = still hair interior drawn under it. */
  mask: string;
  locks: Lock[];
  kink: number;
  /** Her head as an ellipse, as fractions of the picture: centre x, y and radii x, y. Without it the picture never turns. */
  head?: Head;
};
export type Head = [number, number, number, number];
/** How far her head is turned: sine of yaw (+ turns her face toward the picture's right) and of pitch (+ down). */
export type Turn = [number, number];
/** Per frame: each lock's angle in radians, in `locks` order, and the turn. */
export type HairLayer = { draw(angles: number[], turn?: Turn): void; dispose(): void };
export type PlateLayer = { draw(turn: Turn): void; dispose(): void };

/**
 * The turn's warp: her head as a cylinder for each axis. Turning (yaw), what is in line with the head's centre
 * (nose, mouth, chin, fringe) moves by the radius times the sine of the turn, falling off as 1 - u^2 to nothing at
 * her outline; nodding (pitch) the same top to bottom. Past the head (beyond 1.2 radii) nothing moves.
 * `unwarp` takes an output pixel back to where it came from (one fixed-point step inverts the small shifts).
 */
const WARP = `
uniform vec4 head;
uniform vec2 turn;
vec2 headShift(vec2 q) {
  vec2 u = (q - head.xy) / head.zw;
  float zx = max(0.0, 1.0 - u.x * u.x) * (1.0 - smoothstep(0.9, 1.2, abs(u.y)));
  float zy = max(0.0, 1.0 - u.y * u.y) * (1.0 - smoothstep(0.9, 1.2, abs(u.x)));
  return turn * head.zw * vec2(zx, zy);
}
vec2 unwarp(vec2 p) { return p - headShift(p - headShift(p)); }`;

/** The same shift in JS, for what is drawn over the picture (eyes, mouth), in the units `head` is given in. */
export function headShift(head: Head, turn: Turn, x: number, y: number): [number, number] {
  const u = (x - head[0]) / head[2], v = (y - head[1]) / head[3];
  const fall = (a: number) => { const t = Math.min(1, Math.max(0, (Math.abs(a) - 0.9) / 0.3)); return 1 - t * t * (3 - 2 * t); };
  return [turn[0] * head[2] * Math.max(0, 1 - u * u) * fall(v), turn[1] * head[3] * Math.max(0, 1 - v * v) * fall(u)];
}

const MAX_LOCKS = 12;
const VERTEX = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const FRAGMENT = `
precision highp float;
#define MAX_LOCKS ${MAX_LOCKS}
uniform sampler2D image, mask;
uniform vec2 canvas, size;
uniform int count;
uniform float kink;
uniform vec4 bounds[MAX_LOCKS];   // left a, left b, right a, right b
uniform vec2 span[MAX_LOCKS];     // top, bottom
uniform vec2 pivot[MAX_LOCKS];
uniform float angle[MAX_LOCKS];
${WARP}
void main() {
  vec2 uv = gl_FragCoord.xy / canvas;
  vec2 p = unwarp(vec2(uv.x, 1.0 - uv.y) * size);
  float still = texture2D(mask, p / size).g;
  vec4 out_ = vec4(texture2D(image, p / size).rgb * still, still);
  for (int i = 0; i < MAX_LOCKS; i++) {
    if (i >= count) break;
    float c = cos(angle[i]), s = sin(angle[i]);
    vec2 r = p - pivot[i];
    vec2 src = pivot[i] + vec2(c * r.x + s * r.y, -s * r.x + c * r.y);
    vec4 b = bounds[i];
    float k = max(src.y, kink);
    if (src.x < b.x + b.y * k || src.x >= b.z + b.w * k || src.y < span[i].x || src.y >= span[i].y) continue;
    float a = texture2D(mask, src / size).r;
    out_ = vec4(texture2D(image, src / size).rgb * a, a) + out_ * (1.0 - a);
  }
  gl_FragColor = out_;
}`;

const PLATE = `
precision highp float;
uniform sampler2D image;
uniform vec2 canvas, size;
${WARP}
void main() {
  vec2 uv = gl_FragCoord.xy / canvas;
  gl_FragColor = texture2D(image, unwarp(vec2(uv.x, 1.0 - uv.y) * size) / size);
}`;

function load(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`hair texture failed: ${url}`));
    img.src = url;
  });
}

/** One full-canvas quad drawn by `fragment` over the images (texture units in order); null if WebGL or a texture fails. */
async function quad(canvas: HTMLCanvasElement, fragment: string, urls: string[], head?: Head) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  let images: HTMLImageElement[];
  try { images = await Promise.all(urls.map(load)); } catch { return null; }

  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'hair shader');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const textures = images.map((img, unit) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Not powers of two: WebGL 1 allows that only with clamped, unmipped sampling.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // The canvas is premultiplied: a picture that is see-through somewhere (the side view past her hair) must be too.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return texture;
  });
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform2f(at('size'), images[0].naturalWidth, images[0].naturalHeight);
  // In texture px. Without a head the warp is the identity: a unit ellipse that never turns.
  const [w, h] = [images[0].naturalWidth, images[0].naturalHeight];
  gl.uniform4fv(at('head'), head ? [head[0] * w, head[1] * h, head[2] * w, head[3] * h] : [0, 0, 1, 1]);
  const canvasSize = at('canvas'), turnAt = at('turn');
  return {
    gl, at,
    draw(set: () => void, turn: Turn = [0, 0]) {
      const width = Math.round(canvas.clientWidth * devicePixelRatio), height = Math.round(canvas.clientHeight * devicePixelRatio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(canvasSize, width, height);
      gl.uniform2fv(turnAt, head ? turn : [0, 0]);
      set();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      textures.forEach(texture => gl.deleteTexture(texture));
      gl.deleteProgram(program);
    },
  };
}

/** Null when WebGL or a texture is unavailable; the caller then keeps the hair still. */
export async function createHairLayer(canvas: HTMLCanvasElement, assets: HairAssets): Promise<HairLayer | null> {
  if (assets.locks.length > MAX_LOCKS) return null;
  const q = await quad(canvas, FRAGMENT, [assets.image, assets.mask], assets.head);
  if (!q) return null;
  const { gl, at } = q;
  gl.uniform1i(at('image'), 0);
  gl.uniform1i(at('mask'), 1);
  gl.uniform1i(at('count'), assets.locks.length);
  gl.uniform1f(at('kink'), assets.kink);
  gl.uniform4fv(at('bounds'), assets.locks.flatMap(l => [...l.left, ...l.right]));
  gl.uniform2fv(at('span'), assets.locks.flatMap(l => [l.top, l.bottom]));
  gl.uniform2fv(at('pivot'), assets.locks.flatMap(l => l.pivot));
  const angle = at('angle');
  return { draw: (angles, turn) => q.draw(() => gl.uniform1fv(angle, angles), turn), dispose: q.dispose };
}

/** The plate (the picture with her hair painted out), turned with her head; null when WebGL is unavailable. */
export async function createPlateLayer(canvas: HTMLCanvasElement, plate: string, head: Head): Promise<PlateLayer | null> {
  const q = await quad(canvas, PLATE, [plate], head);
  if (!q) return null;
  q.gl.uniform1i(q.at('image'), 0);
  return { draw: turn => q.draw(() => {}, turn), dispose: q.dispose };
}
