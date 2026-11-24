/**
 * Fase 3B (plan de funciones), mejora: editing the points (nodes) of a path that is already
 * drawn. Any SVG path data (absolute / relative, H V S T Q A…) is read into sub-paths of
 * nodes with cubic handles, edited, and written back as M / L / C / Z. Pure functions only,
 * shared by the vector editor and the tests.
 */

import type { Pt } from './graphics';

export interface PNode {
  x: number;
  y: number;
  /** Incoming handle (from the previous node); absent = straight into the node. */
  ix?: number;
  iy?: number;
  /** Outgoing handle (to the next node). */
  ox?: number;
  oy?: number;
  /** Smooth node: moving one handle turns the other one with it. */
  smooth?: boolean;
}

export interface SubPath {
  nodes: PNode[];
  closed: boolean;
}

const r4 = (v: number): number => {
  const x = Math.round(v * 10000) / 10000;
  return Object.is(x, -0) ? 0 : x;
};
const f = (v: number): string => String(r4(v));
const EPS = 1e-6;

// ------------------------------------------------------------------ parse

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

/** Arc flags may be written without separators ("a1 1 0 011 1"): read them one digit at a time. */
function tokenizeArcAware(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  let cmd = '';
  let argN = 0;
  const num = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
  while (i < d.length) {
    const ch = d[i]!;
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      out.push(ch);
      cmd = ch.toLowerCase();
      argN = 0;
      i++;
      continue;
    }
    if (cmd === 'a' && (argN % 7 === 3 || argN % 7 === 4) && (ch === '0' || ch === '1')) {
      out.push(Number(ch));
      argN++;
      i++;
      continue;
    }
    const m = num.exec(d.slice(i));
    if (!m) throw new Error(`Bad path data near "${d.slice(i, i + 12)}"`);
    out.push(Number(m[0]));
    argN++;
    i += m[0].length;
  }
  return out;
}

/** Cubic pieces of an SVG arc (endpoint form), each [c1, c2, end]. */
export function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  angle: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): [Pt, Pt, Pt][] {
  if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) < EPS) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < EPS || ry < EPS)
    return [
      [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        { x: x2, y: y2 },
      ],
    ];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n;
  const kappa = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number): Pt => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy };
  };
  const deriv = (t: number): Pt => {
    const ex = -rx * Math.sin(t);
    const ey = ry * Math.cos(t);
    return { x: cos * ex - sin * ey, y: sin * ex + cos * ey };
  };
  const out: [Pt, Pt, Pt][] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step;
    const b = a + step;
    const p0 = pt(a);
    const p1 = i === n - 1 ? { x: x2, y: y2 } : pt(b);
    const d0 = deriv(a);
    const d1 = deriv(b);
    out.push([
      { x: p0.x + kappa * d0.x, y: p0.y + kappa * d0.y },
      { x: p1.x - kappa * d1.x, y: p1.y - kappa * d1.y },
      p1,
    ]);
  }
  return out;
}

