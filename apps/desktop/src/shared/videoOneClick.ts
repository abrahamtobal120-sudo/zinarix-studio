/**
 * Fase 11D: the one-click tools of the Easy tab and the Inspector, as pure edits plus the FFmpeg
 * filters they add to the export:
 *
 * - Automatic colour: the clip is measured (average of each channel and the dark / bright ends of
 *   the brightness) and a colour grade (Fase 12, same maths in preview and export) fixes levels,
 *   midtones and white balance.
 * - Stabilise: FFmpeg's `deshake`, computed by the export (it needs the frames around each one,
 *   so the live preview shows the clip as shot).
 * - Green screen: FFmpeg's `colorkey`; the preview keys the same pixels with the same formula.
 * - Picture in picture: the clip goes to a track above, smaller, in a corner.
 * - Social formats: centre reframing and a check that titles stay inside each network's safe zone.
 *
 * No runtime imports from video.ts other than helpers (video.ts imports the validators from here).
 */
import type { Clip, VideoProject } from './video.js';
import type { ColorGrade } from './videoColor.js';

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const HEX = /^#[0-9a-f]{6}$/i;

// ---------------- green screen ----------------

export interface ChromaKey {
  /** The colour taken out, #rrggbb. */
  color: string;
  /** 0.01–1: how far from the colour still counts as it (RGB distance, like colorkey). */
  similarity: number;
  /** 0–1: soft edge above the similarity (0 = hard cut). */
  blend: number;
}
export const CHROMA_DEFAULT: ChromaKey = { color: '#00ff00', similarity: 0.3, blend: 0.1 };
export const CHROMA_BLUE = '#0047bb';

export function validChroma(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const k = x as ChromaKey;
  return (
    typeof k.color === 'string' &&
    HEX.test(k.color) &&
    Number.isFinite(k.similarity) &&
    Number.isFinite(k.blend)
  );
}

/** Values in range (undefined stays undefined). */
export function cleanChroma(k: ChromaKey | undefined): ChromaKey | undefined {
  if (!k || !validChroma(k)) return undefined;
  return {
    color: k.color.toLowerCase(),
    similarity: r3(clamp(k.similarity, 0.01, 1)),
    blend: r3(clamp(k.blend, 0, 1)),
  };
}

const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Alpha (0–1) the key leaves on an 8-bit pixel: FFmpeg colorkey's formula. */
export function chromaAlpha(r: number, g: number, b: number, key: ChromaKey): number {
  const [kr, kg, kb] = rgbOf(key.color);
  const dr = r - kr;
  const dg = g - kg;
  const db = b - kb;
  const diff = Math.sqrt((dr * dr + dg * dg + db * db) / (255 * 255 * 3));
  if (key.blend > 0.0001) return clamp((diff - key.similarity) / key.blend, 0, 1);
  return diff > key.similarity ? 1 : 0;
}

/** Keys RGBA pixels in place (the preview's pass; alpha is replaced like colorkey does). */
export function chromaPixels(data: Uint8ClampedArray | Uint8Array, key: ChromaKey): void {
  const k = cleanChroma(key);
  if (!k) return;
  for (let i = 0; i < data.length; i += 4) {
    const a = chromaAlpha(data[i]!, data[i + 1]!, data[i + 2]!, k);
    data[i + 3] = Math.round(a * 255 * (data[i + 3]! / 255));
  }
}

/** The export's filters for a clip's key (input in RGBA). */
export function chromaFilters(c: Pick<Clip, 'chroma'>): string[] {
  const k = cleanChroma(c.chroma);
  if (!k) return [];
  return [`colorkey=0x${k.color.slice(1)}:${k.similarity}:${k.blend}`];
}

// ---------------- stabilise ----------------

/** The export's filters for a stabilised clip (on the source frames, before any scaling). */
export function stabilizeFilters(c: Pick<Clip, 'stabilize'>, kind: string): string[] {
  return c.stabilize === true && kind === 'video' ? ['deshake=rx=32:ry=32:edge=mirror'] : [];
}

// ---------------- edits ----------------

const editable = (p: VideoProject, c: Clip | undefined): c is Clip =>
  !!c && !c.text && !p.tracks.find((t) => t.id === c.trackId)?.locked;

