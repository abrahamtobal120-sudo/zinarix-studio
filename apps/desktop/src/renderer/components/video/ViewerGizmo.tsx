import { useRef, useState } from 'react';
import type { Clip, VideoProject } from '../../../shared/video';
import {
  compositeOrder,
  editTransformAt,
  mediaOf,
  transformAt,
  visualAt,
  visualClipsAt,
} from '../../../shared/video';
import { layerPlacement, type LayerPlacement } from '../../../shared/videoPreview';
import { tv } from './strings';
import { commit, commitMerged, getV, setV, useV } from './videoStore';

/**
 * Move and resize pictures right in the viewer: click a picture or video on the frame to select
 * it, drag it to move it, drag the corner to change its size. Uses the same placement maths as
 * the player and the export (shared/videoPreview.ts), and writes the clip's transform (or a
 * keyframe when that property is animated) as one undo step per drag.
 */

interface Hit {
  clip: Clip;
  pl: LayerPlacement;
}

/** Pictures drawn at time t, top layer first (titles are left to their own controls). */
function layersAt(p: VideoProject, t: number): Hit[] {
  const out: Hit[] = [];
  for (const track of compositeOrder(p)) {
    if (track.hidden || track.locked) continue;
    for (const c of visualClipsAt(p, track.id, t)) {
      if (c.text || c.compound) continue;
      const m = mediaOf(p, c.mediaId);
      if (!m || m.missing || !(m.hasVideo || m.kind === 'image') || !m.width || !m.height) continue;
      const look = visualAt(p, c, t);
      if (!look) continue;
      const pl = layerPlacement(c, t, look, p.width, p.height, m.width, m.height);
      if (pl) out.push({ clip: c, pl });
    }
  }
  return out.reverse();
}

/** Whether frame point (x, y) falls inside a placed picture (its rotation included). */
function inside(pl: LayerPlacement, x: number, y: number): boolean {
  const a = (-pl.rotation * Math.PI) / 180;
  const dx = x - pl.cx;
  const dy = y - pl.cy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(rx) <= pl.dw / 2 && Math.abs(ry) <= pl.dh / 2;
}

type Drag = {
  id: string;
  mode: 'move' | 'scale';
  t: number;
  /** Pointer at the start, in frame pixels. */
  px: number;
  py: number;
  x0: number;
  y0: number;
  s0: number;
  /** Centre of the picture, frame pixels (scaling is about it). */
  cx: number;
  cy: number;
  first: boolean;
};

export function ViewerGizmo({ w, h }: { w: number; h: number }) {
  const project = useV((s) => s.project);
  const playhead = useV((s) => s.playhead);
  const playing = useV((s) => s.playing);
  const selection = useV((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  if (!w || !h || playing) return null;
  const k = w / project.width;
  const layers = layersAt(project, playhead);
  const sel = selection.length === 1 ? layers.find((l) => l.clip.id === selection[0]) : undefined;

  /** Frame pixels of a pointer event. */
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const start = (e: React.PointerEvent, hit: Hit, mode: Drag['mode']) => {
    const { x, y } = at(e);
    const tr = transformAt(hit.clip, playhead);
    drag.current = {
      id: hit.clip.id,
      mode,
      t: playhead,
      px: x,
      py: y,
      x0: tr.x,
      y0: tr.y,
      s0: tr.scale,
      cx: hit.pl.cx,
      cy: hit.pl.cy,
      first: true,
    };
    ref.current?.setPointerCapture(e.pointerId);
    setDragging(true);
    e.stopPropagation();
    e.preventDefault();
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = at(e);
    const hit =
      (sel && inside(sel.pl, x, y) ? sel : undefined) ?? layers.find((l) => inside(l.pl, x, y));
    if (!hit) return;
    if (!getV().selection.includes(hit.clip.id)) setV({ selection: [hit.clip.id] });
    start(e, hit, 'move');
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = at(e);
    const p = getV().project;
    let patch: { x?: number; y?: number; scale?: number };
    if (d.mode === 'move') {
      let nx = d.x0 + (x - d.px) / p.width;
      let ny = d.y0 + (y - d.py) / p.height;
      // Shift: only along one axis. Snap to the centre lines.
      if (e.shiftKey) {
        if (Math.abs(x - d.px) > Math.abs(y - d.py)) ny = d.y0;
        else nx = d.x0;
      }
      if (Math.abs(nx) < 0.01) nx = 0;
      if (Math.abs(ny) < 0.01) ny = 0;
      patch = { x: Math.round(nx * 1000) / 1000, y: Math.round(ny * 1000) / 1000 };
    } else {
      const r0 = Math.hypot(d.px - d.cx, d.py - d.cy) || 1;
      const r1 = Math.hypot(x - d.cx, y - d.cy);
      const s = Math.min(20, Math.max(0.02, (d.s0 * r1) / r0));
      patch = { scale: Math.round(s * 1000) / 1000 };
    }
    const next = editTransformAt(p, d.id, patch, d.t);
    const label = `${tv('viewerMove')} ${d.id}`;
    if (d.first) commit(next, label);
    else commitMerged(next, label);
    d.first = false;
  };

  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    ref.current?.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={ref}
      className={`vs-gizmo-layer${dragging ? ' dragging' : ''}`}
      style={{ width: w, height: h, cursor: dragging ? 'grabbing' : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {sel && (
        <div
          className="vs-gizmo"
          title={tv('viewerMove')}
          style={{
            left: (sel.pl.cx - sel.pl.dw / 2) * k,
            top: (sel.pl.cy - sel.pl.dh / 2) * k,
            width: sel.pl.dw * k,
            height: sel.pl.dh * k,
            transform: sel.pl.rotation ? `rotate(${sel.pl.rotation}deg)` : undefined,
          }}
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <span
              key={corner}
              className={`vs-gizmo-h ${corner}`}
              onPointerDown={(e) => e.button === 0 && start(e, sel, 'scale')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
