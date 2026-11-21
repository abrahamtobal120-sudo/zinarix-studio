import type { monaco } from '../../monaco';
import {
  IDENTITY,
  alignDeltas,
  apply,
  boundsOf,
  boxLines,
  boxToBox,
  boxesTouch,
  distributeDeltas,
  invert,
  matString,
  mul,
  penPath,
  pointsBox,
  resizeBox,
  rotate,
  scale,
  shapePath,
  snapMove,
  translate,
  unionBox,
  wrapText,
  type AlignMode,
  type Box,
  type Guide,
  type Handle,
  type Mat,
  type PenPoint,
  type Pt,
  type ShapeKind,
} from '../../../shared/graphics';
import {
  deleteNodes,
  ellipsePathData,
  insertNode,
  moveHandle,
  moveNode,
  nearestOnPath,
  parsePathData,
  pointsPathData,
  rectPathData,
  serializePathData,
  setNodeType,
  type PNode,
  type SubPath,
} from '../../../shared/pathEdit';
import { tg, type KeyG } from '../graphics/graphicsStrings';

/**
 * Fase 3B (plan de funciones): the live document of the design editor. The SVG of the file
 * is parsed into a shadow root (its <style> and ids stay inside), edited as DOM — every
 * change of position, size or rotation goes to the element's transform (simple shapes get
 * it baked into x / y / width…) — and serialized back into the file's text model, so the
 * code view, Save, dirty marks and changes from the agent all work as for any text file.
 */

export const SVGNS = 'http://www.w3.org/2000/svg';
const NOT_GRAPHIC = new Set([
  'defs', 'style', 'title', 'desc', 'metadata', 'script', 'linearGradient', 'radialGradient',
  'pattern', 'clipPath', 'mask', 'filter', 'symbol', 'marker', 'foreignObject',
]);
const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'text', 'image', 'use']);

export type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text' | 'hand';

export const isGraphic = (n: Node | null): n is SVGGraphicsElement =>
  !!n && n instanceof SVGGraphicsElement && !NOT_GRAPHIC.has(n.localName);

export const kidsOf = (c: Element): SVGGraphicsElement[] => [...c.children].filter(isGraphic);

const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const dom = (m: DOMMatrix | DOMMatrixReadOnly | SVGMatrix): Mat => [m.a, m.b, m.c, m.d, m.e, m.f];

/** The element's own transform attribute as one matrix (without changing the attribute). */
export function matOf(el: SVGGraphicsElement): Mat {
  const list = el.transform?.baseVal;
  let m = IDENTITY;
  if (list) for (let i = 0; i < list.numberOfItems; i++) m = mul(m, dom(list.getItem(i).matrix));
  return m;
}

function setMat(el: Element, m: Mat): void {
  const s = matString(m);
  if (s) el.setAttribute('transform', s);
  else el.removeAttribute('transform');
}

export function isHidden(el: Element): boolean {
  return el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden';
}
export const isLocked = (el: Element): boolean => el.getAttribute('data-locked') === 'true';

/** Name in the layers list: data-name, id, the start of a text, or the kind. */
export function layerName(el: Element): string {
  const n = el.getAttribute('data-name') || el.getAttribute('inkscape:label') || el.getAttribute('id');
  if (n) return n;
  if (el.localName === 'text') {
    const t = (el.textContent ?? '').trim();
    if (t) return t.length > 24 ? `${t.slice(0, 24)}…` : t;
  }
  const k = `kind_${el.localName}` as KeyG;
  try {
    return tg(k);
  } catch {
    return el.localName;
  }
}

/** Removes scripts, event handlers and javascript: links. Returns how many were removed. */
export function sanitizeSvg(root: Element): number {
  let n = 0;
  for (const bad of [...root.querySelectorAll('script, iframe, object, embed')]) {
    bad.remove();
    n++;
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(a.name);
        n++;
      } else if ((name === 'href' || name.endsWith(':href')) && /^\s*javascript:/i.test(a.value)) {
        el.removeAttribute(a.name);
        n++;
      }
    }
  }
  return n;
}

export interface Page {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextEdit {
  el: SVGTextElement;
  value: string;
  isNew: boolean;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'move'; start: Pt; items: Item[]; box: Box; xs: number[]; ys: number[]; dup: boolean; moved: boolean }
  | { kind: 'resize'; handle: Handle; items: Item[]; box: Box; single: { local: Box; full: Mat } | null; ratio: boolean }
  | { kind: 'rotate'; c: Pt; a0: number; items: Item[] }
  | { kind: 'marquee'; start: Pt; now: Pt; add: boolean }
  | { kind: 'create'; el: SVGGraphicsElement; start: Pt; tool: 'rect' | 'ellipse' | 'line' }
  | { kind: 'pen'; point: PenPoint }
  | { kind: 'node'; start: Pt; orig: Map<string, PNode>; moved: boolean }
  | { kind: 'nhandle'; key: string; which: 'in' | 'out' }
  | { kind: 'nmarquee'; start: Pt; add: boolean }
  | { kind: 'wrap'; handle: 'e' | 'w'; left: number; right: number; anchor: string };

/** Points of a path being edited (node mode). Keys are "subpath:index". */
export interface NodeEdit {
  el: SVGPathElement;
  subs: SubPath[];
  sel: Set<string>;
}

/** Shapes that become a path to edit their points. */
export const NODE_EDITABLE = new Set(['path', 'rect', 'ellipse', 'circle', 'line', 'polygon', 'polyline']);

interface Item {
  el: SVGGraphicsElement;
  m0: Mat;
  /** Parent space → document space. */
  p: Mat;
}

const MAX_HISTORY = 120;

export class VectorSession {
  root: SVGSVGElement | null = null;
  container: SVGGraphicsElement | SVGSVGElement | null = null;
  sel: SVGGraphicsElement[] = [];
  hover: SVGGraphicsElement | null = null;
  tool: Tool = 'select';
  spaceHand = false;
  zoom = 1;
  panX = 0;
  panY = 0;
  page: Page = { x: 0, y: 0, w: 100, h: 100 };
  error: string | null = null;
  removed = 0;
  guides: Guide[] = [];
  marquee: Box | null = null;
  pen: { pts: PenPoint[]; el: SVGPathElement; cursor: Pt | null } | null = null;
  textEdit: TextEdit | null = null;
  nodes: NodeEdit | null = null;
  fill = '#4f8fd6';
  /** The user zoomed or panned: a resize of the window no longer re-fits the page. */
  userView = false;
  stroke = '#1f2933';
  private drag: Drag | null = null;
  private shadow: ShadowRoot;
  private prolog = '';
  private last = '';
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private own = false;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  private sub: monaco.IDisposable | null = null;
  private clip: string[] = [];
  private pasteN = 0;
  private cleanup: (() => void)[] = [];

  constructor(
    readonly path: string,
    readonly model: monaco.editor.ITextModel,
    readonly stage: HTMLDivElement,
    readonly host: HTMLDivElement,
    private readonly changed: () => void,
  ) {
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.sub = model.onDidChangeContent(() => {
      if (this.own) return;
      const text = model.getValue();
      if (text === this.last) return;
      // Changed in the code view or on disk (the agent): take it as a new step.
      this.flush();
      if (this.last) this.undoStack.push(this.last);
      this.redoStack = [];
      this.load(text, true);
    });
    const on = <K extends keyof HTMLElementEventMap>(
      t: EventTarget,
      k: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      o?: AddEventListenerOptions,
    ) => {
      t.addEventListener(k, fn as EventListener, o);
      this.cleanup.push(() => t.removeEventListener(k, fn as EventListener, o));
    };
    on(stage, 'pointerdown', (e) => this.down(e));
    on(stage, 'pointermove', (e) => this.move(e));
    on(stage, 'pointerup', (e) => this.up(e));
    on(stage, 'pointercancel', (e) => this.up(e));
    on(stage, 'dblclick', (e) => this.dbl(e));
    on(stage, 'wheel', (e) => this.wheel(e), { passive: false });
    // Links inside the design never navigate the app.
    on(host, 'click', (e) => e.preventDefault(), { capture: true });
  }

