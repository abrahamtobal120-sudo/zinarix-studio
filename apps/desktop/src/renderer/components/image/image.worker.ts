// Module worker of the image editor: holds the full picture and its preview copy, and does every
// pixel pass (preview, histogram, Auto, the full-size save) so the window never freezes.
import {
  MIME_OF,
  applyEdit,
  autoEdit,
  flattenOnWhite,
  histogramOf,
  type Rgba,
} from '../../../shared/imageEdit';
import {
  BG_MODELS,
  maskCoverage,
  maskFromOutput,
  modelInput,
  resizeMask,
} from '../../../shared/bgRemove';
import type { ImageRequest, ImageResponse } from './imageWorkerProtocol';

// The renderer tsconfig has the DOM lib, not WebWorker: type just what we use.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ImageRequest>) => void) | null;
  postMessage(msg: ImageResponse, transfer?: Transferable[]): void;
};

let full: Rgba | null = null;
let preview: { img: Rgba; scale: number } | null = null;
/** Fase 1B: background-removal alpha of the original, and of the preview copy. */
let mask: { full: Uint8Array; preview: Uint8Array } | null = null;

function pixels(bmp: ImageBitmap, w: number, h: number): Rgba {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('canvas');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

async function encode(img: Rgba, req: ImageRequest & { kind: 'save' }): Promise<ArrayBuffer> {
  const src = req.format === 'jpg' ? flattenOnWhite(img) : img;
  const c = new OffscreenCanvas(src.width, src.height);
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas');
  g.putImageData(
    new ImageData(src.data as Uint8ClampedArray<ArrayBuffer>, src.width, src.height),
    0,
    0,
  );
  const type = MIME_OF[req.format];
  const blob = await c.convertToBlob({ type, quality: req.quality / 100 });
  // Chromium falls back to PNG for a type it cannot write: never save PNG bytes as .webp.
  if (blob.type !== type) throw new Error(`${req.format} no disponible`);
  return blob.arrayBuffer();
}

async function handle(req: ImageRequest): Promise<void> {
  switch (req.kind) {
    case 'init': {
      const bmp = req.bitmap;
      if (bmp.width > req.maxSide || bmp.height > req.maxSide) {
        bmp.close();
        ctx.postMessage({ kind: 'error', id: req.id, message: 'too big', code: 'tooBig' });
        return;
      }
      full = pixels(bmp, bmp.width, bmp.height);
      const k = Math.min(1, req.previewSide / Math.max(bmp.width, bmp.height));
      const pw = Math.max(1, Math.round(bmp.width * k));
      const ph = Math.max(1, Math.round(bmp.height * k));
      preview = { img: k < 1 ? pixels(bmp, pw, ph) : full, scale: pw / bmp.width };
      bmp.close();
      ctx.postMessage({
        kind: 'init',
        id: req.id,
        width: full.width,
        height: full.height,
        scale: preview.scale,
      });
      return;
    }
    case 'render': {
      if (!preview) throw new Error('not loaded');
      const out = req.original
        ? preview.img
        : applyEdit(preview.img, req.edit, preview.scale, mask?.preview);
      // A copy when the result is the stored preview itself (it must stay here).
      const data = out.data === preview.img.data ? new Uint8ClampedArray(out.data) : out.data;
      const h = histogramOf(out);
      const hist = new Uint32Array(1024);
      hist.set(h.r, 0);
      hist.set(h.g, 256);
      hist.set(h.b, 512);
      hist.set(h.l, 768);
      const buf = data.buffer as ArrayBuffer;
      ctx.postMessage(
        {
          kind: 'render',
          id: req.id,
          width: out.width,
          height: out.height,
          data: buf,
          hist: hist.buffer,
        },
        [buf, hist.buffer],
      );
      return;
    }
    case 'auto': {
      if (!preview) throw new Error('not loaded');
      ctx.postMessage({ kind: 'auto', id: req.id, edit: autoEdit(preview.img) });
      return;
    }
    case 'save': {
      if (!full) throw new Error('not loaded');
      const out = applyEdit(full, req.edit, 1, mask?.full);
      const bytes = await encode(out, req);
      ctx.postMessage({ kind: 'save', id: req.id, bytes, width: out.width, height: out.height }, [
        bytes,
      ]);
      return;
    }
    case 'cutoutInput': {
      if (!full) throw new Error('not loaded');
      const input = modelInput(full, BG_MODELS[req.model]);
      ctx.postMessage({ kind: 'cutoutInput', id: req.id, input }, [input.buffer]);
      return;
    }
    case 'setMask': {
      if (!full || !preview) throw new Error('not loaded');
      const m = maskFromOutput(req.output, req.side, full.width, full.height);
      const p = resizeMask(m, full.width, full.height, preview.img.width, preview.img.height);
      mask = { full: m, preview: p };
      ctx.postMessage({ kind: 'setMask', id: req.id, coverage: maskCoverage(p) });
      return;
    }
  }
}

ctx.onmessage = (e) => {
  const req = e.data;
  handle(req).catch((err: unknown) =>
    ctx.postMessage({ kind: 'error', id: req.id, message: (err as Error)?.message ?? String(err) }),
  );
};
