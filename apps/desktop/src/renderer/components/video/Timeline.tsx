import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Clip, MediaItem, Track, VideoProject } from '../../../shared/video';
import {
  addMarker,
  addTrack,
  clipDur,
  canDetachAudio,
  clipEnd,
  detachAudio,
  keyTimes,
  speedOf,
  mediaOf,
  moveClips,
  projectDuration,
  removeClips,
  removeTrack,
  snap,
  snapPoints,
  splitAt,
  toFrame,
  trimClip,
  updateTrack,
} from '../../../shared/video';
import { rampGroup } from '../../../shared/videoRamp';
import { confirmDialog } from '../../confirm';
import { api, toast } from '../../store';
import { Icon, type IconName } from '../Icon';
import { MEDIA_DRAG } from './MediaLibrary';
import { tv } from './strings';
import { transitionLabel } from './FxPanels';
import {
  addToTimeline,
  commit,
  getV,
  holdEscape,
  importPaths,
  seek,
  setV,
  useV,
  vPrompt,
} from './videoStore';

const HEAD_W = 156;
const RULER_H = 28;
const ROW_H = { video: 66, audio: 50 } as const;
const MIN_ZOOM = 2;
const MAX_ZOOM = 1200;
/** Snapping reach in pixels. */
const SNAP_PX = 8;

type Drag =
  | {
      kind: 'move';
      ids: Set<string>;
      x0: number;
      grabTrack: string;
      delta: number;
      shift: number;
      valid: boolean;
    }
  | { kind: 'trim'; id: string; edge: 'left' | 'right'; to: number }
  | { kind: 'scrub' };

// ---------------- edit actions (also used by the keyboard) ----------------

export function splitAtPlayhead(): void {
  const s = getV();
  const sel = new Set(s.selection);
  const { project, created } = splitAt(s.project, s.playhead, sel.size ? sel : undefined);
  if (!created.length) return toast(tv('nothingToSplit'));
  commit(project, tv('split'));
}

export function deleteSelection(ripple: boolean): void {
  const s = getV();
  if (!s.selection.length) return;
  const next = removeClips(s.project, new Set(s.selection), ripple);
  if (next === s.project) return toast(tv('locked'));
  commit(next, ripple ? tv('rippleDelete') : tv('delete'));
  setV({ selection: [] });
}

/** "Separar audio": the selected video clips (or the one under the playhead) lose their sound to an audio track. */
export function detachSelectedAudio(): void {
  const s = getV();
  const p = s.project;
  let ids = s.selection.filter((id) =>
    canDetachAudio(
      p,
      p.clips.find((c) => c.id === id),
    ),
  );
  if (!ids.length && !s.selection.length)
    ids = p.clips
      .filter((c) => c.start <= s.playhead && clipEnd(c) > s.playhead && canDetachAudio(p, c))
      .map((c) => c.id);
  if (!ids.length) return toast(tv('detachAudioNone'));
  const r = detachAudio(p, ids);
  if (!r.created.length) return toast(tv('detachAudioNone'));
  commit(r.project, tv('detachAudio').replace(/\s*\(.*\)$/, ''));
  setV({ selection: [...ids, ...r.created] });
  toast(tv('detachAudioDone'));
}

export function addMarkerAtPlayhead(): void {
  const s = getV();
  commit(addMarker(s.project, s.playhead, `${s.project.markers.length + 1}`), tv('marker'));
}

export function setInOut(which: 'in' | 'out'): void {
  const s = getV();
  const p = s.project;
  if (which === 'in')
    commit(
      {
        ...p,
        inPoint: s.playhead,
        outPoint: p.outPoint != null && p.outPoint <= s.playhead ? null : p.outPoint,
      },
      tv('setIn'),
    );
  else
    commit(
      {
        ...p,
        outPoint: s.playhead,
        inPoint: p.inPoint != null && p.inPoint >= s.playhead ? null : p.inPoint,
      },
      tv('setOut'),
    );
}

export function zoomBy(factor: number): void {
  setV((s) => ({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.zoom * factor)) }));
}

let fitRequest: (() => void) | null = null;
export function zoomToFit(): void {
  fitRequest?.();
}

// ---------------- helpers ----------------

