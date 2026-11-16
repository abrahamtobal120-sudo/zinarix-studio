/**
 * Fase 14: render a scene (viewer or Blender) and hand the file to Video Studio; answer the
 * agent's render requests.
 */
import { addTrack, clipEnd } from '../../../shared/video';
import type { Render3DFormat, Scene3D } from '../../../shared/scene3d';
import type { BlenderEngine } from '../../../shared/scene3dBpy';
import type { Render3DResult } from '../../../shared/api';
import { api, toast } from '../../store';
import { addToTimeline, commit as commitVideo, getV, importPaths } from '../video/videoStore';
import { renderToFile } from './render3d';
import { set3 } from './store3d';
import { t3 } from './strings3d';

export type Engine3D = 'viewer' | BlenderEngine;

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * Imports a render into Video Studio and, when asked, places it at the playhead on the top
 * video track (a new track when that spot is taken, so nothing underneath moves).
 */
export async function addToVideo(path: string, timeline = true): Promise<void> {
  if (/%0\dd/.test(path)) return; // a PNG sequence: not a single clip
  const [m] = await importPaths([path]);
  if (!m || !timeline) return;
  let p = getV().project;
  const at = getV().playhead;
  const end = at + m.duration;
  let top = p.tracks.find((t) => t.kind === 'video');
  const busy = (id: string) =>
    p.clips.some((c) => c.trackId === id && c.start < end - 1e-6 && clipEnd(c) > at + 1e-6);
  if (!top || busy(top.id)) {
    p = addTrack(p, 'video');
    commitVideo(p, t3('addTimeline'));
    top = p.tracks.find((t) => t.kind === 'video')!;
  }
  addToTimeline(m, { trackId: top.id, start: at });
  toast(t3('addedTimeline', { name: m.name }));
}

/** Renders with progress in the editor's state; resolves with the file, or null if canceled. */
export async function render3d(
  scene: Scene3D,
  o: { engine: Engine3D; format: Render3DFormat; name: string; timeline: boolean },
): Promise<Render3DResult | null> {
  const ctl = new AbortController();
  const id = crypto.randomUUID();
  const label = (k: number) => t3('rendering', { pct: Math.round(k * 100) });
  set3({ render: { progress: 0, label: label(0), cancel: () => ctl.abort() }, dialog: false });
  const progress = (k: number) =>
    set3((s) => (s.render ? { render: { ...s.render, progress: k, label: label(k) } } : {}));
  try {
    let r: Render3DResult;
    if (o.engine === 'viewer') {
      r = await renderToFile(scene, {
        name: o.name,
        format: o.format,
        onProgress: progress,
        signal: ctl.signal,
      });
    } else {
      const off = api().on((ev) => {
        if (ev.type === 'scene3d' && ev.requestId === id) progress(ev.progress);
      });
      ctl.signal.addEventListener('abort', () => void api().scene3d.cancel(id), { once: true });
      try {
        r = await api().scene3d.blender(id, scene, {
          engine: o.engine,
          format: o.format,
          name: o.name,
        });
      } finally {
        off();
      }
    }
    toast(t3('renderDone', { name: base(r.path) }));
    await addToVideo(r.path, o.timeline);
    return r;
  } catch (e) {
    if (ctl.signal.aborted) {
      toast(t3('renderCanceled'));
      return null;
    }
    toast(t3('renderFailed', { err: e instanceof Error ? e.message : String(e) }));
    throw e;
  } finally {
    set3({ render: null });
  }
}

let wired = false;
/** The agent's render_3d (engine "viewer") and its finished Blender renders. */
export function wireAgent3d(): void {
  if (wired) return;
  wired = true;
  api().on((ev) => {
    if (ev.type === 'scene3d:imported') void addToVideo(ev.path, true);
    if (ev.type !== 'scene3d:agent') return;
    toast(t3('agentRender'));
    render3d(ev.scene, { engine: 'viewer', format: ev.format, name: ev.name, timeline: true })
      .then((r) =>
        api().scene3d.agentDone(
          ev.requestId,
          r ? { path: r.path } : { error: 'El usuario canceló el render.' },
        ),
      )
      .catch((e: unknown) =>
        api().scene3d.agentDone(ev.requestId, {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
  });
}