function mapClips(
  p: VideoProject,
  ids: readonly string[],
  fn: (c: Clip) => Clip,
  ok: (c: Clip) => boolean = () => true,
): VideoProject {
  const set = new Set(ids);
  let hit = false;
  const clips = p.clips.map((c) => {
    if (!set.has(c.id) || !editable(p, c) || !ok(c)) return c;
    hit = true;
    return fn(c);
  });
  return hit ? { ...p, clips } : p;
}

const kindOf = (p: VideoProject, c: Clip) => p.media.find((m) => m.id === c.mediaId)?.kind;

/** Green screen on (a key) or off (undefined) for some clips. */
export function setChroma(
  p: VideoProject,
  ids: readonly string[],
  key: ChromaKey | undefined,
): VideoProject {
  const k = cleanChroma(key);
  return mapClips(
    p,
    ids,
    (c) => {
      const next = { ...c, chroma: k };
      if (!k) delete next.chroma;
      return next;
    },
    (c) => kindOf(p, c) !== 'audio',
  );
}

/** Stabilisation on or off for some video clips. */
export function setStabilize(p: VideoProject, ids: readonly string[], on: boolean): VideoProject {
  return mapClips(
    p,
    ids,
    (c) => {
      const next = { ...c, stabilize: true as const };
      if (!on) delete (next as Partial<Clip>).stabilize;
      return next;
    },
    (c) => kindOf(p, c) === 'video',
  );
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];
export const PIP_SIZE = 0.32;
const PIP_MARGIN = 0.04;

/**
 * Picture in picture: the clip moves to the first video track above its own that is free at
 * its time (a new track on top when none is), shrunk to `size` of the frame and put in a corner
 * with a small margin. Its keys on x, y and scale are dropped (the corner is a fixed place).
 */
export function pictureInPicture(
  p: VideoProject,
  id: string,
  corner: Corner = 'br',
  size = PIP_SIZE,
  /** addTrack from video.ts (passed in: this module has no runtime import of it). */
  addVideoTrack: (p: VideoProject) => VideoProject,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c) || kindOf(p, c) === 'audio') return p;
  const m = p.media.find((x) => x.id === c.mediaId);
  const s = clamp(size, 0.1, 0.9);
  const end = c.start + (c.out - c.in) / (c.speed ?? 1);
  const videoTracks = (q: VideoProject) => q.tracks.filter((t) => t.kind === 'video');
  // Display order is top first: the tracks above c's are the ones before it.
  const free = (q: VideoProject, tid: string) =>
    !q.clips.some((x) => x.trackId === tid && x.id !== id && x.start < end && x.start + (x.out - x.in) / (x.speed ?? 1) > c.start);
  let next = p;
  const vt = videoTracks(next);
  const mine = vt.findIndex((t) => t.id === c.trackId);
  let target = vt.slice(0, Math.max(0, mine)).reverse().find((t) => !t.locked && free(next, t.id));
  if (!target) {
    next = addVideoTrack(next);
    target = videoTracks(next)[0]!;
  }
  // The picture's size as a share of the frame at scale s (it fits first).
  const w = m?.width ?? 0;
  const h = m?.height ?? 0;
  const fit = w > 0 && h > 0 ? Math.min(p.width / w, p.height / h) : 1;
  const pw = w > 0 ? (w * fit * s) / p.width : s;
  const ph = h > 0 ? (h * fit * s) / p.height : s;
  const right = corner === 'tr' || corner === 'br';
  const bottom = corner === 'bl' || corner === 'br';
  const x = r3((right ? 1 : -1) * (0.5 - pw / 2 - PIP_MARGIN));
  const y = r3((bottom ? 1 : -1) * (0.5 - ph / 2 - PIP_MARGIN * (p.width / p.height)));
  const kf = { ...c.keyframes };
  delete kf.x;
  delete kf.y;
  delete kf.scale;
  const moved: Clip = {
    ...c,
    trackId: target.id,
    transform: {
      x,
      y,
      scale: r3(s),
      rotation: c.transform?.rotation ?? 0,
      opacity: c.transform?.opacity ?? 1,
      flipH: c.transform?.flipH ?? false,
      flipV: c.transform?.flipV ?? false,
    },
    keyframes: Object.keys(kf).length ? kf : undefined,
  };
  if (!moved.keyframes) delete moved.keyframes;
  return { ...next, clips: next.clips.map((x2) => (x2.id === id ? moved : x2)) };
}

