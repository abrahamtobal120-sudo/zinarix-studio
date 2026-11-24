import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import {
  FILTER_KEYS,
  IMAGE_FORMATS,
  IMAGE_PRESETS,
  MAX_SIDE,
  RANGES,
  clampCrop,
  cleanEdit,
  editedName,
  flipEdit,
  formatOf,
  isIdentity,
  orientedSize,
  outputSize,
  rotateEdit,
  type AdjustKey,
  type CropRect,
  type FilterKey,
  type ImageEdit,
  type ImageFormat,
} from '../../../shared/imageEdit';
import { BG_MODELS, type BgModelId, type BgStatusView } from '../../../shared/bgRemove';
import { confirmDialog } from '../../confirm';
import { api, openFile, toast } from '../../store';
import { ti, type KeyImg } from './imageStrings';
import { Icon } from '../Icon';
import type { ImageRequest, ImageResponse } from './imageWorkerProtocol';
import './image-editor.css';

/** Longest side of the copy the sliders work on (the full picture is only processed to save). */
const PREVIEW_SIDE = 1400;
/** Slider moves closer together than this are one undo step. */
const COALESCE_MS = 700;

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: '', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
];

/** Light (tone) and colour sliders, in the order of the panel. */
const LIGHT_KEYS: AdjustKey[] = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows'];
const COLOR_KEYS: AdjustKey[] = ['temperature', 'saturation', 'vibrance', 'hue'];

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const EDGES: Edge[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface History {
  list: ImageEdit[];
  i: number;
  /** Slider that made the last step, and when (to merge a drag into one step). */
  key?: string;
  at?: number;
}

type Drag =
  | { mode: 'new'; x0: number; y0: number }
  | { mode: 'move'; dx: number; dy: number; start: CropRect }
  | { mode: 'resize'; edge: Edge; start: CropRect };

/** A request without its id (the client numbers them). */
type Req = ImageRequest extends infer T ? (T extends unknown ? Omit<T, 'id'> : never) : never;

async function exists(path: string): Promise<boolean> {
  try {
    await api().workspace.readBytes(path, 0, 1);
    return true;
  } catch {
    return false;
  }
}

/** A name for the copy that does not overwrite an earlier one. */
async function freeName(path: string, format: ImageFormat): Promise<string> {
  const first = editedName(path, format);
  if (!(await exists(first))) return first;
  for (let n = 2; n < 1000; n++) {
    const p = first.replace(/(\.[^.]+)$/, `-${n}$1`);
    if (!(await exists(p))) return p;
  }
  return first;
}

/** Only rotation, flips, straighten, crop and size (what presets and Auto keep). */
/** The edit with the background back (cutout and backdrop removed). */
function withoutCutout(e: ImageEdit): ImageEdit {
  const { cutout: _c, backdrop: _b, ...rest } = e;
  return rest;
}

function geometryOnly(e: ImageEdit): ImageEdit {
  const g: ImageEdit = {};
  if (e.rotate) g.rotate = e.rotate;
  if (e.flipH) g.flipH = true;
  if (e.flipV) g.flipV = true;
  if (e.straighten) g.straighten = e.straighten;
  if (e.crop) g.crop = e.crop;
  if (e.resize) g.resize = e.resize;
  // The background removal is kept too (presets and Auto only change light and colour).
  if (e.cutout) g.cutout = true;
  if (e.backdrop) g.backdrop = e.backdrop;
  return g;
}

/** Draws the histogram (red, green, blue added, luminance as a line). */
function drawHistogram(c: HTMLCanvasElement, h: Uint32Array) {
  const g = c.getContext('2d');
  if (!g) return;
  const W = c.width;
  const H = c.height;
  g.clearRect(0, 0, W, H);
  // Scale on the 99th busiest bin, so one huge spike (a white background) does not flatten all.
  const sorted = Array.from(h.subarray(0, 768)).sort((a, b) => a - b);
  const top = Math.max(1, sorted[Math.floor(sorted.length * 0.99)]!);
  const col = ['rgba(255, 70, 70, 0.55)', 'rgba(70, 220, 90, 0.55)', 'rgba(80, 130, 255, 0.6)'];
  g.globalCompositeOperation = 'lighter';
  for (let ch = 0; ch < 3; ch++) {
    g.fillStyle = col[ch]!;
    g.beginPath();
    g.moveTo(0, H);
    for (let v = 0; v < 256; v++)
      g.lineTo((v / 255) * W, H - Math.min(1, h[ch * 256 + v]! / top) * H);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  g.lineWidth = 1;
  g.beginPath();
  for (let v = 0; v < 256; v++) {
    const y = H - Math.min(1, h[768 + v]! / top) * H;
    if (v) g.lineTo((v / 255) * W, y);
    else g.moveTo(0, y);
  }
  g.stroke();
}

export function ImageEditor({
  path,
  url,
  onClose,
  onReplaced,
}: {
  path: string;
  /** Blob URL of the file (already read by the viewer). */
  url: string;
  onClose: () => void;
  /** The original file was overwritten: the viewer reads it again. */
  onReplaced: () => void;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<History>({ list: [{}], i: 0 });
  const [savedIndex, setSavedIndex] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [cropDraft, setCropDraft] = useState<CropRect | null>(null);
  const [aspect, setAspect] = useState<string>('free');
  const [format, setFormat] = useState<ImageFormat>(formatOf(path) ?? 'png');
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [histogram, setHistogram] = useState<Uint32Array | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const edit = hist.list[hist.i]!;
  const W = dims?.w ?? 1;
  const H = dims?.h ?? 1;
  const oriented = orientedSize(W, H, edit.rotate);
  const outSize = outputSize(W, H, edit);
  const dirty = hist.i !== savedIndex && !isIdentity(edit);

  // ------------------------------------------------------------ worker
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const waiters = useRef(
    new Map<number, { ok: (r: ImageResponse) => void; fail: (e: Error) => void }>(),
  );

  const call = useCallback((req: Req, transfer: Transferable[] = []): Promise<ImageResponse> => {
    const w = worker.current;
    if (!w) return Promise.reject(new Error('worker'));
    const id = ++seq.current;
    return new Promise((ok, fail) => {
      waiters.current.set(id, { ok, fail });
      w.postMessage({ ...req, id }, transfer);
    });
  }, []);

  // ------------------------------------------------------------ load
  useEffect(() => {
    const w = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const pending = waiters.current;
    w.onmessage = (e: MessageEvent<ImageResponse>) => {
      const r = e.data;
      const p = pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      if (r.kind === 'error') {
        const err = new Error(r.message);
        (err as Error & { code?: string }).code = r.code;
        p.fail(err);
      } else p.ok(r);
    };
    w.onerror = (e) => {
      for (const p of pending.values()) p.fail(new Error(e.message || 'worker'));
      pending.clear();
    };
    let alive = true;
    void (async () => {
      try {
        // Through <img> (the CSP lets blob: pictures in, not fetch() of them).
        const el = new Image();
        el.src = url;
        await el.decode();
        const bitmap = await createImageBitmap(el);
        const r = await call(
          { kind: 'init', bitmap, previewSide: PREVIEW_SIDE, maxSide: MAX_SIDE },
          [bitmap],
        );
        if (alive && r.kind === 'init') setDims({ w: r.width, h: r.height });
      } catch (err) {
        if (!alive) return;
        setError(
          (err as { code?: string }).code === 'tooBig'
            ? ti('tooBig', { max: MAX_SIDE })
            : ti('broken'),
        );
      }
    })();
    return () => {
      alive = false;
      w.terminate();
      worker.current = null;
      for (const p of pending.values()) p.fail(new Error('closed'));
      pending.clear();
    };
  }, [url, call]);

  // ------------------------------------------------------------ history
  const commit = useCallback(
    (next: ImageEdit, key?: string) => {
      const clean = cleanEdit(next, W, H);
      setHist((h) => {
        const now = Date.now();
        if (JSON.stringify(clean) === JSON.stringify(h.list[h.i])) return h;
        if (key && h.key === key && h.at && now - h.at < COALESCE_MS && h.i > 0) {
          const list = h.list.slice(0, h.i + 1);
          list[h.i] = clean;
          return { list, i: h.i, key, at: now };
        }
        const list = [...h.list.slice(0, h.i + 1), clean].slice(-200);
        return { list, i: list.length - 1, key, at: now };
      });
    },
    [W, H],
  );
  const undo = () => setHist((h) => (h.i > 0 ? { ...h, i: h.i - 1, key: undefined } : h));
  const redo = () =>
    setHist((h) => (h.i < h.list.length - 1 ? { ...h, i: h.i + 1, key: undefined } : h));

  // ------------------------------------------------------------ preview
  /** What the canvas shows: while cropping, the whole (rotated, straightened) picture. */
  const shown = useMemo<ImageEdit>(() => {
    if (!cropDraft) return edit;
    const { crop: _c, resize: _r, ...rest } = edit;
    return rest;
  }, [edit, cropDraft]);

  // One render at a time; while one runs only the newest request waits (a slider drag skips
  // the frames the worker could not keep up with instead of queueing them all).
  const rendering = useRef(false);
  const queued = useRef<{ edit: ImageEdit; original: boolean } | null>(null);
  const render = useCallback(
    (e: ImageEdit, original: boolean) => {
      if (rendering.current) {
        queued.current = { edit: e, original };
        return;
      }
      rendering.current = true;
      call({ kind: 'render', edit: e, original })
        .then((r) => {
          if (r.kind !== 'render') return;
          const c = canvasRef.current;
          if (c) {
            c.width = r.width;
            c.height = r.height;
            c.getContext('2d')?.putImageData(
              new ImageData(new Uint8ClampedArray(r.data), r.width, r.height),
              0,
              0,
            );
            setDrawn(true);
          }
          if (!original) setHistogram(new Uint32Array(r.hist));
        })
        .catch(() => undefined)
        .finally(() => {
          rendering.current = false;
          const q = queued.current;
          queued.current = null;
          if (q) render(q.edit, q.original);
        });
    },
    [call],
  );
  useEffect(() => {
    if (dims) render(shown, showOriginal);
  }, [dims, shown, showOriginal, render]);

  useEffect(() => {
    if (histRef.current && histogram) drawHistogram(histRef.current, histogram);
  }, [histogram]);

  // Fit the canvas in the stage (size in CSS pixels, kept in state so the crop box follows).
  const shownSize = showOriginal ? { w: W, h: H } : cropDraft ? oriented : outSize;
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min((r.width - 32) / shownSize.w, (r.height - 32) / shownSize.h, 2);
      setView({ w: Math.max(1, shownSize.w * k), h: Math.max(1, shownSize.h * k) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shownSize.w, shownSize.h, error]);

  // ------------------------------------------------------------ crop
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? null;
  const startCrop = () => setCropDraft(edit.crop ?? { x: 0, y: 0, w: oriented.w, h: oriented.h });
  const toPx = (e: RPointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(oriented.w, ((e.clientX - r.left) / r.width) * oriented.w)),
      y: Math.max(0, Math.min(oriented.h, ((e.clientY - r.top) / r.height) * oriented.h)),
    };
  };
  /** The box from an anchor corner to the pointer (in the shape picked, inside the picture). */
  const withRatio = (x0: number, y0: number, x1: number, y1: number): CropRect => {
    let w = Math.abs(x1 - x0);
    let h = Math.abs(y1 - y0);
    if (ratio) {
      if (w / ratio > h) h = w / ratio;
      else w = h * ratio;
      // Keep inside the picture on the side the drag goes to.
      const maxW = x1 >= x0 ? oriented.w - x0 : x0;
      const maxH = y1 >= y0 ? oriented.h - y0 : y0;
      const k = Math.min(1, maxW / w, maxH / h);
      w *= k;
      h *= k;
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
    const x = x1 >= x0 ? x0 : x0 - w;
    const y = y1 >= y0 ? y0 : y0 - h;
    return { x, y, w, h };
  };
  /** Dragging a handle: corners move two sides, edges one (and the other axis follows a shape). */
  const resizeFrom = (edge: Edge, s: CropRect, p: { x: number; y: number }): CropRect => {
    const L = s.x;
    const T = s.y;
    const R = s.x + s.w;
    const B = s.y + s.h;
    if (edge.length === 2) {
      const ax = edge.includes('w') ? R : L;
      const ay = edge.includes('n') ? B : T;
      return withRatio(ax, ay, p.x, p.y);
    }
    const vertical = edge === 'n' || edge === 's';
    if (!ratio) {
      if (vertical) {
        const a = edge === 'n' ? B : T;
        return { x: L, y: Math.min(a, p.y), w: s.w, h: Math.max(1, Math.abs(p.y - a)) };
      }
      const a = edge === 'w' ? R : L;
      return { x: Math.min(a, p.x), y: T, w: Math.max(1, Math.abs(p.x - a)), h: s.h };
    }
    // With a shape: the dragged side sets one length, the other grows around the centre.
    if (vertical) {
      const a = edge === 'n' ? B : T;
      const up = p.y < a;
      let h = Math.max(1, Math.min(Math.abs(p.y - a), up ? a : oriented.h - a));
      let w = h * ratio;
      if (w > oriented.w) {
        w = oriented.w;
        h = w / ratio;
      }
      const x = Math.max(0, Math.min(oriented.w - w, L + s.w / 2 - w / 2));
      return { x, y: up ? a - h : a, w, h };
    }
    const a = edge === 'w' ? R : L;
    const left = p.x < a;
    let w = Math.max(1, Math.min(Math.abs(p.x - a), left ? a : oriented.w - a));
    let h = w / ratio;
    if (h > oriented.h) {
      h = oriented.h;
      w = h * ratio;
    }
    const y = Math.max(0, Math.min(oriented.h - h, T + s.h / 2 - h / 2));
    return { x: left ? a - w : a, y, w, h };
  };
  const onCropDown = (e: RPointerEvent) => {
    if (!cropDraft) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPx(e);
    const c = cropDraft;
    const edge = (e.target as HTMLElement).dataset.edge as Edge | undefined;
    if (edge) {
      drag.current = { mode: 'resize', edge, start: c };
      return;
    }
    const inside = p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
    drag.current = inside
      ? { mode: 'move', dx: p.x - c.x, dy: p.y - c.y, start: c }
      : { mode: 'new', x0: p.x, y0: p.y };
  };
  const onCropMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || !cropDraft) return;
    const p = toPx(e);
    if (d.mode === 'move') {
      const x = Math.max(0, Math.min(oriented.w - d.start.w, p.x - d.dx));
      const y = Math.max(0, Math.min(oriented.h - d.start.h, p.y - d.dy));
      setCropDraft({ ...d.start, x, y });
    } else if (d.mode === 'resize') {
      setCropDraft(resizeFrom(d.edge, d.start, p));
    } else {
      setCropDraft(withRatio(d.x0, d.y0, p.x, p.y));
    }
  };
  const onCropUp = () => {
    drag.current = null;
  };
  const pickAspect = (id: string) => {
    setAspect(id);
    const r = ASPECTS.find((a) => a.id === id)?.ratio;
    if (!r || !cropDraft) return;
    // The biggest box of that shape, centred on the current one.
    let w = oriented.w;
    let h = w / r;
    if (h > oriented.h) {
      h = oriented.h;
      w = h * r;
    }
    const cx = cropDraft.x + cropDraft.w / 2;
    const cy = cropDraft.y + cropDraft.h / 2;
    setCropDraft({
      x: Math.max(0, Math.min(oriented.w - w, cx - w / 2)),
      y: Math.max(0, Math.min(oriented.h - h, cy - h / 2)),
      w,
      h,
    });
  };
  const applyCrop = () => {
    if (!cropDraft) return;
    const { resize: _r, ...rest } = edit;
    commit({ ...rest, crop: clampCrop(cropDraft, oriented.w, oriented.h) });
    setCropDraft(null);
  };
  /** Arrow keys nudge the crop box (Shift: 10 px of the picture). */
  const nudgeCrop = (dx: number, dy: number) => {
    if (!cropDraft) return;
    setCropDraft({
      ...cropDraft,
      x: Math.max(0, Math.min(oriented.w - cropDraft.w, cropDraft.x + dx)),
      y: Math.max(0, Math.min(oriented.h - cropDraft.h, cropDraft.y + dy)),
    });
  };

  // ------------------------------------------------------------ size
  const base = outputSize(W, H, { ...edit, resize: undefined });
  const [sizeW, setSizeW] = useState('');
  const [sizeH, setSizeH] = useState('');
  const [lock, setLock] = useState(true);
  useEffect(() => {
    setSizeW(String(outSize.w));
    setSizeH(String(outSize.h));
  }, [outSize.w, outSize.h]);
  const typeW = (v: string) => {
    setSizeW(v);
    const n = Number(v);
    if (lock && n > 0) setSizeH(String(Math.max(1, Math.round((n * base.h) / base.w))));
  };
  const typeH = (v: string) => {
    setSizeH(v);
    const n = Number(v);
    if (lock && n > 0) setSizeW(String(Math.max(1, Math.round((n * base.w) / base.h))));
  };
  const applySize = (k?: number) => {
    const w = k ? Math.round(base.w * k) : Math.round(Number(sizeW));
    const h = k ? Math.round(base.h * k) : Math.round(Number(sizeH));
    if (!(w > 0 && h > 0)) return;
    commit({ ...edit, resize: { w: Math.min(MAX_SIDE, w), h: Math.min(MAX_SIDE, h) } });
  };

  // ------------------------------------------------------------ auto
  const auto = async () => {
    try {
      const r = await call({ kind: 'auto' });
      if (r.kind !== 'auto') return;
      // Keeps geometry and filters; replaces light and colour.
      const keep: ImageEdit = { ...geometryOnly(edit) };
      for (const k of FILTER_KEYS) if (edit[k] !== undefined) keep[k] = edit[k];
      commit({ ...keep, ...r.edit });
    } catch {
      /* the picture closed meanwhile */
    }
  };

  // ------------------------------------------------------------ background (Fase 1B)
  const [bgStatus, setBgStatus] = useState<BgStatusView | null>(null);
  const [bgModel, setBgModel] = useState<BgModelId>('fast');
  /** Model of the mask the worker holds (null: none yet). */
  const [maskModel, setMaskModel] = useState<BgModelId | null>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const [dl, setDl] = useState<{ got: number; total: number } | null>(null);
  const refreshBg = useCallback(() => {
    void api()
      .bg.status()
      .then(setBgStatus)
      .catch(() => setBgStatus(null));
  }, []);
  useEffect(() => {
    refreshBg();
    return api().on((ev) => {
      if (ev.type !== 'bg:progress') return;
      if (ev.error) {
        setDl(null);
        toast(ti('bgFailed', { err: ev.error }));
      } else if (ev.done) {
        setDl(null);
        toast(ti('bgDownloaded'));
        refreshBg();
      } else setDl({ got: ev.got, total: ev.total });
    });
  }, [refreshBg]);
  const modelReady = (m: BgModelId) => !!bgStatus?.models.find((x) => x.id === m)?.ready;
  const removeBg = async (m: BgModelId = bgModel) => {
    if (!dims || bgBusy) return;
    if (maskModel === m) {
      commit({ ...edit, cutout: true });
      return;
    }
    setBgBusy(true);
    try {
      const r = await call({ kind: 'cutoutInput', model: m });
      if (r.kind !== 'cutoutInput') throw new Error('worker');
      const output = await api().bg.infer(m, r.input);
      const s = await call({ kind: 'setMask', output, side: BG_MODELS[m].side }, [output.buffer]);
      if (s.kind !== 'setMask') throw new Error('worker');
      setMaskModel(m);
      if (s.coverage < 0.002) {
        toast(ti('bgNone'));
        return;
      }
      if (format === 'jpg' && !edit.backdrop) {
        setFormat('png');
        toast(ti('bgPng'));
      }
      // A new mask under the same edit: render again even when the edit does not change.
      if (edit.cutout) render(shown, showOriginal);
      else commit({ ...edit, cutout: true });
    } catch (e) {
      if ((e as Error).message !== 'closed')
        toast(ti('bgFailed', { err: (e as Error).message ?? String(e) }));
    } finally {
      setBgBusy(false);
    }
  };
  /** picker: dragging in the colour picker is one undo step, a swatch click is its own. */
  const setBackdrop = (c: string | null, picker = false) => {
    const { backdrop: _b, ...rest } = edit;
    commit(c ? { ...rest, cutout: true, backdrop: c } : rest, picker ? 'backdrop' : undefined);
  };

  // ------------------------------------------------------------ save
  const save = async (replace: boolean) => {
    if (!dims || busy) return;
    const fmt = replace ? formatOf(path) : format;
    if (!fmt) return;
    if (replace) {
      const name = path.split(/[\\/]/).pop() ?? path;
      const ok = await confirmDialog(ti('replaceAsk', { name }), {
        danger: true,
        okLabel: ti('replaceOk'),
      });
      if (!ok) return;
    }
    const at = hist.i;
    setBusy(true);
    try {
      const out = replace ? path : await freeName(path, fmt);
      // The worker does the full-size pass and the encoding: the window stays responsive.
      const r = await call({ kind: 'save', edit, format: fmt, quality });
      if (r.kind !== 'save') throw new Error('worker');
      await api().workspace.writeBytes(out, new Uint8Array(r.bytes));
      setSavedIndex(at);
      toast(ti('saved', { name: out.split(/[\\/]/).pop() ?? out }));
      if (replace) onReplaced();
      else void openFile(out).catch(() => undefined);
    } catch (e) {
      if ((e as Error).message !== 'closed')
        toast(ti('saveFailed', { err: (e as Error).message ?? String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (dirty && !(await confirmDialog(ti('unsaved')))) return;
    onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (
      (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') ||
      el.tagName === 'SELECT'
    )
      return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (mod && key === 's') {
      e.preventDefault();
      void save(false);
    } else if (e.key === 'Escape' && cropDraft) {
      setCropDraft(null);
    } else if (e.key === 'Enter' && cropDraft) {
      applyCrop();
    } else if (cropDraft && el.tagName !== 'INPUT' && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      nudgeCrop(
        e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0,
        e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0,
      );
    } else if (!mod && key === 'c' && !cropDraft && dims) {
      startCrop();
    }
  };

  // ------------------------------------------------------------ view
  if (error) return <div className="notice-pane">{error}</div>;
  const slider = (k: AdjustKey | FilterKey | 'straighten', disabled = !!cropDraft) => {
    const [min, max, step] = RANGES[k];
    const v = edit[k] ?? 0;
    const shownVal =
      k === 'exposure'
        ? v.toFixed(2)
        : k === 'straighten'
          ? `${v.toFixed(1)}°`
          : Math.round(v * 10) / 10;
    return (
      <label
        className="ie-slider"
        key={k}
        title={ti('resetHint')}
        onDoubleClick={() => commit({ ...edit, [k]: 0 })}
      >
        <span className="ie-slider-name">{ti(k as KeyImg)}</span>
        <span className={`ie-slider-val${v ? ' set' : ''}`}>{shownVal}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          disabled={disabled}
          className={min < 0 ? 'centered' : ''}
          onChange={(e) => commit({ ...edit, [k]: Number(e.target.value) }, k)}
        />
      </label>
    );
  };
  const sectionSet = (keys: readonly (AdjustKey | FilterKey)[]) =>
    keys.some((k) => edit[k] !== undefined);
  const clearKeys = (keys: readonly (AdjustKey | FilterKey)[]) => {
    const next = { ...edit };
    for (const k of keys) delete next[k];
    commit(next);
  };
  const sectionHead = (title: string, keys: readonly (AdjustKey | FilterKey)[]) => (
    <h4>
      {title}
      {sectionSet(keys) && !cropDraft && (
        <button className="ie-mini" onClick={() => clearKeys(keys)}>
          {ti('sectionReset')}
        </button>
      )}
    </h4>
  );
  const ready = !!dims;

  return (
    <div className="image-editor" tabIndex={0} onKeyDown={onKey}>
      <div className="image-tools">
        <button onClick={undo} disabled={hist.i === 0} title={ti('undo')}>
          ↶
        </button>
        <button onClick={redo} disabled={hist.i >= hist.list.length - 1} title={ti('redo')}>
          ↷
        </button>
        <button onClick={() => commit({})} disabled={isIdentity(edit)}>
          {ti('reset')}
        </button>
        <button
          title={ti('compare')}
          disabled={!ready || !!cropDraft}
          onPointerDown={() => setShowOriginal(true)}
          onPointerUp={() => setShowOriginal(false)}
          onPointerLeave={() => setShowOriginal(false)}
        >
          {ti('original')}
        </button>
        <button title={ti('autoHint')} disabled={!ready || !!cropDraft} onClick={() => void auto()}>
          <Icon name="sparkle" size={14} /> {ti('auto')}
        </button>
        <span className="viewer-dim">{ti('sizeNow', { w: outSize.w, h: outSize.h })}</span>
        <div className="spacer" />
        {busy && <span className="viewer-dim">{ti('saving')}</span>}
        <button onClick={() => void close()}>{ti('close')}</button>
      </div>
      <div className="ie-body">
        <div className="ie-stage" ref={stageRef}>
          {!ready && <span className="viewer-dim">{ti('loading')}</span>}
          <div
            className="ie-canvas-wrap"
            style={{ width: view.w, height: view.h, display: ready && drawn ? undefined : 'none' }}
          >
            <canvas ref={canvasRef} style={{ width: view.w, height: view.h }} />
            {cropDraft && !showOriginal && (
              <div
                className="ie-crop-layer"
                onPointerDown={onCropDown}
                onPointerMove={onCropMove}
                onPointerUp={onCropUp}
                onPointerCancel={onCropUp}
              >
                <div
                  className="ie-crop-box"
                  style={{
                    left: `${(cropDraft.x / oriented.w) * 100}%`,
                    top: `${(cropDraft.y / oriented.h) * 100}%`,
                    width: `${(cropDraft.w / oriented.w) * 100}%`,
                    height: `${(cropDraft.h / oriented.h) * 100}%`,
                  }}
                >
                  <span className="ie-crop-size">
                    {Math.round(cropDraft.w)} × {Math.round(cropDraft.h)}
                  </span>
                  {EDGES.map((d) => (
                    <span key={d} className={`ie-h ie-h-${d}`} data-edge={d} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <aside className="ie-side">
          <section>
            <canvas
              ref={histRef}
              className="ie-hist"
              width={256}
              height={70}
              title={ti('histogram')}
            />
          </section>
          <section>
            <h4>{ti('geometry')}</h4>
            <div className="ie-row">
              <button
                title={ti('rotateLeft')}
                disabled={!!cropDraft}
                onClick={() => commit(rotateEdit(edit, W, H, -1))}
              >
                ⟲
              </button>
              <button
                title={ti('rotateRight')}
                disabled={!!cropDraft}
                onClick={() => commit(rotateEdit(edit, W, H, 1))}
              >
                ⟳
              </button>
              <button
                title={ti('flipH')}
                disabled={!!cropDraft}
                onClick={() => commit(flipEdit(edit, W, H, 'h'))}
              >
                ⇋
              </button>
              <button
                title={ti('flipV')}
                disabled={!!cropDraft}
                onClick={() => commit(flipEdit(edit, W, H, 'v'))}
              >
                ⇵
              </button>
              {!cropDraft && (
                <button onClick={startCrop} disabled={!ready} title={ti('cropKey')}>
                  {ti('crop')}
                </button>
              )}
            </div>
            {slider('straighten', false)}
            {cropDraft && (
              <>
                <p className="ie-hint">{ti('cropHint')}</p>
                <div className="ie-row ie-wrap">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      className={aspect === a.id ? 'on' : ''}
                      onClick={() => pickAspect(a.id)}
                    >
                      {a.ratio ? a.label : ti('free')}
                    </button>
                  ))}
                </div>
                <div className="ie-row">
                  <button className="on" onClick={applyCrop}>
                    {ti('cropApply')}
                  </button>
                  <button onClick={() => setCropDraft(null)}>{ti('cropCancel')}</button>
                </div>
              </>
            )}
            {edit.crop && !cropDraft && (
              <div className="ie-row">
                <button
                  onClick={() => {
                    const { crop: _c, resize: _r, ...rest } = edit;
                    commit(rest);
                  }}
                >
                  {ti('cropClear')}
                </button>
              </div>
            )}
          </section>
          <section>
            <h4>{ti('size')}</h4>
            <div className="ie-row">
              <label className="ie-num">
                {ti('width')}
                <input
                  type="number"
                  min={1}
                  max={MAX_SIDE}
                  value={sizeW}
                  onChange={(e) => typeW(e.target.value)}
                />
              </label>
              <label className="ie-num">
                {ti('height')}
                <input
                  type="number"
                  min={1}
                  max={MAX_SIDE}
                  value={sizeH}
                  onChange={(e) => typeH(e.target.value)}
                />
              </label>
            </div>
            <div className="ie-row">
              <label className="ie-check">
                <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
                {ti('keepRatio')}
              </label>
              <button onClick={() => applySize()} disabled={!!cropDraft}>
                {ti('applySize')}
              </button>
            </div>
            <div className="ie-row ie-wrap">
              {[0.25, 0.5, 0.75].map((k) => (
                <button key={k} disabled={!!cropDraft} onClick={() => applySize(k)}>
                  {k * 100}%
                </button>
              ))}
              {edit.resize && (
                <button
                  disabled={!!cropDraft}
                  onClick={() => {
                    const { resize: _r, ...rest } = edit;
                    commit(rest);
                  }}
                >
                  {ti('sizeClear')}
                </button>
              )}
            </div>
          </section>
          <section className="ie-bg">
            <h4>{ti('bg')}</h4>
            {bgStatus && !bgStatus.available ? (
              <p className="ie-hint">{ti('bgUnavailable')}</p>
            ) : (
              <>
                <div className="ie-row ie-wrap" role="radiogroup" aria-label={ti('bg')}>
                  {(['fast', 'precise'] as const).map((m) => (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={bgModel === m}
                      className={bgModel === m ? 'on' : ''}
                      title={ti(m === 'fast' ? 'bgFastHint' : 'bgPreciseHint')}
                      onClick={() => setBgModel(m)}
                    >
                      {ti(m === 'fast' ? 'bgFast' : 'bgPrecise')}
                    </button>
                  ))}
                </div>
                {!modelReady(bgModel) && bgStatus && (
                  <div className="ie-row ie-wrap">
                    {dl ? (
                      <>
                        <progress className="ie-progress" value={dl.got} max={dl.total} />
                        <span className="viewer-dim">
                          {ti('bgDownloading', { pct: Math.floor((dl.got / dl.total) * 100) })}
                        </span>
                        <button onClick={() => void api().bg.cancelDownload(bgModel)}>
                          {ti('bgCancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setDl({ got: 0, total: BG_MODELS[bgModel].bytes });
                          void api().bg.download(bgModel);
                        }}
                      >
                        {ti('bgDownload', {
                          name: ti(bgModel === 'fast' ? 'bgFast' : 'bgPrecise').toLowerCase(),
                          mb: Math.max(1, Math.round(BG_MODELS[bgModel].bytes / 1e6)),
                        })}
                      </button>
                    )}
                  </div>
                )}
                <div className="ie-row ie-wrap">
                  {!edit.cutout ? (
                    <button
                      className="on"
                      title={ti('bgRemoveHint')}
                      disabled={!ready || !!cropDraft || bgBusy || !modelReady(bgModel)}
                      onClick={() => void removeBg()}
                    >
                      {!bgBusy && <Icon name="scissors" size={14} />}{' '}
                      {bgBusy ? ti('bgWorking') : ti('bgRemove')}
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={!!cropDraft}
                        onClick={() => commit({ ...withoutCutout(edit) })}
                      >
                        {ti('bgRestore')}
                      </button>
                      {maskModel !== bgModel && (
                        <button
                          disabled={!ready || !!cropDraft || bgBusy || !modelReady(bgModel)}
                          onClick={() => void removeBg()}
                        >
                          {bgBusy ? ti('bgWorking') : ti('bgRedo')}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {edit.cutout && (
                  <div
                    className="ie-row ie-wrap ie-backdrops"
                    role="radiogroup"
                    aria-label={ti('bgBehind')}
                  >
                    <span className="viewer-dim">{ti('bgBehind')}</span>
                    {[
                      { c: null, label: ti('bgTransparent') },
                      { c: '#ffffff', label: ti('bgWhite') },
                      { c: '#000000', label: ti('bgBlack') },
                    ].map((o) => (
                      <button
                        key={o.label}
                        role="radio"
                        aria-checked={(edit.backdrop ?? null) === o.c}
                        className={`ie-swatch${(edit.backdrop ?? null) === o.c ? ' on' : ''}${o.c ? '' : ' clear'}`}
                        style={o.c ? { background: o.c } : undefined}
                        title={o.label}
                        aria-label={o.label}
                        disabled={!!cropDraft}
                        onClick={() => setBackdrop(o.c)}
                      />
                    ))}
                    <label className="ie-swatch-pick" title={ti('bgColor')}>
                      <input
                        type="color"
                        aria-label={ti('bgColor')}
                        value={edit.backdrop ?? '#3b82f6'}
                        disabled={!!cropDraft}
                        onChange={(e) => setBackdrop(e.target.value, true)}
                      />
                    </label>
                  </div>
                )}
                {!edit.cutout && <p className="ie-hint">{ti('bgRemoveHint')}</p>}
              </>
            )}
          </section>
          <section>
            <h4>{ti('presets')}</h4>
            <div className="ie-row ie-wrap">
              {IMAGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  disabled={!!cropDraft}
                  onClick={() => commit({ ...geometryOnly(edit), ...p.edit })}
                >
                  {ti(`p_${p.id}` as KeyImg)}
                </button>
              ))}
            </div>
          </section>
          <section>
            {sectionHead(ti('light'), LIGHT_KEYS)}
            {LIGHT_KEYS.map((k) => slider(k))}
          </section>
          <section>
            {sectionHead(ti('color'), COLOR_KEYS)}
            {COLOR_KEYS.map((k) => slider(k))}
          </section>
          <section>
            {sectionHead(ti('filters'), FILTER_KEYS)}
            {FILTER_KEYS.map((k) => slider(k))}
          </section>
          <section>
            <h4>{ti('save')}</h4>
            <div className="ie-row">
              <label className="ie-num">
                {ti('format')}
                <select value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
                  {IMAGE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              {format !== 'png' && (
                <label className="ie-num">
                  {ti('quality')}
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={quality}
                    onChange={(e) =>
                      setQuality(Math.max(1, Math.min(100, Number(e.target.value) || 92)))
                    }
                  />
                </label>
              )}
            </div>
            {format === 'jpg' && <p className="ie-hint">{ti('jpgNoAlpha')}</p>}
            <div className="ie-row ie-wrap">
              <button
                className="on"
                disabled={busy || !ready || !!cropDraft}
                title={ti('saveCopyHint', {
                  name: editedName(path.split(/[\\/]/).pop() ?? path, format),
                })}
                onClick={() => void save(false)}
              >
                {ti('saveCopy')}
              </button>
              <button
                disabled={busy || !ready || !!cropDraft || !formatOf(path) || isIdentity(edit)}
                onClick={() => void save(true)}
              >
                {ti('replace')}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