/** Reads path data into sub-paths of nodes (throws on data that cannot be read). */
export function parsePathData(d: string): SubPath[] {
  const tk = /[aA]/.test(d) ? tokenizeArcAware(d) : tokenize(d);
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  /** Last control point (for S / T reflection) and the kind of the last command. */
  let lc: Pt | null = null;
  let lq: Pt | null = null;
  let i = 0;
  let cmd = '';
  const last = (): PNode => cur!.nodes[cur!.nodes.length - 1]!;
  const start = (nx: number, ny: number): void => {
    cur = { nodes: [{ x: nx, y: ny }], closed: false };
    subs.push(cur);
  };
  const ensure = (): void => {
    if (!cur) start(x, y);
  };
  const lineTo = (nx: number, ny: number): void => {
    ensure();
    cur!.nodes.push({ x: nx, y: ny });
  };
  const cubicTo = (c1: Pt, c2: Pt, nx: number, ny: number): void => {
    ensure();
    const a = last();
    if (Math.hypot(c1.x - a.x, c1.y - a.y) > EPS) {
      a.ox = c1.x;
      a.oy = c1.y;
    }
    const n: PNode = { x: nx, y: ny };
    if (Math.hypot(c2.x - nx, c2.y - ny) > EPS) {
      n.ix = c2.x;
      n.iy = c2.y;
    }
    cur!.nodes.push(n);
  };
  while (i < tk.length) {
    const t = tk[i];
    if (typeof t === 'string') {
      cmd = t;
      i++;
      if (cmd === 'z' || cmd === 'Z') {
        if (cur) {
          closeSub(cur);
          x = sx;
          y = sy;
          cur = null;
        }
        lc = lq = null;
        continue;
      }
    } else if (!cmd) throw new Error('Path data must start with a command.');
    const lo = cmd.toLowerCase();
    const n = ARGS[lo];
    if (n === undefined) throw new Error(`Unknown path command "${cmd}".`);
    if (n === 0) {
      // Numbers after Z with no command: nothing to apply them to.
      i++;
      continue;
    }
    const a = tk.slice(i, i + n);
    if (a.length < n || a.some((v) => typeof v !== 'number'))
      throw new Error(`Path command "${cmd}" is missing numbers.`);
    i += n;
    const v = a as number[];
    const rel = cmd !== cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (lo) {
      case 'm':
        x = v[0]! + ox;
        y = v[1]! + oy;
        sx = x;
        sy = y;
        start(x, y);
        // Pairs after the first one are line-tos.
        cmd = rel ? 'l' : 'L';
        lc = lq = null;
        break;
      case 'l':
        x = v[0]! + ox;
        y = v[1]! + oy;
        lineTo(x, y);
        lc = lq = null;
        break;
      case 'h':
        x = v[0]! + ox;
        lineTo(x, y);
        lc = lq = null;
        break;
      case 'v':
        y = v[0]! + oy;
        lineTo(x, y);
        lc = lq = null;
        break;
      case 'c': {
        const c1 = { x: v[0]! + ox, y: v[1]! + oy };
        const c2 = { x: v[2]! + ox, y: v[3]! + oy };
        x = v[4]! + ox;
        y = v[5]! + oy;
        cubicTo(c1, c2, x, y);
        lc = c2;
        lq = null;
        break;
      }
      case 's': {
        const c1 = lc ? { x: 2 * x - lc.x, y: 2 * y - lc.y } : { x, y };
        const c2 = { x: v[0]! + ox, y: v[1]! + oy };
        x = v[2]! + ox;
        y = v[3]! + oy;
        cubicTo(c1, c2, x, y);
        lc = c2;
        lq = null;
        break;
      }
      case 'q':
      case 't': {
        const q: Pt =
          lo === 'q'
            ? { x: v[0]! + ox, y: v[1]! + oy }
            : lq
              ? { x: 2 * x - lq.x, y: 2 * y - lq.y }
              : { x, y };
        const nx = (lo === 'q' ? v[2]! : v[0]!) + ox;
        const ny = (lo === 'q' ? v[3]! : v[1]!) + oy;
        cubicTo(
          { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
          { x: nx + (2 / 3) * (q.x - nx), y: ny + (2 / 3) * (q.y - ny) },
          nx,
          ny,
        );
        x = nx;
        y = ny;
        lq = q;
        lc = null;
        break;
      }
      case 'a': {
        const nx = v[5]! + ox;
        const ny = v[6]! + oy;
        const parts = arcToCubics(x, y, v[0]!, v[1]!, v[2]!, v[3] !== 0, v[4] !== 0, nx, ny);
        for (const [c1, c2, p] of parts) cubicTo(c1, c2, p.x, p.y);
        x = nx;
        y = ny;
        lc = lq = null;
        break;
      }
    }
  }
  for (const s of subs) markSmooth(s);
  return subs.filter((s) => s.nodes.length > 0);
}

/** Z: a last node on top of the first one is the same node. */
function closeSub(s: SubPath): void {
  s.closed = true;
  const first = s.nodes[0]!;
  const lastN = s.nodes[s.nodes.length - 1]!;
  if (
    s.nodes.length > 1 &&
    Math.abs(first.x - lastN.x) < 1e-4 &&
    Math.abs(first.y - lastN.y) < 1e-4
  ) {
    if (lastN.ix !== undefined) {
      first.ix = lastN.ix;
      first.iy = lastN.iy;
    }
    s.nodes.pop();
  }
}

/** Nodes whose two handles point in opposite directions are smooth. */
function markSmooth(s: SubPath): void {
  for (const n of s.nodes) {
    if (n.ix === undefined || n.ox === undefined) continue;
    const ax = n.x - n.ix;
    const ay = n.y - n.iy!;
    const bx = n.ox - n.x;
    const by = n.oy! - n.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < EPS || lb < EPS) continue;
    const cross = (ax * by - ay * bx) / (la * lb);
    const dot = (ax * bx + ay * by) / (la * lb);
    if (Math.abs(cross) < 0.02 && dot > 0) n.smooth = true;
  }
}

