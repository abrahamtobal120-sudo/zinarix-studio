// Module worker computing the video scopes off the UI thread (Fase 12C).
import { histogram, lumaStats, parade, sampling, vectorscope, waveform } from '../../../shared/videoScopes';
import type { ScopeRequest, ScopeResponse, ScopeResult } from './scopesProtocol';

// The renderer tsconfig has the DOM lib, not WebWorker: type just what we use.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ScopeRequest>) => void) | null;
  postMessage(msg: ScopeResponse, transfer?: Transferable[]): void;
};

const buf = (a: Uint32Array) => a.buffer as ArrayBuffer;

function compute(req: ScopeRequest): { res: ScopeResult; transfer: ArrayBuffer[] } {
  const t0 = performance.now();
  const { id, kind, w, h, maxWidth } = req;
  const px = new Uint8ClampedArray(req.data);
  const { step } = sampling(w, h, maxWidth);
  const hist = histogram(px, w, h, maxWidth);
  const stats = lumaStats(hist.luma);
  const base = () => ({ id, stats, step, ms: performance.now() - t0 });
  switch (kind) {
    case 'waveform': {
      const wf = waveform(px, w, h, maxWidth);
      return { res: { ...base(), kind, cols: wf.cols, bins: wf.bins, peak: wf.peak }, transfer: [buf(wf.bins)] };
    }
    case 'parade': {
      const p = parade(px, w, h, maxWidth);
      return {
        res: { ...base(), kind, cols: p.cols, r: p.r, g: p.g, b: p.b, peak: p.peak },
        transfer: [buf(p.r), buf(p.g), buf(p.b)],
      };
    }
    case 'vector': {
      const v = vectorscope(px, w, h, maxWidth);
      return { res: { ...base(), kind, bins: v.bins, peak: v.peak }, transfer: [buf(v.bins)] };
    }
    case 'histogram':
      return {
        res: { ...base(), kind, r: hist.r, g: hist.g, b: hist.b, luma: hist.luma, peak: hist.peak },
        transfer: [buf(hist.r), buf(hist.g), buf(hist.b), buf(hist.luma)],
      };
  }
}

ctx.onmessage = (e) => {
  const req = e.data;
  try {
    const { res, transfer } = compute(req);
    ctx.postMessage(res, transfer);
  } catch (err) {
    ctx.postMessage({ id: req.id, kind: 'error', message: (err as Error).message });
  }
};