// ---------------- automatic colour ----------------

/** What the measuring pass found (0–1): channel averages and the brightness ends. */
export interface ColorStats {
  r: number;
  g: number;
  b: number;
  /** Brightness at the 1st and 99th percentile, and its average. */
  lo: number;
  hi: number;
  mean: number;
}

/** Stats of RGB(A) pixels (8 bits; `channels` = 3 for rgb24, 4 for rgba). */
export function frameColorStats(px: Uint8Array | Uint8ClampedArray, channels = 3): ColorStats {
  const hist = new Uint32Array(256);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 2 < px.length; i += channels) {
    r += px[i]!;
    g += px[i + 1]!;
    b += px[i + 2]!;
    hist[Math.round(0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!)]!++;
    n++;
  }
  if (!n) return { r: 0.5, g: 0.5, b: 0.5, lo: 0, hi: 1, mean: 0.5 };
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= q * n) return v / 255;
    }
    return 1;
  };
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v]!;
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255, lo: pct(0.01), hi: pct(0.99), mean: sum / n / 255 };
}

const LIFT_K = 0.4; // videoColor.ts: lift wheel reach
const GAMMA_K = 1;
const AUTO_WHITE = 0.96;
const AUTO_BLACK = 0.02;
const AUTO_MID = 0.45;

/**
 * A colour grade that stretches the levels (the 99th percentile to near white, the 1st to near
 * black), brings the midtones toward a middle grey and evens the channels (grey world), with
 * moderate limits so a dark night shot or a sunset is corrected, not flattened.
 */
export function autoGrade(s: ColorStats): ColorGrade | undefined {
  const lum = (x: number) => clamp(x, 0, 1);
  const lo = lum(s.lo);
  const hi = Math.max(lo + 0.05, lum(s.hi));
  // Levels: gain so hi → white, then a (negative) lift so lo → black.
  const G = clamp(AUTO_WHITE / hi, 0.6, 1.8);
  const loG = lo * G;
  const L = clamp((AUTO_BLACK - loG) / Math.max(0.05, 1 - loG), -0.3, 0.3);
  // White balance (grey world), kept within ±15 %.
  const grey = (s.r + s.g + s.b) / 3;
  const ch = [s.r, s.g, s.b].map((v) => clamp(v > 0.01 ? grey / v : 1, 0.85, 1.15));
  // Midtones: the mean after levels toward AUTO_MID.
  const after = clamp(s.mean * G + L * (1 - s.mean * G), 0.02, 0.98);
  const exp = clamp(Math.log(AUTO_MID) / Math.log(after), 0.6, 1.6);
  const gammaW = clamp(-Math.log2(exp) / GAMMA_K, -0.5, 0.5);
  const w = (v: number) => r3(clamp(v, -1, 1));
  const grade: ColorGrade = {
    gain: { m: w(G - 1), r: w(G * (ch[0]! - 1)), g: w(G * (ch[1]! - 1)), b: w(G * (ch[2]! - 1)) },
    lift: { m: w(L / LIFT_K) },
    gamma: { m: w(gammaW) },
  };
  // Drop the neutral parts (videoColor's cleanGrade would too; kept here to stay import-free).
  for (const k of ['gain', 'lift', 'gamma'] as const) {
    const wh = grade[k]!;
    for (const kk of Object.keys(wh) as (keyof typeof wh)[]) if (Math.abs(wh[kk]!) < 0.005) delete wh[kk];
    if (!Object.keys(wh).length) delete grade[k];
  }
  return Object.keys(grade).length ? grade : undefined;
}

// ---------------- social formats ----------------

