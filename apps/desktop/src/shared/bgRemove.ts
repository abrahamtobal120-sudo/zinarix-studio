/**
 * Fase 1B (plan de funciones): remove the background of a picture on this PC, without paying and
 * without uploading it. A salient-object model (U²-Net / IS-Net, Apache-2.0, run with ONNX
 * Runtime Web in a separate process) gives a mask; these pure functions prepare its input, turn
 * its output into an alpha mask at the picture's size and apply it. Shared by the image editor
 * (in its worker) and the agent tool (main process).
 */
import type { Rgba } from './imageEdit.js';

export type BgModelId = 'fast' | 'precise';

export interface BgModel {
  id: BgModelId;
  file: string;
  /** The model's square input side. */
  side: number;
  mean: [number, number, number];
  std: [number, number, number];
  /** Download size in bytes and its SHA-256 (the file is checked before it is used). */
  bytes: number;
  sha256: string;
  url: string;
}

const RELEASE = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/';

export const BG_MODELS: Record<BgModelId, BgModel> = {
  // U²-Net small (Qin et al., Apache-2.0): 4.6 MB, ~0.3 s. Ships with the app.
  fast: {
    id: 'fast',
    file: 'u2netp.onnx',
    side: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    bytes: 4_574_861,
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    url: `${RELEASE}u2netp.onnx`,
  },
  // IS-Net general use (DIS, Apache-2.0): 179 MB, ~2 s, much finer edges. Downloaded on demand.
  precise: {
    id: 'precise',
    file: 'isnet-general-use.onnx',
    side: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
    bytes: 178_648_008,
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    url: `${RELEASE}isnet-general-use.onnx`,
  },
};

export interface BgModelState {
  id: BgModelId;
  ready: boolean;
  bytes: number;
  /** Bytes downloaded so far while a download runs. */
  downloading?: number;
}

export interface BgStatusView {
  /** False when this installation lacks the background-removal program. */
  available: boolean;
  models: BgModelState[];
}

export const isBgModelId = (x: unknown): x is BgModelId => x === 'fast' || x === 'precise';

/** Bilinear sample of channel c (0..3) of an RGBA picture at (x, y) in pixel centres. */
function sample(img: Rgba, x: number, y: number, c: number): number {
  const { width: w, height: h, data } = img;
  const fx = Math.min(Math.max(x, 0), w - 1);
  const fy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = data[(y0 * w + x0) * 4 + c]!;
  const b = data[(y0 * w + x1) * 4 + c]!;
  const d = data[(y1 * w + x0) * 4 + c]!;
  const e = data[(y1 * w + x1) * 4 + c]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
}

/**
 * The model's input: the picture squeezed to side × side (area average when shrinking a lot,
 * so small details are not aliased away), divided by its brightest value and normalised, laid
 * out as planar float32 [1, 3, side, side]. Transparent pixels count as black, like rembg.
 */
export function modelInput(img: Rgba, m: Pick<BgModel, 'side' | 'mean' | 'std'>): Float32Array {
  const S = m.side;
  const { width: w, height: h } = img;
  const rgb = new Float32Array(3 * S * S);
  const kx = w / S;
  const ky = h / S;
  // Sub-samples per output pixel along each axis (1 when enlarging).
  const nx = Math.max(1, Math.min(8, Math.round(kx)));
  const ny = Math.max(1, Math.min(8, Math.round(ky)));
  let max = 1;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const sx = (x + (i + 0.5) / nx) * kx - 0.5;
          const sy = (y + (j + 0.5) / ny) * ky - 0.5;
          const a = sample(img, sx, sy, 3) / 255;
          r += sample(img, sx, sy, 0) * a;
          g += sample(img, sx, sy, 1) * a;
          b += sample(img, sx, sy, 2) * a;
        }
      const n = nx * ny;
      const o = y * S + x;
      rgb[o] = r / n;
      rgb[S * S + o] = g / n;
      rgb[2 * S * S + o] = b / n;
      max = Math.max(max, rgb[o]!, rgb[S * S + o]!, rgb[2 * S * S + o]!);
    }
  for (let c = 0; c < 3; c++) {
    const off = c * S * S;
    for (let i = 0; i < S * S; i++) rgb[off + i] = (rgb[off + i]! / max - m.mean[c]!) / m.std[c]!;
  }
  return rgb;
}

