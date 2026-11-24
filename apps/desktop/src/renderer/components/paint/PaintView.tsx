import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as RKeyboardEvent, ReactNode } from 'react';
import { confirmDialog } from '../../confirm';
import { api, onDiskChange, registerViewerSaver, setTabDirty, toast } from '../../store';
import { isTypingTarget, uniqueName } from '../../../shared/graphics';
import {
  BLEND_MODES,
  BRUSH_KINDS,
  BRUSH_SPACING,
  MAX_LAYERS,
  MAX_PAINT_SIDE,
  compositeOf,
  diskPoints,
  floodFill,
  hexToRgba,
  mirrorPoints,
  mulberry32,
  normPressure,
  parsePaintFile,
  pixelBox,
  rectMap,
  rgbToHex,
  scaleRect,
  serializePaintFile,
  stampsBetween,
  type BlendMode,
  type BrushKind,
  type Corner,
  type Rect,
  type Stamp,
  type StrokePoint,
  type Symmetry,
} from '../../../shared/paint';
import { tg, type KeyG } from '../graphics/graphicsStrings';
import './paint.css';

/**
 * Fase 3A (plan de funciones): paint canvas — brush with pen pressure (Pointer Events),
 * eraser, bucket fill, eyedropper and layers (opacity, blend modes, order, merge). A .zdraw
 * file keeps the layers; "Export PNG" flattens them. Opened from a picture, the picture is
 * the bottom layer and the drawing is saved next to it.
 */

type Tool = 'brush' | 'eraser' | 'bucket' | 'picker' | 'rect' | 'lasso' | 'move';
type P = { x: number; y: number };

/** The selection: a mask (white = selected) and the outlines shown as marching ants. */
interface Selection {
  mask: HTMLCanvasElement;
  outline: P[][];
  data: Uint8ClampedArray | null;
}

/** Pixels lifted off a layer to move / scale them (or pasted), until Enter or another tool. */
interface Float {
  canvas: HTMLCanvasElement;
  /** Where the pixels came from and where they are now (canvas px). */
  src: Rect;
  dst: Rect;
  flipX: boolean;
  flipY: boolean;
  layer: number;
  /** The whole layer before the lift (for the undo step and Esc). */
  before: ImageData;
  /** The selection moves with the pixels. */
  carriesSel: boolean;
}

/** Tools that Alt turns into the eyedropper. */
const PAINTING = new Set<Tool>(['brush', 'eraser', 'bucket']);

interface Layer {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  canvas: HTMLCanvasElement;
}

type Step =
  | { kind: 'pixels'; layer: number; x: number; y: number; before: ImageData; after: ImageData }
  | {
      kind: 'layers';
      before: LayerMeta[];
      after: LayerMeta[];
      activeBefore: number;
      activeAfter: number;
    };

/** Layer list state (the canvases are shared, not copied). */
type LayerMeta = Omit<Layer, never>;

const SWATCHES = [
  '#000000',
  '#ffffff',
  '#7f8c8d',
  '#e74c3c',
  '#e67e22',
  '#f1c40f',
  '#2ecc71',
  '#1abc9c',
  '#3498db',
  '#2c3e50',
  '#9b59b6',
  '#ff6fb5',
  '#8d6e63',
  '#ffe0bd',
  '#c0392b',
  '#16a085',
];
const MAX_HISTORY_BYTES = 600 * 1024 * 1024;
let nextId = 1;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const ctx = (c: HTMLCanvasElement): CanvasRenderingContext2D =>
  c.getContext('2d', { willReadFrequently: true })!;