// ------------------------------------------------------------------ write

function segment(a: PNode, b: PNode): string {
  const hasOut = a.ox !== undefined && a.oy !== undefined;
  const hasIn = b.ix !== undefined && b.iy !== undefined;
  if (!hasOut && !hasIn) return `L ${f(b.x)} ${f(b.y)}`;
  const c1x = hasOut ? a.ox! : a.x;
  const c1y = hasOut ? a.oy! : a.y;
  const c2x = hasIn ? b.ix! : b.x;
  const c2y = hasIn ? b.iy! : b.y;
  return `C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(b.x)} ${f(b.y)}`;
}

export function serializePathData(subs: SubPath[]): string {
  const out: string[] = [];
  for (const s of subs) {
    if (!s.nodes.length) continue;
    const ns = s.nodes;
    out.push(`M ${f(ns[0]!.x)} ${f(ns[0]!.y)}`);
    for (let i = 1; i < ns.length; i++) out.push(segment(ns[i - 1]!, ns[i]!));
    if (s.closed) {
      const a = ns[ns.length - 1]!;
      const b = ns[0]!;
      if (ns.length > 1 && (a.ox !== undefined || b.ix !== undefined)) out.push(segment(a, b));
      out.push('Z');
    }
  }
  return out.join(' ');
}

// ------------------------------------------------------------------ geometry

/** The four control points of segment i (from node i to the next one). */
export function segmentPoints(s: SubPath, i: number): [Pt, Pt, Pt, Pt] | null {
  const a = s.nodes[i];
  const b = s.nodes[(i + 1) % s.nodes.length];
  if (!a || !b || (i === s.nodes.length - 1 && !s.closed)) return null;
  return [
    { x: a.x, y: a.y },
    a.ox !== undefined ? { x: a.ox, y: a.oy! } : { x: a.x, y: a.y },
    b.ix !== undefined ? { x: b.ix, y: b.iy! } : { x: b.x, y: b.y },
    { x: b.x, y: b.y },
  ];
}

export const segmentCount = (s: SubPath): number =>
  s.closed ? s.nodes.length : Math.max(0, s.nodes.length - 1);

function bez(p: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x,
    y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y,
  };
}

