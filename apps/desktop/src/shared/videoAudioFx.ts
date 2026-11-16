/**
 * Fase 12D — audio effects shared by the FFmpeg export and the Web Audio preview.
 *
 * - 4-band peaking EQ: FFmpeg `equalizer` (t=q) and Web Audio `BiquadFilterNode` 'peaking' both
 *   implement the RBJ cookbook peaking filter, so `eqResponseDb` describes both.
 * - Compressor: FFmpeg `acompressor` (hard knee, peak detection, max link) and Web Audio
 *   `DynamicsCompressorNode` (knee 0) both converge to `compStaticGainDb` on a steady tone.
 * - Loudness meter per ITU-R BS.1770-4 / EBU R128 (momentary, short-term, integrated, sample peak).
 *
 * Pure module: no DOM or Node imports. Every number that reaches a filter string goes through
 * `num()` after clamping, so a bad project file cannot inject filter syntax.
 */

// ---------------- types, ranges, presets ----------------

/** Gains in dB (−24…24) for the four fixed bands. */
export interface Eq4 {
  low?: number;
  lowMid?: number;
  highMid?: number;
  high?: number;
}
export type EqBand = keyof Eq4;

export interface Compressor {
  /** dBFS, −60…0. */
  threshold: number;
  /** 1…20. */
  ratio: number;
  /** ms, 0.1…200. */
  attack: number;
  /** ms, 10…2000. */
  release: number;
  /** dB, 0…24. */
  makeup: number;
}

/** Fixed band centres (Hz) and Q; all peaking. */
export const EQ_BANDS: Readonly<Record<EqBand, { f: number; q: number }>> = Object.freeze({
  low: { f: 100, q: 1 },
  lowMid: { f: 400, q: 1 },
  highMid: { f: 2500, q: 1 },
  high: { f: 8000, q: 1 },
});
export const EQ_BAND_KEYS: readonly EqBand[] = ['low', 'lowMid', 'highMid', 'high'];
export const EQ_GAIN_MAX = 24;

export const COMP_RANGE = Object.freeze({
  threshold: [-60, 0],
  ratio: [1, 20],
  attack: [0.1, 200],
  release: [10, 2000],
  makeup: [0, 24],
} as const satisfies Record<keyof Compressor, readonly [number, number]>);

export const COMP_DEFAULT: Readonly<Compressor> = Object.freeze({
  threshold: -24,
  ratio: 4,
  attack: 10,
  release: 200,
  makeup: 0,
});

export type AudioPresetId = 'voice' | 'music' | 'podcast';

export const COMP_PRESETS: Readonly<Record<AudioPresetId, Readonly<Compressor>>> = Object.freeze({
  /** Voz: moderate levelling, fast attack for consonants. */
  voice: Object.freeze({ threshold: -18, ratio: 3, attack: 5, release: 120, makeup: 4 }),
  /** Música: gentle glue, slower attack keeps transients. */
  music: Object.freeze({ threshold: -14, ratio: 2, attack: 20, release: 250, makeup: 2 }),
  /** Podcast: firmer control for an even spoken level. */
  podcast: Object.freeze({ threshold: -22, ratio: 4, attack: 3, release: 150, makeup: 6 }),
});

/** Matching EQ curves for the same presets. */
export const EQ_PRESETS: Readonly<Record<AudioPresetId, Readonly<Eq4>>> = Object.freeze({
  voice: Object.freeze({ low: -4, lowMid: -2, highMid: 3, high: 1 }),
  music: Object.freeze({ low: 2, highMid: -1, high: 2 }),
  podcast: Object.freeze({ low: -3, lowMid: -2, highMid: 3, high: 2 }),
});

// ---------------- sanitising ----------------

