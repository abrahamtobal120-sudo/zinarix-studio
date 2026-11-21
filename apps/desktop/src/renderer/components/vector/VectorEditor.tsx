import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { api, getDoc, save, setTabViewer, toast } from '../../store';
import { askAgent } from '../Chat';
import { isTypingTarget, toHexColor, uniqueName, type AlignMode, type Handle, type ShapeKind } from '../../../shared/graphics';
import { tg, type KeyG } from '../graphics/graphicsStrings';
import {
  NODE_EDITABLE,
  VectorSession,
  isHidden,
  isLocked,
  kidsOf,
  layerName,
  wrapWidth,
  type Tool,
} from './vectorSession';
import './vector.css';

/**
 * Fase 3B (plan de funciones): design editor for SVG files — shapes, pen, text, images,
 * layers, align / group, colors and gradients, export to PNG / JPG. The SVG stays the file:
 * every change is written into its text model (Code shows it, Ctrl+S saves it).
 */

const FONTS = [
  "'Segoe UI', Arial, sans-serif",
  'Arial, Helvetica, sans-serif',
  "'Trebuchet MS', sans-serif",
  'Verdana, sans-serif',
  'Tahoma, sans-serif',
  "Impact, 'Arial Black', sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Times New Roman', serif",
  "'Palatino Linotype', serif",
  "'Courier New', monospace",
  'Consolas, monospace',
  "'Comic Sans MS', cursive",
];
const fontLabel = (f: string): string => f.split(',')[0]!.replace(/'/g, '');

const TOOLS: { id: Tool; icon: string; tip: KeyG }[] = [
  { id: 'select', icon: '➤', tip: 'toolSelect' },
  { id: 'rect', icon: '▭', tip: 'toolRect' },
  { id: 'ellipse', icon: '◯', tip: 'toolEllipse' },
  { id: 'line', icon: '╱', tip: 'toolLine' },
  { id: 'pen', icon: '✒', tip: 'toolPen' },
  { id: 'text', icon: 'T', tip: 'toolText' },
  { id: 'hand', icon: '✋', tip: 'toolHand' },
];
const SHAPE_KINDS: ShapeKind[] = ['star', 'triangle', 'hexagon', 'arrow', 'heart', 'speech'];
const KEY_TOOL: Record<string, Tool> = { v: 'select', r: 'rect', o: 'ellipse', l: 'line', p: 'pen', t: 'text', h: 'hand' };

export function VectorEditor({ path }: { path: string }) {
  const [, setTick] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [s, setS] = useState<VectorSession | null>(null);
  const [menu, setMenu] = useState<'shapes' | 'export' | 'ai' | null>(null);
  /** null = not decided yet (open unless the editor is narrow). */
  const [layersOpen, setLayersOpen] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    const doc = getDoc(path);
    if (!doc || !stage.current || !host.current) return;
    const session = new VectorSession(path, doc.model, stage.current, host.current, () => setTick((t) => t + 1));
    session.load();
    setS(session);
    const ro = new ResizeObserver(() => {
      if (!session.userView) session.fit();
      else session.bump();
      // Little room (sidebar and chat open): the layers list folds away.
      const w = stage.current?.parentElement?.getBoundingClientRect().width ?? 0;
      if (w && w < 860) setLayersOpen((o) => (o === null ? false : o));
    });
    ro.observe(stage.current);
    // The first layout may not have its size yet.
    requestAnimationFrame(() => session.fit());
    return () => {
      ro.disconnect();
      session.dispose();
    };
  }, [path]);

  useEffect(() => {
    if (!s) return;
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'Space' && s.spaceHand) {
        s.spaceHand = false;
        s.bump();
      }
    };
    window.addEventListener('keyup', up);
    return () => window.removeEventListener('keyup', up);
  }, [s]);

  const onKey = (e: KeyboardEvent) => {
    if (!s) return;
    const mod = e.ctrlKey || e.metaKey;
    if (isTypingTarget(e.target, mod)) return;
    const k = e.key.toLowerCase();
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && k === 's') return stop(), s.flush(), void save(path);
    if (s.nodes) {
      // Editing the points of a path.
      if (mod && k === 'a') return stop(), s.nodeSelectAll();
      if (!mod && (k === 'delete' || k === 'backspace')) return stop(), s.nodeDelete();
      if (!mod && (k === 'escape' || k === 'enter')) return stop(), s.exitNodes();
      const step0 = (e.shiftKey ? 10 : 1) * Math.max(0.1, 1 / s.zoom);
      const nArrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (!mod && nArrows[k]) return stop(), s.nodeNudge(nArrows[k]![0] * step0, nArrows[k]![1] * step0);
    }
    if (mod && k === 'z') return stop(), e.shiftKey ? s.redo() : s.undo();
    if (mod && k === 'y') return stop(), s.redo();
    if (mod && k === 'd') return stop(), s.duplicate();
    if (mod && k === 'c') return stop(), s.copy();
    if (mod && k === 'x') return stop(), s.copy(true);
    if (mod && k === 'v') return stop(), s.paste();
    if (mod && k === 'a') return stop(), s.selectAll();
    if (mod && k === 'g') return stop(), e.shiftKey ? s.ungroup() : s.group();
    if (mod && (e.key === ']' || e.key === '}')) return stop(), s.order(e.shiftKey ? 'front' : 'forward');
    if (mod && (e.key === '[' || e.key === '{')) return stop(), s.order(e.shiftKey ? 'back' : 'backward');
    if (mod && k === '0') return stop(), s.fit();
    if (mod && k === '1') return stop(), s.setZoom(1);
    if (mod && (k === '=' || k === '+')) return stop(), s.zoomAt(1.25);
    if (mod && k === '-') return stop(), s.zoomAt(0.8);
    if (mod) return;
    if (e.code === 'Space') {
      stop();
      if (!s.spaceHand) {
        s.spaceHand = true;
        s.bump();
      }
      return;
    }
    if (k === 'delete' || k === 'backspace') {
      stop();
      if (s.pen) return;
      return s.remove();
    }
    if (k === 'escape') {
      stop();
      if (s.pen) return s.penFinish();
      if (s.sel.length) return s.select([]);
      return s.exitGroup();
    }
    if (k === 'enter') {
      stop();
      if (s.pen) return s.penFinish();
      const one = s.single();
      if (one?.localName === 'text') s.editText(one as SVGTextElement);
      else if (one?.localName === 'g') s.enterGroup(one);
      else if (one && NODE_EDITABLE.has(one.localName)) s.editNodes(one);
      return;
    }
    const arrows: Record<string, [number, number]> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    };
    if (arrows[k]) {
      stop();
      const step = (e.shiftKey ? 10 : 1) * Math.max(0.1, 1 / s.zoom);
      return s.nudge(arrows[k]![0] * step, arrows[k]![1] * step);
    }
    if (k === 'a' && !e.shiftKey) {
      // A: edit the points of the selected shape.
      stop();
      if (s.single()) s.editNodes();
      return;
    }
    if (KEY_TOOL[k]) {
      stop();
      if (s.pen) s.penFinish();
      s.exitNodes();
      s.tool = KEY_TOOL[k]!;
      s.bump();
    }
  };

  const onDrop = (e: DragEvent) => {
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (!f || !s) return;
    e.preventDefault();
    const at = s.toDoc(e.clientX, e.clientY);
    void readImage(f).then((r) => r && s.addImage(r.url, r.w, r.h, at));
  };

  const tool = s?.spaceHand ? 'hand' : (s?.tool ?? 'select');
  return (
    <div className="vd" onKeyDown={onKey}>
      <div className="vd-bar">
        <div className="vd-group">
          {TOOLS.map((x) => (
            <button
              key={x.id}
              className={tool === x.id ? 'on' : ''}
              title={tg(x.tip)}
              onClick={() => {
                if (!s) return;
                if (s.pen) s.penFinish();
                s.tool = x.id;
                s.bump();
                stage.current?.focus();
              }}
            >
              {x.icon}
            </button>
          ))}
          <div className="vd-menu-wrap">
            <button className={menu === 'shapes' ? 'on' : ''} onClick={() => setMenu(menu === 'shapes' ? null : 'shapes')}>
              ★ {tg('shapes')} ▾
            </button>
            {menu === 'shapes' && (
              <div className="vd-menu" onMouseLeave={() => setMenu(null)}>
                {SHAPE_KINDS.map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      s?.addShape(k);
                      setMenu(null);
                    }}
                  >
                    {tg(`shape_${k}` as KeyG)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ImageButton onPick={(r) => s?.addImage(r.url, r.w, r.h)} />
        </div>
        <div className="vd-group">
          <button className={layersOpen !== false ? 'on' : ''} title={tg('layers')} onClick={() => setLayersOpen(layersOpen === false)}>
            ☰
          </button>
          <button disabled={!s?.canUndo()} title={tg('undo')} onClick={() => s?.undo()}>
            ↶
          </button>
          <button disabled={!s?.canRedo()} title={tg('redo')} onClick={() => s?.redo()}>
            ↷
          </button>
        </div>
        <div className="vd-group">
          <button onClick={() => s?.zoomAt(0.8)}>−</button>
          <button className="vd-zoom" onClick={() => s?.setZoom(1)} title="100%">
            {Math.round((s?.zoom ?? 1) * 100)}%
          </button>
          <button onClick={() => s?.zoomAt(1.25)}>+</button>
          <button onClick={() => s?.fit()}>{tg('zoomFit')}</button>
        </div>
        <div className="spacer" />
        <div className="vd-menu-wrap">
          <button className={menu === 'ai' ? 'on' : ''} title={tg('aiEditHint')} onClick={() => setMenu(menu === 'ai' ? null : 'ai')}>
            {tg('aiEdit')}
          </button>
          {menu === 'ai' && <AiBox path={path} session={s} onDone={() => setMenu(null)} />}
        </div>
        <div className="vd-menu-wrap">
          <button className={menu === 'export' ? 'on' : ''} disabled={!s?.root} onClick={() => setMenu(menu === 'export' ? null : 'export')}>
            ⤓ PNG / JPG
          </button>
          {menu === 'export' && s && <ExportBox path={path} session={s} onDone={() => setMenu(null)} />}
        </div>
        <button title={tg('codeHint')} onClick={() => (s?.flush(), setTabViewer(path, undefined))}>
          {'</>'} {tg('code')}
        </button>
        <button className="on" title={tg('save')} onClick={() => (s?.flush(), void save(path))}>
          {tg('save').replace(/ \(.*\)/, '')}
        </button>
      </div>
      {s?.removed ? <div className="vd-note">{tg('removedScripts')}</div> : null}
      <div className="vd-body">
        {s && s.root && layersOpen !== false && <Layers s={s} />}
        <div
          ref={stage}
          className={`vd-stage tool-${tool}`}
          tabIndex={0}
          onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
          onDrop={onDrop}
        >
          <div ref={host} className="vd-host" />
          {s && s.root && <Overlay s={s} />}
          {s?.textEdit && <TextBox s={s} />}
          {s?.error !== null && s?.error !== undefined && (
            <div className="vd-error">
              <p>{tg('broken')}</p>
              <pre>{s.error}</pre>
              <button onClick={() => setTabViewer(path, undefined)}>
                {'</>'} {tg('code')}
              </button>
            </div>
          )}
        </div>
        {s && s.root && <Inspector s={s} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ overlay

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function Overlay({ s }: { s: VectorSession }) {
  const st = (p: { x: number; y: number }) => s.toStage(p);
  const pg = s.page;
  const a = st({ x: pg.x, y: pg.y });
  const b = st({ x: pg.x + pg.w, y: pg.y + pg.h });
  const out: ReactNode[] = [];
  out.push(<rect key="page" className="vd-page" x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} />);
  if (s.hover && !s.sel.includes(s.hover) && s.hover.isConnected) {
    const c = s.corners(s.hover).map(st);
    out.push(<polygon key="hover" className="vd-hover" points={c.map((p) => `${p.x},${p.y}`).join(' ')} />);
  }
  if (s.container && s.container !== s.root && s.container.isConnected) {
    const c = s.corners(s.container as SVGGraphicsElement).map(st);
    out.push(<polygon key="group" className="vd-in-group" points={c.map((p) => `${p.x},${p.y}`).join(' ')} />);
  }
  const sel = s.sel.filter((el) => el.isConnected);
  if (s.nodes && s.nodes.el.isConnected) {
    const m = s.nodes.el.getScreenCTM();
    const r = s.stage.getBoundingClientRect();
    if (m) {
      // The outline of the path, drawn on top so thin or hidden strokes can be edited.
      const t = `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e - r.left} ${m.f - r.top})`;
      out.push(<path key="nout" className="vd-node-outline" d={s.nodes.el.getAttribute('d') ?? ''} transform={t} vectorEffect="non-scaling-stroke" />);
    }
    for (const n of s.nodeView()) {
      for (const [h, w] of [
        [n.i, 'in'],
        [n.o, 'out'],
      ] as const) {
        if (!h) continue;
        out.push(<line key={`nl${n.key}${w}`} className="vd-pen-handle" x1={n.a.x} y1={n.a.y} x2={h.x} y2={h.y} />);
        out.push(<circle key={`nh${n.key}${w}`} className="vd-node-h" data-nh={`${n.key}:${w}`} cx={h.x} cy={h.y} r={4} />);
      }
    }
    for (const n of s.nodeView()) {
      out.push(
        n.smooth ? (
          <circle key={`n${n.key}`} className={`vd-node ${n.on ? 'on' : ''}`} data-n={n.key} cx={n.a.x} cy={n.a.y} r={5} />
        ) : (
          <rect key={`n${n.key}`} className={`vd-node ${n.on ? 'on' : ''}`} data-n={n.key} x={n.a.x - 4.5} y={n.a.y - 4.5} width={9} height={9} />
        ),
      );
    }
  } else if (sel.length && !s.textEdit) {
    let corners: { x: number; y: number }[];
    if (sel.length === 1) corners = s.corners(sel[0]!).map(st);
    else {
      for (const el of sel) {
        const c = s.corners(el).map(st);
        out.push(<polygon key={`o${out.length}`} className="vd-sel-each" points={c.map((p) => `${p.x},${p.y}`).join(' ')} />);
      }
      const bx = s.selBox()!;
      corners = [
        { x: bx.x, y: bx.y },
        { x: bx.x + bx.w, y: bx.y },
        { x: bx.x + bx.w, y: bx.y + bx.h },
        { x: bx.x, y: bx.y + bx.h },
      ].map(st);
    }
    out.push(<polygon key="sel" className="vd-sel" points={corners.map((p) => `${p.x},${p.y}`).join(' ')} />);
    const [nw, ne, se, sw] = corners as [typeof corners[0], typeof corners[0], typeof corners[0], typeof corners[0]];
    const mid = (p: typeof nw, q: typeof nw) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const pos: Record<Handle, typeof nw> = {
      nw,
      n: mid(nw, ne),
      ne,
      e: mid(ne, se),
      se,
      s: mid(se, sw),
      sw,
      w: mid(sw, nw),
    };
    const small = Math.hypot(ne.x - nw.x, ne.y - nw.y) < 24 || Math.hypot(sw.x - nw.x, sw.y - nw.y) < 24;
    // Rotation knob: above the top edge, along the box's own "up".
    const top = pos.n;
    const ux = nw.x - sw.x;
    const uy = nw.y - sw.y;
    const ul = Math.hypot(ux, uy) || 1;
    const knob = { x: top.x + (ux / ul) * 24, y: top.y + (uy / ul) * 24 };
    out.push(<line key="rl" className="vd-rot-line" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} />);
    out.push(<circle key="rot" className="vd-rot" data-h="rot" cx={knob.x} cy={knob.y} r={6} />);
    for (const h of HANDLES) {
      if (small && h.length === 1) continue;
      const p = pos[h];
      out.push(<rect key={h} className={`vd-h vd-h-${h}`} data-h={h} x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2} />);
    }
    if (sel.length === 1) {
      const bx = s.selBox()!;
      const label = `${Math.round(bx.w)} × ${Math.round(bx.h)}`;
      const bot = st({ x: bx.x + bx.w / 2, y: bx.y + bx.h });
      out.push(
        <text key="dim" className="vd-dim" x={bot.x} y={bot.y + 18} textAnchor="middle">
          {label}
        </text>,
      );
    }
  }
  for (const [i, g] of s.guides.entries()) {
    if (g.axis === 'x') {
      const p = st({ x: g.at, y: 0 });
      out.push(<line key={`g${i}`} className="vd-guide" x1={p.x} y1={0} x2={p.x} y2="100%" />);
    } else {
      const p = st({ x: 0, y: g.at });
      out.push(<line key={`g${i}`} className="vd-guide" x1={0} y1={p.y} x2="100%" y2={p.y} />);
    }
  }
  if (s.marquee) {
    const p = st({ x: s.marquee.x, y: s.marquee.y });
    const q = st({ x: s.marquee.x + s.marquee.w, y: s.marquee.y + s.marquee.h });
    out.push(<rect key="mq" className="vd-marquee" x={Math.min(p.x, q.x)} y={Math.min(p.y, q.y)} width={Math.abs(q.x - p.x)} height={Math.abs(q.y - p.y)} />);
  }
  if (s.pen) {
    const toDoc = s.pen.el.getScreenCTM();
    const r = s.stage.getBoundingClientRect();
    const sp = (x: number, y: number) => {
      if (!toDoc) return { x: 0, y: 0 };
      return { x: toDoc.a * x + toDoc.c * y + toDoc.e - r.left, y: toDoc.b * x + toDoc.d * y + toDoc.f - r.top };
    };
    const pts = s.pen.pts.map((p) => ({ a: sp(p.x, p.y), h: p.hx !== undefined ? sp(p.hx, p.hy!) : null }));
    const last = pts[pts.length - 1];
    if (last && s.pen.cursor) {
      const c = st(s.pen.cursor);
      out.push(<line key="pc" className="vd-pen-next" x1={last.a.x} y1={last.a.y} x2={c.x} y2={c.y} />);
    }
    pts.forEach((p, i) => {
      if (p.h) {
        const m = { x: 2 * p.a.x - p.h.x, y: 2 * p.a.y - p.h.y };
        out.push(<line key={`pl${i}`} className="vd-pen-handle" x1={m.x} y1={m.y} x2={p.h.x} y2={p.h.y} />);
        out.push(<circle key={`ph${i}`} className="vd-pen-hdot" cx={p.h.x} cy={p.h.y} r={3} />);
      }
      out.push(<rect key={`pp${i}`} className={i === 0 ? 'vd-pen-pt first' : 'vd-pen-pt'} x={p.a.x - 4} y={p.a.y - 4} width={8} height={8} />);
    });
  }
  return <svg className="vd-overlay">{out}</svg>;
}

// ------------------------------------------------------------------ text box

function TextBox({ s }: { s: VectorSession }) {
  const te = s.textEdit!;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(te.value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [te.el]);
  const cs = getComputedStyle(te.el);
  const m = s.elToDoc(te.el);
  const k = Math.hypot(m[0], m[1]) * s.zoom;
  const font = (parseFloat(cs.fontSize) || 16) * k;
  const x = parseFloat((te.el.getAttribute('x') ?? '0').split(/[\s,]+/)[0]!) || 0;
  const y = parseFloat((te.el.getAttribute('y') ?? '0').split(/[\s,]+/)[0]!) || 0;
  const scr = te.el.getScreenCTM();
  const r = s.stage.getBoundingClientRect();
  const base = scr ? { x: scr.a * x + scr.c * y + scr.e - r.left, y: scr.b * x + scr.d * y + scr.f - r.top } : { x: 0, y: 0 };
  const anchor = cs.textAnchor;
  const wrapW = wrapWidth(te.el) * k;
  const lines = Math.max(1, value.split('\n').length);
  const width = wrapW > 0 ? wrapW + 6 : Math.max(160, ...value.split('\n').map((l) => l.length * font * 0.62 + font));
  const rows = wrapW > 0 ? Math.max(lines, te.el.querySelectorAll('tspan').length || 1) + 1 : lines;
  const left = anchor === 'middle' ? base.x - width / 2 : anchor === 'end' ? base.x - width : base.x;
  return (
    <textarea
      ref={ref}
      className="vd-text-edit"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => s.endText(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          s.endText(te.isNew && !value.trim() ? null : value);
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          s.endText(value);
        }
      }}
      style={{
        left,
        top: base.y - font * 0.92,
        width,
        height: rows * font * 1.15 + 8,
        whiteSpace: wrapW > 0 ? 'pre-wrap' : undefined,
        fontSize: font,
        lineHeight: 1.15,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textAlign: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
        color: toHexColor(cs.fill) ?? undefined,
      }}
      placeholder={tg('newText')}
    />
  );
}