/** The point of the path nearest to p: which sub-path, which segment and where (t 0…1). */
export function nearestOnPath(
  subs: SubPath[],
  p: Pt,
): { sub: number; seg: number; t: number; dist: number; at: Pt } | null {
  let best: { sub: number; seg: number; t: number; dist: number; at: Pt } | null = null;
  subs.forEach((s, si) => {
    for (let i = 0; i < segmentCount(s); i++) {
      const sp = segmentPoints(s, i);
      if (!sp) continue;
      const N = 48;
      let bt = 0;
      let bd = Infinity;
      for (let k = 0; k <= N; k++) {
        const q = bez(sp, k / N);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          bt = k / N;
        }
      }
      // Refine around the best sample.
      let lo = Math.max(0, bt - 1 / N);
      let hi = Math.min(1, bt + 1 / N);
      for (let k = 0; k < 20; k++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        const d1 = Math.hypot(bez(sp, m1).x - p.x, bez(sp, m1).y - p.y);
        const d2 = Math.hypot(bez(sp, m2).x - p.x, bez(sp, m2).y - p.y);
        if (d1 < d2) hi = m2;
        else lo = m1;
      }
      const t = (lo + hi) / 2;
      const at = bez(sp, t);
      const dist = Math.hypot(at.x - p.x, at.y - p.y);
      if (!best || dist < best.dist) best = { sub: si, seg: i, t, dist, at };
    }
  });
  return best;
}

// ------------------------------------------------------------------ edits (in place)

/** Adds a node on segment `seg` at t without changing the shape (de Casteljau split). */
export function insertNode(s: SubPath, seg: number, t: number): number {
  const sp = segmentPoints(s, seg);
  if (!sp) return -1;
  const a = s.nodes[seg]!;
  const bi = (seg + 1) % s.nodes.length;
  const b = s.nodes[bi]!;
  const straight = a.ox === undefined && b.ix === undefined;
  const lerp = (p: Pt, q: Pt): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const [p0, p1, p2, p3] = sp;
  const m = lerp(p0, p3);
  if (straight) {
    s.nodes.splice(seg + 1, 0, { x: m.x, y: m.y });
    return seg + 1;
  }
  const q0 = lerp(p0, p1);
  const q1 = lerp(p1, p2);
  const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const mid = lerp(r0, r1);
  a.ox = q0.x;
  a.oy = q0.y;
  b.ix = q2.x;
  b.iy = q2.y;
  const n: PNode = { x: mid.x, y: mid.y, ix: r0.x, iy: r0.y, ox: r1.x, oy: r1.y, smooth: true };
  s.nodes.splice(seg + 1, 0, n);
  return seg + 1;
}

/** Removes nodes (keys "sub:index"). Sub-paths left with one node go away. */
export function deleteNodes(subs: SubPath[], keys: Set<string>): SubPath[] {
  return subs
    .map((s, si) => ({ ...s, nodes: s.nodes.filter((_, i) => !keys.has(`${si}:${i}`)) }))
    .filter((s) => s.nodes.length >= 2);
}

export function moveNode(n: PNode, dx: number, dy: number): void {
  n.x += dx;
  n.y += dy;
  if (n.ix !== undefined) {
    n.ix += dx;
    n.iy! += dy;
  }
  if (n.ox !== undefined) {
    n.ox += dx;
    n.oy! += dy;
  }
}

/** Drags one handle; on a smooth node the other one turns to stay opposite (its length kept). */
export function moveHandle(n: PNode, which: 'in' | 'out', p: Pt, breakSmooth = false): void {
  if (which === 'in') {
    n.ix = p.x;
    n.iy = p.y;
  } else {
    n.ox = p.x;
    n.oy = p.y;
  }
  if (breakSmooth) n.smooth = false;
  if (!n.smooth) return;
  const other = which === 'in' ? 'out' : 'in';
  const ox = other === 'in' ? n.ix : n.ox;
  const oy = other === 'in' ? n.iy : n.oy;
  const len = ox !== undefined ? Math.hypot(ox - n.x, oy! - n.y) : Math.hypot(p.x - n.x, p.y - n.y);
  const dx = n.x - p.x;
  const dy = n.y - p.y;
  const l = Math.hypot(dx, dy);
  if (l < EPS) return;
  const q = { x: n.x + (dx / l) * len, y: n.y + (dy / l) * len };
  if (other === 'in') {
    n.ix = q.x;
    n.iy = q.y;
  } else {
    n.ox = q.x;
    n.oy = q.y;
  }
}

