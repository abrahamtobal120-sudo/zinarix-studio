/**
 * Zinarix Video Studio, Fase 12: colour grading (lift / gamma / gain, temperature, tint) and
 * 3D LUTs in the .cube format. Pure maths shared by the preview and the export:
 *
 * - The grade is a per-channel curve. The preview samples it into 256-entry tables (an SVG
 *   feComponentTransfer, or the CPU path when a LUT is on), the export writes the very same
 *   formula as a `lutrgb` expression, so both give the same 8-bit values.
 * - LUTs are applied with trilinear interpolation on both sides (`lut3d=interp=trilinear`).
 *
 * No runtime imports from video.ts (it imports the validators from here).
 */

// ---------------- grade ----------------

/** A colour wheel: a master amount plus a push per channel, each −1…1. */
export interface Wheel {
  m?: number;
  r?: number;
  g?: number;
  b?: number;
}
export const WHEEL_KEYS = ['m', 'r', 'g', 'b'] as const;
export type WheelKey = (typeof WHEEL_KEYS)[number];

export interface ColorGrade {
  /** Shadows: raises (or crushes) the blacks. */
  lift?: Wheel;
  /** Midtones: positive = brighter. */
  gamma?: Wheel;
  /** Highlights: a multiplier, 0 = unchanged. */
  gain?: Wheel;
  /** −1 (cool, blue) … 1 (warm, orange). */
  temperature?: number;
  /** −1 (green) … 1 (magenta). */
  tint?: number;
  /** Absolute path of a .cube 3D LUT, applied after the wheels. */
  lut?: string;
  /** 0…1 strength of the LUT (missing = 1). */
  lutMix?: number;
}

export const WHEELS = ['lift', 'gamma', 'gain'] as const;
export type WheelName = (typeof WHEELS)[number];

/** How far each control reaches at ±1 (kept moderate: a wheel pushed to the end is still usable). */
const LIFT_K = 0.4;
const GAMMA_K = 1; // exponent 2^(∓1): from ×0.5 to ×2
const GAIN_K = 1;
const TEMP_K = 0.25;
const TINT_K = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const c1 = (v: unknown) => clamp(fin(v), -1, 1);

/** The three channels' parameters: v = x·gain; v = v + lift·(1 − v); out = clip(v)^exp. */
export interface ChannelCurve {
  gain: number;
  lift: number;
  exp: number;
}