/** Share of the frame the apps cover with their buttons and captions (top, bottom, sides). */
export const SAFE_ZONES: Record<'vertical' | 'square' | 'wide', { top: number; bottom: number; side: number }> = {
  vertical: { top: 0.12, bottom: 0.2, side: 0.06 },
  square: { top: 0.06, bottom: 0.1, side: 0.06 },
  wide: { top: 0.05, bottom: 0.05, side: 0.05 },
};
export const safeZoneFor = (w: number, h: number) =>
  h > w * 1.2 ? SAFE_ZONES.vertical : Math.abs(w - h) < Math.max(w, h) * 0.1 ? SAFE_ZONES.square : SAFE_ZONES.wide;

/**
 * Centre reframing for another frame size: each picture is zoomed (by its transform scale) so it
 * fills the new frame, cropping the sides equally. Titles and audio stay as they are.
 */
export function reframeCenter(p: VideoProject, width: number, height: number): VideoProject {
  if (!(width > 0 && height > 0)) return p;
  const clips = p.clips.map((c) => {
    const m = p.media.find((x) => x.id === c.mediaId);
    if (c.text || !m || m.kind === 'audio' || !(m.width > 0 && m.height > 0)) return c;
    if (c.keyframes?.scale?.length) return c;
    const fit = Math.min(width / m.width, height / m.height);
    const cover = Math.max(width / m.width, height / m.height);
    const t = c.transform;
    return {
      ...c,
      transform: {
        x: t?.x ?? 0,
        y: t?.y ?? 0,
        scale: r3(cover / fit),
        rotation: t?.rotation ?? 0,
        opacity: t?.opacity ?? 1,
        flipH: t?.flipH ?? false,
        flipV: t?.flipV ?? false,
      },
    };
  });
  return { ...p, width, height, clips };
}

/**
 * Titles that reach outside the safe zone of a frame size: their estimated box (lines × size
 * tall, ~0.55 × size per letter wide) against the margins. Returns their clip ids.
 */
export function safeZoneIssues(p: VideoProject, width: number, height: number): string[] {
  const z = safeZoneFor(width, height);
  const out: string[] = [];
  for (const c of p.clips) {
    if (!c.text || c.text.content.trim() === '') continue;
    const lines = c.text.content.split('\n');
    const longest = Math.max(...lines.map((l) => [...l].length));
    const sz = c.text.size * (c.transform?.scale ?? 1);
    const hShare = sz * 1.22 * lines.length;
    const wShare = (longest * 0.55 * sz * height) / width;
    const cx = 0.5 + (c.transform?.x ?? 0);
    const cy = 0.5 + (c.transform?.y ?? 0);
    if (
      cy - hShare / 2 < z.top ||
      cy + hShare / 2 > 1 - z.bottom ||
      cx - wShare / 2 < z.side ||
      cx + wShare / 2 > 1 - z.side
    )
      out.push(c.id);
  }
  return out;
}

/** Moves titles back inside the safe zone (shrinking the ones too wide or tall for it). */
export function fitTitlesToSafeZone(p: VideoProject, width: number, height: number): VideoProject {
  const z = safeZoneFor(width, height);
  const bad = new Set(safeZoneIssues(p, width, height));
  if (!bad.size) return p;
  const clips = p.clips.map((c) => {
    if (!bad.has(c.id) || !c.text) return c;
    const lines = c.text.content.split('\n');
    const longest = Math.max(...lines.map((l) => [...l].length));
    const t = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, ...c.transform };
    const room = { w: 1 - 2 * z.side, h: 1 - z.top - z.bottom };
    const sz = c.text.size * t.scale;
    const wShare = (longest * 0.55 * sz * height) / width;
    const hShare = sz * 1.22 * lines.length;
    const k = Math.min(1, room.w / Math.max(wShare, 1e-6), room.h / Math.max(hShare, 1e-6));
    const scale = r3(t.scale * k * 0.98);
    const w2 = wShare * k * 0.98;
    const h2 = hShare * k * 0.98;
    const cx = clamp(0.5 + t.x, z.side + w2 / 2, 1 - z.side - w2 / 2);
    const cy = clamp(0.5 + t.y, z.top + h2 / 2, 1 - z.bottom - h2 / 2);
    return { ...c, transform: { ...t, scale, x: r3(cx - 0.5), y: r3(cy - 0.5) } };
  });
  return { ...p, clips };
}