// ------------------------------------------------------------------ layers

function Layers({ s }: { s: VectorSession }) {
  const [renaming, setRenaming] = useState<Element | null>(null);
  const [dragged, setDragged] = useState<SVGGraphicsElement | null>(null);
  const c = s.container!;
  const items = kidsOf(c).reverse();
  return (
    <div className="vd-layers">
      <div className="vd-side-title">{tg('layers')}</div>
      {c !== s.root && (
        <button className="vd-crumb" onClick={() => s.exitGroup()}>
          ← {tg('inGroup', { name: layerName(c) })}
        </button>
      )}
      <div className="vd-layer-list">
        {items.map((el, i) => {
          const on = s.sel.includes(el);
          return (
            <div
              key={i + layerName(el) + el.localName}
              className={`vd-layer ${on ? 'on' : ''} ${isHidden(el) ? 'hidden' : ''}`}
              draggable={renaming !== el}
              onDragStart={(e) => {
                setDragged(el);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => dragged && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragged) return;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                // The list is top-first: dropping on the upper half puts it over the target.
                s.reorder(dragged, el, e.clientY < r.top + r.height / 2);
                setDragged(null);
              }}
              onClick={(e) => {
                if (isLocked(el) || isHidden(el)) return;
                s.select(e.shiftKey ? (on ? s.sel.filter((x) => x !== el) : [...s.sel, el]) : [el]);
              }}
              onDoubleClick={() => (el.localName === 'g' && !isLocked(el) ? s.enterGroup(el) : setRenaming(el))}
              onMouseEnter={() => {
                s.hover = el;
                s.bump();
              }}
              onMouseLeave={() => {
                s.hover = null;
                s.bump();
              }}
              title={tg('rename')}
            >
              <span className="vd-layer-kind">{KIND_ICON[el.localName] ?? '◇'}</span>
              {renaming === el ? (
                <input
                  autoFocus
                  defaultValue={layerName(el)}
                  onBlur={(e) => (s.rename(el, e.target.value), setRenaming(null))}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="vd-layer-name">{layerName(el)}</span>
              )}
              {el.localName === 'g' && <span className="vd-layer-count">{kidsOf(el).length}</span>}
              <button
                className={`vd-ico ${isLocked(el) ? 'set' : ''}`}
                title={tg('lock')}
                onClick={(e) => (e.stopPropagation(), s.toggleLocked(el))}
              >
                {isLocked(el) ? '🔒' : '🔓'}
              </button>
              <button
                className={`vd-ico ${isHidden(el) ? 'set' : ''}`}
                title={tg('hide')}
                onClick={(e) => (e.stopPropagation(), s.toggleHidden(el))}
              >
                {isHidden(el) ? '◌' : '👁'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="vd-hint">{tg('enterGroup')}</p>
    </div>
  );
}

const KIND_ICON: Record<string, string> = {
  rect: '▭',
  circle: '◯',
  ellipse: '⬭',
  line: '╱',
  path: '✒',
  polygon: '⬠',
  polyline: '〰',
  text: 'T',
  g: '▣',
  image: '🖼',
  use: '⧉',
};

// ------------------------------------------------------------------ inspector

const SHAPE_TAGS = 'rect,circle,ellipse,line,path,polygon,polyline,text,tspan,use';

/** What a color change touches: the elements, or the shapes inside the groups. */
function paintTargets(els: SVGGraphicsElement[]): Element[] {
  return els.flatMap((el) => (el.localName === 'g' ? [...el.querySelectorAll(SHAPE_TAGS)].filter((x) => x.localName !== 'tspan') : [el]));
}

function readPaint(el: Element, prop: 'fill' | 'stroke'): string {
  const v = getComputedStyle(el).getPropertyValue(prop).trim();
  if (!v || v === 'none') return 'none';
  if (v.startsWith('url')) return 'url';
  return toHexColor(v) ?? '#000000';
}

function writeStyle(el: Element, prop: string, value: string | null): void {
  const st = (el as SVGElement).style;
  if (value === null) el.removeAttribute(prop);
  else el.setAttribute(prop, value);
  st.removeProperty(prop);
  // A <style> rule of the file beats the attribute: then it goes in the style attribute.
  if (value !== null && getComputedStyle(el).getPropertyValue(prop).trim() !== value) {
    const now = getComputedStyle(el).getPropertyValue(prop).trim();
    if (toHexColor(now) !== toHexColor(value) && now !== value) st.setProperty(prop, value);
  }
  if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
}

function NodePanel({ s }: { s: VectorSession }) {
  const ne = s.nodes!;
  const n = ne.sel.size;
  return (
    <div className="vd-side">
      <section>
        <h4>{tg('nodesTitle')}</h4>
        <p className="vd-hint">{n ? tg('nodesSelected', { n }) : tg('nodesNone')}</p>
        <div className="vd-row vd-wrap">
          <button disabled={!n} title={tg('nodeCorner')} onClick={() => s.nodeType('corner')}>
            ◇ {tg('nodeCornerShort')}
          </button>
          <button disabled={!n} title={tg('nodeSmooth')} onClick={() => s.nodeType('smooth')}>
            ◯ {tg('nodeSmoothShort')}
          </button>
          <button disabled={!n} className="danger" title={tg('nodeDelete')} onClick={() => s.nodeDelete()}>
            🗑
          </button>
        </div>
        <div className="vd-row vd-wrap">
          <button title={tg('nodeCloseHint')} onClick={() => s.nodeToggleClosed()}>
            ⟲ {tg('nodeClose')}
          </button>
          <button title="Ctrl+A" onClick={() => s.nodeSelectAll()}>
            {tg('nodeAll')}
          </button>
        </div>
        <ul className="vd-help">
          <li>{tg('nodeHelpDrag')}</li>
          <li>{tg('nodeHelpAdd')}</li>
          <li>{tg('nodeHelpType')}</li>
          <li>{tg('nodeHelpAlt')}</li>
        </ul>
        <button className="vd-wide on" onClick={() => s.exitNodes()}>
          ✓ {tg('nodeDone')}
        </button>
      </section>
    </div>
  );
}

function Inspector({ s }: { s: VectorSession }) {
  const sel = s.sel.filter((el) => el.isConnected);
  if (s.nodes) return <NodePanel s={s} />;
  if (!sel.length) return <PagePanel s={s} />;
  const one = sel.length === 1 ? sel[0]! : null;
  const box = s.selBox();
  const targets = paintTargets(sel);
  const first = targets[0] ?? sel[0]!;
  const fill = readPaint(first, 'fill');
  const stroke = readPaint(first, 'stroke');
  const sw = parseFloat(getComputedStyle(first).strokeWidth) || 0;
  const opacity = parseFloat(sel[0]!.getAttribute('opacity') ?? '1');
  const grad = fill === 'url' ? s.gradientOf(first) : null;
  const texts = sel.filter((el) => el.localName === 'text') as SVGTextElement[];
  const rect = one?.localName === 'rect' ? one : null;
  const setAll = (prop: string, v: string | null) => {
    for (const el of targets) writeStyle(el, prop, v);
    s.soon();
  };
  return (
    <div className="vd-side">
      <section>
        <h4>{one ? layerName(one) : tg('selected', { n: sel.length })}</h4>
        {box && (
          <div className="vd-grid4">
            <NumField label="X" value={box.x} onSet={(v) => s.setBox({ x: v })} />
            <NumField label="Y" value={box.y} onSet={(v) => s.setBox({ y: v })} />
            <NumField label="W" value={box.w} min={0.1} onSet={(v) => s.setBox({ w: v })} />
            <NumField label="H" value={box.h} min={0.1} onSet={(v) => s.setBox({ h: v })} />
          </div>
        )}
        {one && (
          <div className="vd-row">
            <NumField label={`${tg('rotation')} °`} value={s.angle(one)} onSet={(v) => s.setAngle(v)} />
            <button title={tg('flipH')} onClick={() => s.flip('x')}>⇋</button>
            <button title={tg('flipV')} onClick={() => s.flip('y')}>⇵</button>
          </div>
        )}
        {one && NODE_EDITABLE.has(one.localName) && !isLocked(one) && (
          <button className="vd-wide" title={tg('editNodesHint')} onClick={() => s.editNodes(one)}>
            ✎ {tg('editNodes')}
          </button>
        )}
      </section>
      <section>
        <h4>{tg('fill')}</h4>
        <ColorRow
          value={fill}
          onPick={(v) => {
            setAll('fill', v);
            s.fill = v;
          }}
          onNone={() => setAll('fill', 'none')}
        />
        {grad && (
          <div className="vd-row vd-wrap">
            <span className="vd-dim-label">{tg('gradient')}</span>
            {[...grad.querySelectorAll('stop')].map((st, i) => (
              <input
                key={i}
                type="color"
                value={toHexColor(st.getAttribute('stop-color') ?? getComputedStyle(st).stopColor) ?? '#000000'}
                onChange={(e) => {
                  writeStyle(st, 'stop-color', e.target.value);
                  s.soon();
                }}
              />
            ))}
          </div>
        )}
        <h4>{tg('stroke')}</h4>
        <ColorRow
          value={stroke}
          onPick={(v) => {
            setAll('stroke', v);
            if (sw === 0) setAll('stroke-width', String(Math.max(1, Math.round(s.page.w / 270))));
            s.stroke = v;
          }}
          onNone={() => setAll('stroke', 'none')}
        />
        {stroke !== 'none' && (
          <Slider label={tg('strokeWidth')} min={0} max={Math.max(40, Math.round(s.page.w / 20))} step={0.5} value={sw} onChange={(v) => setAll('stroke-width', String(v))} />
        )}
        <Slider
          label={tg('opacity')}
          min={0}
          max={100}
          step={1}
          value={Math.round((Number.isFinite(opacity) ? opacity : 1) * 100)}
          suffix="%"
          onChange={(v) => {
            for (const el of sel) {
              if (v >= 100) el.removeAttribute('opacity');
              else el.setAttribute('opacity', String(v / 100));
            }
            s.soon();
          }}
        />
        {rect && (
          <Slider
            label={tg('radius')}
            min={0}
            max={Math.round(Math.min(rect.getBBox().width, rect.getBBox().height) / 2)}
            step={1}
            value={parseFloat(rect.getAttribute('rx') ?? '0') || 0}
            onChange={(v) => {
              rect.setAttribute('rx', String(v));
              rect.setAttribute('ry', String(v));
              s.soon();
            }}
          />
        )}
      </section>
      {texts.length > 0 && <TextPanel s={s} texts={texts} />}
      <section>
        <h4>{tg('alignTo')}</h4>
        <div className="vd-row vd-wrap">
          {(
            [
              ['left', '⇤', 'aLeft'],
              ['hcenter', '↔', 'aHCenter'],
              ['right', '⇥', 'aRight'],
              ['top', '⤒', 'aTop'],
              ['vcenter', '↕', 'aVCenter'],
              ['bottom', '⤓', 'aBottom'],
            ] as [AlignMode, string, KeyG][]
          ).map(([m, icon, tip]) => (
            <button key={m} title={tg(tip)} onClick={() => s.align(m)}>
              {icon}
            </button>
          ))}
          <button title={tg('distH')} disabled={sel.length < 3} onClick={() => s.distribute('x')}>
            ⫼
          </button>
          <button title={tg('distV')} disabled={sel.length < 3} onClick={() => s.distribute('y')}>
            ≡
          </button>
        </div>
        <p className="vd-hint">{tg('toPage')}</p>
        <h4>{tg('arrange')}</h4>
        <div className="vd-row vd-wrap">
          <button title={tg('front')} onClick={() => s.order('front')}>⇈</button>
          <button title={tg('forward')} onClick={() => s.order('forward')}>↑</button>
          <button title={tg('backward')} onClick={() => s.order('backward')}>↓</button>
          <button title={tg('back')} onClick={() => s.order('back')}>⇊</button>
          <button title={tg('group')} disabled={sel.length < 2} onClick={() => s.group()}>▣</button>
          <button title={tg('ungroup')} disabled={!sel.some((x) => x.localName === 'g')} onClick={() => s.ungroup()}>▢</button>
          <button title={tg('duplicate')} onClick={() => s.duplicate()}>⧉</button>
          <button title={tg('delete')} className="danger" onClick={() => s.remove()}>🗑</button>
        </div>
      </section>
    </div>
  );
}

function TextPanel({ s, texts }: { s: VectorSession; texts: SVGTextElement[] }) {
  const t0 = texts[0]!;
  const cs = getComputedStyle(t0);
  const family = t0.getAttribute('font-family') ?? cs.fontFamily;
  const size = parseFloat(t0.getAttribute('font-size') ?? cs.fontSize) || 16;
  const bold = Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold';
  const italic = cs.fontStyle === 'italic';
  const anchor = cs.textAnchor;
  const spacing = parseFloat(t0.getAttribute('letter-spacing') ?? '0') || 0;
  const set = (prop: string, v: string | null) => {
    for (const el of texts) {
      writeStyle(el, prop, v);
      // tspans with their own value would hide the change.
      for (const sp of el.querySelectorAll('tspan')) if (sp.getAttribute(prop) !== null) sp.removeAttribute(prop);
      // A wider font changes where the lines break.
      s.reflow(el);
    }
    s.soon();
  };
  const ww = texts.length === 1 ? wrapWidth(t0) : 0;
  const known = FONTS.find((f) => fontLabel(f).toLowerCase() === fontLabel(family).toLowerCase());
  return (
    <section>
      <h4>{tg('textSec')}</h4>
      {texts.length === 1 && (
        <button className="vd-wide" onClick={() => s.editText(t0)}>
          ✎ {tg('content')}
        </button>
      )}
      <label className="vd-field">
        <span>{tg('font')}</span>
        <select value={known ?? family} onChange={(e) => set('font-family', e.target.value)}>
          {!known && <option value={family}>{fontLabel(family)}</option>}
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {fontLabel(f)}
            </option>
          ))}
        </select>
      </label>
      <div className="vd-row">
        <NumField label={tg('fontSize')} value={size} min={1} onSet={(v) => set('font-size', String(v))} />
        <button className={bold ? 'on' : ''} title={tg('bold')} onClick={() => set('font-weight', bold ? '400' : '700')}>
          <b>B</b>
        </button>
        <button className={italic ? 'on' : ''} title={tg('italic')} onClick={() => set('font-style', italic ? null : 'italic')}>
          <i>I</i>
        </button>
      </div>
      <div className="vd-row">
        {(
          [
            ['start', '⯇', 'alignLeft'],
            ['middle', '≡', 'alignCenter'],
            ['end', '⯈', 'alignRight'],
          ] as [string, string, KeyG][]
        ).map(([a, icon, tip]) => (
          <button key={a} className={anchor === a ? 'on' : ''} title={tg(tip)} onClick={() => set('text-anchor', a)}>
            {icon}
          </button>
        ))}
      </div>
      <Slider label={tg('spacing')} min={-10} max={Math.max(40, Math.round(size))} step={0.5} value={spacing} onChange={(v) => set('letter-spacing', v ? String(v) : null)} />
      {texts.length === 1 &&
        (ww > 0 ? (
          <div className="vd-row">
            <NumField label={tg('wrapWidth')} value={ww} min={1} onSet={(v) => s.setWrap(t0, v)} />
            <button title={tg('wrapOffHint')} onClick={() => s.setWrap(t0, null)}>
              {tg('wrapOff')}
            </button>
          </div>
        ) : (
          <button
            className="vd-wide"
            title={tg('wrapOnHint')}
            onClick={() => s.setWrap(t0, Math.max(size * 6, Math.min(s.localBox(t0).w, s.page.w * 0.8)))}
          >
            ↵ {tg('wrapOn')}
          </button>
        ))}
    </section>
  );
}

function PagePanel({ s }: { s: VectorSession }) {
  const bg = s.root ? kidsOf(s.root).find((k) => k.localName === 'rect' && isFullPage(s, k)) : undefined;
  return (
    <div className="vd-side">
      <section>
        <h4>{tg('page')}</h4>
        <div className="vd-grid4">
          <NumField label="W" value={s.page.w} min={1} onSet={(v) => s.setPageSize(v, s.page.h)} />
          <NumField label="H" value={s.page.h} min={1} onSet={(v) => s.setPageSize(s.page.w, v)} />
        </div>
        {bg && (
          <>
            <h4>{tg('background')}</h4>
            <ColorRow
              value={readPaint(bg, 'fill')}
              onPick={(v) => {
                writeStyle(bg, 'fill', v);
                s.soon();
              }}
              onNone={() => {
                writeStyle(bg, 'fill', 'none');
                s.soon();
              }}
            />
          </>
        )}
        <p className="vd-hint">{tg('nothing')}</p>
      </section>
    </div>
  );
}

function isFullPage(s: VectorSession, el: SVGGraphicsElement): boolean {
  const b = s.docBox(el);
  return Math.abs(b.x - s.page.x) < 1 && Math.abs(b.y - s.page.y) < 1 && Math.abs(b.w - s.page.w) < 1 && Math.abs(b.h - s.page.h) < 1;
}

// ------------------------------------------------------------------ small controls

function ColorRow({ value, onPick, onNone }: { value: string; onPick: (v: string) => void; onNone: () => void }) {
  return (
    <div className="vd-row">
      <input type="color" value={value.startsWith('#') ? value : '#000000'} onChange={(e) => onPick(e.target.value)} />
      <input
        className="vd-hex"
        key={value}
        defaultValue={value === 'none' ? '' : value === 'url' ? tg('gradient') : value}
        placeholder={tg('none_')}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const v = toHexColor(e.target.value);
          if (v && v !== value) onPick(v);
        }}
      />
      <button className={value === 'none' ? 'on' : ''} title={tg('none_')} onClick={onNone}>
        ⌀
      </button>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  suffix = '',
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="vd-slider">
      <span>{label}</span>
      <span className="vd-slider-val">
        {Math.round(value * 10) / 10}
        {suffix}
      </span>
      <input type="range" min={min} max={Math.max(max, value)} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function NumField({ label, value, min, onSet }: { label: string; value: number; min?: number; onSet: (v: number) => void }) {
  const shown = String(Math.round(value * 100) / 100);
  return (
    <label className="vd-num">
      <span>{label}</span>
      <input
        key={shown}
        defaultValue={shown}
        inputMode="decimal"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(v) && (min === undefined || v >= min) && String(v) !== shown) onSet(v);
        }}
      />
    </label>
  );
}