/** Numbers only ever reach a filter string through here. */
const num = (n: number) => {
  const x = Number(n);
  return (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0).toString();
};
const clamp = (n: unknown, lo: number, hi: number, fallback = lo) => {
  const x = Number(n);
  return Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : fallback));
};
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const dbToLin = (db: number) => Math.pow(10, db / 20);
const linToDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Clamps gains to ±24 dB (0.1 dB steps), drops flat bands; undefined when the EQ is flat. */
export function cleanEq(eq: Eq4 | null | undefined): Eq4 | undefined {
  if (!isObj(eq)) return undefined;
  const out: Eq4 = {};
  let any = false;
  for (const k of EQ_BAND_KEYS) {
    const v = (eq as Record<string, unknown>)[k];
    if (!finite(v)) continue;
    const g = Math.round(clamp(v, -EQ_GAIN_MAX, EQ_GAIN_MAX, 0) * 10) / 10;
    if (g !== 0) {
      out[k] = g;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Clamps every field (missing ones take COMP_DEFAULT); undefined when it would do nothing. */
export function cleanComp(c: Partial<Compressor> | null | undefined): Compressor | undefined {
  if (!isObj(c)) return undefined;
  const pick = (k: keyof Compressor) => {
    const [lo, hi] = COMP_RANGE[k];
    return clamp(c[k], lo, hi, COMP_DEFAULT[k]);
  };
  const out: Compressor = {
    threshold: pick('threshold'),
    ratio: pick('ratio'),
    attack: pick('attack'),
    release: pick('release'),
    makeup: pick('makeup'),
  };
  // Ratio 1 never compresses; with no makeup the stage is a no-op.
  if (out.ratio <= 1 && out.makeup <= 0) return undefined;
  return out;
}

/** For loading project files: undefined, or an object whose band fields are finite numbers. */
export function validEq(x: unknown): x is Eq4 | undefined {
  if (x === undefined) return true;
  if (!isObj(x)) return false;
  return EQ_BAND_KEYS.every((k) => x[k] === undefined || finite(x[k]));
}

/** For loading project files: undefined, or an object with all five fields as finite numbers. */
export function validComp(x: unknown): x is Compressor | undefined {
  if (x === undefined) return true;
  if (!isObj(x)) return false;
  return (Object.keys(COMP_RANGE) as (keyof Compressor)[]).every((k) => finite(x[k]));
}

// ---------------- FFmpeg ----------------

/** One `equalizer` per non-zero band (RBJ peaking, width as Q). */
export function ffmpegEq(eq: Eq4 | null | undefined): string[] {
  const c = cleanEq(eq);
  if (!c) return [];
  const out: string[] = [];
  for (const k of EQ_BAND_KEYS) {
    const g = c[k];
    if (g === undefined) continue;
    const b = EQ_BANDS[k];
    out.push(`equalizer=f=${num(b.f)}:t=q:w=${num(b.q)}:g=${num(g)}`);
  }
  return out;
}

/** FFmpeg acompressor's own limits. */
const AC = { thrMin: 0.000976563, makeupMax: 64, attack: [0.01, 2000], release: [0.01, 9000] } as const;

/**
 * `acompressor` set up to mirror DynamicsCompressorNode: hard knee (knee=1), peak detection and
 * max channel link (acompressor defaults to RMS detection and average link, which put the
 * steady-state gain ~3 dB off on a sine). Threshold and makeup go in as linear amplitudes.
 */
export function ffmpegComp(comp: Partial<Compressor> | null | undefined): string[] {
  const c = cleanComp(comp);
  if (!c) return [];
  const thr = clamp(dbToLin(c.threshold), AC.thrMin, 1);
  const makeup = clamp(dbToLin(c.makeup), 1, AC.makeupMax);
  const attack = clamp(c.attack, AC.attack[0], AC.attack[1]);
  const release = clamp(c.release, AC.release[0], AC.release[1]);
  return [
    `acompressor=threshold=${num(thr)}:ratio=${num(c.ratio)}:attack=${num(attack)}` +
      `:release=${num(release)}:makeup=${num(makeup)}:knee=1:detection=peak:link=maximum`,
  ];
}

// ---------------- biquads (RBJ cookbook) ----------------

/** Normalised biquad: H(z) = (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²). */
export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ peaking EQ (= FFmpeg equalizer t=q, = Web Audio 'peaking'). */
export function peakingCoefs(f: number, q: number, gainDb: number, sampleRate: number): BiquadCoefs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cos) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

/** RBJ high-pass with linear Q (Web Audio takes this Q in dB: 20·log10(q)). */
export function highpassCoefs(f: number, q: number, sampleRate: number): BiquadCoefs {
  const w0 = (2 * Math.PI * f) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** RBJ high shelf with slope S = 1 (what Web Audio 'highshelf' uses). */
export function highshelfCoefs(f: number, gainDb: number, sampleRate: number): BiquadCoefs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * Math.SQRT2; // S = 1
  const s = 2 * Math.sqrt(A) * alpha;
  const a0 = A + 1 - (A - 1) * cos + s;
  return {
    b0: (A * (A + 1 + (A - 1) * cos + s)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
    b2: (A * (A + 1 + (A - 1) * cos - s)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
    a2: (A + 1 - (A - 1) * cos - s) / a0,
  };
}

/** |H(e^jω)| in dB at `freq`. */
export function biquadMagnitudeDb(c: BiquadCoefs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
  const ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2;
  const di = -(c.a1 * s1 + c.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** Combined EQ response in dB at `freq` (bands in series, so dB add). */
export function eqResponseDb(eq: Eq4 | null | undefined, freq: number, sampleRate: number): number {
  const c = cleanEq(eq);
  if (!c) return 0;
  let db = 0;
  for (const k of EQ_BAND_KEYS) {
    const g = c[k];
    if (g === undefined) continue;
    const b = EQ_BANDS[k];
    db += biquadMagnitudeDb(peakingCoefs(b.f, b.q, g, sampleRate), freq, sampleRate);
  }
  return db;
}

// ---------------- compressor curve ----------------

/**
 * Gain (dB) the compressor applies at a steady detected level `inputDb` (peak dBFS):
 * hard knee, then makeup. Output level = inputDb + compStaticGainDb(inputDb, c).
 */
export function compStaticGainDb(inputDb: number, comp: Partial<Compressor> | null | undefined): number {
  const c = cleanComp(comp);
  if (!c) return 0;
  const over = inputDb - c.threshold;
  const reduction = over > 0 ? over - over / c.ratio : 0;
  return c.makeup - reduction;
}

// ---------------- Web Audio parameters (no DOM types) ----------------

export interface WebAudioBiquadParams {
  type: 'peaking' | 'highpass' | 'highshelf';
  frequency: number;
  Q: number;
  gain: number;
}

/** One 'peaking' BiquadFilterNode per non-zero band (Q is linear for 'peaking'). */
export function webAudioEqParams(eq: Eq4 | null | undefined): WebAudioBiquadParams[] {
  const c = cleanEq(eq);
  if (!c) return [];
  const out: WebAudioBiquadParams[] = [];
  for (const k of EQ_BAND_KEYS) {
    const g = c[k];
    if (g === undefined) continue;
    const b = EQ_BANDS[k];
    out.push({ type: 'peaking', frequency: b.f, Q: b.q, gain: g });
  }
  return out;
}

export interface WebAudioCompParams {
  /** dB */
  threshold: number;
  ratio: number;
  /** seconds (Web Audio caps at 1) */
  attack: number;
  /** seconds (Web Audio caps at 1) */
  release: number;
  knee: 0;
  /**
   * Linear gain for a GainNode after the compressor. DynamicsCompressorNode adds its own
   * automatic makeup of (1/fullRangeGain)^0.6; this value cancels it and applies `makeup`.
   */
  makeupGain: number;
}

export function webAudioCompParams(comp: Partial<Compressor> | null | undefined): WebAudioCompParams | undefined {
  const c = cleanComp(comp);
  if (!c) return undefined;
  // Web Audio spec: fullRangeGain = curve(1.0); auto makeup = (1/fullRangeGain)^0.6.
  const autoMakeupDb = -0.6 * c.threshold * (1 - 1 / c.ratio);
  return {
    threshold: c.threshold,
    ratio: c.ratio,
    attack: clamp(c.attack / 1000, 0, 1),
    release: clamp(c.release / 1000, 0, 1),
    knee: 0,
    makeupGain: dbToLin(c.makeup - autoMakeupDb),
  };
}

// ---------------- K-weighting (BS.1770) ----------------

/** Stage 1 (head shelf) and stage 2 (RLB high-pass), derived as in libebur128. */
export function kWeightingCoefs(sampleRate: number): [BiquadCoefs, BiquadCoefs] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: BiquadCoefs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const rlb: BiquadCoefs = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, rlb];
}

/**
 * Approximation of the K filter with two BiquadFilterNodes for the live meter in the player
 * (Web Audio offers no raw biquad coefficients without IIRFilterNode). Within ~0.5 dB of the
 * exact K curve across the audio band; exports use the exact filter (`LoudnessMeter`).
 * Note: Web Audio 'highpass' Q is in dB, hence 20·log10(0.5).
 */
export function kWeightingWebAudio(): [WebAudioBiquadParams, WebAudioBiquadParams] {
  return [
    { type: 'highpass', frequency: 38.13547087602444, Q: 20 * Math.log10(0.5003270373238773), gain: 0 },
    { type: 'highshelf', frequency: 1681.974450955533, Q: 1, gain: 3.999843853973347 },
  ];
}

// ---------------- loudness meter ----------------

/** BS.1770 channel weights: L, R, C = 1; surrounds = 1.41; LFE (5.1 index 3) excluded. */
function channelWeights(channels: number): number[] {
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (channels === 5) return [1, 1, 1, 1.41, 1.41];
  return Array.from({ length: channels }, () => 1);
}

const energyToLufs = (e: number) => (e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity);

/**
 * EBU R128 meter. Feed planar float PCM with `push`; read momentary (400 ms), short-term (3 s),
 * integrated (gated) loudness in LUFS and sample peak in dBFS. Windows not yet filled count as
 * silence (as libebur128 does). Silence reads −Infinity.
 */
export class LoudnessMeter {
  readonly sampleRate: number;
  readonly channels: number;
  private readonly weights: number[];
  private readonly coefs: [BiquadCoefs, BiquadCoefs];
  /** Per channel: [x1, x2, y1, y2] for stage 1, then stage 2. */
  private readonly state: Float64Array[];
  private readonly subLen: number;
  private subPos = 0;
  private subAcc = 0;
  /** Weighted mean-square energy of every finished 100 ms sub-block. */
  private readonly subs: number[] = [];
  private peakAbs = 0;

  constructor(sampleRate: number, channels: number) {
    this.sampleRate = clamp(sampleRate, 8000, 384000, 48000);
    this.channels = Math.max(1, Math.min(8, Math.floor(clamp(channels, 1, 8, 1))));
    this.weights = channelWeights(this.channels);
    this.coefs = kWeightingCoefs(this.sampleRate);
    this.state = Array.from({ length: this.channels }, () => new Float64Array(8));
    this.subLen = Math.max(1, Math.round(this.sampleRate / 10));
  }

  reset(): void {
    for (const s of this.state) s.fill(0);
    this.subPos = 0;
    this.subAcc = 0;
    this.subs.length = 0;
    this.peakAbs = 0;
  }

  /** Planar samples, one array per channel (missing channels count as silent). */
  push(channels: Float32Array[]): void {
    const n = channels.reduce((m, c) => Math.max(m, c.length), 0);
    const [s1, s2] = this.coefs;
    let i = 0;
    while (i < n) {
      const end = Math.min(n, i + (this.subLen - this.subPos));
      for (let ch = 0; ch < this.channels; ch++) {
        const w = this.weights[ch] ?? 1;
        const data = channels[ch];
        const st = this.state[ch]!;
        let x1 = st[0]!, x2 = st[1]!, y1 = st[2]!, y2 = st[3]!;
        let u1 = st[4]!, u2 = st[5]!, z1 = st[6]!, z2 = st[7]!;
        let acc = 0;
        let pk = this.peakAbs;
        for (let k = i; k < end; k++) {
          const x = data ? (data[k] ?? 0) : 0;
          const ax = Math.abs(x);
          if (ax > pk) pk = ax;
          const y = s1.b0 * x + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
          const z = s2.b0 * y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * z1 - s2.a2 * z2;
          u2 = u1; u1 = y; z2 = z1; z1 = z;
          acc += z * z;
        }
        this.peakAbs = pk;
        st[0] = x1; st[1] = x2; st[2] = y1; st[3] = y2;
        st[4] = u1; st[5] = u2; st[6] = z1; st[7] = z2;
        this.subAcc += w * acc;
      }
      this.subPos += end - i;
      i = end;
      if (this.subPos >= this.subLen) {
        this.subs.push(this.subAcc / this.subLen);
        this.subAcc = 0;
        this.subPos = 0;
      }
    }
  }

  /** Mean energy of the last `count` sub-blocks; missing ones count as silence. */
  private windowEnergy(count: number): number {
    let sum = 0;
    const from = Math.max(0, this.subs.length - count);
    for (let k = from; k < this.subs.length; k++) sum += this.subs[k]!;
    return sum / count;
  }

  /** LUFS over the last 400 ms. */
  momentary(): number {
    return energyToLufs(this.windowEnergy(4));
  }

  /** LUFS over the last 3 s. */
  shortTerm(): number {
    return energyToLufs(this.windowEnergy(30));
  }

  /** Gated integrated loudness: 400 ms blocks every 100 ms, −70 LUFS absolute, −10 LU relative. */
  integrated(): number {
    const blocks: number[] = [];
    for (let k = 3; k < this.subs.length; k++) {
      blocks.push((this.subs[k]! + this.subs[k - 1]! + this.subs[k - 2]! + this.subs[k - 3]!) / 4);
    }
    const absGate = blocks.filter((e) => energyToLufs(e) > -70);
    if (!absGate.length) return -Infinity;
    const relThreshold = energyToLufs(absGate.reduce((a, b) => a + b, 0) / absGate.length) - 10;
    const gated = absGate.filter((e) => energyToLufs(e) > relThreshold);
    if (!gated.length) return -Infinity;
    return energyToLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }

  /** Sample peak (dBFS) since construction or reset. */
  peak(): number {
    return linToDb(this.peakAbs);
  }
}