/** Grade with every value in range and the neutral ones dropped (undefined = no grade). */
export function cleanGrade(g: ColorGrade | undefined): ColorGrade | undefined {
  if (!g) return undefined;
  const out: ColorGrade = {};
  for (const w of WHEELS) {
    const src = g[w];
    if (!src) continue;
    const wheel: Wheel = {};
    for (const k of WHEEL_KEYS) {
      const v = c1(src[k]);
      if (Math.abs(v) > 1e-4) wheel[k] = v;
    }
    if (Object.keys(wheel).length) out[w] = wheel;
  }
  const t = c1(g.temperature);
  if (Math.abs(t) > 1e-4) out.temperature = t;
  const ti = c1(g.tint);
  if (Math.abs(ti) > 1e-4) out.tint = ti;
  if (typeof g.lut === 'string' && g.lut.trim() && g.lut.length <= 4096) {
    out.lut = g.lut;
    const mix = clamp(g.lutMix === undefined ? 1 : fin(g.lutMix), 0, 1);
    if (mix < 1 - 1e-4) out.lutMix = mix;
    if (mix < 1e-4) {
      delete out.lut;
      delete out.lutMix;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const hasCurve = (g: ColorGrade | undefined): boolean =>
  !!g && !!(g.lift || g.gamma || g.gain || g.temperature || g.tint);

/** Whether the grade changes anything apart from the LUT. */
export const gradeHasCurves = (g: ColorGrade | undefined): boolean => hasCurve(cleanGrade(g));

/** Per channel (r, g, b) curve parameters of a grade. */
export function channelCurves(g: ColorGrade | undefined): [ChannelCurve, ChannelCurve, ChannelCurve] {
  const e = cleanGrade(g) ?? {};
  const t = e.temperature ?? 0;
  const ti = e.tint ?? 0;
  const wb = [1 + TEMP_K * t, 1 - TINT_K * ti, 1 - TEMP_K * t];
  const ch = (['r', 'g', 'b'] as const).map((k, i): ChannelCurve => {
    const w = (wheel: Wheel | undefined) => (wheel?.m ?? 0) + (wheel?.[k] ?? 0);
    return {
      gain: Math.max(0, (1 + GAIN_K * w(e.gain)) * wb[i]!),
      lift: LIFT_K * w(e.lift),
      exp: Math.pow(2, -GAMMA_K * w(e.gamma)),
    };
  });
  return ch as [ChannelCurve, ChannelCurve, ChannelCurve];
}

/** One channel, 0…1 in and out. */
export function curveAt(c: ChannelCurve, x: number): number {
  let v = x * c.gain;
  v = v + c.lift * (1 - v);
  v = clamp(v, 0, 1);
  return Math.pow(v, c.exp);
}

/** 256-entry 8-bit tables (r, g, b), rounded like the export's expression. */
export function gradeTables(g: ColorGrade | undefined): [Uint8Array, Uint8Array, Uint8Array] {
  return channelCurves(g).map((c) => {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) t[i] = Math.floor(255 * curveAt(c, i / 255) + 0.5);
    return t;
  }) as [Uint8Array, Uint8Array, Uint8Array];
}

const n6 = (x: number) => (Math.round(x * 1e6) / 1e6).toString();

/** The FFmpeg expression of one channel (numbers only; `val` is the 0–255 input). */
function curveExpr(c: ChannelCurve): string {
  const v = `(val/255)*${n6(c.gain)}`;
  const lifted = `clip(${v}+${n6(c.lift)}*(1-${v}),0,1)`;
  return `floor(255*pow(${lifted},${n6(c.exp)})+0.5)`;
}

/** Which LUT file a grade needs: the same .cube at another strength is another file. */
export function lutKey(g: ColorGrade | undefined): string | null {
  const e = cleanGrade(g);
  return e?.lut ? `${n6(e.lutMix ?? 1)}|${e.lut}` : null;
}

/**
 * FFmpeg filters of the grade, before the clip's effects. `lutFile` is the name the runner gave
 * the LUT (lutKey) inside its working folder (letters, digits, dots, dashes), or null to skip it.
 */
export function ffmpegGrade(g: ColorGrade | undefined, lutFile: string | null = null): string[] {
  const e = cleanGrade(g);
  if (!e) return [];
  const f: string[] = [];
  if (hasCurve(e)) {
    const [r, gg, b] = channelCurves(e).map(curveExpr);
    f.push(`lutrgb=r='${r}':g='${gg}':b='${b}'`);
  }
  // The LUT strength is baked into the file (mixLut), so one filter does it.
  if (e.lut && lutFile && /^[\w.-]{1,64}$/.test(lutFile))
    f.push(`lut3d=file=${lutFile}:interp=trilinear`);
  return f;
}

// ---------------- 3D LUTs (.cube) ----------------

export interface Lut3D {
  title: string;
  size: number;
  /** size³ RGB triples, red changing fastest (the .cube order), already mapped to 0…1 input. */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export const LUT_MAX_SIZE = 65;
/** A 65³ LUT is ~8 MB of text: anything much bigger is not a LUT. */
export const LUT_MAX_BYTES = 16 * 1024 * 1024;

/** Parses an Adobe / Resolve .cube 3D LUT. Throws a short message on anything else. */
export function parseCube(text: string): Lut3D {
  if (text.length > LUT_MAX_BYTES) throw new Error('El LUT es demasiado grande.');
  let title = '';
  let size = 0;
  let dmin: [number, number, number] = [0, 0, 0];
  let dmax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  let n = 0;
  const triple = (parts: string[]): [number, number, number] => {
    const v = parts.slice(0, 3).map(Number);
    if (v.length !== 3 || v.some((x) => !Number.isFinite(x)))
      throw new Error('Línea del LUT no válida.');
    return v as [number, number, number];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0]!.toUpperCase();
    if (key === 'TITLE') {
      title = line.slice(5).trim().replace(/^"|"$/g, '').slice(0, 200);
      continue;
    }
    if (key === 'LUT_1D_SIZE') throw new Error('Solo se admiten LUT 3D (este es 1D).');
    if (key === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > LUT_MAX_SIZE)
        throw new Error(`Tamaño de LUT no admitido (2 a ${LUT_MAX_SIZE}).`);
      data = new Float32Array(size * size * size * 3);
      continue;
    }
    if (key === 'DOMAIN_MIN') {
      dmin = triple(parts.slice(1));
      continue;
    }
    if (key === 'DOMAIN_MAX') {
      dmax = triple(parts.slice(1));
      continue;
    }
    if (/^[A-Z_]+$/.test(key)) continue; // other keywords (LUT_3D_INPUT_RANGE…): ignored
    if (!data) throw new Error('Falta LUT_3D_SIZE antes de los datos.');
    if (n >= size * size * size) throw new Error('El LUT tiene más datos de los que declara.');
    const v = triple(parts);
    data[n * 3] = v[0];
    data[n * 3 + 1] = v[1];
    data[n * 3 + 2] = v[2];
    n++;
  }
  if (!data) throw new Error('No es un LUT .cube (falta LUT_3D_SIZE).');
  if (n !== size * size * size) throw new Error('Al LUT le faltan datos.');
  if (dmin.some((v, i) => !(dmax[i]! > v))) throw new Error('DOMAIN_MIN / DOMAIN_MAX no válidos.');
  return { title, size, data, domainMin: dmin, domainMax: dmax };
}

/** Back to .cube text (what the export hands FFmpeg: a clean file whatever the original was). */
export function serializeCube(l: Lut3D): string {
  const out = [`LUT_3D_SIZE ${l.size}`];
  if (l.domainMin.some((v) => v !== 0) || l.domainMax.some((v) => v !== 1)) {
    out.push(`DOMAIN_MIN ${l.domainMin.map(n6).join(' ')}`);
    out.push(`DOMAIN_MAX ${l.domainMax.map(n6).join(' ')}`);
  }
  for (let i = 0; i < l.data.length; i += 3)
    out.push(`${n6(l.data[i]!)} ${n6(l.data[i + 1]!)} ${n6(l.data[i + 2]!)}`);
  return out.join('\n') + '\n';
}

/** Trilinear lookup of one colour (0…1 in, 0…1 out). */
export function applyLut(l: Lut3D, r: number, g: number, b: number): [number, number, number] {
  const s = l.size - 1;
  const pos = (v: number, i: 0 | 1 | 2) =>
    clamp(((v - l.domainMin[i]) / (l.domainMax[i] - l.domainMin[i])) * s, 0, s);
  const x = pos(r, 0);
  const y = pos(g, 1);
  const z = pos(b, 2);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(s, x0 + 1);
  const y1 = Math.min(s, y0 + 1);
  const z1 = Math.min(s, z0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const N = l.size;
  const d = l.data;
  const at = (xi: number, yi: number, zi: number, c: number) => d[((zi * N + yi) * N + xi) * 3 + c]!;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - fx) + at(x1, y0, z0, c) * fx;
    const c10 = at(x0, y1, z0, c) * (1 - fx) + at(x1, y1, z0, c) * fx;
    const c01 = at(x0, y0, z1, c) * (1 - fx) + at(x1, y0, z1, c) * fx;
    const c11 = at(x0, y1, z1, c) * (1 - fx) + at(x1, y1, z1, c) * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1v = c01 * (1 - fy) + c11 * fy;
    out[c] = clamp(c0 * (1 - fz) + c1v * fz, 0, 1);
  }
  return out;
}