async function pngOf(c: HTMLCanvasElement): Promise<Uint8Array> {
  const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (!b) throw new Error('canvas');
  return new Uint8Array(await b.arrayBuffer());
}
function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function imageFrom(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export function PaintView({
  path,
  source,
  onClose,
}: {
  /** The .zdraw file — or, with `source`, the picture it starts from. */
  path: string;
  source?: { url: string };
  onClose?: () => void;
}) {
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const st = useRef({
    w: 0,
    h: 0,
    layers: [] as Layer[],
    active: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    undo: [] as Step[],
    redo: [] as Step[],
    bytes: 0,
    dirty: false,
    file: source ? null : path,
    stroke: null as null | {
      canvas: HTMLCanvasElement;
      last: StrokePoint;
      carry: number;
      box: { x0: number; y0: number; x1: number; y1: number };
      tool: 'brush' | 'eraser';
    },
    lastPoint: null as StrokePoint | null,
    sel: null as Selection | null,
    lasso: null as null | { kind: 'rect' | 'lasso'; pts: P[]; mode: 'new' | 'add' | 'sub' },
    float: null as Float | null,
    fdrag: null as null | { kind: 'move' | 'scale'; corner: Corner; start: P; r0: Rect },
    clip: null as null | { canvas: HTMLCanvasElement; x: number; y: number },
    rand: mulberry32(1),
    seed: 1,
    pan: null as null | { sx: number; sy: number; px: number; py: number },
    raf: 0,
    space: false,
    alt: false,
    /** Zoomed or panned by the user: resizing the window keeps the view. */
    userView: false,
  }).current;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('brush');
  const [size, setSize] = useState(12);
  const [flow, setFlow] = useState(100);
  const [hardness, setHardness] = useState(80);
  const [pSize, setPSize] = useState(true);
  const [pFlow, setPFlow] = useState(false);
  const [tolerance, setTolerance] = useState(32);
  const [sampleAll, setSampleAll] = useState(true);
  const [color, setColor] = useState('#1f2933');
  const [color2, setColor2] = useState('#ffffff');
  const [brushKind, setBrushKind] = useState<BrushKind>('round');
  const [sym, setSym] = useState<Symmetry>('none');
  const [recent, setRecent] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<number | null>(null);
  /** Opacity of the layer when its slider started moving (for one undo step). */
  const opacityFrom = useRef<number | null>(null);
  const opts = useRef({
    tool,
    size,
    flow,
    hardness,
    pSize,
    pFlow,
    tolerance,
    sampleAll,
    color,
    brushKind,
    sym,
  });
  opts.current = {
    tool,
    size,
    flow,
    hardness,
    pSize,
    pFlow,
    tolerance,
    sampleAll,
    color,
    brushKind,
    sym,
  };

  // ---------------------------------------------------------------- drawing the view

  const draw = useCallback(() => {
    st.raf = 0;
    const v = view.current;
    if (!v || !st.w) return;
    const g = ctx(v);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, st.w, st.h);
    st.layers.forEach((l, i) => {
      if (!l.visible) return;
      let src: HTMLCanvasElement = l.canvas;
      if (i === st.active && st.stroke) {
        // The layer with the stroke on it, as it will be when the stroke ends.
        const tmp = scratch(st.w, st.h);
        const tg2 = ctx(tmp);
        tg2.globalCompositeOperation = 'source-over';
        tg2.globalAlpha = 1;
        tg2.clearRect(0, 0, st.w, st.h);
        tg2.drawImage(l.canvas, 0, 0);
        tg2.globalAlpha = opts.current.flow / 100;
        tg2.globalCompositeOperation =
          st.stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        tg2.drawImage(clipped(st.stroke.canvas), 0, 0);
        src = tmp;
      } else if (st.float && st.float.layer === l.id) {
        // The lifted pixels on top of what is left of the layer.
        const tmp = scratch(st.w, st.h);
        const tg2 = ctx(tmp);
        tg2.globalCompositeOperation = 'source-over';
        tg2.globalAlpha = 1;
        tg2.clearRect(0, 0, st.w, st.h);
        tg2.drawImage(l.canvas, 0, 0);
        drawFloat(tg2, st.float);
        src = tmp;
      }
      g.globalAlpha = l.opacity;
      g.globalCompositeOperation = compositeOf(l.blend) as GlobalCompositeOperation;
      g.drawImage(src, 0, 0);
    });
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clipped() only reads st
  }, [st]);

  /** The stroke kept inside the selection (the stroke canvas itself when there is none). */
  function clipped(c: HTMLCanvasElement): HTMLCanvasElement {
    if (!st.sel) return c;
    const out = scratch3(st.w, st.h);
    const g = ctx(out);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, st.w, st.h);
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(st.sel.mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return out;
  }

  const redraw = useCallback(() => {
    if (!st.raf) st.raf = requestAnimationFrame(draw);
  }, [st, draw]);

  const layout = useCallback(() => {
    const v = view.current;
    if (!v) return;
    v.style.left = `${st.panX}px`;
    v.style.top = `${st.panY}px`;
    v.style.width = `${st.w * st.zoom}px`;
    v.style.height = `${st.h * st.zoom}px`;
    v.style.imageRendering = st.zoom >= 2 ? 'pixelated' : 'auto';
  }, [st]);

  const fit = useCallback(() => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || !st.w) return;
    st.zoom = Math.max(0.02, Math.min(4, (r.width - 64) / st.w, (r.height - 64) / st.h));
    st.panX = (r.width - st.w * st.zoom) / 2;
    st.panY = (r.height - st.h * st.zoom) / 2;
    st.userView = false;
    layout();
    bump();
  }, [st, layout, bump]);

  const zoomAt = (f: number, x?: number, y?: number) => {
    const r = stage.current!.getBoundingClientRect();
    const cx = x ?? r.width / 2;
    const cy = y ?? r.height / 2;
    const z = Math.max(0.02, Math.min(32, st.zoom * f));
    st.panX = cx - (cx - st.panX) * (z / st.zoom);
    st.panY = cy - (cy - st.panY) * (z / st.zoom);
    st.zoom = z;
    st.userView = true;
    layout();
    bump();
  };

  const markDirty = (on = true) => {
    st.dirty = on;
    if (!source) setTabDirty(path, on);
    bump();
  };

  // ---------------------------------------------------------------- load

  const load = useCallback(async () => {
    setError(null);
    try {
      let w: number;
      let h: number;
      const layers: Layer[] = [];
      if (source) {
        const img = await imageFrom(source.url);
        w = img.naturalWidth;
        h = img.naturalHeight;
        if (w > MAX_PAINT_SIDE || h > MAX_PAINT_SIDE)
          throw new Error(tg('tooBig', { max: MAX_PAINT_SIDE }));
        const base = makeCanvas(w, h);
        ctx(base).drawImage(img, 0, 0);
        layers.push({
          id: nextId++,
          name: tg('baseLayer'),
          visible: true,
          opacity: 1,
          blend: 'normal',
          canvas: base,
        });
        layers.push({
          id: nextId++,
          name: tg('layerName', { n: 1 }),
          visible: true,
          opacity: 1,
          blend: 'normal',
          canvas: makeCanvas(w, h),
        });
      } else {
        const f = await api().workspace.readFile(path);
        if (f.tooLarge) throw new Error('too large');
        const doc = parsePaintFile(f.content);
        w = doc.width;
        h = doc.height;
        for (const l of doc.layers) {
          const c = makeCanvas(w, h);
          if (l.png) ctx(c).drawImage(await imageFrom(`data:image/png;base64,${l.png}`), 0, 0);
          layers.push({
            id: nextId++,
            name: l.name,
            visible: l.visible,
            opacity: l.opacity,
            blend: l.blend,
            canvas: c,
          });
        }
      }
      st.w = w;
      st.h = h;
      st.layers = layers;
      st.active = layers.length - 1;
      st.undo = [];
      st.redo = [];
      st.bytes = 0;
      const v = view.current!;
      v.width = w;
      v.height = h;
      setReady(true);
      markDirty(false);
      requestAnimationFrame(() => {
        fit();
        redraw();
      });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, source?.url]);

  useLayoutEffect(() => {
    void load();
  }, [load]);

  // ---------------------------------------------------------------- history

  const push = (s: Step) => {
    st.undo.push(s);
    st.redo = [];
    if (s.kind === 'pixels') st.bytes += s.before.data.length * 2;
    while (st.bytes > MAX_HISTORY_BYTES && st.undo.length > 1) {
      const old = st.undo.shift()!;
      if (old.kind === 'pixels') st.bytes -= old.before.data.length * 2;
    }
    markDirty();
  };

  const layerById = (id: number) => st.layers.find((l) => l.id === id);

  const applyStep = (s: Step, back: boolean) => {
    if (s.kind === 'pixels') {
      const l = layerById(s.layer);
      if (l) ctx(l.canvas).putImageData(back ? s.before : s.after, s.x, s.y);
    } else {
      st.layers = (back ? s.before : s.after).map((m) => ({ ...m }));
      st.active = Math.min(st.layers.length - 1, back ? s.activeBefore : s.activeAfter);
    }
    markDirty();
    redraw();
  };

  const undo = () => {
    if (st.float) return cancelFloat();
    const s = st.undo.pop();
    if (!s) return;
    st.redo.push(s);
    applyStep(s, true);
  };
  const redo = () => {
    if (st.float) return;
    const s = st.redo.pop();
    if (!s) return;
    st.undo.push(s);
    applyStep(s, false);
  };

  /** A change of the layer list as one undo step. */
  const layersChange = (fn: (layers: Layer[]) => { layers: Layer[]; active: number } | null) => {
    const before = st.layers.map((l) => ({ ...l }));
    const activeBefore = st.active;
    const r = fn(st.layers.map((l) => ({ ...l })));
    if (!r) return;
    st.layers = r.layers;
    st.active = r.active;
    push({
      kind: 'layers',
      before,
      after: r.layers.map((l) => ({ ...l })),
      activeBefore,
      activeAfter: r.active,
    });
    redraw();
  };

  /** Pixels of a layer changed inside a box: one undo step. */
  const pixelsChange = (l: Layer, x: number, y: number, w: number, h: number, fn: () => void) => {
    x = Math.max(0, Math.floor(x));
    y = Math.max(0, Math.floor(y));
    w = Math.min(st.w - x, Math.ceil(w));
    h = Math.min(st.h - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    const g = ctx(l.canvas);
    const before = g.getImageData(x, y, w, h);
    fn();
    const after = g.getImageData(x, y, w, h);
    push({ kind: 'pixels', layer: l.id, x, y, before, after });
    redraw();
  };

  // ---------------------------------------------------------------- tools

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = view.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * st.w,
      y: ((e.clientY - r.top) / r.height) * st.h,
    };
  };

  const dab = (g: CanvasRenderingContext2D, s: Stamp) => {
    const o = opts.current;
    const r = s.size / 2;
    const c = hexToRgba(o.tool === 'eraser' ? '#000000' : o.color);
    const kind: BrushKind = o.brushKind;
    const rgb = `rgb(${c.r} ${c.g} ${c.b})`;
    if (kind === 'pencil') {
      // Hard, a little grainy.
      g.globalAlpha = s.alpha * (0.65 + 0.35 * st.rand());
      g.fillStyle = rgb;
      g.beginPath();
      g.arc(s.x, s.y, Math.max(0.5, r), 0, Math.PI * 2);
      g.fill();
      return;
    }
    if (kind === 'marker') {
      // A flat, slanted tip.
      g.globalAlpha = s.alpha;
      g.fillStyle = rgb;
      g.save();
      g.translate(s.x, s.y);
      g.rotate(-Math.PI / 4);
      g.scale(1, 0.32);
      g.beginPath();
      g.arc(0, 0, Math.max(0.5, r), 0, Math.PI * 2);
      g.fill();
      g.restore();
      return;
    }
    if (kind === 'spray' || kind === 'chalk') {
      const n =
        kind === 'spray'
          ? Math.min(160, Math.max(4, Math.round(r * 0.8)))
          : Math.min(320, Math.max(6, Math.round(r * r * 0.22)));
      g.fillStyle = rgb;
      for (const d of diskPoints(s.x, s.y, r, n, st.rand)) {
        const dr = kind === 'spray' ? 0.6 + st.rand() * 0.7 : 0.5 + st.rand() * 1.1;
        g.globalAlpha = s.alpha * (kind === 'spray' ? 1 : 0.55 + st.rand() * 0.45);
        g.fillRect(d.x - dr, d.y - dr, dr * 2, dr * 2);
      }
      return;
    }
    const hard = kind === 'airbrush' ? 0 : o.hardness / 100;
    g.globalAlpha = kind === 'airbrush' ? s.alpha * 0.1 : s.alpha;
    if (hard >= 0.98 || r < 1.5) {
      g.fillStyle = `rgb(${c.r} ${c.g} ${c.b})`;
      g.beginPath();
      g.arc(s.x, s.y, Math.max(0.5, r), 0, Math.PI * 2);
      g.fill();
      return;
    }
    const grad = g.createRadialGradient(s.x, s.y, r * hard, s.x, s.y, r);
    grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 1)`);
    grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
    g.fillStyle = grad;
    g.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  };

  const strokeTo = (p: StrokePoint) => {
    const s = st.stroke;
    if (!s) return;
    const o = opts.current;
    const spacing = s.tool === 'eraser' ? 0.12 : BRUSH_SPACING[o.brushKind];
    const r = stampsBetween(
      s.last,
      p,
      { size: o.size, sizePressure: o.pSize, flowPressure: o.pFlow, spacing },
      s.carry,
    );
    const g = ctx(s.canvas);
    for (const d0 of r.stamps)
      for (const m of mirrorPoints(o.sym, d0.x, d0.y, st.w, st.h)) {
        const d = { ...d0, x: m.x, y: m.y };
        dab(g, d);
        const half = d.size / 2 + 2;
        s.box.x0 = Math.min(s.box.x0, d.x - half);
        s.box.y0 = Math.min(s.box.y0, d.y - half);
        s.box.x1 = Math.max(s.box.x1, d.x + half);
        s.box.y1 = Math.max(s.box.y1, d.y + half);
      }
    s.carry = r.carry;
    s.last = p;
    redraw();
  };

  const pick = (x: number, y: number, secondary = false) => {
    const v = view.current;
    if (!v) return;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= st.w || py >= st.h) return;
    draw();
    const d = ctx(v).getImageData(px, py, 1, 1).data;
    const hex = rgbToHex(d[0]!, d[1]!, d[2]!);
    if (secondary) setColor2(hex);
    else setColor(hex);
  };

  const composite = (): HTMLCanvasElement => {
    const c = makeCanvas(st.w, st.h);
    const g = ctx(c);
    for (const l of st.layers) {
      if (!l.visible) continue;
      g.globalAlpha = l.opacity;
      g.globalCompositeOperation = compositeOf(l.blend) as GlobalCompositeOperation;
      g.drawImage(l.canvas, 0, 0);
    }
    return c;
  };

  const bucket = (x: number, y: number) => {
    const l = st.layers[st.active];
    if (!l || !l.visible) return;
    const o = opts.current;
    const g = ctx(l.canvas);
    const target = g.getImageData(0, 0, st.w, st.h);
    const sample = o.sampleAll ? ctx(composite()).getImageData(0, 0, st.w, st.h).data : target.data;
    const before = g.getImageData(0, 0, st.w, st.h);
    const box = floodFill(
      target.data,
      sample,
      st.w,
      st.h,
      x,
      y,
      hexToRgba(o.color),
      (o.tolerance / 100) * 255,
    );
    if (!box) return;
    if (st.sel) {
      // Only inside the selection.
      const m = selData();
      for (let yy = box.y; yy < box.y + box.h; yy++)
        for (let xx = box.x; xx < box.x + box.w; xx++) {
          const i = (yy * st.w + xx) * 4;
          if (m[i + 3]! < 128) for (let k = 0; k < 4; k++) target.data[i + k] = before.data[i + k]!;
        }
    }
    g.putImageData(target, 0, 0);
    // Only the changed box goes to the history.
    const b = new ImageData(box.w, box.h);
    for (let row = 0; row < box.h; row++) {
      const from = ((box.y + row) * st.w + box.x) * 4;
      b.data.set(before.data.subarray(from, from + box.w * 4), row * box.w * 4);
    }
    push({
      kind: 'pixels',
      layer: l.id,
      x: box.x,
      y: box.y,
      before: b,
      after: g.getImageData(box.x, box.y, box.w, box.h),
    });
    remember(o.color);
    redraw();
  };

  const remember = (c: string) => setRecent((r) => [c, ...r.filter((x) => x !== c)].slice(0, 8));

  // ---------------------------------------------------------------- selection

  const selData = (): Uint8ClampedArray => {
    const s0 = st.sel!;
    if (!s0.data) s0.data = ctx(s0.mask).getImageData(0, 0, st.w, st.h).data;
    return s0.data;
  };

  const fillPoly = (g: CanvasRenderingContext2D, poly: P[]) => {
    g.beginPath();
    poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fill();
  };

  const pageRect = (): P[] => [
    { x: 0, y: 0 },
    { x: st.w, y: 0 },
    { x: st.w, y: st.h },
    { x: 0, y: st.h },
  ];

  const applySel = (poly: P[], mode: 'new' | 'add' | 'sub') => {
    const keep = st.sel && mode !== 'new';
    const mask = keep ? st.sel!.mask : makeCanvas(st.w, st.h);
    const g = ctx(mask);
    g.fillStyle = 'white';
    g.globalCompositeOperation = mode === 'sub' ? 'destination-out' : 'source-over';
    fillPoly(g, poly);
    g.globalCompositeOperation = 'source-over';
    st.sel = { mask, outline: keep ? [...st.sel!.outline, poly] : [poly], data: null };
    if (mode === 'sub' && !selBox()) st.sel = null;
    bump();
  };

  /** Box of what is selected (whole pixels), or null. */
  const selBox = (): Rect | null => {
    if (!st.sel) return null;
    const d = selData();
    let x0 = st.w;
    let y0 = st.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < st.h; y++)
      for (let x = 0; x < st.w; x++)
        if (d[(y * st.w + x) * 4 + 3]! > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  const selectAll = () => {
    commitFloat();
    st.sel = null;
    applySel(pageRect(), 'new');
  };
  const deselect = () => {
    commitFloat();
    st.sel = null;
    bump();
  };
  const invertSel = () => {
    commitFloat();
    if (!st.sel) return selectAll();
    const mask = makeCanvas(st.w, st.h);
    const g = ctx(mask);
    g.fillStyle = 'white';
    g.fillRect(0, 0, st.w, st.h);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(st.sel.mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    st.sel = { mask, outline: [pageRect(), ...st.sel.outline], data: null };
    if (!selBox()) st.sel = null;
    bump();
  };

  /** Pixels of the active layer inside the selection, cut to its box (null: nothing there). */
  const selectedPixels = (): { canvas: HTMLCanvasElement; box: Rect } | null => {
    const l = st.layers[st.active];
    if (!l) return null;
    const box = st.sel ? selBox() : { x: 0, y: 0, w: st.w, h: st.h };
    if (!box) return null;
    const c = makeCanvas(box.w, box.h);
    const g = ctx(c);
    g.drawImage(l.canvas, -box.x, -box.y);
    if (st.sel) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(st.sel.mask, -box.x, -box.y);
      g.globalCompositeOperation = 'source-over';
    }
    return { canvas: c, box };
  };

  const selClear = () => {
    const l = st.layers[st.active];
    if (!l || !l.visible) return;
    commitFloat();
    const box = st.sel ? selBox() : { x: 0, y: 0, w: st.w, h: st.h };
    if (!box) return;
    pixelsChange(l, box.x, box.y, box.w, box.h, () => {
      const g = ctx(l.canvas);
      if (!st.sel) return g.clearRect(0, 0, st.w, st.h);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(st.sel.mask, 0, 0);
      g.globalCompositeOperation = 'source-over';
    });
  };

  const selFill = () => {
    const l = st.layers[st.active];
    if (!l || !l.visible) return;
    commitFloat();
    const box = st.sel ? selBox() : { x: 0, y: 0, w: st.w, h: st.h };
    if (!box) return;
    pixelsChange(l, box.x, box.y, box.w, box.h, () => {
      const c = scratch3(st.w, st.h);
      const g = ctx(c);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, st.w, st.h);
      g.fillStyle = opts.current.color;
      g.fillRect(0, 0, st.w, st.h);
      if (st.sel) {
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(st.sel.mask, 0, 0);
        g.globalCompositeOperation = 'source-over';
      }
      ctx(l.canvas).drawImage(c, 0, 0);
    });
    remember(opts.current.color);
  };

  /** Ctrl+J: what is selected, copied to a new layer above. */
  const selToLayer = () => {
    commitFloat();
    if (st.layers.length >= MAX_LAYERS) return toast(tg('maxLayers', { n: MAX_LAYERS }));
    const px = selectedPixels();
    const l = st.layers[st.active];
    if (!px || !l) return toast(tg('emptySel'));
    layersChange((ls) => {
      const c = makeCanvas(st.w, st.h);
      ctx(c).drawImage(px.canvas, px.box.x, px.box.y);
      const used = ls.map((x) => Number(/(\d+)$/.exec(x.name)?.[1] ?? 0));
      ls.splice(st.active + 1, 0, {
        id: nextId++,
        name: tg('layerName', { n: Math.max(0, ...used) + 1 }),
        visible: true,
        opacity: 1,
        blend: 'normal',
        canvas: c,
      });
      return { layers: ls, active: st.active + 1 };
    });
  };

  const copySel = (cut: boolean) => {
    commitFloat();
    const px = selectedPixels();
    if (!px) return toast(tg('emptySel'));
    st.clip = { canvas: px.canvas, x: px.box.x, y: px.box.y };
    if (cut) selClear();
  };

  const pasteClip = () => {
    const c = st.clip;
    const l = st.layers[st.active];
    if (!c || !l) return;
    commitFloat();
    if (!l.visible) setMeta({ visible: true });
    const before = ctx(l.canvas).getImageData(0, 0, st.w, st.h);
    const src = { x: 0, y: 0, w: c.canvas.width, h: c.canvas.height };
    st.float = {
      canvas: c.canvas,
      src,
      dst: { x: c.x, y: c.y, w: src.w, h: src.h },
      flipX: false,
      flipY: false,
      layer: l.id,
      before,
      carriesSel: false,
    };
    st.sel = null;
    setTool('move');
    toast(tg('pasted'));
    redraw();
    bump();
  };

  // ---------------------------------------------------------------- move / transform

  function drawFloat(g: CanvasRenderingContext2D, f: Float) {
    g.save();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.setTransform(...rectMap({ x: 0, y: 0, w: f.src.w, h: f.src.h }, f.dst, f.flipX, f.flipY));
    g.imageSmoothingQuality = 'high';
    g.drawImage(f.canvas, 0, 0);
    g.restore();
  }

  /** Lifts the selected pixels (or the whole layer) to move them. */
  const lift = (): boolean => {
    const l = st.layers[st.active];
    if (!l || !l.visible) return false;
    const px = selectedPixels();
    if (!px) {
      toast(tg('emptySel'));
      return false;
    }
    const g = ctx(l.canvas);
    const before = g.getImageData(0, 0, st.w, st.h);
    if (st.sel) {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(st.sel.mask, 0, 0);
      g.globalCompositeOperation = 'source-over';
    } else g.clearRect(0, 0, st.w, st.h);
    st.float = {
      canvas: px.canvas,
      src: px.box,
      dst: { ...px.box },
      flipX: false,
      flipY: false,
      layer: l.id,
      before,
      carriesSel: !!st.sel,
    };
    return true;
  };

  /** Puts the moved pixels down: one undo step; the selection follows them. */
  function commitFloat() {
    const f = st.float;
    if (!f) return;
    st.float = null;
    st.fdrag = null;
    const l = layerById(f.layer);
    if (!l) return;
    const g = ctx(l.canvas);
    drawFloat(g, f);
    if (f.carriesSel && st.sel) {
      const m = rectMap(f.src, f.dst, f.flipX, f.flipY);
      const mask = makeCanvas(st.w, st.h);
      const mg = ctx(mask);
      mg.setTransform(...m);
      mg.drawImage(st.sel.mask, 0, 0);
      mg.setTransform(1, 0, 0, 1, 0, 0);
      const map = (p: P): P => ({ x: m[0] * p.x + m[4], y: m[3] * p.y + m[5] });
      st.sel = { mask, outline: st.sel.outline.map((poly) => poly.map(map)), data: null };
    }
    // The undo step covers where the pixels were and where they are now.
    const pts = [
      { x: f.src.x, y: f.src.y },
      { x: f.src.x + f.src.w, y: f.src.y + f.src.h },
      { x: f.dst.x, y: f.dst.y },
      { x: f.dst.x + f.dst.w, y: f.dst.y + f.dst.h },
    ];
    const box = pixelBox(pts, st.w, st.h);
    if (box) {
      const before = new ImageData(box.w, box.h);
      for (let row = 0; row < box.h; row++) {
        const from = ((box.y + row) * st.w + box.x) * 4;
        before.data.set(f.before.data.subarray(from, from + box.w * 4), row * box.w * 4);
      }
      push({
        kind: 'pixels',
        layer: l.id,
        x: box.x,
        y: box.y,
        before,
        after: g.getImageData(box.x, box.y, box.w, box.h),
      });
    }
    redraw();
    bump();
  }

  function cancelFloat() {
    const f = st.float;
    if (!f) return;
    st.float = null;
    st.fdrag = null;
    const l = layerById(f.layer);
    if (l) ctx(l.canvas).putImageData(f.before, 0, 0);
    redraw();
    bump();
  }

  const flipFloat = (axis: 'x' | 'y') => {
    if (!st.float && !lift()) return;
    const f = st.float!;
    if (axis === 'x') f.flipX = !f.flipX;
    else f.flipY = !f.flipY;
    redraw();
    bump();
  };

  const nudgeFloat = (dx: number, dy: number) => {
    if (!st.float && !lift()) return;
    st.float!.dst.x += dx;
    st.float!.dst.y += dy;
    redraw();
    bump();
  };

  /** Changing tool puts lifted pixels down first. */
  const pickTool = (t: Tool) => {
    if (t !== 'move') commitFloat();
    setTool(t);
  };

  // ---------------------------------------------------------------- pointer

  const onDown = (e: React.PointerEvent) => {
    if (!ready) return;
    stage.current?.focus({ preventScroll: true });
    if (e.button === 1 || st.space) {
      st.pan = { sx: e.clientX, sy: e.clientY, px: st.panX, py: st.panY };
      (e.target as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const p = toCanvas(e);
    const t = e.altKey && PAINTING.has(opts.current.tool) ? 'picker' : opts.current.tool;
    if (t === 'picker') return pick(p.x, p.y, e.button === 2);
    if (t === 'bucket') return bucket(p.x, p.y);
    if (e.button !== 0) return;
    if (t === 'rect' || t === 'lasso') {
      commitFloat();
      (e.target as Element).setPointerCapture(e.pointerId);
      st.lasso = { kind: t, pts: [p], mode: e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new' };
      bump();
      return;
    }
    if (t === 'move') {
      const corner = (e.target as Element).getAttribute?.('data-fh') as Corner | null;
      const f = st.float;
      if (f) {
        const d = f.dst;
        const inside = p.x >= d.x && p.x <= d.x + d.w && p.y >= d.y && p.y <= d.y + d.h;
        if (!corner && !inside) {
          // Clicked away: the pixels go down where they are.
          commitFloat();
          return;
        }
      } else if (!lift()) return;
      (e.target as Element).setPointerCapture(e.pointerId);
      st.fdrag = {
        kind: corner ? 'scale' : 'move',
        corner: corner ?? 'se',
        start: p,
        r0: { ...st.float!.dst },
      };
      redraw();
      bump();
      return;
    }
    const l = st.layers[st.active];
    if (!l || !l.visible) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const sp: StrokePoint = { ...p, pressure: normPressure(e.pointerType, e.pressure) };
    const canvas = scratch2(st.w, st.h);
    ctx(canvas).clearRect(0, 0, st.w, st.h);
    st.stroke = {
      canvas,
      last: sp,
      carry: 0,
      box: { x0: p.x, y0: p.y, x1: p.x, y1: p.y },
      tool: t,
    };
    st.seed = (st.seed + 1) >>> 0;
    st.rand = mulberry32(st.seed);
    // Shift: a straight line from where the last stroke ended.
    if (e.shiftKey && st.lastPoint) {
      st.stroke.last = st.lastPoint;
      strokeTo(sp);
    } else strokeTo(sp);
  };

  const onMove = (e: React.PointerEvent) => {
    const c = cursor.current;
    const r = stage.current?.getBoundingClientRect();
    if (c && r) {
      const d = Math.max(4, opts.current.size * st.zoom);
      c.style.width = c.style.height = `${d}px`;
      c.style.left = `${e.clientX - r.left - d / 2}px`;
      c.style.top = `${e.clientY - r.top - d / 2}px`;
    }
    if (st.pan) {
      st.panX = st.pan.px + e.clientX - st.pan.sx;
      st.panY = st.pan.py + e.clientY - st.pan.sy;
      st.userView = true;
      layout();
      return;
    }
    if (st.lasso) {
      const p = toCanvas(e);
      const L = st.lasso;
      if (L.kind === 'rect') L.pts = [L.pts[0]!, p];
      else {
        const last = L.pts[L.pts.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * st.zoom >= 2) L.pts.push(p);
      }
      bump();
      return;
    }
    if (st.fdrag && st.float) {
      const p = toCanvas(e);
      const d = st.fdrag;
      if (d.kind === 'move') {
        st.float.dst = {
          ...d.r0,
          x: d.r0.x + Math.round(p.x - d.start.x),
          y: d.r0.y + Math.round(p.y - d.start.y),
        };
      } else st.float.dst = scaleRect(d.r0, d.corner, p.x, p.y, !e.shiftKey);
      redraw();
      bump();
      return;
    }
    if (!st.stroke) return;
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [
      e.nativeEvent as PointerEvent,
    ];
    for (const ev of evs.length ? evs : [e.nativeEvent as PointerEvent])
      strokeTo({ ...toCanvas(ev), pressure: normPressure(ev.pointerType, ev.pressure) });
  };

  const onUp = () => {
    st.pan = null;
    st.fdrag = null;
    const L = st.lasso;
    if (L) {
      st.lasso = null;
      const a = L.pts[0]!;
      const b = L.pts[L.pts.length - 1]!;
      const poly =
        L.kind === 'rect'
          ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map((q) => ({
              x: Math.round(Math.min(st.w, Math.max(0, q.x))),
              y: Math.round(Math.min(st.h, Math.max(0, q.y))),
            }))
          : L.pts;
      const tiny =
        L.kind === 'rect' ? Math.abs(b.x - a.x) < 1 || Math.abs(b.y - a.y) < 1 : L.pts.length < 3;
      if (tiny) {
        if (L.mode === 'new') st.sel = null;
        bump();
        return;
      }
      applySel(poly, L.mode);
      return;
    }
    const s = st.stroke;
    if (!s) return;
    st.stroke = null;
    st.lastPoint = s.last;
    const l = st.layers[st.active];
    if (!l) return;
    const { x0, y0, x1, y1 } = s.box;
    pixelsChange(l, x0, y0, x1 - x0, y1 - y0, () => {
      const g = ctx(l.canvas);
      g.globalAlpha = opts.current.flow / 100;
      g.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      g.drawImage(clipped(s.canvas), 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    });
    if (s.tool === 'brush') remember(opts.current.color);
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      else {
        st.panX -= e.shiftKey ? e.deltaY : e.deltaX;
        st.panY -= e.shiftKey ? 0 : e.deltaY;
        st.userView = true;
        layout();
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') st.space = false;
      if (e.key === 'Alt') st.alt = false;
      bump();
    };
    window.addEventListener('keyup', up);
    const ro = new ResizeObserver(() => (st.userView ? bump() : fit()));
    ro.observe(el);
    return () => {
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('keyup', up);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- save / export

  const saveDraw = useCallback(async () => {
    if (!st.w) return;
    commitFloat();
    try {
      const layers = [];
      for (const l of st.layers)
        layers.push({
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          blend: l.blend,
          png: b64(await pngOf(l.canvas)),
        });
      let file = st.file;
      if (!file) {
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        const base = path.slice(dir.length).replace(/\.[^.]+$/, '');
        const files = new Set(
          await api()
            .workspace.listFiles()
            .catch(() => [] as string[]),
        );
        file = dir + uniqueName(base, 'zdraw', (n) => files.has(dir + n));
      }
      await api().workspace.writeFile(
        file,
        serializePaintFile({ width: st.w, height: st.h, layers }),
      );
      st.file = file;
      markDirty(false);
      toast(tg('savedDraw', { name: file }));
    } catch (e) {
      toast(tg('saveFailed', { err: String((e as Error).message ?? e) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => registerViewerSaver(path, saveDraw), [path, saveDraw]);

  // The agent (or another window) rewrote the drawing: read it again when nothing is pending.
  useEffect(
    () =>
      onDiskChange((p) => {
        if (!source && p === path && !st.dirty) void load();
      }),
    [path, source, load, st],
  );

  const exportPng = async () => {
    commitFloat();
    try {
      const bytes = await pngOf(composite());
      const ref = st.file ?? path;
      const dir = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/') + 1) : '';
      const base = `${ref.slice(dir.length).replace(/\.[^.]+$/, '')}-dibujo`;
      const files = new Set(
        await api()
          .workspace.listFiles()
          .catch(() => [] as string[]),
      );
      const out = dir + uniqueName(base, 'png', (n) => files.has(dir + n));
      await api().workspace.writeBytes(out, bytes);
      toast(tg('exported', { name: out }));
    } catch (e) {
      toast(tg('exportFailed', { err: String((e as Error).message ?? e) }));
    }
  };

  // ---------------------------------------------------------------- layers

  const active = st.layers[st.active];
  const addLayer = () => {
    if (st.layers.length >= MAX_LAYERS) return toast(tg('maxLayers', { n: MAX_LAYERS }));
    layersChange((ls) => {
      // Next free number: "Capa 2" after "Capa 1", whatever was deleted before.
      const used = ls.map((x) => Number(/(\d+)$/.exec(x.name)?.[1] ?? 0));
      const n = Math.max(0, ...used) + 1;
      const l: Layer = {
        id: nextId++,
        name: tg('layerName', { n }),
        visible: true,
        opacity: 1,
        blend: 'normal',
        canvas: makeCanvas(st.w, st.h),
      };
      ls.splice(st.active + 1, 0, l);
      return { layers: ls, active: st.active + 1 };
    });
  };
  const dupLayer = () => {
    if (!active) return;
    if (st.layers.length >= MAX_LAYERS) return toast(tg('maxLayers', { n: MAX_LAYERS }));
    layersChange((ls) => {
      const c = makeCanvas(st.w, st.h);
      ctx(c).drawImage(active.canvas, 0, 0);
      ls.splice(st.active + 1, 0, { ...active, id: nextId++, name: `${active.name} 2`, canvas: c });
      return { layers: ls, active: st.active + 1 };
    });
  };
  const delLayer = () => {
    if (st.layers.length <= 1) return toast(tg('lastLayer'));
    layersChange((ls) => {
      ls.splice(st.active, 1);
      return { layers: ls, active: Math.max(0, st.active - 1) };
    });
  };
  const moveLayer = (d: 1 | -1) => {
    const to = st.active + d;
    if (to < 0 || to >= st.layers.length) return;
    layersChange((ls) => {
      const [l] = ls.splice(st.active, 1);
      ls.splice(to, 0, l!);
      return { layers: ls, active: to };
    });
  };
  const setMeta = (
    patch: Partial<Pick<Layer, 'name' | 'visible' | 'opacity' | 'blend'>>,
    i = st.active,
  ) => {
    layersChange((ls) => {
      ls[i] = { ...ls[i]!, ...patch };
      return { layers: ls, active: st.active };
    });
  };
  const mergeDown = () => {
    if (st.active < 1 || !active) return;
    const below = st.layers[st.active - 1]!;
    // The lower layer's pixels and the list change: two steps undone together would be
    // nicer, but a copy of the lower layer keeps it simple and exact.
    const merged = makeCanvas(st.w, st.h);
    const g = ctx(merged);
    g.drawImage(below.canvas, 0, 0);
    g.globalAlpha = active.opacity;
    g.globalCompositeOperation = compositeOf(active.blend) as GlobalCompositeOperation;
    if (active.visible) g.drawImage(active.canvas, 0, 0);
    layersChange((ls) => {
      const i = st.active;
      ls.splice(i - 1, 2, { ...below, id: nextId++, canvas: merged });
      return { layers: ls, active: i - 1 };
    });
  };
  const clearLayer = () => {
    if (!active) return;
    pixelsChange(active, 0, 0, st.w, st.h, () => ctx(active.canvas).clearRect(0, 0, st.w, st.h));
  };

  // ---------------------------------------------------------------- keys

  const onKey = (e: RKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (isTypingTarget(e.target, mod)) return;
    const k = e.key.toLowerCase();
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (mod && k === 's') return (stop(), void saveDraw());
    if (mod && k === 'a') return (stop(), selectAll());
    if (mod && k === 'd') return (stop(), deselect());
    if (mod && e.shiftKey && k === 'i') return (stop(), invertSel());
    if (mod && k === 'j') return (stop(), selToLayer());
    if (mod && k === 'c') return (stop(), copySel(false));
    if (mod && k === 'x') return (stop(), copySel(true));
    if (mod && k === 'v') return (stop(), pasteClip());
    if (mod && k === 'z') return (stop(), e.shiftKey ? redo() : undo());
    if (mod && k === 'y') return (stop(), redo());
    if (mod && k === '0') return (stop(), fit());
    if (mod && (k === '=' || k === '+')) return (stop(), zoomAt(1.25));
    if (mod && k === '-') return (stop(), zoomAt(0.8));
    if (mod) return;
    if (e.code === 'Space') {
      stop();
      st.space = true;
      bump();
      return;
    }
    if (k === 'enter' && st.float) return (stop(), commitFloat());
    if (k === 'escape') {
      stop();
      if (st.float) return cancelFloat();
      return deselect();
    }
    if (k === 'delete' || k === 'backspace') {
      stop();
      if (st.float) {
        // Lifted pixels deleted: they stay off the layer.
        st.float.canvas = makeCanvas(1, 1);
        st.float.src = { x: 0, y: 0, w: 1, h: 1 };
        return commitFloat();
      }
      return selClear();
    }
    const arrows: Record<string, [number, number]> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    };
    if (arrows[k] && opts.current.tool === 'move') {
      stop();
      const n = e.shiftKey ? 10 : 1;
      return nudgeFloat(arrows[k]![0] * n, arrows[k]![1] * n);
    }
    const tools: Record<string, Tool> = {
      b: 'brush',
      e: 'eraser',
      g: 'bucket',
      i: 'picker',
      m: 'rect',
      l: 'lasso',
      v: 'move',
    };
    if (tools[k]) return (stop(), pickTool(tools[k]!));
    if (k === 'x') {
      stop();
      setColor(color2);
      setColor2(color);
      return;
    }
    if (e.key === '[') return (stop(), setSize((s) => Math.max(1, Math.round(s / 1.2))));
    if (e.key === ']') return (stop(), setSize((s) => Math.min(500, Math.round(s * 1.2 + 1))));
  };

  const close = async () => {
    if (st.dirty && !(await confirmDialog(tg('unsaved'), { danger: true }))) return;
    onClose?.();
  };

  const showTool: Tool = st.alt && PAINTING.has(tool) ? 'picker' : tool;
  if (error) return <div className="notice-pane">{error}</div>;
  return (
    <div className="pv" onKeyDown={onKey}>
      <div className="pv-bar">
        {(
          [
            ['brush', '🖌', 'brush'],
            ['eraser', '⌫', 'eraser'],
            ['bucket', '🪣', 'bucket'],
            ['picker', '💧', 'picker'],
            ['rect', '⬚', 'selRect'],
            ['lasso', '➰', 'selLasso'],
            ['move', '✥', 'moveTool'],
          ] as [Tool, string, KeyG][]
        ).map(([id, icon, tip]) => (
          <button
            key={id}
            className={showTool === id ? 'on' : ''}
            title={tg(tip)}
            onClick={() => pickTool(id)}
          >
            {icon}
          </button>
        ))}
        <span className="pv-sep" />
        <button disabled={!st.undo.length} title="Ctrl+Z" onClick={undo}>
          ↶
        </button>
        <button disabled={!st.redo.length} title="Ctrl+Y" onClick={redo}>
          ↷
        </button>
        <span className="pv-sep" />
        <button onClick={() => zoomAt(0.8)}>−</button>
        <button onClick={() => zoomAt(1 / st.zoom)}>{Math.round(st.zoom * 100)}%</button>
        <button onClick={() => zoomAt(1.25)}>+</button>
        <button onClick={fit}>{tg('zoomFit')}</button>
        <span className="pv-dim">
          {tg('canvasSize')}: {st.w} × {st.h}
        </span>
        <div className="spacer" />
        <button onClick={() => void exportPng()}>{tg('exportPng')}</button>
        <button className="on" onClick={() => void saveDraw()}>
          {tg('save').replace(/ \(.*\)/, '')}
          {st.dirty ? ' •' : ''}
        </button>
        {onClose && <button onClick={() => void close()}>{tg('close')}</button>}
      </div>
      <div className="pv-body">
        <div
          ref={stage}
          className={`pv-stage tool-${st.space ? 'hand' : showTool}`}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Alt') {
              e.preventDefault();
              st.alt = true;
              bump();
            }
          }}
        >
          <canvas ref={view} className="pv-canvas" />
          {ready && <PaintOverlay st={st} />}
          {(showTool === 'brush' || showTool === 'eraser') && !st.space && (
            <div ref={cursor} className="pv-cursor" />
          )}
          {!ready && <div className="pv-loading">{tg('loading')}</div>}
        </div>
        <div className="pv-side">
          <section>
            <h4>{tg('color')}</h4>
            <div className="pv-row">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              <button title={tg('swap')} onClick={() => (setColor(color2), setColor2(color))}>
                ⇄
              </button>
              <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} />
            </div>
            <div className="pv-swatches">
              {[...recent, ...SWATCHES.filter((c) => !recent.includes(c))].slice(0, 24).map((c) => (
                <button
                  key={c}
                  className={c === color ? 'on' : ''}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </section>
          {(tool === 'brush' || tool === 'eraser') && (
            <section>
              <h4>{tg(tool)}</h4>
              {tool === 'brush' && (
                <div className="pv-brushes" role="radiogroup" aria-label={tg('brushKind')}>
                  {BRUSH_KINDS.map((b) => (
                    <button
                      key={b}
                      className={brushKind === b ? 'on' : ''}
                      onClick={() => setBrushKind(b)}
                    >
                      {tg(`brush_${b}` as KeyG)}
                    </button>
                  ))}
                </div>
              )}
              <PvSlider
                label={tg('size')}
                min={1}
                max={500}
                value={size}
                onChange={setSize}
                suffix=" px"
              />
              <PvSlider
                label={tg('flow')}
                min={1}
                max={100}
                value={flow}
                onChange={setFlow}
                suffix="%"
              />
              <PvSlider
                label={tg('hardness')}
                min={0}
                max={100}
                value={hardness}
                onChange={setHardness}
                suffix="%"
              />
              <div className="pv-label">{tg('pressure')}</div>
              <label className="pv-check">
                <input
                  type="checkbox"
                  checked={pSize}
                  onChange={(e) => setPSize(e.target.checked)}
                />{' '}
                {tg('pressureSize')}
              </label>
              <label className="pv-check">
                <input
                  type="checkbox"
                  checked={pFlow}
                  onChange={(e) => setPFlow(e.target.checked)}
                />{' '}
                {tg('pressureFlow')}
              </label>
              <div className="pv-label">{tg('symmetry')}</div>
              <div className="pv-row pv-wrap">
                {(['none', 'x', 'y', 'xy'] as Symmetry[]).map((m) => (
                  <button key={m} className={sym === m ? 'on' : ''} onClick={() => setSym(m)}>
                    {tg(`sym_${m}` as KeyG)}
                  </button>
                ))}
              </div>
            </section>
          )}
          {(tool === 'rect' || tool === 'lasso' || st.sel) && (
            <section>
              <h4>{tg('selection')}</h4>
              <p className="pv-hint">{st.sel ? tg('selHint') : tg('noSelection')}</p>
              <div className="pv-row pv-wrap">
                <button onClick={selectAll}>{tg('selAll')}</button>
                <button disabled={!st.sel} onClick={deselect}>
                  {tg('deselect')}
                </button>
                <button onClick={invertSel}>{tg('invertSel')}</button>
              </div>
              <div className="pv-row pv-wrap">
                <button onClick={selToLayer}>{tg('selToLayer')}</button>
                <button onClick={selFill}>{tg('selFill')}</button>
                <button className="danger" onClick={selClear}>
                  {tg('selClear')}
                </button>
              </div>
            </section>
          )}
          {tool === 'move' && (
            <section>
              <h4>{tg('transform')}</h4>
              <p className="pv-hint">{tg('transformHint')}</p>
              {st.float && (
                <p className="pv-hint">
                  {Math.round(st.float.dst.w)} × {Math.round(st.float.dst.h)} px
                </p>
              )}
              <div className="pv-row pv-wrap">
                <button title={tg('flipH')} onClick={() => flipFloat('x')}>
                  ⇋
                </button>
                <button title={tg('flipV')} onClick={() => flipFloat('y')}>
                  ⇵
                </button>
                <button className="on" disabled={!st.float} onClick={commitFloat}>
                  {tg('apply')}
                </button>
                <button disabled={!st.float} onClick={cancelFloat}>
                  {tg('cancel')}
                </button>
              </div>
            </section>
          )}
          {tool === 'bucket' && (
            <section>
              <h4>{tg('bucket')}</h4>
              <PvSlider
                label={tg('tolerance')}
                min={0}
                max={100}
                value={tolerance}
                onChange={setTolerance}
                suffix="%"
              />
              <label className="pv-check">
                <input
                  type="checkbox"
                  checked={sampleAll}
                  onChange={(e) => setSampleAll(e.target.checked)}
                />{' '}
                {tg('sampleAll')}
              </label>
            </section>
          )}
          <section>
            <h4>{tg('layers')}</h4>
            {active && (
              <>
                <PvSlider
                  label={tg('opacity')}
                  min={0}
                  max={100}
                  value={Math.round(active.opacity * 100)}
                  suffix="%"
                  onChange={(v) => {
                    // Live while dragging, one undo step at the end.
                    if (opacityFrom.current === null) opacityFrom.current = active.opacity;
                    active.opacity = v / 100;
                    redraw();
                    bump();
                  }}
                  onCommit={(v) => {
                    if (opacityFrom.current === null) return;
                    active.opacity = opacityFrom.current;
                    opacityFrom.current = null;
                    if (Math.abs(active.opacity - v / 100) > 1e-6) setMeta({ opacity: v / 100 });
                  }}
                />
                <label className="pv-field">
                  <span>{tg('blend')}</span>
                  <select
                    value={active.blend}
                    onChange={(e) => setMeta({ blend: e.target.value as BlendMode })}
                  >
                    {BLEND_MODES.map((b) => (
                      <option key={b} value={b}>
                        {tg(`blend_${b}` as KeyG)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="pv-layers">
              {st.layers
                .map((l, i) => ({ l, i }))
                .reverse()
                .map(({ l, i }) => (
                  <div
                    key={l.id}
                    className={`pv-layer ${i === st.active ? 'on' : ''}`}
                    onClick={() => {
                      st.active = i;
                      bump();
                    }}
                    onDoubleClick={() => setRenaming(l.id)}
                  >
                    <button
                      className="pv-eye"
                      title={tg('hide')}
                      onClick={(e) => (e.stopPropagation(), setMeta({ visible: !l.visible }, i))}
                    >
                      {l.visible ? '👁' : '◌'}
                    </button>
                    <Thumb canvas={l.canvas} tick={st.undo.length + st.redo.length} />
                    {renaming === l.id ? (
                      <input
                        autoFocus
                        defaultValue={l.name}
                        onBlur={(e) => {
                          setRenaming(null);
                          if (e.target.value.trim() && e.target.value !== l.name)
                            setMeta({ name: e.target.value.trim().slice(0, 60) }, i);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      <span className="pv-layer-name">{l.name}</span>
                    )}
                    {l.blend !== 'normal' && (
                      <span className="pv-tag">{tg(`blend_${l.blend}` as KeyG)}</span>
                    )}
                    {l.opacity < 1 && (
                      <span className="pv-tag">{Math.round(l.opacity * 100)}%</span>
                    )}
                  </div>
                ))}
            </div>
            <div className="pv-row pv-wrap">
              <button title={tg('addLayer')} onClick={addLayer}>
                ＋
              </button>
              <button title={tg('dupLayer')} onClick={dupLayer}>
                ⧉
              </button>
              <button title={tg('mergeDown')} disabled={st.active < 1} onClick={mergeDown}>
                ⤓
              </button>
              <button
                title={tg('forward')}
                disabled={st.active >= st.layers.length - 1}
                onClick={() => moveLayer(1)}
              >
                ↑
              </button>
              <button title={tg('backward')} disabled={st.active < 1} onClick={() => moveLayer(-1)}>
                ↓
              </button>
              <button title={tg('clearLayer')} onClick={clearLayer}>
                ⌧
              </button>
              <button
                title={tg('delLayer')}
                className="danger"
                disabled={st.layers.length <= 1}
                onClick={delLayer}
              >
                🗑
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Reused full-size canvases (a new one per frame would churn memory on big drawings). */
let scratchA: HTMLCanvasElement | null = null;
let scratchB: HTMLCanvasElement | null = null;
function scratch(w: number, h: number): HTMLCanvasElement {
  if (!scratchA || scratchA.width !== w || scratchA.height !== h) scratchA = makeCanvas(w, h);
  return scratchA;
}
function scratch2(w: number, h: number): HTMLCanvasElement {
  if (!scratchB || scratchB.width !== w || scratchB.height !== h) scratchB = makeCanvas(w, h);
  return scratchB;
}
let scratchC: HTMLCanvasElement | null = null;
function scratch3(w: number, h: number): HTMLCanvasElement {
  if (!scratchC || scratchC.width !== w || scratchC.height !== h) scratchC = makeCanvas(w, h);
  return scratchC;
}

/** Marching ants of the selection, the lasso being drawn and the transform box. */
function PaintOverlay({
  st,
}: {
  st: {
    zoom: number;
    panX: number;
    panY: number;
    sel: Selection | null;
    lasso: { kind: 'rect' | 'lasso'; pts: P[] } | null;
    float: Float | null;
  };
}) {
  const sp = (p: P) => `${st.panX + p.x * st.zoom},${st.panY + p.y * st.zoom}`;
  const out: ReactNode[] = [];
  const ants = (pts: P[], key: string, closed: boolean) => {
    const d = pts.map(sp).join(' ');
    const Tag = closed ? 'polygon' : 'polyline';
    out.push(<Tag key={`${key}a`} className="pv-ants-bg" points={d} />);
    out.push(<Tag key={`${key}b`} className="pv-ants" points={d} />);
  };
  if (st.sel && !st.float?.carriesSel)
    st.sel.outline.forEach((poly, i) => ants(poly, `s${i}`, true));
  if (st.lasso) {
    const L = st.lasso;
    if (L.kind === 'rect' && L.pts.length > 1) {
      const a = L.pts[0]!;
      const b = L.pts[L.pts.length - 1]!;
      ants([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], 'l', true);
    } else ants(L.pts, 'l', false);
  }
  const f = st.float;
  if (f) {
    const d = f.dst;
    const c: [Corner, P][] = [
      ['nw', { x: d.x, y: d.y }],
      ['ne', { x: d.x + d.w, y: d.y }],
      ['se', { x: d.x + d.w, y: d.y + d.h }],
      ['sw', { x: d.x, y: d.y + d.h }],
    ];
    out.push(<polygon key="fbox" className="pv-fbox" points={c.map(([, p]) => sp(p)).join(' ')} />);
    for (const [k, p] of c) {
      const x = st.panX + p.x * st.zoom;
      const y = st.panY + p.y * st.zoom;
      out.push(
        <rect
          key={`fh${k}`}
          className={`pv-fh pv-fh-${k}`}
          data-fh={k}
          x={x - 5}
          y={y - 5}
          width={10}
          height={10}
        />,
      );
    }
  }
  return <svg className="pv-overlay">{out}</svg>;
}

function Thumb({ canvas, tick }: { canvas: HTMLCanvasElement; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = Math.min(36 / canvas.width, 28 / canvas.height);
    c.width = Math.max(1, Math.round(canvas.width * k));
    c.height = Math.max(1, Math.round(canvas.height * k));
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(canvas, 0, 0, c.width, c.height);
  }, [canvas, tick]);
  return <canvas ref={ref} className="pv-thumb" />;
}

function PvSlider({
  label,
  min,
  max,
  value,
  suffix = '',
  onChange,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  suffix?: string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  return (
    <label className="pv-slider">
      <span>{label}</span>
      <span className="pv-val">
        {value}
        {suffix}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
    </label>
  );
}

/** A new drawing file: a white background layer and an empty one. */
export async function newPaintFile(
  w: number,
  h: number,
  names: { base: string; layer: string },
): Promise<string> {
  const bg = makeCanvas(w, h);
  const g = ctx(bg);
  g.fillStyle = 'white';
  g.fillRect(0, 0, w, h);
  const empty = makeCanvas(w, h);
  return serializePaintFile({
    width: w,
    height: h,
    layers: [
      { name: names.base, visible: true, opacity: 1, blend: 'normal', png: b64(await pngOf(bg)) },
      {
        name: names.layer,
        visible: true,
        opacity: 1,
        blend: 'normal',
        png: b64(await pngOf(empty)),
      },
    ],
  });
}