  dispose(): void {
    this.flush();
    this.sub?.dispose();
    for (const f of this.cleanup) f();
    cancelAnimationFrame(this.raf);
  }

  /** Re-renders the panels and the overlay (once per frame). */
  bump(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.changed();
    });
  }

  // ---------------------------------------------------------------- load / save

  load(text = this.model.getValue(), keepView = false): void {
    const d = new DOMParser().parseFromString(text, 'image/svg+xml');
    const pe = d.querySelector('parsererror');
    if (pe || d.documentElement.localName !== 'svg') {
      this.error = pe ? (pe.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) : 'No <svg> element.';
      this.root?.remove();
      this.root = null;
      this.sel = [];
      this.bump();
      return;
    }
    this.error = null;
    const at = text.search(/<svg[\s>]/i);
    this.prolog = at > 0 ? text.slice(0, at) : '';
    const src = d.documentElement as unknown as SVGSVGElement;
    this.removed = sanitizeSvg(src);
    const root = document.importNode(src, true);
    // Without a viewBox, zoom would not scale the drawing.
    const size = (k: 'width' | 'height', d0: number): number => {
      const v = parseFloat(root.getAttribute(k) ?? '');
      return Number.isFinite(v) && v > 0 && !/%/.test(root.getAttribute(k) ?? '') ? v : d0;
    };
    if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${size('width', 300)} ${size('height', 150)}`);
    const vb = root.viewBox.baseVal;
    this.page = { x: vb.x, y: vb.y, w: vb.width || 300, h: vb.height || 150 };
    if (!this.shadow.querySelector('style[data-vd]')) {
      const st = document.createElement('style');
      st.setAttribute('data-vd', '');
      st.textContent = ':host{display:block}:host>svg{display:block;width:100%;height:100%;overflow:visible;user-select:none}';
      this.shadow.append(st);
    }
    this.root?.remove();
    this.shadow.append(root);
    this.root = root;
    this.container = root;
    this.sel = [];
    this.textEdit = null;
    this.pen = null;
    this.nodes = null;
    this.last = text;
    this.layout();
    if (!keepView) this.fit();
    this.bump();
  }

  serialize(): string {
    if (!this.root) return this.model.getValue();
    const body = new XMLSerializer().serializeToString(this.root);
    return `${this.prolog}${body}\n`;
  }

  /** Writes the document into the text model (one undo step of ours). */
  commit(): void {
    clearTimeout(this.pending);
    this.pending = undefined;
    if (!this.root) return;
    const text = this.serialize();
    if (text === this.last) return;
    this.undoStack.push(this.last);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.write(text);
    this.bump();
  }

  /** A property change: applied now, written a moment later (sliders, color pickers). */
  soon(): void {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => this.commit(), 350);
    this.bump();
  }

  flush(): void {
    if (this.pending) this.commit();
  }

  private write(text: string): void {
    this.last = text;
    this.own = true;
    try {
      this.model.pushEditOperations([], [{ range: this.model.getFullModelRange(), text }], () => null);
    } finally {
      this.own = false;
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 || !!this.pending;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    this.flush();
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.last);
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.last);
    this.restore(next);
  }

  private restore(text: string): void {
    const path = this.sel.map((el) => this.indexPath(el));
    const inside = this.container && this.container !== this.root ? this.indexPath(this.container) : null;
    const nodePath = this.nodes ? this.indexPath(this.nodes.el) : null;
    this.load(text, true);
    this.write(text);
    if (nodePath) {
      const el = this.byIndexPath(nodePath);
      if (el?.localName === 'path') this.startNodes(el as SVGPathElement);
    }
    if (inside) {
      const c = this.byIndexPath(inside);
      if (c) this.container = c;
    }
    this.sel = path.map((p) => this.byIndexPath(p)).filter((x): x is SVGGraphicsElement => !!x);
    this.bump();
  }

  private indexPath(el: Element): number[] {
    const out: number[] = [];
    let n: Element | null = el;
    while (n && n !== this.root && n.parentElement) {
      out.unshift([...n.parentElement.children].indexOf(n));
      n = n.parentElement;
    }
    return out;
  }

  private byIndexPath(p: number[]): SVGGraphicsElement | null {
    let n: Element | null = this.root;
    for (const i of p) n = n?.children[i] ?? null;
    return isGraphic(n) ? n : null;
  }

  // ---------------------------------------------------------------- coordinates

  layout(): void {
    this.host.style.left = `${this.panX}px`;
    this.host.style.top = `${this.panY}px`;
    this.host.style.width = `${this.page.w * this.zoom}px`;
    this.host.style.height = `${this.page.h * this.zoom}px`;
  }

  fit(): void {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = 48;
    this.zoom = Math.max(0.02, Math.min(4, (r.width - pad * 2) / this.page.w, (r.height - pad * 2) / this.page.h));
    this.panX = (r.width - this.page.w * this.zoom) / 2;
    this.panY = (r.height - this.page.h * this.zoom) / 2;
    this.userView = false;
    this.layout();
    this.bump();
  }

  /** Zoom by a factor around a point of the stage (px from its corner). */
  zoomAt(f: number, sx?: number, sy?: number): void {
    const r = this.stage.getBoundingClientRect();
    const x = sx ?? r.width / 2;
    const y = sy ?? r.height / 2;
    const z = Math.max(0.02, Math.min(64, this.zoom * f));
    const k = z / this.zoom;
    this.panX = x - (x - this.panX) * k;
    this.panY = y - (y - this.panY) * k;
    this.zoom = z;
    this.userView = true;
    this.layout();
    this.bump();
  }

  setZoom(z: number): void {
    this.zoomAt(z / this.zoom);
  }

  private rootScreen(): Mat {
    const m = this.root?.getScreenCTM();
    return m ? dom(m) : IDENTITY;
  }

  /** Client (screen) point → document units. */
  toDoc(cx: number, cy: number): Pt {
    return apply(invert(this.rootScreen()), { x: cx, y: cy });
  }

  /** Document → stage px (for the overlay). */
  toStage(p: Pt): Pt {
    const r = this.stage.getBoundingClientRect();
    const s = apply(this.rootScreen(), p);
    return { x: s.x - r.left, y: s.y - r.top };
  }

  /** Element's user space → document. */
  elToDoc(el: SVGGraphicsElement): Mat {
    const m = el.getScreenCTM();
    return m ? mul(invert(this.rootScreen()), dom(m)) : IDENTITY;
  }

  localBox(el: SVGGraphicsElement): Box {
    try {
      const b = el.getBBox();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  docBox(el: SVGGraphicsElement): Box {
    return boundsOf(this.elToDoc(el), this.localBox(el));
  }

  selBox(): Box | null {
    return unionBox(this.sel.map((el) => this.docBox(el)));
  }

  private items(els = this.sel): Item[] {
    return els.map((el) => {
      const m0 = matOf(el);
      return { el, m0, p: mul(this.elToDoc(el), invert(m0)) };
    });
  }

  /** Applies a document-space transform to items (from their starting matrices). */
  private applyDoc(items: Item[], t: Mat): void {
    for (const it of items) setMat(it.el, mul(invert(it.p), mul(t, mul(it.p, it.m0))));
  }

  // ---------------------------------------------------------------- hit testing

  /** The child of the current container under a pointer event (null: empty / locked). */
  private hit(e: Event): SVGGraphicsElement | null {
    const t = e.composedPath()[0];
    if (!(t instanceof Element) || !this.root?.contains(t) || t === this.root) return null;
    let n: Element | null = t;
    while (n && n.parentElement !== this.container) n = n.parentElement;
    if (!n && this.container !== this.root) {
      // Clicked outside the group being edited: leave it.
      this.container = this.root;
      return this.hit(e);
    }
    return isGraphic(n) && !isLocked(n) && !isHidden(n) ? n : null;
  }

  private handleOf(e: Event): Handle | 'rot' | null {
    const t = e.composedPath()[0];
    return t instanceof Element ? ((t.getAttribute('data-h') as Handle | 'rot' | null) ?? null) : null;
  }

  // ---------------------------------------------------------------- pointer

  private down(e: PointerEvent): void {
    if (!this.root || this.textEdit) return;
    if ((e.target as Element).closest?.('.vd-text-edit')) return;
    this.stage.focus({ preventScroll: true });
    const p = this.toDoc(e.clientX, e.clientY);
    const tool = this.spaceHand ? 'hand' : this.tool;
    if (e.button === 1 || tool === 'hand') {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
      this.stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    this.stage.setPointerCapture(e.pointerId);
    if (this.nodes && tool === 'select' && this.nodeDown(e, p)) return;
    if (tool === 'pen') return this.penDown(p);
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      const el = this.create(tool, p);
      this.drag = { kind: 'create', el, start: p, tool };
      return;
    }
    if (tool === 'text') {
      const el = this.createText(p);
      this.tool = 'select';
      this.sel = [el];
      this.textEdit = { el, value: '', isNew: true };
      this.mask(el, true);
      this.bump();
      return;
    }
    const h = this.handleOf(e);
    if (h && this.sel.length) {
      const items = this.items();
      if (h === 'rot') {
        const b = this.single() ? this.orientedCenter(this.sel[0]!) : this.boxCenter(this.selBox()!);
        this.drag = { kind: 'rotate', c: b, a0: Math.atan2(p.y - b.y, p.x - b.x), items };
      } else {
        const one = this.single();
        if (one?.localName === 'text' && wrapWidth(one) > 0 && (h === 'e' || h === 'w')) {
          // A text box that wraps: the side handles change the width of the box.
          const w0 = wrapWidth(one);
          const x0 = firstNum(one.getAttribute('x'));
          const anchor = getComputedStyle(one).textAnchor;
          const left = anchor === 'middle' ? x0 - w0 / 2 : anchor === 'end' ? x0 - w0 : x0;
          this.drag = { kind: 'wrap', handle: h, left, right: left + w0, anchor };
          return;
        }
        const ratio = one ? ['text', 'image', 'g', 'use'].includes(one.localName) : false;
        this.drag = {
          kind: 'resize',
          handle: h,
          items,
          box: this.selBox()!,
          single: one ? { local: this.localBox(one), full: this.elToDoc(one) } : null,
          ratio,
        };
      }
      return;
    }
    const el = this.hit(e);
    if (el) {
      if (e.shiftKey) {
        this.sel = this.sel.includes(el) ? this.sel.filter((x) => x !== el) : [...this.sel, el];
        this.bump();
        if (!this.sel.includes(el)) return;
      } else if (!this.sel.includes(el)) this.sel = [el];
      this.startMove(p, e.altKey);
      this.bump();
      return;
    }
    if (!e.shiftKey) this.sel = [];
    this.drag = { kind: 'marquee', start: p, now: p, add: e.shiftKey };
    this.bump();
  }

  private startMove(p: Pt, dup: boolean): void {
    const others = kidsOf(this.container!).filter((k) => !this.sel.includes(k) && !isHidden(k));
    const xs: number[] = [];
    const ys: number[] = [];
    for (const b of [this.page, ...others.map((k) => this.docBox(k))]) {
      const l = boxLines(b);
      xs.push(...l.xs);
      ys.push(...l.ys);
    }
    this.drag = { kind: 'move', start: p, items: this.items(), box: this.selBox()!, xs, ys, dup, moved: false };
  }

  private move(e: PointerEvent): void {
    if (!this.root) return;
    const p = this.toDoc(e.clientX, e.clientY);
    const d = this.drag;
    if (!d) {
      if (this.pen) {
        this.pen.cursor = p;
        this.bump();
        return;
      }
      if (this.tool === 'select' && !this.spaceHand) {
        const h = this.hit(e);
        if (h !== this.hover) {
          this.hover = h;
          this.bump();
        }
      }
      return;
    }
    switch (d.kind) {
      case 'pan':
        this.panX = d.px + e.clientX - d.sx;
        this.panY = d.py + e.clientY - d.sy;
        this.userView = true;
        this.layout();
        this.bump();
        return;
      case 'move': {
        let dx = p.x - d.start.x;
        let dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
        if (!d.moved && d.dup) {
          // Alt-drag: the copies move, the originals stay.
          const copies = this.duplicateEls(this.sel, false);
          this.sel = copies;
          d.items = this.items();
        }
        d.moved = true;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const s = e.ctrlKey ? { dx, dy, guides: [] } : snapMove(d.box, dx, dy, d.xs, d.ys, 6 / this.zoom);
        this.guides = s.guides;
        this.applyDoc(d.items, translate(s.dx, s.dy));
        this.bump();
        return;
      }
      case 'resize': {
        const keep = d.ratio !== e.shiftKey;
        if (d.single) {
          const q = apply(invert(d.single.full), p);
          const nb = resizeBox(d.single.local, d.handle, q, keep, e.altKey, 0.5 / this.zoom);
          const it = d.items[0]!;
          setMat(it.el, mul(it.m0, boxToBox(d.single.local, nb)));
        } else {
          const nb = resizeBox(d.box, d.handle, p, keep, e.altKey, 0.5 / this.zoom);
          this.applyDoc(d.items, boxToBox(d.box, nb));
        }
        this.bump();
        return;
      }
      case 'rotate': {
        let deg = ((Math.atan2(p.y - d.c.y, p.x - d.c.x) - d.a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        this.applyDoc(d.items, rotate(deg, d.c.x, d.c.y));
        this.bump();
        return;
      }
      case 'marquee':
        d.now = p;
        this.marquee = pointsBox([d.start, p]);
        this.bump();
        return;
      case 'create':
        this.shapeTo(d.el, d.tool, d.start, p, e.shiftKey);
        this.bump();
        return;
      case 'node':
      case 'nhandle':
      case 'nmarquee':
        this.nodeMove(d, p, e);
        return;
      case 'wrap': {
        const el = this.single();
        if (!el) return;
        const q = apply(invert(this.elToDoc(el)), p);
        let { left, right } = d;
        if (d.handle === 'e') right = q.x;
        else left = q.x;
        const min = (parseFloat(getComputedStyle(el).fontSize) || 16) * 1.2;
        if (right - left < min) {
          if (d.handle === 'e') right = left + min;
          else left = right - min;
        }
        const x = d.anchor === 'middle' ? (left + right) / 2 : d.anchor === 'end' ? right : left;
        el.setAttribute('x', String(r4(x)));
        el.setAttribute('data-wrap-width', String(r4(right - left)));
        this.reflow(el as SVGTextElement);
        this.bump();
        return;
      }
      case 'pen': {
        if (Math.hypot(p.x - d.point.x, p.y - d.point.y) * this.zoom > 2) {
          d.point.hx = p.x;
          d.point.hy = p.y;
          this.penUpdate();
        }
        return;
      }
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    this.guides = [];
    if (!d) return;
    switch (d.kind) {
      case 'move':
        if (d.moved) {
          for (const it of d.items) bake(it.el);
          this.commit();
        }
        break;
      case 'resize':
      case 'rotate':
        for (const it of d.items) bake(it.el);
        this.commit();
        break;
      case 'marquee': {
        const m = this.marquee;
        this.marquee = null;
        if (m && (m.w > 0 || m.h > 0)) {
          const hits = kidsOf(this.container!).filter(
            (k) => !isLocked(k) && !isHidden(k) && boxesTouch(this.docBox(k), m),
          );
          this.sel = d.add ? [...new Set([...this.sel, ...hits])] : hits;
        }
        break;
      }
      case 'create': {
        const b = this.docBox(d.el);
        if (b.w * this.zoom < 3 && b.h * this.zoom < 3) {
          // A click without dragging: a shape of a default size there.
          const s = Math.min(this.page.w, this.page.h) / 4;
          this.shapeTo(d.el, d.tool, { x: d.start.x - s / 2, y: d.start.y - s / 2 }, { x: d.start.x + s / 2, y: d.start.y + s / 2 }, false);
        }
        this.sel = [d.el];
        this.tool = 'select';
        this.commit();
        break;
      }
      case 'pen':
        break;
      case 'node':
        if (d.moved) this.commit();
        break;
      case 'nhandle':
      case 'wrap':
        this.commit();
        break;
      case 'nmarquee': {
        const m = this.marquee;
        this.marquee = null;
        const ne = this.nodes;
        if (m && ne && (m.w > 0 || m.h > 0)) {
          const k = this.elToDoc(ne.el);
          if (!d.add) ne.sel.clear();
          ne.subs.forEach((sp, si) =>
            sp.nodes.forEach((n, i) => {
              const q = apply(k, n);
              if (q.x >= m.x && q.x <= m.x + m.w && q.y >= m.y && q.y <= m.y + m.h) ne.sel.add(`${si}:${i}`);
            }),
          );
        }
        break;
      }
    }
    this.bump();
  }

  private dbl(e: MouseEvent): void {
    if (!this.root || this.tool !== 'select') {
      if (this.pen) this.penFinish();
      return;
    }
    if (this.nodes) {
      const key = nodeKeyOf(e);
      if (key?.which === 'anchor') {
        const [si, i] = key.key.split(':').map(Number) as [number, number];
        const n = this.nodes.subs[si]?.nodes[i];
        if (n) {
          setNodeType(this.nodes.subs[si]!, i, n.ix !== undefined || n.ox !== undefined ? 'corner' : 'smooth');
          this.writeNodes();
          this.commit();
        }
        return;
      }
      if (this.nodeAddAt(this.toDoc(e.clientX, e.clientY))) return;
      if (this.hit(e) !== this.nodes.el) this.exitNodes();
      return;
    }
    const el = this.hit(e);
    if (!el) {
      if (this.container !== this.root) this.exitGroup();
      return;
    }
    if (el.localName === 'g') {
      this.container = el;
      this.sel = [];
      this.bump();
      return;
    }
    if (el.localName === 'text') this.editText(el as SVGTextElement);
    else if (el.localName === 'path' || el.localName === 'polygon' || el.localName === 'polyline') this.editNodes(el);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    this.panX -= e.shiftKey ? e.deltaY : e.deltaX;
    this.panY -= e.shiftKey ? 0 : e.deltaY;
    this.userView = true;
    this.layout();
    this.bump();
  }

  // ---------------------------------------------------------------- creating

  private create(tool: 'rect' | 'ellipse' | 'line', p: Pt): SVGGraphicsElement {
    const el = document.createElementNS(SVGNS, tool) as SVGGraphicsElement;
    const k = `kind_${tool}` as KeyG;
    el.setAttribute('data-name', tg(k));
    if (tool === 'line') {
      el.setAttribute('stroke', this.stroke);
      el.setAttribute('stroke-width', String(r4(Math.max(1, this.page.w / 270))));
      el.setAttribute('stroke-linecap', 'round');
    } else el.setAttribute('fill', this.fill);
    this.container!.append(el);
    this.shapeTo(el, tool, p, p, false);
    return el;
  }

  private shapeTo(el: SVGGraphicsElement, tool: 'rect' | 'ellipse' | 'line', a: Pt, b: Pt, square: boolean): void {
    // In the container's own space (the group being edited may be transformed).
    const inv = invert(this.containerToDoc());
    const pa = apply(inv, a);
    let pb = apply(inv, b);
    if (square && tool !== 'line') {
      const s = Math.max(Math.abs(pb.x - pa.x), Math.abs(pb.y - pa.y));
      pb = { x: pa.x + Math.sign(pb.x - pa.x || 1) * s, y: pa.y + Math.sign(pb.y - pa.y || 1) * s };
    }
    if (square && tool === 'line') {
      const ang = Math.round(Math.atan2(pb.y - pa.y, pb.x - pa.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      pb = { x: pa.x + Math.cos(ang) * len, y: pa.y + Math.sin(ang) * len };
    }
    const set = (k: string, v: number) => el.setAttribute(k, String(r4(v)));
    if (tool === 'line') {
      set('x1', pa.x);
      set('y1', pa.y);
      set('x2', pb.x);
      set('y2', pb.y);
      return;
    }
    const box = pointsBox([pa, pb]);
    if (tool === 'rect') {
      set('x', box.x);
      set('y', box.y);
      set('width', box.w);
      set('height', box.h);
    } else {
      set('cx', box.x + box.w / 2);
      set('cy', box.y + box.h / 2);
      set('rx', box.w / 2);
      set('ry', box.h / 2);
    }
  }

  private containerToDoc(): Mat {
    const c = this.container;
    if (!c || c === this.root) return IDENTITY;
    return this.elToDoc(c as SVGGraphicsElement);
  }

  private createText(p: Pt): SVGTextElement {
    const el = document.createElementNS(SVGNS, 'text') as SVGTextElement;
    const q = apply(invert(this.containerToDoc()), p);
    el.setAttribute('data-name', tg('kind_text'));
    el.setAttribute('x', String(r4(q.x)));
    el.setAttribute('y', String(r4(q.y)));
    el.setAttribute('font-family', "'Segoe UI', Arial, sans-serif");
    el.setAttribute('font-size', String(Math.max(12, Math.round(this.page.w / 18))));
    el.setAttribute('font-weight', '700');
    el.setAttribute('fill', this.fill === '#4f8fd6' ? '#1f2933' : this.fill);
    el.textContent = '';
    this.container!.append(el);
    return el;
  }

  /** A ready-made shape in the middle of the view. */
  addShape(kind: ShapeKind): void {
    if (!this.root) return;
    const r = this.stage.getBoundingClientRect();
    const c = this.toDoc(r.left + r.width / 2, r.top + r.height / 2);
    const s = Math.min(this.page.w, this.page.h) / 3;
    const inv = invert(this.containerToDoc());
    const a = apply(inv, { x: c.x - s / 2, y: c.y - s / 2 });
    const el = document.createElementNS(SVGNS, 'path') as SVGPathElement;
    el.setAttribute('data-name', tg(`shape_${kind}` as KeyG));
    el.setAttribute('d', shapePath(kind, { x: a.x, y: a.y, w: s, h: kind === 'arrow' ? s * 0.6 : s }));
    el.setAttribute('fill', this.fill);
    this.container!.append(el);
    this.sel = [el];
    this.tool = 'select';
    this.commit();
  }

  /** Inserts a picture (data: URL) fitted into the page, centered at a document point. */
  addImage(url: string, w: number, h: number, at?: Pt): void {
    if (!this.root) return;
    const k = Math.min(1, (this.page.w * 0.6) / w, (this.page.h * 0.6) / h);
    const iw = w * k;
    const ih = h * k;
    const c = at ?? { x: this.page.x + this.page.w / 2, y: this.page.y + this.page.h / 2 };
    const q = apply(invert(this.containerToDoc()), { x: c.x - iw / 2, y: c.y - ih / 2 });
    const el = document.createElementNS(SVGNS, 'image') as SVGImageElement;
    el.setAttribute('data-name', tg('kind_image'));
    el.setAttribute('href', url);
    el.setAttribute('x', String(r4(q.x)));
    el.setAttribute('y', String(r4(q.y)));
    el.setAttribute('width', String(r4(iw)));
    el.setAttribute('height', String(r4(ih)));
    el.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    this.container!.append(el);
    this.sel = [el];
    this.commit();
  }

  // ---------------------------------------------------------------- pen

  private penDown(p: Pt): void {
    const q = apply(invert(this.containerToDoc()), p);
    if (!this.pen) {
      const el = document.createElementNS(SVGNS, 'path') as SVGPathElement;
      el.setAttribute('data-name', tg('kind_path'));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', this.stroke);
      el.setAttribute('stroke-width', String(r4(Math.max(1, this.page.w / 270))));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      this.container!.append(el);
      this.pen = { pts: [], el, cursor: null };
    }
    const pts = this.pen.pts;
    const first = pts[0];
    if (first && pts.length > 2) {
      const f = apply(this.containerToDoc(), first);
      if (Math.hypot(f.x - p.x, f.y - p.y) * this.zoom < 9) {
        this.penFinish(true);
        return;
      }
    }
    const point: PenPoint = { x: q.x, y: q.y };
    pts.push(point);
    this.drag = { kind: 'pen', point };
    this.penUpdate();
  }

  private penUpdate(): void {
    if (!this.pen) return;
    this.pen.el.setAttribute('d', penPath(this.pen.pts, false));
    this.bump();
  }

  penFinish(close = false): void {
    const pen = this.pen;
    if (!pen) return;
    this.pen = null;
    if (pen.pts.length < 2) {
      pen.el.remove();
      this.bump();
      return;
    }
    pen.el.setAttribute('d', penPath(pen.pts, close));
    if (close) pen.el.setAttribute('fill', this.fill);
    this.sel = [pen.el];
    this.tool = 'select';
    this.commit();
  }

  // ---------------------------------------------------------------- text

  /** The text being typed is drawn by the text box, not twice. */
  private mask(el: Element, on: boolean): void {
    const st = (el as SVGElement).style;
    if (on) st.setProperty('visibility', 'hidden');
    else {
      st.removeProperty('visibility');
      if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
    }
  }

  editText(el: SVGTextElement): void {
    this.mask(el, true);
    const value = textValue(el);
    this.sel = [el];
    this.textEdit = { el, value, isNew: false };
    this.bump();
  }

  /** Ends text editing: writes the lines (or drops a new empty text). */
  endText(value: string | null): void {
    const te = this.textEdit;
    if (!te) return;
    this.textEdit = null;
    this.mask(te.el, false);
    if (value === null || (!value.trim() && te.isNew)) {
      if (te.isNew) {
        te.el.remove();
        this.sel = [];
      }
      this.bump();
      return;
    }
    setTextLines(te.el, value);
    this.commit();
  }

  /** Lines of a text again after its font or box width changed. */
  reflow(el: SVGTextElement): void {
    if (wrapWidth(el) > 0) setTextLines(el, textValue(el));
  }

  /** Text box width (null: no wrapping, one line per Enter). */
  setWrap(el: SVGTextElement, w: number | null): void {
    const value = textValue(el);
    if (w && w > 0) el.setAttribute('data-wrap-width', String(r4(w)));
    else el.removeAttribute('data-wrap-width');
    setTextLines(el, value);
    this.commit();
  }

  // ---------------------------------------------------------------- node editing

  /** Starts editing the points of a shape (rects, ellipses… become a path first). */
  editNodes(el = this.single()): boolean {
    if (!el || !NODE_EDITABLE.has(el.localName) || isLocked(el)) return false;
    this.flush();
    let path = el as SVGPathElement;
    if (el.localName !== 'path') {
      const d = shapeAsPath(el);
      if (!d) return false;
      path = document.createElementNS(SVGNS, 'path') as SVGPathElement;
      const geo = new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points']);
      for (const a of [...el.attributes]) if (!geo.has(a.name)) path.setAttribute(a.name, a.value);
      if (el.localName === 'line' && !path.getAttribute('fill')) path.setAttribute('fill', 'none');
      path.setAttribute('d', d);
      el.replaceWith(path);
      this.sel = [path];
      this.commit();
    }
    return this.startNodes(path);
  }

  private startNodes(el: SVGPathElement): boolean {
    let subs: SubPath[];
    try {
      subs = parsePathData(el.getAttribute('d') ?? '');
    } catch {
      return false;
    }
    if (!subs.length) return false;
    this.nodes = { el, subs, sel: new Set() };
    this.sel = [el];
    this.tool = 'select';
    this.bump();
    return true;
  }

  exitNodes(): void {
    if (!this.nodes) return;
    this.nodes = null;
    this.bump();
  }

  private writeNodes(): void {
    const ne = this.nodes;
    if (ne) ne.el.setAttribute('d', serializePathData(ne.subs));
  }

  private nodeAt(key: string): PNode | undefined {
    const [si, i] = key.split(':').map(Number) as [number, number];
    return this.nodes?.subs[si]?.nodes[i];
  }

  /** Pointer down in node mode. False: the click was on another shape (normal handling). */
  private nodeDown(e: PointerEvent, p: Pt): boolean {
    const ne = this.nodes!;
    const k = nodeKeyOf(e);
    const local = apply(invert(this.elToDoc(ne.el)), p);
    if (k?.which === 'anchor') {
      if (e.shiftKey) {
        if (ne.sel.has(k.key)) ne.sel.delete(k.key);
        else ne.sel.add(k.key);
      } else if (!ne.sel.has(k.key)) ne.sel = new Set([k.key]);
      const orig = new Map<string, PNode>();
      for (const key of ne.sel) {
        const n = this.nodeAt(key);
        if (n) orig.set(key, { ...n });
      }
      this.drag = { kind: 'node', start: local, orig, moved: false };
      this.bump();
      return true;
    }
    if (k && (k.which === 'in' || k.which === 'out')) {
      this.drag = { kind: 'nhandle', key: k.key, which: k.which };
      return true;
    }
    const el = this.hit(e);
    if (el && el !== ne.el) {
      this.nodes = null;
      return false;
    }
    if (!e.shiftKey) ne.sel.clear();
    this.drag = { kind: 'nmarquee', start: p, add: e.shiftKey };
    this.bump();
    return true;
  }

  private nodeMove(d: Extract<Drag, { kind: 'node' | 'nhandle' | 'nmarquee' }>, p: Pt, e: PointerEvent): void {
    const ne = this.nodes;
    if (!ne) return;
    if (d.kind === 'nmarquee') {
      this.marquee = pointsBox([d.start, p]);
      this.bump();
      return;
    }
    const q = apply(invert(this.elToDoc(ne.el)), p);
    if (d.kind === 'node') {
      let dx = q.x - d.start.x;
      let dy = q.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * this.zoom < 2) return;
      d.moved = true;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      for (const [key, o] of d.orig) {
        const n = this.nodeAt(key);
        if (!n) continue;
        for (const k of ['ix', 'iy', 'ox', 'oy'] as const) delete n[k];
        Object.assign(n, o);
        moveNode(n, dx, dy);
      }
    } else {
      const n = this.nodeAt(d.key);
      if (!n) return;
      // Alt: breaks a smooth node into a corner with two free handles.
      moveHandle(n, d.which, q, e.altKey);
    }
    this.writeNodes();
    this.bump();
  }

  /** Double click on the outline: a new point there. */
  private nodeAddAt(p: Pt): boolean {
    const ne = this.nodes;
    if (!ne) return false;
    const m = this.elToDoc(ne.el);
    const q = apply(invert(m), p);
    const near = nearestOnPath(ne.subs, q);
    // Distance in screen px (the path may be scaled).
    const k = Math.hypot(m[0], m[1]) * this.zoom;
    if (!near || near.dist * k > 10) return false;
    const i = insertNode(ne.subs[near.sub]!, near.seg, near.t);
    if (i < 0) return false;
    ne.sel = new Set([`${near.sub}:${i}`]);
    this.writeNodes();
    this.commit();
    return true;
  }

  nodeDelete(): void {
    const ne = this.nodes;
    if (!ne || !ne.sel.size) return;
    const subs = deleteNodes(ne.subs, ne.sel);
    if (!subs.length) {
      ne.el.remove();
      this.nodes = null;
      this.sel = [];
      this.commit();
      return;
    }
    ne.subs = subs;
    ne.sel = new Set();
    this.writeNodes();
    this.commit();
  }

  nodeType(type: 'corner' | 'smooth'): void {
    const ne = this.nodes;
    if (!ne || !ne.sel.size) return;
    for (const key of ne.sel) {
      const [si, i] = key.split(':').map(Number) as [number, number];
      if (ne.subs[si]) setNodeType(ne.subs[si]!, i, type);
    }
    this.writeNodes();
    this.commit();
  }

  /** Opens or closes the sub-paths of the selected points (all when none is selected). */
  nodeToggleClosed(): void {
    const ne = this.nodes;
    if (!ne) return;
    const subsOf = new Set([...ne.sel].map((k) => Number(k.split(':')[0])));
    ne.subs.forEach((sp, si) => {
      if (subsOf.size && !subsOf.has(si)) return;
      if (sp.nodes.length > 2 || sp.closed) sp.closed = !sp.closed;
    });
    this.writeNodes();
    this.commit();
  }

  nodeSelectAll(): void {
    const ne = this.nodes;
    if (!ne) return;
    ne.sel = new Set(ne.subs.flatMap((sp, si) => sp.nodes.map((_, i) => `${si}:${i}`)));
    this.bump();
  }

  /** Arrow keys in node mode: moves the selected points by (dx, dy) document units. */
  nodeNudge(dx: number, dy: number): void {
    const ne = this.nodes;
    if (!ne || !ne.sel.size) return;
    const m = this.elToDoc(ne.el);
    const d = apply(invert([m[0], m[1], m[2], m[3], 0, 0]), { x: dx, y: dy });
    for (const key of ne.sel) {
      const n = this.nodeAt(key);
      if (n) moveNode(n, d.x, d.y);
    }
    this.writeNodes();
    this.soon();
  }

  /** Points and handles in stage px, for the overlay. */
  nodeView(): { key: string; a: Pt; on: boolean; smooth: boolean; i: Pt | null; o: Pt | null }[] {
    const ne = this.nodes;
    if (!ne || !ne.el.isConnected) return [];
    const m = this.elToDoc(ne.el);
    const st = (p: Pt) => this.toStage(apply(m, p));
    const near = new Set<string>();
    ne.subs.forEach((sp, si) => {
      const len = sp.nodes.length;
      sp.nodes.forEach((_, i) => {
        if (!ne.sel.has(`${si}:${i}`)) return;
        near.add(`${si}:${i}`);
        if (i > 0 || sp.closed) near.add(`${si}:${(i - 1 + len) % len}`);
        if (i < len - 1 || sp.closed) near.add(`${si}:${(i + 1) % len}`);
      });
    });
    return ne.subs.flatMap((sp, si) =>
      sp.nodes.map((n, i) => {
        const key = `${si}:${i}`;
        const show = near.has(key);
        return {
          key,
          a: st(n),
          on: ne.sel.has(key),
          smooth: !!n.smooth,
          i: show && n.ix !== undefined ? st({ x: n.ix, y: n.iy! }) : null,
          o: show && n.ox !== undefined ? st({ x: n.ox, y: n.oy! }) : null,
        };
      }),
    );
  }

  // ---------------------------------------------------------------- selection commands

  single(): SVGGraphicsElement | null {
    return this.sel.length === 1 ? this.sel[0]! : null;
  }

  private boxCenter(b: Box): Pt {
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  orientedCenter(el: SVGGraphicsElement): Pt {
    const b = this.localBox(el);
    return apply(this.elToDoc(el), { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  }

  /** Corners of an element in document space (for the oriented selection box). */
  corners(el: SVGGraphicsElement): Pt[] {
    const b = this.localBox(el);
    const m = this.elToDoc(el);
    return [
      apply(m, { x: b.x, y: b.y }),
      apply(m, { x: b.x + b.w, y: b.y }),
      apply(m, { x: b.x + b.w, y: b.y + b.h }),
      apply(m, { x: b.x, y: b.y + b.h }),
    ];
  }

  selectAll(): void {
    this.sel = kidsOf(this.container!).filter((k) => !isLocked(k) && !isHidden(k));
    this.bump();
  }

  select(els: SVGGraphicsElement[]): void {
    this.sel = els;
    this.bump();
  }

  exitGroup(): void {
    if (!this.container || this.container === this.root) return;
    const g = this.container as SVGGraphicsElement;
    let up: Element | null = g.parentElement;
    while (up && up !== this.root && !isGraphic(up)) up = up.parentElement;
    this.container = (up as SVGGraphicsElement) ?? this.root;
    this.sel = [g];
    this.bump();
  }

  enterGroup(g: SVGGraphicsElement): void {
    if (g.localName !== 'g') return;
    this.container = g;
    this.sel = [];
    this.bump();
  }

  remove(): void {
    if (!this.sel.length) return;
    for (const el of this.sel) el.remove();
    this.sel = [];
    this.commit();
  }

  nudge(dx: number, dy: number): void {
    if (!this.sel.length) return;
    this.applyDoc(this.items(), translate(dx, dy));
    for (const el of this.sel) bake(el);
    this.soon();
  }

  /** Moves / scales the selection so its box becomes `b` (the X Y W H fields). */
  setBox(b: Partial<Box>): void {
    const cur = this.selBox();
    if (!cur) return;
    const next = { ...cur, ...b };
    if (next.w <= 0 || next.h <= 0) return;
    this.applyDoc(this.items(), boxToBox(cur, next));
    for (const el of this.sel) bake(el);
    this.commit();
  }

  /** Turns a single element to an absolute angle (degrees) around its center. */
  setAngle(deg: number): void {
    const el = this.single();
    if (!el) return;
    const now = (Math.atan2(this.elToDoc(el)[1], this.elToDoc(el)[0]) * 180) / Math.PI;
    const c = this.orientedCenter(el);
    this.applyDoc(this.items(), rotate(deg - now, c.x, c.y));
    bake(el);
    this.commit();
  }

  angle(el: SVGGraphicsElement): number {
    const m = this.elToDoc(el);
    return Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI * 10) / 10;
  }

  flip(axis: 'x' | 'y'): void {
    const b = this.selBox();
    if (!b) return;
    const c = this.boxCenter(b);
    const t = mul(translate(c.x, c.y), mul(axis === 'x' ? scale(-1, 1) : scale(1, -1), translate(-c.x, -c.y)));
    this.applyDoc(this.items(), t);
    this.commit();
  }

  align(mode: AlignMode): void {
    if (!this.sel.length) return;
    const boxes = this.sel.map((el) => this.docBox(el));
    const ref = this.sel.length === 1 ? this.page : unionBox(boxes)!;
    const ds = alignDeltas(boxes, mode, ref);
    this.sel.forEach((el, i) => {
      this.applyDoc(this.items([el]), translate(ds[i]!.x, ds[i]!.y));
      bake(el);
    });
    this.commit();
  }

  distribute(axis: 'x' | 'y'): void {
    if (this.sel.length < 3) return;
    const ds = distributeDeltas(this.sel.map((el) => this.docBox(el)), axis);
    this.sel.forEach((el, i) => {
      this.applyDoc(this.items([el]), translate(ds[i]!.x, ds[i]!.y));
      bake(el);
    });
    this.commit();
  }

  /** Stacking order inside the container. */
  order(how: 'front' | 'forward' | 'backward' | 'back'): void {
    const c = this.container;
    if (!c || !this.sel.length) return;
    const inOrder = kidsOf(c).filter((k) => this.sel.includes(k));
    if (how === 'front') for (const el of inOrder) c.append(el);
    else if (how === 'back') {
      const first = kidsOf(c)[0];
      for (const el of inOrder) if (first && el !== first) c.insertBefore(el, first);
    } else if (how === 'forward') {
      for (const el of [...inOrder].reverse()) {
        let n = el.nextElementSibling;
        while (n && !isGraphic(n)) n = n.nextElementSibling;
        if (n && !this.sel.includes(n as SVGGraphicsElement)) n.after(el);
      }
    } else {
      for (const el of inOrder) {
        let n = el.previousElementSibling;
        while (n && !isGraphic(n)) n = n.previousElementSibling;
        if (n && !this.sel.includes(n as SVGGraphicsElement)) n.before(el);
      }
    }
    this.commit();
  }

  /** Moves a layer before (= under) or after (= over) another of the same container. */
  reorder(el: SVGGraphicsElement, target: SVGGraphicsElement, over: boolean): void {
    if (el === target || el.contains(target)) return;
    if (over) target.after(el);
    else target.before(el);
    this.commit();
  }

  group(): void {
    const c = this.container;
    if (!c || this.sel.length < 2) return;
    const inOrder = kidsOf(c).filter((k) => this.sel.includes(k));
    const g = document.createElementNS(SVGNS, 'g') as SVGGElement;
    g.setAttribute('data-name', tg('kind_g'));
    inOrder[inOrder.length - 1]!.after(g);
    for (const el of inOrder) g.append(el);
    this.sel = [g];
    this.commit();
  }

  ungroup(): void {
    const groups = this.sel.filter((el) => el.localName === 'g');
    if (!groups.length) return;
    const out: SVGGraphicsElement[] = this.sel.filter((el) => el.localName !== 'g');
    const inherit = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'font-style'];
    for (const g of groups) {
      const mg = matOf(g);
      const gOpacity = parseFloat(g.getAttribute('opacity') ?? '1');
      for (const ch of [...g.children]) {
        if (isGraphic(ch)) {
          setMat(ch, mul(mg, matOf(ch)));
          for (const a of inherit) {
            const v = g.getAttribute(a);
            if (v !== null && ch.getAttribute(a) === null) ch.setAttribute(a, v);
          }
          if (gOpacity !== 1) {
            const o = parseFloat(ch.getAttribute('opacity') ?? '1');
            ch.setAttribute('opacity', String(r4(o * gOpacity)));
          }
          out.push(ch);
        }
        g.before(ch);
      }
      g.remove();
    }
    this.sel = out;
    this.commit();
  }

  /** Copies of elements right after them; offset moves them a bit (Ctrl+D). */
  private duplicateEls(els: SVGGraphicsElement[], offset: boolean): SVGGraphicsElement[] {
    const d = offset ? Math.max(4, this.page.w / 60) : 0;
    const copies: SVGGraphicsElement[] = [];
    for (const el of els) {
      const cp = el.cloneNode(true) as SVGGraphicsElement;
      stripIds(cp);
      el.after(cp);
      copies.push(cp);
    }
    if (d) this.applyDoc(this.items(copies), translate(d, d));
    return copies;
  }

  duplicate(): void {
    if (!this.sel.length) return;
    this.sel = this.duplicateEls(this.sel, true);
    for (const el of this.sel) bake(el);
    this.commit();
  }

  copy(cut = false): void {
    if (!this.sel.length) return;
    const s = new XMLSerializer();
    this.clip = this.sel.map((el) => s.serializeToString(el));
    this.pasteN = 0;
    if (cut) this.remove();
  }

  paste(): void {
    if (!this.clip.length || !this.container) return;
    const d = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}">${this.clip.join('')}</svg>`, 'image/svg+xml');
    if (d.querySelector('parsererror')) return;
    sanitizeSvg(d.documentElement);
    this.pasteN++;
    const off = Math.max(4, this.page.w / 60) * this.pasteN;
    const made: SVGGraphicsElement[] = [];
    for (const ch of [...d.documentElement.children]) {
      const el = document.importNode(ch, true);
      if (!isGraphic(el)) continue;
      stripIds(el);
      this.container.append(el);
      made.push(el);
    }
    this.applyDoc(this.items(made), translate(off, off));
    for (const el of made) bake(el);
    this.sel = made;
    this.commit();
  }

  toggleHidden(el: SVGGraphicsElement): void {
    if (isHidden(el)) {
      el.removeAttribute('display');
      if (el.getAttribute('visibility') === 'hidden') el.removeAttribute('visibility');
    } else {
      el.setAttribute('display', 'none');
      this.sel = this.sel.filter((x) => x !== el);
    }
    this.commit();
  }

  toggleLocked(el: SVGGraphicsElement): void {
    if (isLocked(el)) el.removeAttribute('data-locked');
    else {
      el.setAttribute('data-locked', 'true');
      this.sel = this.sel.filter((x) => x !== el);
    }
    this.commit();
  }

  rename(el: Element, name: string): void {
    const n = name.trim().slice(0, 60);
    if (n) el.setAttribute('data-name', n);
    else el.removeAttribute('data-name');
    this.commit();
  }

  /** Page size: width / height and the viewBox. */
  setPageSize(w: number, h: number): void {
    if (!this.root || !(w > 0) || !(h > 0)) return;
    this.root.setAttribute('width', String(Math.round(w)));
    this.root.setAttribute('height', String(Math.round(h)));
    this.root.setAttribute('viewBox', `${this.page.x} ${this.page.y} ${r4(w)} ${r4(h)}`);
    this.page = { ...this.page, w, h };
    this.layout();
    this.commit();
    this.fit();
  }

  /** The gradient an element's fill points at (url(#id)), if any. */
  gradientOf(el: Element, prop: 'fill' | 'stroke' = 'fill'): SVGGradientElement | null {
    const v = getComputedStyle(el).getPropertyValue(prop) || el.getAttribute(prop) || '';
    const m = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(v);
    if (!m || !this.root) return null;
    const g = this.shadow.getElementById(m[1]!);
    return g instanceof SVGGradientElement ? g : null;
  }
}