/**
 * The LUT at a strength: identity + mix·(LUT − identity) at every grid point. Trilinear
 * interpolation is linear in the grid values, so this equals blending the LUT's result with the
 * input — the preview and the export both use the mixed table.
 */
export function mixLut(l: Lut3D, mix: number): Lut3D {
  const k = clamp(fin(mix), 0, 1);
  if (k >= 1 - 1e-6) return l;
  const N = l.size;
  const d = new Float32Array(l.data.length);
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = ((z * N + y) * N + x) * 3;
        const id = [x, y, z].map(
          (v, c) => l.domainMin[c]! + (v / (N - 1)) * (l.domainMax[c]! - l.domainMin[c]!),
        );
        for (let c = 0; c < 3; c++) d[i + c] = id[c]! + k * (l.data[i + c]! - id[c]!);
      }
  return { ...l, data: d };
}

/** The CPU path of the preview: grade tables, then the (already mixed) LUT, in place on RGBA. */
export function gradePixels(
  px: Uint8ClampedArray,
  tables: [Uint8Array, Uint8Array, Uint8Array] | null,
  lut: Lut3D | null,
): void {
  const [tr, tg, tb] = tables ?? [null, null, null];
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]!;
    let g = px[i + 1]!;
    let b = px[i + 2]!;
    if (tr) {
      r = tr[r]!;
      g = tg![g]!;
      b = tb![b]!;
    }
    if (lut) {
      const o = applyLut(lut, r / 255, g / 255, b / 255);
      px[i] = o[0] * 255 + 0.5;
      px[i + 1] = o[1] * 255 + 0.5;
      px[i + 2] = o[2] * 255 + 0.5;
    } else {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
}

/** Ready-made grades for one click (no LUTs: those are the user's files). */
export const GRADE_PRESETS: { id: string; grade: ColorGrade }[] = [
  { id: 'neutral', grade: {} },
  { id: 'warm', grade: { temperature: 0.35, gain: { m: 0.05 } } },
  { id: 'cool', grade: { temperature: -0.35, lift: { b: 0.05 } } },
  { id: 'tealOrange', grade: { lift: { b: 0.08, r: -0.04 }, gain: { r: 0.08, b: -0.06 } } },
  { id: 'matte', grade: { lift: { m: 0.12 }, gain: { m: -0.08 } } },
  { id: 'punchy', grade: { lift: { m: -0.06 }, gamma: { m: 0.08 }, gain: { m: 0.1 } } },
  { id: 'bleach', grade: { lift: { m: -0.05 }, gamma: { m: -0.15 }, gain: { m: 0.15 } } },
];

export function validGrade(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const g = x as Record<string, unknown>;
  const okNum = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));
  for (const w of WHEELS) {
    const wh = g[w];
    if (wh === undefined) continue;
    if (!wh || typeof wh !== 'object' || Array.isArray(wh)) return false;
    if (!WHEEL_KEYS.every((k) => okNum((wh as Record<string, unknown>)[k]))) return false;
  }
  return (
    okNum(g.temperature) &&
    okNum(g.tint) &&
    okNum(g.lutMix) &&
    (g.lut === undefined || (typeof g.lut === 'string' && g.lut.length <= 4096))
  );
}