/** Corner (no handles) or smooth (handles in line, a third of the way to the neighbors). */
export function setNodeType(s: SubPath, i: number, type: 'corner' | 'smooth'): void {
  const n = s.nodes[i];
  if (!n) return;
  if (type === 'corner') {
    delete n.ix;
    delete n.iy;
    delete n.ox;
    delete n.oy;
    n.smooth = false;
    return;
  }
  const len = s.nodes.length;
  const prev = i > 0 ? s.nodes[i - 1] : s.closed ? s.nodes[len - 1] : undefined;
  const next = i < len - 1 ? s.nodes[i + 1] : s.closed ? s.nodes[0] : undefined;
  let tx = (next?.x ?? n.x) - (prev?.x ?? n.x);
  let ty = (next?.y ?? n.y) - (prev?.y ?? n.y);
  const tl = Math.hypot(tx, ty);
  if (tl < EPS) {
    tx = 1;
    ty = 0;
  } else {
    tx /= tl;
    ty /= tl;
  }
  const dp = prev ? Math.hypot(n.x - prev.x, n.y - prev.y) / 3 : 0;
  const dn = next ? Math.hypot(next.x - n.x, next.y - n.y) / 3 : 0;
  if (prev) {
    n.ix = n.x - tx * dp;
    n.iy = n.y - ty * dp;
  }
  if (next) {
    n.ox = n.x + tx * dn;
    n.oy = n.y + ty * dn;
  }
  n.smooth = true;
}

// ------------------------------------------------------------------ shapes as paths

const K = 0.5522847498;

export function rectPathData(x: number, y: number, w: number, h: number, rx = 0, ry = rx): string {
  rx = Math.max(0, Math.min(rx, w / 2));
  ry = Math.max(0, Math.min(ry || rx, h / 2));
  if (!rx || !ry)
    return `M ${f(x)} ${f(y)} L ${f(x + w)} ${f(y)} L ${f(x + w)} ${f(y + h)} L ${f(x)} ${f(y + h)} Z`;
  const kx = rx * K;
  const ky = ry * K;
  return [
    `M ${f(x + rx)} ${f(y)}`,
    `L ${f(x + w - rx)} ${f(y)}`,
    `C ${f(x + w - rx + kx)} ${f(y)} ${f(x + w)} ${f(y + ry - ky)} ${f(x + w)} ${f(y + ry)}`,
    `L ${f(x + w)} ${f(y + h - ry)}`,
    `C ${f(x + w)} ${f(y + h - ry + ky)} ${f(x + w - rx + kx)} ${f(y + h)} ${f(x + w - rx)} ${f(y + h)}`,
    `L ${f(x + rx)} ${f(y + h)}`,
    `C ${f(x + rx - kx)} ${f(y + h)} ${f(x)} ${f(y + h - ry + ky)} ${f(x)} ${f(y + h - ry)}`,
    `L ${f(x)} ${f(y + ry)}`,
    `C ${f(x)} ${f(y + ry - ky)} ${f(x + rx - kx)} ${f(y)} ${f(x + rx)} ${f(y)}`,
    'Z',
  ].join(' ');
}

export function ellipsePathData(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * K;
  const ky = ry * K;
  return [
    `M ${f(cx + rx)} ${f(cy)}`,
    `C ${f(cx + rx)} ${f(cy + ky)} ${f(cx + kx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}`,
    `C ${f(cx - kx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ky)} ${f(cx - rx)} ${f(cy)}`,
    `C ${f(cx - rx)} ${f(cy - ky)} ${f(cx - kx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}`,
    `C ${f(cx + kx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ky)} ${f(cx + rx)} ${f(cy)}`,
    'Z',
  ].join(' ');
}

/** "x,y x,y …" of a polygon / polyline as path data. */
export function pointsPathData(points: string, closed: boolean): string {
  const v = (points.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const pts: string[] = [];
  for (let i = 0; i + 1 < v.length; i += 2) pts.push(`${f(v[i]!)} ${f(v[i + 1]!)}`);
  if (!pts.length) return '';
  return `M ${pts.join(' L ')}${closed ? ' Z' : ''}`;
}