// ------------------------------------------------------------------ image, export, AI

async function readImage(f: File): Promise<{ url: string; w: number; h: number } | null> {
  if (f.size > 25 * 1024 * 1024) {
    toast(`${f.name}: > 25 MB`);
    return null;
  }
  const url = await new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(f);
  });
  const img = new Image();
  img.src = url;
  await img.decode();
  return { url, w: img.naturalWidth || 100, h: img.naturalHeight || 100 };
}

function ImageButton({ onPick }: { onPick: (r: { url: string; w: number; h: number }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button title={tg('insertImageHint')} onClick={() => input.current?.click()}>
        🖼 {tg('insertImage')}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void readImage(f).then((r) => r && onPick(r)).catch((err: unknown) => toast(String(err)));
        }}
      />
    </>
  );
}

/** Draws the design into a canvas and writes it next to the SVG. */
export async function exportDesign(
  path: string,
  svg: string,
  page: { w: number; h: number },
  format: 'png' | 'jpg',
  k: number,
  transparent: boolean,
): Promise<string> {
  const w = Math.max(1, Math.round(page.w * k));
  const h = Math.max(1, Math.round(page.h * k));
  if (w * h > 8192 * 8192) throw new Error('max 8192 × 8192 px');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    if (format === 'jpg' || !transparent) {
      g.fillStyle = 'white';
      g.fillRect(0, 0, w, h);
    }
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92));
    if (!blob) throw new Error('canvas');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const base = path.slice(dir.length).replace(/\.svg$/i, '') + (k === 1 ? '' : `@${k}x`);
    const files = new Set(await api().workspace.listFiles().catch(() => [] as string[]));
    const name = uniqueName(base, format, (n) => files.has(dir + n));
    await api().workspace.writeBytes(dir + name, bytes);
    return dir + name;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ExportBox({ path, session, onDone }: { path: string; session: VectorSession; onDone: () => void }) {
  const [k, setK] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async (format: 'png' | 'jpg') => {
    setBusy(true);
    try {
      session.flush();
      const out = await exportDesign(path, session.serialize(), session.page, format, k, transparent);
      toast(tg('exported', { name: out }));
      onDone();
    } catch (e) {
      toast(tg('exportFailed', { err: String((e as Error).message ?? e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vd-menu vd-pop right">
      <div className="vd-row">
        <span className="vd-dim-label">{tg('scale')}</span>
        {[0.5, 1, 2, 3, 4].map((x) => (
          <button key={x} className={k === x ? 'on' : ''} onClick={() => setK(x)}>
            {x}×
          </button>
        ))}
      </div>
      <p className="vd-hint">
        {Math.round(session.page.w * k)} × {Math.round(session.page.h * k)} px
      </p>
      <label className="vd-check">
        <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> {tg('transparent')}
      </label>
      <div className="vd-row">
        <button disabled={busy} className="on" onClick={() => void go('png')}>
          {tg('exportPng')}
        </button>
        <button disabled={busy} onClick={() => void go('jpg')}>
          {tg('exportJpg')}
        </button>
      </div>
    </div>
  );
}

function AiBox({ path, session, onDone }: { path: string; session: VectorSession | null; onDone: () => void }) {
  const [text, setText] = useState('');
  const go = async () => {
    const want = text.trim();
    if (!want) return toast(tg('aiNeedText'));
    session?.flush();
    // The agent reads the file from disk: what is on screen has to be there.
    await save(path).catch(() => undefined);
    askAgent(
      `Cambia el diseño ${path} (un SVG editable que el usuario tiene abierto en el editor de diseño): ${want}\n\n` +
        'Lee el archivo, haz el cambio y guárdalo en el mismo archivo. Mantén el diseño editable: texto como <text>, partes con data-name, sin scripts ni imágenes de internet. ' +
        'Al terminar revisa cómo se ve con svg_render y corrige lo que se vea mal.',
    );
    onDone();
  };
  return (
    <div className="vd-menu vd-pop right vd-ai">
      <label className="vd-field">
        <span>{tg('aiEditAsk')}</span>
        <textarea
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void go();
            }
          }}
        />
      </label>
      <button className="on" onClick={() => void go()}>
        {tg('aiEdit')}
      </button>
    </div>
  );
}

