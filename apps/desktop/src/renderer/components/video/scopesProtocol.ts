// Messages between Scopes.tsx and scopes.worker.ts. Buffers travel as transferables.
import type { LumaStats } from '../../../shared/videoScopes';

export type ScopeKind = 'waveform' | 'parade' | 'vector' | 'histogram';

export interface ScopeRequest {
  id: number;
  kind: ScopeKind;
  /** RGBA pixels, w × h × 4 bytes (transferred). */
  data: ArrayBuffer;
  w: number;
  h: number;
  /** Bound on sampled columns; Infinity (or ≥ w) = exact. */
  maxWidth: number;
}

interface Base {
  id: number;
  /** Luma statistics of the same sample (always sent). */
  stats: LumaStats;
  /** Sampling step used (1 = every pixel). */
  step: number;
  /** Time spent in the worker, ms. */
  ms: number;
}

/** Waveform: `bins` is cols × 256 (index col * 256 + level). */
export interface WaveformResult extends Base {
  kind: 'waveform';
  cols: number;
  bins: Uint32Array;
  peak: number;
}

/** Parade: three cols × 256 arrays. */
export interface ParadeResult extends Base {
  kind: 'parade';
  cols: number;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  peak: number;
}

/** Vectorscope: 256 × 256 (index row * 256 + col, col = 128 + Cb, row = 128 − Cr). */
export interface VectorResult extends Base {
  kind: 'vector';
  bins: Uint32Array;
  peak: number;
}

/** Histogram: 256 bins per channel. */
export interface HistogramResult extends Base {
  kind: 'histogram';
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  peak: number;
}

export interface ScopeError {
  id: number;
  kind: 'error';
  message: string;
}

export type ScopeResult = WaveformResult | ParadeResult | VectorResult | HistogramResult;
export type ScopeResponse = ScopeResult | ScopeError;