// ------------------------------------------------------------------ helpers

function stripIds(el: Element): void {
  el.removeAttribute('id');
  for (const c of el.querySelectorAll('[id]')) c.removeAttribute('id');
}

/** Width of the box a text wraps in (data-wrap-width), 0 when it does not wrap. */
export function wrapWidth(el: Element): number {
  const v = parseFloat(el.getAttribute('data-wrap-width') ?? '');
  return Number.isFinite(v) && v > 0 ? v : 0;
}

const firstNum = (v: string | null): number => parseFloat((v ?? '0').trim().split(/[\s,]+/)[0] ?? '0') || 0;

/** The text as typed: Enter between paragraphs, wrapped lines joined back with a space. */
export function textValue(el: SVGTextElement): string {
  const spans = [...el.children].filter((c) => c.localName === 'tspan');
  if (!spans.length) return el.textContent ?? '';
  return spans
    .map((s, i) => (i === 0 ? '' : s.getAttribute('data-soft') === '1' ? ' ' : '\n') + (s.textContent === ' ' ? '' : (s.textContent ?? '')))
    .join('');
}

/** Width of a line in the text's own font (an estimate where the DOM cannot measure). */
function measurer(el: SVGTextElement): (s: string) => number {
  const size = parseFloat(el.getAttribute('font-size') ?? '') || parseFloat(getComputedStyle(el).fontSize) || 16;
  return (s: string) => {
    el.textContent = s;
    let w = 0;
    try {
      w = el.getComputedTextLength();
    } catch {
      w = 0;
    }
    return w > 0 || !s ? w : s.length * size * 0.55;
  };
}