/**
 * The model's output (side × side probabilities) as an 8-bit alpha mask of w × h: stretched to
 * 0…1 like rembg, enlarged with bilinear filtering, with a gentle S-curve so the subject is solid
 * and the background clear while the edge stays soft.
 */
export function maskFromOutput(out: Float32Array, side: number, w: number, h: number): Uint8Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < side * side; i++) {
    const v = out[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  const curve = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    // Values under 4 % are background noise, over 96 % solid subject.
    const t = Math.min(1, Math.max(0, (i / 1023 - 0.04) / 0.92));
    curve[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  const mask = new Uint8Array(w * h);
  const kx = side / w;
  const ky = side / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) * ky - 0.5, 0), side - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, side - 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) * kx - 0.5, 0), side - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, side - 1);
      const tx = fx - x0;
      const v =
        (out[y0 * side + x0]! * (1 - tx) + out[y0 * side + x1]! * tx) * (1 - ty) +
        (out[y1 * side + x0]! * (1 - tx) + out[y1 * side + x1]! * tx) * ty;
      mask[y * w + x] = curve[Math.round(((v - lo) / span) * 1023)]!;
    }
  }
  return mask;
}

/** A mask of w × h resized to W × H (bilinear), e.g. the full-size mask for the preview. */
export function resizeMask(mask: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  if (w === W && h === H) return mask;
  const f = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) f[i] = mask[i]!;
  const out = new Uint8Array(W * H);
  const kx = w / W;
  const ky = h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(Math.max((y + 0.5) * ky - 0.5, 0), h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, h - 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(Math.max((x + 0.5) * kx - 0.5, 0), w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, w - 1);
      const tx = fx - x0;
      out[y * W + x] = Math.round(
        (f[y0 * w + x0]! * (1 - tx) + f[y0 * w + x1]! * tx) * (1 - ty) +
          (f[y1 * w + x0]! * (1 - tx) + f[y1 * w + x1]! * tx) * ty,
      );
    }
  }
  return out;
}

/** The picture with the mask as its alpha (multiplied with any alpha it already had). */
export function applyMask(img: Rgba, mask: Uint8Array): Rgba {
  if (mask.length !== img.width * img.height) throw new Error('The mask does not match the picture.');
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) d[p] = (d[p]! * mask[i]!) / 255;
  return { width: img.width, height: img.height, data: d };
}

/** "#rrggbb" (or "#rgb") → [r, g, b], null when it is not a colour. */
export function parseHex(hex: unknown): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  let m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    const s = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim());
    if (!s) return null;
    m = [s[0], s[1]! + s[1] + s[2] + s[2] + s[3] + s[3]] as unknown as RegExpExecArray;
  }
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The picture over a solid colour (fully opaque result). */
export function fillBackdrop(img: Rgba, hex: string): Rgba {
  const c = parseHex(hex);
  if (!c) return img;
  const d = new Uint8ClampedArray(img.data);
  for (let p = 0; p < d.length; p += 4) {
    const a = d[p + 3]! / 255;
    if (a >= 1) continue;
    d[p] = d[p]! * a + c[0] * (1 - a);
    d[p + 1] = d[p + 1]! * a + c[1] * (1 - a);
    d[p + 2] = d[p + 2]! * a + c[2] * (1 - a);
    d[p + 3] = 255;
  }
  return { width: img.width, height: img.height, data: d };
}

/** The box around what is visible (alpha over the threshold), with a margin; null when empty. */
export function contentBox(
  img: Rgba,
  pad = 0,
  threshold = 8,
): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]! > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Share of the picture the mask keeps (0…1), to tell "nothing found" apart. */
export function maskCoverage(mask: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < mask.length; i++) s += mask[i]!;
  return mask.length ? s / (255 * mask.length) : 0;
}