/** Ruler step (seconds) so labels are at least ~90 px apart. */
function rulerStep(zoom: number, fps: number): number {
  const steps = [
    1 / fps,
    2 / fps,
    5 / fps,
    0.5,
    1,
    2,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600,
    900,
    1800,
    3600,
  ];
  return steps.find((s) => s * zoom >= 90) ?? 3600;
}

function rulerLabel(t: number, step: number, fps: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  if (step >= 1) return base;
  return `${base}:${String(Math.round((t % 1) * fps)).padStart(2, '0')}`;
}

function sameKind(p: VideoProject, trackId: string): Track[] {
  const k = p.tracks.find((t) => t.id === trackId)?.kind;
  return p.tracks.filter((t) => t.kind === k);
}

// ---------------- component ----------------

export function Timeline() {
  const project = useV((s) => s.project);
  const zoom = useV((s) => s.zoom);
  const selection = useV((s) => s.selection);
  const scroll = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; clip: Clip } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const duration = projectDuration(project);
  const contentW = Math.max(view.width - HEAD_W, (duration + Math.max(30, duration * 0.25)) * zoom);
  const sel = useMemo(() => new Set(selection), [selection]);

  // What the timeline shows: the project, or the edit being dragged.
  const preview = useMemo<VideoProject>(() => {
    if (!drag) return project;
    if (drag.kind === 'move')
      return moveClips(project, drag.ids, drag.delta, drag.shift) ?? project;
    if (drag.kind === 'trim') return trimClip(project, drag.id, drag.edge, drag.to);
    return project;
  }, [project, drag]);

  const onScroll = () => {
    const el = scroll.current;
    if (el) setView({ left: el.scrollLeft, width: el.clientWidth });
  };
  useLayoutEffect(() => {
    onScroll();
    const el = scroll.current;
    if (!el) return;
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fitRequest = () => {
      const el = scroll.current;
      const d = projectDuration(getV().project);
      if (!el || !d) return;
      setV({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (el.clientWidth - HEAD_W - 40) / d)) });
      el.scrollLeft = 0;
    };
    return () => {
      fitRequest = null;
    };
  }, []);

  // Ctrl + wheel zooms around the pointer; Shift + wheel scrolls sideways.
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        if (e.shiftKey) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
        return;
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - HEAD_W;
      const z0 = getV().zoom;
      const t = (el.scrollLeft + x) / z0;
      const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z0 * Math.pow(1.0015, -e.deltaY)));
      setV({ zoom: z1 });
      requestAnimationFrame(() => (el.scrollLeft = Math.max(0, t * z1 - x)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the playhead in view while playing.
  useEffect(() => {
    let raf = 0;
    const follow = () => {
      const s = getV();
      const el = scroll.current;
      if (el && s.playing) {
        const x = s.playhead * s.zoom;
        const w = el.clientWidth - HEAD_W;
        if (x < el.scrollLeft || x > el.scrollLeft + w - 40)
          el.scrollLeft = Math.max(0, x - w * 0.1);
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** Timeline time at a viewport x. */
  const timeAt = (clientX: number): number => {
    const el = scroll.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - HEAD_W + el.scrollLeft) / getV().zoom);
  };
  const snapTime = (
    t: number,
    ignore: ReadonlySet<string> = new Set(),
    withPlayhead = true,
  ): number => {
    const s = getV();
    if (!s.snap) return toFrame(t, s.project.fps);
    const pts = snapPoints(s.project, s.playhead, ignore).filter(
      (x) => withPlayhead || x !== s.playhead,
    );
    return snap(t, pts, SNAP_PX / s.zoom) ?? toFrame(t, s.project.fps);
  };

  const startScrub = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setV({ playing: false });
    seek(snapTime(timeAt(e.clientX), new Set(), false));
    setDrag({ kind: 'scrub' });
    const move = (ev: MouseEvent) => seek(snapTime(timeAt(ev.clientX), new Set(), false));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startClipDrag = (e: React.MouseEvent, c: Clip, edge: 'left' | 'right' | null) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    const s = getV();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids = new Set(s.selection);
    if (additive) {
      if (ids.has(c.id)) ids.delete(c.id);
      else ids.add(c.id);
      setV({ selection: [...ids] });
      return;
    }
    if (!ids.has(c.id) || edge) ids = new Set([c.id]);
    // Fase 4B: a speed ramp moves as one clip (its edges still trim the outer steps).
    if (c.ramp && !edge && ids.size === 1)
      ids = new Set(rampGroup(s.project, c.id).map((x) => x.id));
    setV({ selection: [...ids] });
    if (s.project.tracks.find((t) => t.id === c.trackId)?.locked) return;
    const x0 = e.clientX;
    let moved = false;
    if (edge) {
      setDrag({ kind: 'trim', id: c.id, edge, to: edge === 'left' ? c.start : clipEnd(c) });
    }
    const move = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3 && !edge) {
        const under = trackUnder(ev.clientX, ev.clientY);
        if (!under || under === c.trackId) return;
      }
      moved = true;
      const p = getV().project;
      if (edge) {
        const to = snapTime(timeAt(ev.clientX), new Set([c.id]));
        setDrag({ kind: 'trim', id: c.id, edge, to });
        return;
      }
      // Move: the grabbed clip's edges snap; the group follows.
      const raw = (ev.clientX - x0) / getV().zoom;
      let delta = raw;
      if (getV().snap) {
        const pts = snapPoints(p, getV().playhead, ids);
        const reach = SNAP_PX / getV().zoom;
        let best: number | null = null;
        for (const id of ids) {
          const k = p.clips.find((x) => x.id === id);
          if (!k) continue;
          for (const edgeT of [k.start + raw, clipEnd(k) + raw]) {
            const sn = snap(edgeT, pts, reach);
            if (sn != null && (best == null || Math.abs(sn - edgeT) < Math.abs(best)))
              best = sn - edgeT;
          }
        }
        if (best != null) delta = raw + best;
      }
      const minStart = Math.min(
        ...[...ids].map((id) => p.clips.find((x) => x.id === id)?.start ?? 0),
      );
      delta = Math.max(-minStart, delta);
      const kinds = sameKind(p, c.trackId);
      const under = trackUnder(ev.clientX, ev.clientY);
      const prev = dragRef.current;
      let shift = prev?.kind === 'move' ? prev.shift : 0;
      if (under) {
        const idx = kinds.findIndex((t) => t.id === under);
        if (idx >= 0) shift = idx - kinds.findIndex((t) => t.id === c.trackId);
      }
      const valid = moveClips(p, ids, delta, shift) != null;
      setDrag({ kind: 'move', ids, x0, grabTrack: c.trackId, delta, shift, valid });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const d = dragRef.current;
      setDrag(null);
      if (!moved || !d) return;
      const p = getV().project;
      if (d.kind === 'trim') commit(trimClip(p, d.id, d.edge, d.to), 'Recortar');
      if (d.kind === 'move') {
        const next = moveClips(p, d.ids, d.delta, d.shift);
        if (next) commit(next, 'Mover');
        else toast(tv('noRoom'));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Track id of the lane under the pointer. */
  const trackUnder = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const id = (el as HTMLElement).dataset?.track;
      if (id) return id;
    }
    return null;
  };

  const onLaneDrop = (e: React.DragEvent, track: Track) => {
    const id = e.dataTransfer.getData(MEDIA_DRAG);
    const start = snapTime(timeAt(e.clientX));
    if (id) {
      e.preventDefault();
      e.stopPropagation();
      const m = mediaOf(getV().project, id);
      if (m) addToTimeline(m, { trackId: track.id, start });
      return;
    }
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      e.stopPropagation();
      const paths = [...e.dataTransfer.files].map((f) => api().app.pathForFile(f)).filter(Boolean);
      void importPaths(paths).then((items) => {
        let at = start;
        for (const m of items) {
          addToTimeline(m, { trackId: track.id, start: at });
          at += m.kind === 'image' ? 5 : m.duration;
        }
      });
    }
  };

  // Only the clips in (or near) the visible range are drawn.
  const t0 = Math.max(0, view.left / zoom - 2);
  const t1 = (view.left + view.width) / zoom + 2;
  const dragInvalid = drag?.kind === 'move' && !drag.valid;

  return (
    <div className="vs-timeline" onMouseDown={() => setMenu(null)}>
      <Toolbar />
      <div className="vs-tl-scroll" ref={scroll} onScroll={onScroll}>
        <div className="vs-tl-content" style={{ width: HEAD_W + contentW }}>
          <div className="vs-tl-row vs-tl-ruler-row" style={{ height: RULER_H }}>
            <div className="vs-tl-corner" style={{ width: HEAD_W }}>
              <TrackAdders />
            </div>
            <Ruler
              project={project}
              zoom={zoom}
              width={contentW}
              from={t0}
              to={t1}
              onMouseDown={startScrub}
            />
          </div>
          {preview.tracks.map((track) => (
            <div
              key={track.id}
              className={`vs-tl-row vs-${track.kind}`}
              style={{ height: ROW_H[track.kind] }}
            >
              <TrackHead track={track} project={project} />
              <div
                className={`vs-lane ${track.locked ? 'vs-locked' : ''} ${track.hidden ? 'vs-hidden' : ''}`}
                data-track={track.id}
                style={{ width: contentW }}
                onMouseDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  setV({ selection: [] });
                  startScrub(e);
                }}
                onDragOver={(e) => {
                  if (
                    e.dataTransfer.types.includes(MEDIA_DRAG) ||
                    e.dataTransfer.types.includes('Files')
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                  }
                }}
                onDrop={(e) => onLaneDrop(e, track)}
              >
                {preview.clips
                  .filter((c) => c.trackId === track.id && clipEnd(c) >= t0 && c.start <= t1)
                  .map((c) => (
                    <ClipView
                      key={c.id}
                      clip={c}
                      media={mediaOf(preview, c.mediaId)}
                      track={track}
                      zoom={zoom}
                      selected={sel.has(c.id)}
                      invalid={dragInvalid && drag.ids.has(c.id)}
                      view={{ t0, t1 }}
                      onDown={startClipDrag}
                      onMenu={(e) => {
                        e.preventDefault();
                        if (!sel.has(c.id)) setV({ selection: [c.id] });
                        setMenu({ x: e.clientX, y: e.clientY, clip: c });
                      }}
                    />
                  ))}
              </div>
            </div>
          ))}
          <InOutShade project={project} zoom={zoom} scrollLeft={view.left} />
          <Playhead zoom={zoom} scrollLeft={view.left} />
          {drag?.kind === 'trim' && drag.to * zoom >= view.left && (
            <SnapLine x={HEAD_W + drag.to * zoom} />
          )}
        </div>
      </div>
      <MiniMap project={project} zoom={zoom} view={view} scroll={scroll} />
      {menu && <ClipMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Toolbar() {
  const snapOn = useV((s) => s.snap);
  const zoom = useV((s) => s.zoom);
  const hasSel = useV((s) => s.selection.length > 0);
  const p = useV((s) => s.project);
  const btn = (
    icon: IconName,
    title: string,
    onClick: () => void,
    opts: { on?: boolean; disabled?: boolean; flip?: boolean; rot?: boolean } = {},
  ) => (
    <button
      className={`vs-icon-btn ${opts.on ? 'on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={opts.on}
      disabled={opts.disabled}
      onClick={onClick}
    >
      <Icon
        name={icon}
        size={16}
        className={opts.flip ? 'vs-flip' : opts.rot ? 'vs-rot' : undefined}
      />
    </button>
  );
  return (
    <div className="vs-tools" role="toolbar" aria-label={tv('timeline')}>
      {btn('scissors', tv('split'), splitAtPlayhead)}
      {btn('trash', tv('delete'), () => deleteSelection(false), { disabled: !hasSel })}
      {btn('columns', tv('rippleDelete'), () => deleteSelection(true), { disabled: !hasSel })}
      {btn('link', tv('detachAudio'), detachSelectedAudio)}
      <span className="vs-sep" />
      {btn(
        'magnet',
        snapOn ? tv('snapOn') : tv('snapOff'),
        () => setV((s) => ({ snap: !s.snap })),
        { on: snapOn },
      )}
      {btn('flag', tv('marker'), addMarkerAtPlayhead)}
      <button className="vs-text-btn" title={tv('setIn')} onClick={() => setInOut('in')}>
        I
      </button>
      <button className="vs-text-btn" title={tv('setOut')} onClick={() => setInOut('out')}>
        O
      </button>
      {(p.inPoint != null || p.outPoint != null) &&
        btn('x', tv('clearInOut'), () =>
          commit({ ...getV().project, inPoint: null, outPoint: null }, tv('clearInOut')),
        )}
      <div className="spacer" />
      {btn('minimize', tv('zoomOut'), () => zoomBy(1 / 1.5))}
      <input
        type="range"
        className="vs-zoom"
        min={Math.log(MIN_ZOOM)}
        max={Math.log(MAX_ZOOM)}
        step={0.01}
        value={Math.log(zoom)}
        aria-label={tv('zoomIn')}
        onChange={(e) => setV({ zoom: Math.exp(Number(e.target.value)) })}
      />
      {btn('maximize', tv('zoomIn'), () => zoomBy(1.5))}
      {btn('arrowsV', tv('zoomFit'), zoomToFit, { rot: true })}
    </div>
  );
}

function TrackAdders() {
  return (
    <div className="vs-adders">
      <button
        className="vs-mini"
        title={tv('addVideoTrack')}
        onClick={() => commit(addTrack(getV().project, 'video'), tv('addVideoTrack'))}
      >
        <Icon name="plus" size={11} /> V
      </button>
      <button
        className="vs-mini"
        title={tv('addAudioTrack')}
        onClick={() => commit(addTrack(getV().project, 'audio'), tv('addAudioTrack'))}
      >
        <Icon name="plus" size={11} /> A
      </button>
    </div>
  );
}

function TrackHead({ track, project }: { track: Track; project: VideoProject }) {
  const set = (patch: Partial<Track>, label: string) =>
    commit(updateTrack(getV().project, track.id, patch), label);
  const n = project.clips.filter((c) => c.trackId === track.id).length;
  return (
    <div className="vs-head" style={{ width: HEAD_W }}>
      <span className={`vs-head-tag vs-tag-${track.kind}`}>
        <Icon name={track.kind === 'video' ? 'film' : 'music'} size={12} />
      </span>
      <button
        className="vs-head-name"
        title={tv('trackRename')}
        onDoubleClick={async () => {
          const name = (await vPrompt(tv('trackRename'), track.name))?.trim();
          if (name) set({ name: name.slice(0, 40) }, tv('trackRename'));
        }}
      >
        {track.name}
      </button>
      <div className="vs-head-btns">
        {track.kind === 'video' && (
          <button
            className={`vs-icon-btn ${track.hidden ? 'on-warn' : ''}`}
            title={track.hidden ? tv('trackShow') : tv('trackHide')}
            aria-label={track.hidden ? tv('trackShow') : tv('trackHide')}
            onClick={() =>
              set({ hidden: !track.hidden }, track.hidden ? tv('trackShow') : tv('trackHide'))
            }
          >
            <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={13} />
          </button>
        )}
        <button
          className={`vs-icon-btn ${track.muted ? 'on-warn' : ''}`}
          title={track.muted ? tv('trackUnmute') : tv('trackMute')}
          aria-label={track.muted ? tv('trackUnmute') : tv('trackMute')}
          onClick={() =>
            set({ muted: !track.muted }, track.muted ? tv('trackUnmute') : tv('trackMute'))
          }
        >
          <Icon name={track.muted ? 'volumeOff' : 'volume'} size={13} />
        </button>
        <button
          className={`vs-icon-btn ${track.locked ? 'on-warn' : ''}`}
          title={track.locked ? tv('trackUnlock') : tv('trackLock')}
          aria-label={track.locked ? tv('trackUnlock') : tv('trackLock')}
          onClick={() =>
            set({ locked: !track.locked }, track.locked ? tv('trackUnlock') : tv('trackLock'))
          }
        >
          <Icon name={track.locked ? 'lock' : 'unlock'} size={13} />
        </button>
        <button
          className="vs-icon-btn vs-head-del"
          title={tv('trackRemove')}
          aria-label={tv('trackRemove')}
          disabled={project.tracks.filter((t) => t.kind === track.kind).length <= 1}
          onClick={async () => {
            if (
              n &&
              !(await confirmDialog(tv('trackRemoveAsk', { name: track.name, n }), {
                danger: true,
              }))
            )
              return;
            commit(removeTrack(getV().project, track.id), tv('trackRemove'));
          }}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  );
}

function Ruler({
  project,
  zoom,
  width,
  from,
  to,
  onMouseDown,
}: {
  project: VideoProject;
  zoom: number;
  width: number;
  from: number;
  to: number;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const step = rulerStep(zoom, project.fps);
  const ticks: number[] = [];
  for (let t = Math.floor(from / step) * step; t <= to; t += step)
    ticks.push(Math.round(t * 1e6) / 1e6);
  return (
    <div className="vs-ruler" style={{ width }} onMouseDown={onMouseDown}>
      {ticks.map((t) => (
        <div key={t} className="vs-tick" style={{ left: t * zoom }}>
          <span>{rulerLabel(t, step, project.fps)}</span>
        </div>
      ))}
      {ticks.map((t) => (
        <div key={`m${t}`} className="vs-tick-minor" style={{ left: (t + step / 2) * zoom }} />
      ))}
      {project.markers.map((m) => (
        <div
          key={m.id}
          className="vs-marker"
          style={{ left: m.time * zoom, '--mk': m.color } as CSSProperties}
          title={m.name}
          onMouseDown={(e) => {
            e.stopPropagation();
            seek(m.time);
          }}
          onDoubleClick={async (e) => {
            e.stopPropagation();
            const name = (await vPrompt(tv('markerName'), m.name))?.trim();
            if (name == null) return;
            const p = getV().project;
            commit(
              { ...p, markers: p.markers.map((x) => (x.id === m.id ? { ...x, name } : x)) },
              tv('markerName'),
            );
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const p = getV().project;
            commit({ ...p, markers: p.markers.filter((x) => x.id !== m.id) }, tv('removeMarker'));
          }}
        >
          {m.name && <span>{m.name}</span>}
        </div>
      ))}
    </div>
  );
}

/** Overlays are clipped at the track headers' edge (`scrollLeft`), so they never cover them. */
function InOutShade({
  project,
  zoom,
  scrollLeft,
}: {
  project: VideoProject;
  zoom: number;
  scrollLeft: number;
}) {
  if (project.inPoint == null && project.outPoint == null) return null;
  const a = Math.max((project.inPoint ?? 0) * zoom, scrollLeft);
  const b = (project.outPoint ?? projectDuration(project)) * zoom;
  if (b <= a) return null;
  return (
    <div
      className={`vs-inout ${a > (project.inPoint ?? 0) * zoom ? 'vs-inout-cut' : ''}`}
      style={{ left: HEAD_W + a, width: Math.max(1, b - a) }}
    />
  );
}

function Playhead({ zoom, scrollLeft }: { zoom: number; scrollLeft: number }) {
  const t = useV((s) => s.playhead);
  if (t * zoom < scrollLeft - 1) return null;
  return (
    <div className="vs-playhead" style={{ transform: `translateX(${HEAD_W + t * zoom}px)` }}>
      <div className="vs-playhead-cap" />
    </div>
  );
}

function SnapLine({ x }: { x: number }) {
  return <div className="vs-snapline" style={{ transform: `translateX(${x}px)` }} />;
}

function ClipView({
  clip,
  media,
  track,
  zoom,
  selected,
  invalid,
  view,
  onDown,
  onMenu,
}: {
  clip: Clip;
  media: MediaItem | undefined;
  track: Track;
  zoom: number;
  selected: boolean;
  invalid: boolean;
  view: { t0: number; t1: number };
  onDown: (e: React.MouseEvent, c: Clip, edge: 'left' | 'right' | null) => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const thumb = useV((s) => s.thumbs[clip.mediaId]);
  const wave = useV((s) => s.waves[clip.mediaId]);
  const left = clip.start * zoom;
  const width = Math.max(2, clipDur(clip) * zoom);
  const kind = clip.text ? 'text' : (media?.kind ?? 'video');
  const name = clip.text ? clip.text.content.split('\n')[0] || tv('textClip') : media?.name;
  const showStrip = track.kind === 'video' && thumb && !media?.missing;
  const h = ROW_H[track.kind] - 8;
  const waveH = track.kind === 'audio' ? h - 16 : 14;
  return (
    <div
      className={`vs-clip vs-clip-${kind} ${clip.ramp ? 'vs-clip-ramp' : ''} ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''} ${media?.missing ? 'vs-missing' : ''}`}
      style={{ left, width }}
      onMouseDown={(e) => onDown(e, clip, null)}
      onContextMenu={onMenu}
      title={name ? `${name} · ${clipDur(clip).toFixed(2)} s` : ''}
    >
      {showStrip && media && (
        <Filmstrip
          clip={clip}
          media={media}
          url={thumb}
          zoom={zoom}
          height={h - (media.hasAudio ? waveH : 0)}
          view={view}
        />
      )}
      <div className="vs-clip-label">
        {clip.text && <span className="vs-clip-t">T</span>}
        {name ?? '?'}
        {clip.effects && <span className="vs-clip-speed">fx</span>}
        {clip.ramp ? (
          <span className="vs-clip-speed" title={`${speedOf(clip)}×`}>
            ⤳
          </span>
        ) : (
          speedOf(clip) !== 1 && <span className="vs-clip-speed">{`${speedOf(clip)}×`}</span>
        )}
      </div>
      {clip.transition && (
        <div
          className="vs-tr-mark"
          title={`${tv('editTransition')} · ${transitionLabel(clip.transition.kind, clip.transition.def)} · ${clip.transition.d} s`}
        />
      )}
      {!!clip.fadeIn && (
        <div className="vs-fade vs-fade-in" style={{ width: clip.fadeIn * zoom }} />
      )}
      {!!clip.fadeOut && (
        <div className="vs-fade vs-fade-out" style={{ width: clip.fadeOut * zoom }} />
      )}
      {clip.keyframes &&
        keyTimes(clip).map((t) => (
          // Kept inside the clip so keys on its edges are not cut in half.
          <div
            key={t}
            className="vs-kf"
            style={{ left: Math.min(Math.max((t - clip.start) * zoom, 5), width - 5) }}
          />
        ))}
      {wave && media?.hasAudio && (
        <Waveform
          clip={clip}
          wave={wave}
          zoom={zoom}
          height={waveH}
          view={view}
          muted={track.muted || clip.volume <= 0}
        />
      )}
      <div className="vs-trim vs-trim-l" onMouseDown={(e) => onDown(e, clip, 'left')} />
      <div className="vs-trim vs-trim-r" onMouseDown={(e) => onDown(e, clip, 'right')} />
    </div>
  );
}

/** Thumbnail tiles; each shows the frame at its source time (24-frame sprite). */
function Filmstrip({
  clip,
  media,
  url,
  zoom,
  height,
  view,
}: {
  clip: Clip;
  media: MediaItem;
  url: string;
  zoom: number;
  height: number;
  view: { t0: number; t1: number };
}) {
  const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
  const tileW = Math.max(16, height * aspect);
  const still = media.kind === 'image';
  const width = clipDur(clip) * zoom;
  const tiles: { x: number; frame: number }[] = [];
  const firstX = Math.max(0, Math.floor(((view.t0 - clip.start) * zoom) / tileW) * tileW);
  const lastX = Math.min(width, (view.t1 - clip.start) * zoom);
  for (let x = firstX; x < lastX && tiles.length < 200; x += tileW) {
    const src = clip.in + ((x + tileW / 2) / zoom) * speedOf(clip);
    tiles.push({
      x,
      frame: Math.min(23, Math.max(0, Math.floor((src / Math.max(0.001, media.duration)) * 24))),
    });
  }
  return (
    <div className="vs-strip" style={{ height }}>
      {tiles.map((tl) => (
        <div
          key={tl.x}
          className="vs-tile"
          style={{
            left: tl.x,
            width: tileW,
            height,
            backgroundImage: `url("${url}")`,
            // A picture is one image; a video thumbnail is a strip of 24 frames.
            backgroundSize: still ? 'cover' : `${tileW * 24}px ${height}px`,
            backgroundPosition: still ? 'center' : `${-tl.frame * tileW}px 0`,
          }}
        />
      ))}
    </div>
  );
}

function Waveform({
  clip,
  wave,
  zoom,
  height,
  view,
  muted,
}: {
  clip: Clip;
  wave: { pps: number; peaks: number[] };
  zoom: number;
  height: number;
  view: { t0: number; t1: number };
  muted: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Draw only the visible part of the clip (canvases have a size limit).
  const a = Math.max(clip.start, view.t0);
  const b = Math.min(clipEnd(clip), view.t1);
  const left = (a - clip.start) * zoom;
  const width = Math.max(1, Math.min(8000, Math.round((b - a) * zoom)));
  const sp = speedOf(clip);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = muted ? 'rgba(160,160,160,0.45)' : 'rgba(255,255,255,0.75)';
    const mid = height / 2;
    const scaleV = Math.min(2, clip.volume);
    for (let x = 0; x < width; x++) {
      const t0 = clip.in + (a - clip.start + x / zoom) * sp;
      const t1 = t0 + sp / zoom;
      let peak = 0;
      for (let i = Math.floor(t0 * wave.pps); i <= Math.floor(t1 * wave.pps); i++)
        peak = Math.max(peak, wave.peaks[i] ?? 0);
      const hh = Math.max(0.5, (peak / 255) * mid * scaleV);
      ctx.fillRect(x, mid - hh, 1, hh * 2);
    }
  }, [a, b, width, height, zoom, clip.in, clip.start, sp, clip.volume, wave, muted]);
  if (b <= a) return null;
  return <canvas ref={ref} className="vs-wave" style={{ left, width, height }} />;
}

function MiniMap({
  project,
  zoom,
  view,
  scroll,
}: {
  project: VideoProject;
  zoom: number;
  view: { left: number; width: number };
  scroll: React.RefObject<HTMLDivElement | null>;
}) {
  const total = Math.max(projectDuration(project), 1);
  const visible = (view.width - HEAD_W) / zoom;
  const span = Math.max(total, view.left / zoom + visible);
  const go = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * span - visible / 2;
    if (scroll.current) scroll.current.scrollLeft = Math.max(0, t * zoom);
  };
  const rows = project.tracks;
  return (
    <div
      className="vs-minimap"
      aria-hidden="true"
      onMouseDown={(e) => {
        go(e);
        const el = e.currentTarget;
        const move = (ev: MouseEvent) =>
          go({ ...ev, currentTarget: el } as unknown as React.MouseEvent<HTMLDivElement>);
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    >
      {project.clips.map((c) => {
        const row = rows.findIndex((t) => t.id === c.trackId);
        return (
          <div
            key={c.id}
            className={`vs-mm-clip vs-mm-${rows[row]?.kind}`}
            style={{
              left: `${(c.start / span) * 100}%`,
              width: `${(clipDur(c) / span) * 100}%`,
              top: `${(row / rows.length) * 100}%`,
              height: `${100 / rows.length}%`,
            }}
          />
        );
      })}
      <div
        className="vs-mm-view"
        style={{
          left: `${(view.left / zoom / span) * 100}%`,
          width: `${Math.min(100, (visible / span) * 100)}%`,
        }}
      />
    </div>
  );
}

function ClipMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const canDetach = useV((s) =>
    s.selection.some((id) =>
      canDetachAudio(
        s.project,
        s.project.clips.find((c) => c.id === id),
      ),
    ),
  );
  const [pos, setPos] = useState({ x, y });
  // Right-clicking near the bottom or the right edge: open upwards / leftwards.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, y + r.height > window.innerHeight - 4 ? y - r.height : y),
    });
  }, [x, y]);
  useEffect(() => {
    const release = holdEscape(onClose);
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', away);
    return () => {
      release();
      window.removeEventListener('mousedown', away);
    };
  }, [onClose]);
  const item = (label: string, run: () => void) => (
    <button
      className="vs-menu-item"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      className="vs-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {item(tv('split'), splitAtPlayhead)}
      {item(tv('delete'), () => deleteSelection(false))}
      {item(tv('rippleDelete'), () => deleteSelection(true))}
      {canDetach && item(tv('detachAudio'), detachSelectedAudio)}
    </div>
  );
}
