// Fase 12C: waveform, RGB parade, vectorscope and histogram of the preview frame.
// Pixels are grabbed from the viewer canvas and crunched in scopes.worker.ts; this file only draws.
import { useCallback, useEffect, useRef, useState } from 'react';
import { COLOR_BAR_TARGETS, SKIN_TONE_ANGLE, legalRange } from '../../../shared/videoScopes';
import { Badge } from '../../ui';
import type { ScopeKind, ScopeRequest, ScopeResponse, ScopeResult } from './scopesProtocol';
import { type ScopesKey, tsc } from './scopesStrings';
import './scopes.css';

/** Columns sampled while playing (the frame is downscaled to this width). */
const LIVE_WIDTH = 512;
/** ≈ 8 fps while playing. */
const LIVE_MS = 125;
/** While paused, a tiny fingerprint is compared this often to spot a changed frame. */
const IDLE_MS = 400;

const KINDS: ScopeKind[] = ['waveform', 'parade', 'vector', 'histogram'];

type Rgb = [number, number, number];
// Channel identity colours (data, not theme): drawn into ImageData, so plain numbers.
const CH_R: Rgb = [255, 82, 82];
const CH_G: Rgb = [82, 220, 110];
const CH_B: Rgb = [90, 140, 255];

export function Scopes({ source, playing }: { source: () => HTMLCanvasElement | null; playing: boolean }) {
  const [kind, setKind] = useState<ScopeKind>('waveform');
  const [result, setResult] = useState<ScopeResult | null>(null);
  const [exact, setExact] = useState(false);
  const [error, setError] = useState('');
  const [noSource, setNoSource] = useState(false);

  const view = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const thumb = useRef<HTMLCanvasElement | null>(null);
  const seq = useRef(0);
  const inflight = useRef(false);
  const queued = useRef<number | null>(null); // max width of a grab waiting for the worker
  const exactOf = useRef(new Map<number, boolean>());
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // One worker for the component's life.
  useEffect(() => {
    const w = new Worker(new URL('./scopes.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    inflight.current = false;
    queued.current = null;
    w.onerror = (e) => {
      inflight.current = false;
      setError(e.message || 'worker');
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  const grab = useCallback((maxW: number) => {
    const w = worker.current;
    if (!w) return;
    if (inflight.current) {
      queued.current = maxW;
      return;
    }
    const src = sourceRef.current();
    if (!src || !src.width || !src.height) {
      setNoSource(true);
      return;
    }
    setNoSource(false);
    const sw = Math.min(src.width, maxW);
    const sh = Math.max(1, Math.round((src.height * sw) / src.width));
    const cv = (scratch.current ??= document.createElement('canvas'));
    if (cv.width !== sw || cv.height !== sh) {
      cv.width = sw;
      cv.height = sh;
    }
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(src, 0, 0, sw, sh);
    const img = ctx.getImageData(0, 0, sw, sh);
    const id = ++seq.current;
    exactOf.current.set(id, sw === src.width);
    const req: ScopeRequest = { id, kind: kindRef.current, data: img.data.buffer, w: sw, h: sh, maxWidth: sw };
    inflight.current = true;
    w.postMessage(req, [img.data.buffer]);
  }, []);

  // Results from the worker.
  useEffect(() => {
    const w = worker.current;
    if (!w) return;
    const onMsg = (e: MessageEvent<ScopeResponse>) => {
      inflight.current = false;
      const res = e.data;
      const wasExact = exactOf.current.get(res.id) ?? false;
      exactOf.current.delete(res.id);
      if (res.kind === 'error') setError(res.message);
      else {
        setError('');
        // A reply for a scope the user already left is dropped (the queued grab follows).
        if (res.kind === kindRef.current) {
          setResult(res);
          setExact(wasExact);
        }
      }
      const next = queued.current;
      if (next !== null) {
        queued.current = null;
        grab(next);
      }
    };
    w.addEventListener('message', onMsg);
    return () => w.removeEventListener('message', onMsg);
  }, [grab]);

  // Sampling loop: live while playing, exact once per change while paused.
  useEffect(() => {
    if (playing) {
      grab(LIVE_WIDTH);
      const t = window.setInterval(() => {
        if (!inflight.current) grab(LIVE_WIDTH);
      }, LIVE_MS);
      return () => window.clearInterval(t);
    }
    let last = fingerprint(sourceRef.current(), thumb);
    grab(Infinity);
    const t = window.setInterval(() => {
      const f = fingerprint(sourceRef.current(), thumb);
      if (f !== last) {
        last = f;
        grab(Infinity);
      }
    }, IDLE_MS);
    return () => window.clearInterval(t);
  }, [playing, kind, grab]);

  // Draw whenever a result lands.
  useEffect(() => {
    const cv = view.current;
    if (cv && result) draw(cv, result);
  }, [result]);

  const stats = result?.stats;
  const pct = (n: number) => n.toFixed(n < 10 ? 1 : 0);
  const shown = result && result.kind === kind ? result : null;

  return (
    <div className="vs-scopes" aria-label={tsc('title')}>
      <div className="vs-scopes-head">
        <div className="vs-seg vs-scopes-kinds" role="tablist" aria-label={tsc('title')}>
          {KINDS.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => setKind(k)}
            >
              {tsc(k as ScopesKey)}
            </button>
          ))}
        </div>
        {shown && (
          <span title={tsc(exact ? 'exactHint' : 'liveHint')}>
            <Badge tone={exact ? 'ok' : 'neutral'} className="vs-scopes-badge">
              {tsc(exact ? 'exact' : 'live')}
            </Badge>
          </span>
        )}
      </div>
      <div className={`vs-scopes-stage${kind === 'vector' ? ' vs-scopes-square' : ''}`}>
        <canvas ref={view} className="vs-scopes-canvas" aria-label={tsc(kind as ScopesKey)} />
        {!shown && noSource && <p className="vs-scopes-empty">{tsc('noSource')}</p>}
      </div>
      {error && <p className="vs-scopes-err">{tsc('error', { e: error })}</p>}
      {stats && shown && (
        <div className="vs-scopes-stats">
          <span>{tsc('lumaRange', { min: stats.min, max: stats.max })}</span>
          <span className={stats.outPct > 1 ? 'vs-scopes-warn' : ''}>
            {tsc('outRange', { pct: pct(stats.outPct) })}
          </span>
          <span className="vs-scopes-dim">{tsc('below', { pct: pct(stats.belowPct) })}</span>
          <span className="vs-scopes-dim">{tsc('above', { pct: pct(stats.abovePct) })}</span>
        </div>
      )}
    </div>
  );
}

/** Cheap hash of a 32×18 downscale of the source, to notice a new frame while paused. */
function fingerprint(src: HTMLCanvasElement | null, ref: { current: HTMLCanvasElement | null }): number {
  if (!src || !src.width || !src.height) return -1;
  const cv = (ref.current ??= Object.assign(document.createElement('canvas'), { width: 32, height: 18 }));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return -1;
  ctx.drawImage(src, 0, 0, 32, 18);
  const d = ctx.getImageData(0, 0, 32, 18).data;
  let h = 2166136261 ^ src.width ^ (src.height << 16);
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 16777619);
  return h >>> 0;
}

// --- drawing ---------------------------------------------------------------------------------

interface Theme {
  fg: Rgb;
  grid: string;
  guide: string;
  label: string;
  target: string;
  skin: string;
  font: string;
}

const probe: { cv: HTMLCanvasElement | null } = { cv: null };

/** Resolves a CSS colour (any syntax) to RGB by painting it on a 1×1 canvas. */
function cssRgb(value: string, fallback: Rgb): Rgb {
  const cv = (probe.cv ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx || !value) return fallback;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return d[3] ? [d[0]!, d[1]!, d[2]!] : fallback;
}

function theme(cv: HTMLCanvasElement): Theme {
  const cs = getComputedStyle(cv);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const fg = cssRgb(v('--vs-stage-fg'), [221, 221, 221]);
  const rgba = (c: Rgb, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  return {
    fg,
    grid: rgba(fg, 0.12),
    guide: v('--warn') || 'rgba(224, 179, 65, 0.9)',
    label: rgba(fg, 0.65),
    target: rgba(fg, 0.8),
    skin: v('--warn') || 'rgba(224, 179, 65, 0.9)',
    font: `10px ${cs.fontFamily || 'sans-serif'}`,
  };
}

function draw(cv: HTMLCanvasElement, r: ScopeResult): void {
  const square = r.kind === 'vector';
  const W = square ? 256 : 512;
  const H = 256;
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const t = theme(cv);
  ctx.clearRect(0, 0, W, H);
  ctx.font = t.font;
  switch (r.kind) {
    case 'waveform':
      blit(ctx, densityImage([r.bins], [t.fg], r.cols, r.peak), 0, 0, W, H);
      levelGuides(ctx, t, 0, W, H);
      break;
    case 'parade': {
      const third = W / 3;
      const img = [r.r, r.g, r.b];
      const tints = [CH_R, CH_G, CH_B];
      for (let i = 0; i < 3; i++) blit(ctx, densityImage([img[i]!], [tints[i]!], r.cols, r.peak), i * third, 0, third, H);
      ctx.strokeStyle = t.grid;
      for (let i = 1; i < 3; i++) line(ctx, i * third, 0, i * third, H);
      levelGuides(ctx, t, 0, W, H);
      break;
    }
    case 'vector':
      drawVector(ctx, r.bins, r.peak, t);
      break;
    case 'histogram':
      drawHistogram(ctx, r, t, W, H);
      break;
  }
}

/** cols × 256 count arrays → an ImageData cols wide and 256 tall (level 255 at the top), log scale. */
function densityImage(layers: Uint32Array[], tints: Rgb[], cols: number, peak: number): ImageData {
  const img = new ImageData(Math.max(1, cols), 256);
  const out = img.data;
  const k = 255 / Math.log1p(Math.max(1, peak));
  for (let li = 0; li < layers.length; li++) {
    const bins = layers[li]!;
    const [tr, tg, tb] = tints[li]!;
    for (let c = 0; c < cols; c++) {
      const base = c << 8;
      for (let lv = 0; lv < 256; lv++) {
        const n = bins[base + lv]!;
        if (!n) continue;
        const a = Math.min(255, Math.log1p(n) * k * 1.6 + 40);
        const o = ((255 - lv) * cols + c) * 4;
        out[o] = Math.max(out[o]!, tr);
        out[o + 1] = Math.max(out[o + 1]!, tg);
        out[o + 2] = Math.max(out[o + 2]!, tb);
        out[o + 3] = Math.max(out[o + 3]!, a);
      }
    }
  }
  return img;
}

const offscreen: { cv: HTMLCanvasElement | null } = { cv: null };

function blit(ctx: CanvasRenderingContext2D, img: ImageData, x: number, y: number, w: number, h: number): void {
  const off = (offscreen.cv ??= document.createElement('canvas'));
  off.width = img.width;
  off.height = img.height;
  off.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, x, y, w, h);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Graticule at 0/64/128/192/255 and dashed legal-range lines at 16 and 235. */
function levelGuides(ctx: CanvasRenderingContext2D, t: Theme, x0: number, W: number, H: number): void {
  const y = (lv: number) => ((255.5 - lv) / 256) * H;
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.grid;
  for (const lv of [0, 64, 128, 192, 255]) line(ctx, x0, y(lv), x0 + W, y(lv));
  ctx.strokeStyle = t.guide;
  ctx.setLineDash([4, 3]);
  for (const lv of [legalRange.lo, legalRange.hi]) line(ctx, x0, y(lv), x0 + W, y(lv));
  ctx.setLineDash([]);
  ctx.fillStyle = t.label;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(legalRange.hi), x0 + 3, y(legalRange.hi) - 6);
  ctx.fillText(String(legalRange.lo), x0 + 3, y(legalRange.lo) + 6);
}

function drawVector(ctx: CanvasRenderingContext2D, bins: Uint32Array, peak: number, t: Theme): void {
  // Density: each bin painted with its own hue so the trace reads like the colours it holds.
  const img = new ImageData(256, 256);
  const out = img.data;
  const k = 255 / Math.log1p(Math.max(1, peak));
  for (let row = 0; row < 256; row++) {
    for (let col = 0; col < 256; col++) {
      const n = bins[(row << 8) | col]!;
      if (!n) continue;
      // Back to RGB at a mid luma for the tint (BT.709 inverse), lifted towards the theme fg.
      const cb = col - 128;
      const cr = 128 - row;
      const yv = 160;
      const R = yv + 1.5748 * cr;
      const G = yv - 0.1873 * cb - 0.4681 * cr;
      const B = yv + 1.8556 * cb;
      const o = (row * 256 + col) * 4;
      out[o] = (R + t.fg[0]) / 2;
      out[o + 1] = (G + t.fg[1]) / 2;
      out[o + 2] = (B + t.fg[2]) / 2;
      out[o + 3] = Math.min(255, Math.log1p(n) * k * 1.6 + 50);
    }
  }
  blit(ctx, img, 0, 0, 256, 256);

  const c = 128;
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.grid;
  ctx.beginPath();
  ctx.arc(c, c, 127, 0, Math.PI * 2);
  ctx.stroke();
  line(ctx, c - 127, c, c + 127, c);
  line(ctx, c, c - 127, c, c + 127);

  // Skin-tone line (angle counter-clockwise from +Cb, y grows downwards on the canvas).
  const a = (SKIN_TONE_ANGLE * Math.PI) / 180;
  ctx.strokeStyle = t.skin;
  ctx.setLineDash([4, 3]);
  line(ctx, c, c, c + 127 * Math.cos(a), c - 127 * Math.sin(a));
  ctx.setLineDash([]);
  ctx.fillStyle = t.skin;
  ctx.textBaseline = 'middle';
  ctx.fillText(tsc('skin'), c + 118 * Math.cos(a) + 4, c - 118 * Math.sin(a));

  // 75% colour-bar targets: a small box per bar plus its letter.
  ctx.strokeStyle = t.target;
  ctx.fillStyle = t.label;
  for (const bar of COLOR_BAR_TARGETS) {
    const x = bar.col + 0.5;
    const y = bar.row + 0.5;
    ctx.strokeRect(x - 5, y - 5, 10, 10);
    const ox = Math.cos((bar.angle * Math.PI) / 180) * 14;
    const oy = -Math.sin((bar.angle * Math.PI) / 180) * 14;
    ctx.fillText(bar.name, x + ox - 3, y + oy);
  }
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  r: Extract<ScopeResult, { kind: 'histogram' }>,
  t: Theme,
  W: number,
  H: number,
): void {
  const peak = Math.max(1, r.peak);
  const x = (i: number) => ((i + 0.5) / 256) * W;
  const y = (n: number) => H - Math.sqrt(n / peak) * (H - 4);
  const path = (bins: Uint32Array) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) ctx.lineTo(x(i), y(bins[i]!));
    ctx.lineTo(W, H);
    ctx.closePath();
  };
  ctx.strokeStyle = t.grid;
  for (const lv of [64, 128, 192]) line(ctx, x(lv), 0, x(lv), H);
  // Luma as a soft fill, channels as additive outlines.
  path(r.luma);
  ctx.fillStyle = `rgba(${t.fg[0]}, ${t.fg[1]}, ${t.fg[2]}, 0.25)`;
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  const ch: [Uint32Array, Rgb][] = [
    [r.r, CH_R],
    [r.g, CH_G],
    [r.b, CH_B],
  ];
  for (const [bins, c] of ch) {
    path(bins);
    ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.18)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.85)`;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = t.guide;
  ctx.setLineDash([4, 3]);
  for (const lv of [legalRange.lo, legalRange.hi]) line(ctx, x(lv), 0, x(lv), H);
  ctx.setLineDash([]);
  ctx.fillStyle = t.label;
  ctx.textBaseline = 'top';
  ctx.fillText(String(legalRange.lo), x(legalRange.lo) + 3, 3);
  ctx.fillText(String(legalRange.hi), x(legalRange.hi) - 22, 3);
}