/**
 * Writes lines into a <text>: one line as plain text, more as tspans under each other. With
 * data-wrap-width the paragraphs are broken to that width (those tspans get data-soft).
 */
export function setTextLines(el: SVGTextElement, value: string): void {
  const w = wrapWidth(el);
  const lines =
    w > 0 ? wrapText(value, w, measurer(el)) : value.replace(/\r/g, '').split('\n').map((text) => ({ text, soft: false }));
  const x = (el.getAttribute('x') ?? '0').trim().split(/[\s,]+/)[0] ?? '0';
  while (el.firstChild) el.firstChild.remove();
  if (lines.length === 1) {
    el.textContent = lines[0]!.text;
    return;
  }
  lines.forEach((l, i) => {
    const t = document.createElementNS(SVGNS, 'tspan');
    t.setAttribute('x', x);
    t.setAttribute('dy', i === 0 ? '0' : '1.15em');
    if (l.soft) t.setAttribute('data-soft', '1');
    t.textContent = l.text || ' ';
    el.append(t);
  });
}

/** Which point or handle of the node overlay an event is on. */
function nodeKeyOf(e: Event): { key: string; which: 'anchor' | 'in' | 'out' } | null {
  const t = e.composedPath()[0];
  if (!(t instanceof Element)) return null;
  const a = t.getAttribute('data-n');
  if (a) return { key: a, which: 'anchor' };
  const h = t.getAttribute('data-nh');
  if (h) {
    const [si, i, w] = h.split(':');
    return { key: `${si}:${i}`, which: w === 'in' ? 'in' : 'out' };
  }
  return null;
}

