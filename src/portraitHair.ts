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
};
/** Per frame: each lock's angle in radians, in `locks` order. */
export type HairLayer = { draw(angles: number[]): void; dispose(): void };

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
void main() {
  vec2 uv = gl_FragCoord.xy / canvas;
  vec2 p = vec2(uv.x, 1.0 - uv.y) * size;
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

function load(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`hair texture failed: ${url}`));
    img.src = url;
  });
}

/** Null when WebGL or a texture is unavailable; the caller then keeps the hair still. */
export async function createHairLayer(canvas: HTMLCanvasElement, assets: HairAssets): Promise<HairLayer | null> {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl || assets.locks.length > MAX_LOCKS) return null;
  let images: HTMLImageElement[];
  try { images = await Promise.all([load(assets.image), load(assets.mask)]); } catch { return null; }

  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'hair shader');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return texture;
  });
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(at('image'), 0);
  gl.uniform1i(at('mask'), 1);
  gl.uniform2f(at('size'), images[0].naturalWidth, images[0].naturalHeight);
  gl.uniform1i(at('count'), assets.locks.length);
  gl.uniform1f(at('kink'), assets.kink);
  gl.uniform4fv(at('bounds'), assets.locks.flatMap(l => [...l.left, ...l.right]));
  gl.uniform2fv(at('span'), assets.locks.flatMap(l => [l.top, l.bottom]));
  gl.uniform2fv(at('pivot'), assets.locks.flatMap(l => l.pivot));
  const canvasSize = at('canvas'), angle = at('angle');

  return {
    draw(angles) {
      const width = Math.round(canvas.clientWidth * devicePixelRatio), height = Math.round(canvas.clientHeight * devicePixelRatio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(canvasSize, width, height);
      gl.uniform1fv(angle, angles);
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
