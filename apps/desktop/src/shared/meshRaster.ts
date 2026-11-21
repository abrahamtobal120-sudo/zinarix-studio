/**
 * Fase 7: a tiny software renderer (z-buffer, flat shading, orthographic) so the agent can SEE
 * a CAD model or a mesh without a window or a GPU: 4 views on one picture. Z is up.
 */
import { boundsOf, type Tris } from './mesh3d.js';

export type MeshView = 'iso' | 'front' | 'right' | 'top';

export interface RasterOptions {
  width: number;
  height: number;
  view: MeshView;
  /** Model colour, "#rrggbb". */
  color?: string;
  background?: string;
  /** Both sides the same colour (G-code ribbons have no inside). */
  twoSided?: boolean;
}

const hex = (c: string, fallback: [number, number, number]): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return fallback;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Camera basis: right, up and toward-the-viewer vectors of a view. */
function basis(view: MeshView): [number[], number[], number[]] {
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    return v.map((x) => x / l);
  };
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  // Direction from the model to the eye.
  const eye =
    view === 'front' ? [0, -1, 0] : view === 'right' ? [1, 0, 0] : view === 'top' ? [0, 0, 1] : norm([1, -1.2, 0.9]);
  const worldUp = view === 'top' ? [0, 1, 0] : [0, 0, 1];
  const right = norm(cross(worldUp, eye));
  const up = cross(eye, right);
  return [right, norm(up), eye];
}

/** RGBA pixels of one view of the mesh, fitted to the frame with a margin. */
export function rasterize(t: Tris, o: RasterOptions): Uint8ClampedArray {
  const { width: W, height: H } = o;
  const px = new Uint8ClampedArray(W * H * 4);
  const bg = hex(o.background ?? '#20232a', [32, 35, 42]);
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  const n = Math.floor(t.length / 9);
  if (!n) return px;
  const [R, U, E] = basis(o.view);
  const b = boundsOf(t);
  const c = [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2);
  // Projected extent of the bounding box corners.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = [k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]].map(
      (v, i) => v! - c[i]!,
    );
    const x = p[0]! * R[0]! + p[1]! * R[1]! + p[2]! * R[2]!;
    const y = p[0]! * U[0]! + p[1]! * U[1]! + p[2]! * U[2]!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const scale = Math.min((W * 0.86) / Math.max(maxX - minX, 1e-9), (H * 0.86) / Math.max(maxY - minY, 1e-9));
  const ox = W / 2 - ((minX + maxX) / 2) * scale;
  const oy = H / 2 + ((minY + maxY) / 2) * scale;
  const zbuf = new Float32Array(W * H).fill(-Infinity);
  const base = hex(o.color ?? '#f0a640', [240, 166, 64]);
  const light = [0.35, -0.5, 0.8];
  const ll = Math.hypot(...light);
  const sx = new Float64Array(3), sy = new Float64Array(3), sz = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const q = i * 9;
    for (let v = 0; v < 3; v++) {
      const x = t[q + v * 3]! - c[0]!, y = t[q + v * 3 + 1]! - c[1]!, z = t[q + v * 3 + 2]! - c[2]!;
      sx[v] = ox + (x * R[0]! + y * R[1]! + z * R[2]!) * scale;
      sy[v] = oy - (x * U[0]! + y * U[1]! + z * U[2]!) * scale;
      sz[v] = x * E[0]! + y * E[1]! + z * E[2]!;
    }
    // Normal in world space for the shade; toward the eye decides front or back face.
    const ux = t[q + 3]! - t[q]!, uy = t[q + 4]! - t[q + 1]!, uz = t[q + 5]! - t[q + 2]!;
    const vx = t[q + 6]! - t[q]!, vy = t[q + 7]! - t[q + 1]!, vz = t[q + 8]! - t[q + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-20) continue;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const facing = nx * E[0]! + ny * E[1]! + nz * E[2]!;
    const sign = facing < 0 ? -1 : 1;
    const lam = Math.max(0, sign * (nx * light[0]! + ny * light[1]! + nz * light[2]!) / ll);
    const shade = 0.35 + 0.65 * lam;
    // Back faces (an open or inside-out mesh) are tinted red so they show.
    const col = facing < 0 && !o.twoSided ? [200 * shade, 60 * shade, 60 * shade] : [base[0] * shade, base[1] * shade, base[2] * shade];
    const x0 = Math.max(0, Math.floor(Math.min(sx[0]!, sx[1]!, sx[2]!)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(sx[0]!, sx[1]!, sx[2]!)));
    const y0 = Math.max(0, Math.floor(Math.min(sy[0]!, sy[1]!, sy[2]!)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(sy[0]!, sy[1]!, sy[2]!)));
    const area = (sx[1]! - sx[0]!) * (sy[2]! - sy[0]!) - (sx[2]! - sx[0]!) * (sy[1]! - sy[0]!);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const pxc = x + 0.5, pyc = y + 0.5;
        const w0 = ((sx[1]! - pxc) * (sy[2]! - pyc) - (sx[2]! - pxc) * (sy[1]! - pyc)) / area;
        const w1 = ((sx[2]! - pxc) * (sy[0]! - pyc) - (sx[0]! - pxc) * (sy[2]! - pyc)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[0]! + w1 * sz[1]! + w2 * sz[2]!;
        const k = y * W + x;
        if (z <= zbuf[k]!) continue;
        zbuf[k] = z;
        px[k * 4] = col[0]!;
        px[k * 4 + 1] = col[1]!;
        px[k * 4 + 2] = col[2]!;
      }
  }
  return px;
}

/** Iso (large, left) and front / right / top (small, right column) on one picture. */
export function rasterViews(t: Tris, size = 768, color?: string, twoSided = false): { rgba: Uint8ClampedArray; width: number; height: number } {
  const W = Math.round(size * 1.5);
  const H = size;
  const out = new Uint8ClampedArray(W * H * 4);
  const blit = (src: Uint8ClampedArray, w: number, h: number, dx: number, dy: number) => {
    for (let y = 0; y < h; y++) out.set(src.subarray(y * w * 4, (y + 1) * w * 4), ((dy + y) * W + dx) * 4);
  };
  blit(rasterize(t, { width: size, height: size, view: 'iso', color, twoSided }), size, size, 0, 0);
  const s = Math.floor(size / 3);
  const views: MeshView[] = ['front', 'right', 'top'];
  views.forEach((v, i) => {
    const h = i === 2 ? H - 2 * s : s;
    blit(rasterize(t, { width: W - size, height: h, view: v, color, twoSided, background: i % 2 ? '#262a33' : '#2c303a' }), W - size, h, size, i * s);
  });
  return { rgba: out, width: W, height: H };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG from RGBA; `deflate` is zlib's (node:zlib deflateSync in main). */
export function encodePng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  deflate: (b: Uint8Array) => Uint8Array,
): Uint8Array {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    const td = new TextEncoder().encode(type);
    out.set(td, 4);
    out.set(data, 8);
    const body = new Uint8Array(4 + data.length);
    body.set(td);
    body.set(data, 4);
    dv.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflate(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const len = parts.reduce((a, p) => a + p.length, 0);
  const png = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}