/** Path data of a simple shape, in its own coordinates. */
function shapeAsPath(el: Element): string | null {
  const g = (k: string): number => parseFloat(el.getAttribute(k) ?? '0') || 0;
  switch (el.localName) {
    case 'rect': {
      const rx = el.getAttribute('rx') !== null ? g('rx') : g('ry');
      const ry = el.getAttribute('ry') !== null ? g('ry') : rx;
      return rectPathData(g('x'), g('y'), g('width'), g('height'), rx, ry);
    }
    case 'circle':
      return ellipsePathData(g('cx'), g('cy'), g('r'), g('r'));
    case 'ellipse':
      return ellipsePathData(g('cx'), g('cy'), g('rx'), g('ry'));
    case 'line':
      return `M ${g('x1')} ${g('y1')} L ${g('x2')} ${g('y2')}`;
    case 'polygon':
    case 'polyline':
      return pointsPathData(el.getAttribute('points') ?? '', el.localName === 'polygon') || null;
    default:
      return null;
  }
}

const num = (el: Element, k: string): number | null => {
  const v = el.getAttribute(k);
  if (v === null) return 0;
  if (/%|[a-z]/i.test(v.replace(/e[-+]?\d+/i, ''))) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Scales a list attribute ("10 20 30") — x / y of text and tspans. */
function scaleList(el: Element, k: string, s: number, t: number): boolean {
  const v = el.getAttribute(k);
  if (v === null) return true;
  const parts = v.trim().split(/[\s,]+/).map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return false;
  el.setAttribute(k, parts.map((p) => r4(p * s + t)).join(' '));
  return true;
}

/**
 * Bakes a plain move / scale (no rotation, no flip) into the geometry of simple shapes, so
 * the file keeps x / y / width… instead of a matrix and strokes do not get thicker.
 */
export function bake(el: SVGGraphicsElement): void {
  const m = matOf(el);
  if (!(Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0)) return;
  if (m.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-9)) {
    el.removeAttribute('transform');
    return;
  }
  const [sx, , , sy, tx, ty] = m;
  const set = (k: string, v: number) => el.setAttribute(k, String(r4(v)));
  const vals = (ks: string[]): number[] | null => {
    const out = ks.map((k) => num(el, k));
    return out.some((v) => v === null) ? null : (out as number[]);
  };
  const uniform = Math.abs(sx - sy) < 1e-6 * Math.max(sx, sy);
  switch (el.localName) {
    case 'rect':
    case 'image':
    case 'use': {
      const v = vals(['x', 'y', 'width', 'height']);
      if (!v) return;
      // <use> keeps its referenced geometry: only a move is baked.
      if (el.localName === 'use' && (sx !== 1 || sy !== 1)) return;
      set('x', v[0]! * sx + tx);
      set('y', v[1]! * sy + ty);
      if (el.getAttribute('width') !== null) set('width', v[2]! * sx);
      if (el.getAttribute('height') !== null) set('height', v[3]! * sy);
      if (el.localName === 'rect') {
        const rx = num(el, 'rx');
        const ry = num(el, 'ry');
        if (el.getAttribute('rx') !== null && rx !== null) set('rx', rx * sx);
        if (el.getAttribute('ry') !== null && ry !== null) set('ry', ry * sy);
      }
      break;
    }
    case 'ellipse': {
      const v = vals(['cx', 'cy', 'rx', 'ry']);
      if (!v) return;
      set('cx', v[0]! * sx + tx);
      set('cy', v[1]! * sy + ty);
      set('rx', v[2]! * sx);
      set('ry', v[3]! * sy);
      break;
    }
    case 'circle': {
      const v = vals(['cx', 'cy', 'r']);
      if (!v || !uniform) return;
      set('cx', v[0]! * sx + tx);
      set('cy', v[1]! * sy + ty);
      set('r', v[2]! * sx);
      break;
    }
    case 'line': {
      const v = vals(['x1', 'y1', 'x2', 'y2']);
      if (!v) return;
      set('x1', v[0]! * sx + tx);
      set('y1', v[1]! * sy + ty);
      set('x2', v[2]! * sx + tx);
      set('y2', v[3]! * sy + ty);
      break;
    }
    case 'text': {
      if (!uniform) return;
      const nodes = [el, ...el.querySelectorAll('tspan')];
      // dx / dy in user units would need scaling too; em values follow the font size.
      for (const n of nodes)
        for (const k of ['dx', 'dy']) {
          const v = n.getAttribute(k);
          if (v !== null && !/em\s*$/.test(v) && v.trim() !== '0' && sx !== 1) return;
        }
      const listOk = (n: Element, k: string): boolean => {
        const v = n.getAttribute(k);
        return v === null || v.trim().split(/[\s,]+/).every((p) => Number.isFinite(Number(p)));
      };
      if (!nodes.every((n) => listOk(n, 'x') && listOk(n, 'y'))) return;
      for (const n of nodes) {
        scaleList(n, 'x', sx, tx);
        scaleList(n, 'y', sy, ty);
      }
      if (sx !== 1) {
        for (const n of nodes) {
          const fs = n.getAttribute('font-size');
          if (fs !== null) {
            const f = parseFloat(fs);
            if (Number.isFinite(f)) n.setAttribute('font-size', String(r4(f * sx)));
          }
          const ww = n.getAttribute('data-wrap-width');
          if (ww !== null && Number.isFinite(parseFloat(ww))) n.setAttribute('data-wrap-width', String(r4(parseFloat(ww) * sx)));
          const ls = n.getAttribute('letter-spacing');
          if (ls !== null && Number.isFinite(parseFloat(ls))) n.setAttribute('letter-spacing', String(r4(parseFloat(ls) * sx)));
        }
        if (el.getAttribute('font-size') === null) {
          const f = parseFloat(getComputedStyle(el).fontSize);
          if (Number.isFinite(f)) el.setAttribute('font-size', String(r4(f * sx)));
        }
        if (el.style.fontSize) el.style.removeProperty('font-size');
      }
      break;
    }
    default:
      return;
  }
  el.removeAttribute('transform');
}
